using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Controllers;
using Xunit;

namespace Odip.Tests.Auth;

/// <summary>
/// The failed-sign-in lockout as it behaves through the DEPLOYED shape, rather
/// than the direct-call shape the existing suite uses.
///
/// <para>
/// Supervisor cycle 884 found the lockout keyed on the proxy's address: one caller
/// sending 10 bad tokens returned 429 to every other user of the deployment. The
/// address key was correct code — the genuine client address never arrived, because
/// <c>docker-proxy</c> serves the published port, so nginx's <c>$remote_addr</c> is the
/// Docker bridge gateway for every caller and <c>proxy_add_x_forwarded_for</c>
/// appends that gateway as the rightmost entry.
/// </para>
///
/// <para>
/// The existing <c>AuthControllerExchangeTests</c> passes only because it assigns
/// <c>Connection.RemoteIpAddress</c> on a bare <c>DefaultHttpContext</c>: it bypasses
/// the proxy, so it cannot reproduce the defect. These tests run the real
/// <see cref="ForwardedHeadersMiddleware"/> with the deployed options over the headers
/// deployed nginx actually sends, so they see what production resolves. Against the
/// pre-fix tree <see cref="One_client_behind_the_proxy_can_no_longer_lock_out_everyone_else"/>
/// fails, which is what makes them worth having.
/// </para>
/// </summary>
public class AuthControllerProxyPartitionTests
{
    private const string BridgeGateway = "172.31.0.1";   // what docker-proxy leaves as nginx's peer
    private const string TenantDomain = "acme.example.com";
    private const string SuperAdminDomain = "platform.example.com";

    /// <summary>
    /// Three legal base64url segments, so the shape guard (FirebaseIdTokenShape) admits
    /// it and the exchange reaches the verifier. This matters: the existing suite's
    /// <c>AnyShapedToken</c> ("eyJhbG...dXJl") splits into FOUR segments and is refused by
    /// the shape guard before the verifier is ever asked — harmless there, because those
    /// tests only assert a 401, but it would make "a genuine credential still gets in"
    /// untestable.
    /// </summary>
    private const string AnyShapedToken = "aaa.bbb.ccc";

    private static ForwardedHeadersOptions DeployedOptions() => new()
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        KnownNetworks = { new Microsoft.AspNetCore.HttpOverrides.IPNetwork(IPAddress.Parse("172.16.0.0"), 12) },
    };

    /// <summary>
    /// An HttpContext that has been through the real ForwardedHeadersMiddleware with the
    /// deployed options, carrying exactly the headers deployed nginx sends.
    /// </summary>
    private static DefaultHttpContext ProxiedContext(string? forwardedFor)
    {
        var context = new DefaultHttpContext { TraceIdentifier = Guid.NewGuid().ToString() };
        context.Connection.RemoteIpAddress = IPAddress.Parse(BridgeGateway);
        context.Request.Headers["Host"] = "odip.example";
        context.Request.Headers["X-Forwarded-Proto"] = "http";

        // proxy_add_x_forwarded_for APPENDS the peer nginx saw — the gateway. That entry
        // is what ForwardedHeadersMiddleware adopts, and it is the whole defect.
        if (forwardedFor is not null)
            context.Request.Headers["X-Forwarded-For"] = $"{forwardedFor}, {BridgeGateway}";

        var services = new ServiceCollection();
        services.AddLogging();
        var app = new ApplicationBuilder(services.BuildServiceProvider());
        app.UseForwardedHeaders(DeployedOptions());
        app.Build()(context);

        return context;
    }

    /// <summary>A client reaching the API with no proxy in front: a real, partitionable address.</summary>
    private static DefaultHttpContext DirectContext(string address)
    {
        var context = new DefaultHttpContext { TraceIdentifier = Guid.NewGuid().ToString() };
        context.Connection.RemoteIpAddress = IPAddress.Parse(address);
        return context;
    }

    private sealed class AlwaysRefusingVerifier : IFirebaseTokenVerifier
    {
        public Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct) =>
            throw FirebaseTestExceptions.WithCode(FirebaseAdmin.Auth.AuthErrorCode.InvalidIdToken);
    }

    /// <summary>Vouches for a genuine sign-in, with claims built the way the real SDK builds them.</summary>
    private sealed class AcceptingVerifier(string email) : IFirebaseTokenVerifier
    {
        public Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct) =>
            Task.FromResult(FirebaseTestClaims.For(email, emailVerified: true));
    }

    private static AuthController Controller(
        OdipDbContext db,
        ILoginAttemptTracker tracker,
        DefaultHttpContext http,
        IFirebaseTokenVerifier? verifier = null)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Secret"] = new string('k', 48),
            ["Auth:SuperAdminDomain"] = SuperAdminDomain,
        }).Build();

        return new AuthController(
            db, config, new Mock<ILogger<AuthController>>().Object, tracker,
            new Mock<ICurrentTenant>().Object, verifier ?? new AlwaysRefusingVerifier())
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    // The exchange runs ANONYMOUS: the ambient tenant is none and the caller is not a
    // SuperAdmin, exactly as in production (see AuthControllerExchangeTests.CreateDb).
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static Tenant SeedTenant(OdipDbContext db, string name = "Acme Support", string domain = TenantDomain)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = name, EmailDomain = domain, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, string storedEmail)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Jane", LastName = "Smith",
            Username = Guid.NewGuid().ToString("N"), Email = storedEmail, Role = UserRole.Coordinator,
            IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    private static Task<ActionResult<ApiResponse<AuthResponseDto>>> Exchange(AuthController controller) =>
        controller.Exchange(new ExchangeTokenDto { IdToken = AnyShapedToken }, CancellationToken.None);

    private static int StatusOf(ActionResult<ApiResponse<AuthResponseDto>> result) =>
        result.Result switch
        {
            UnauthorizedObjectResult => StatusCodes.Status401Unauthorized,
            ObjectResult { StatusCode: not null } objectResult => objectResult.StatusCode.Value,
            _ => StatusCodes.Status200OK,
        };

    // ── The regression: one client must not lock out the others ──────────────

    [Fact]
    public async Task One_client_behind_the_proxy_can_no_longer_lock_out_everyone_else()
    {
        // Pre-fix this FAILS at the final assertion: client B is refused 429, because
        // A's 10 failures were counted against the shared key 172.31.0.1.
        using var db = CreateDb();
        var tracker = new LoginAttemptTracker(TimeProvider.System);

        var probe = ProxiedContext("203.0.113.9");
        for (var attempt = 0; attempt < LoginAttemptTracker.MaxFailures; attempt++)
            await Exchange(Controller(db, tracker, ProxiedContext("203.0.113.9")));

        // Guards the fixture itself: if this ever stops being the proxy shape, the
        // assertions below would pass for the wrong reason.
        Assert.True(Odip.Api.Services.ClientIp.IsIndistinguishableFromProxy(probe));

        var bStatus = StatusOf(await Exchange(Controller(db, tracker, ProxiedContext("203.0.113.10"))));

        Assert.NotEqual(StatusCodes.Status429TooManyRequests, bStatus);
    }

    [Fact]
    public async Task A_genuine_credential_is_never_locked_out_by_a_strangers_failures()
    {
        // The property that matters most, and it holds even when the address IS shared:
        // a valid credential always succeeds, whatever the counter says.
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "real.person@acme.example.com");
        var tracker = new LoginAttemptTracker(TimeProvider.System);

        // A stranger exhausts the budget from the very address the real person uses.
        for (var attempt = 0; attempt < LoginAttemptTracker.MaxFailures + 5; attempt++)
            await Exchange(Controller(db, tracker, ProxiedContext("203.0.113.9")));

        var real = Controller(
            db, tracker, ProxiedContext("203.0.113.9"),
            new AcceptingVerifier("real.person@acme.example.com"));

        var result = await Exchange(real);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(user.Id, Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!.Id);
    }

    [Fact]
    public async Task A_locked_out_client_still_gets_a_429_for_a_bad_token_so_the_defence_is_not_merely_disarmed()
    {
        // The mitigation must not decay into "no lockout at all". Where a real
        // per-client key DOES exist, exceeding the budget still answers 429.
        using var db = CreateDb();
        var tracker = new LoginAttemptTracker(TimeProvider.System);

        for (var attempt = 0; attempt < LoginAttemptTracker.MaxFailures; attempt++)
            await Exchange(Controller(db, tracker, DirectContext("198.51.100.7")));

        var status = StatusOf(await Exchange(Controller(db, tracker, DirectContext("198.51.100.7"))));

        Assert.Equal(StatusCodes.Status429TooManyRequests, status);
    }

    [Fact]
    public async Task Through_the_deployed_proxy_shape_nothing_is_locked_out_so_one_caller_cannot_lock_out_another()
    {
        // States the trade honestly: behind docker-proxy the budget is not counted,
        // because the only key available is one every client shares. Until the deploy
        // publishes without the userspace proxy, the flood is bounded by the
        // address-keyed rate limiter (60 per 5 minutes) and the cost of a Firebase
        // verification per attempt — not by this counter.
        using var db = CreateDb();
        var tracker = new LoginAttemptTracker(TimeProvider.System);

        for (var attempt = 0; attempt < LoginAttemptTracker.MaxFailures * 4; attempt++)
        {
            var status = StatusOf(await Exchange(Controller(db, tracker, ProxiedContext("203.0.113.9"))));
            Assert.Equal(StatusCodes.Status401Unauthorized, status);
        }
    }
}