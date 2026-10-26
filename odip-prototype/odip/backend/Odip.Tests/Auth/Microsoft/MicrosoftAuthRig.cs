using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services.Microsoft;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>Counts what the controller tells the lockout; delegates to the real tracker so a lockout really happens.</summary>
public sealed class RecordingTracker : ILoginAttemptTracker
{
    private readonly LoginAttemptTracker _inner = new();
    public List<string> Failures { get; } = new();
    public List<string> Successes { get; } = new();
    public bool IsLockedOut(string key, out TimeSpan retryAfter) => _inner.IsLockedOut(key, out retryAfter);
    public void RecordFailure(string key) { Failures.Add(key); _inner.RecordFailure(key); }
    public void RecordSuccess(string key) { Successes.Add(key); _inner.RecordSuccess(key); }
}

public sealed class FakeRedeemer : IMicrosoftCodeRedeemer
{
    public List<(string Code, string Verifier, string RedirectUri)> Calls { get; } = new();
    public Func<string?> Result { get; set; } = () => null;
    public Task<string?> RedeemAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct)
    {
        Calls.Add((code, codeVerifier, redirectUri));
        return Task.FromResult(Result());
    }
}

public sealed class TestClock : TimeProvider
{
    public TimeSpan Offset { get; set; }
    public override DateTimeOffset GetUtcNow() => base.GetUtcNow() + Offset;
}

/// <summary>What one request did: where it sent the browser, and the cookies it set.</summary>
public sealed record Outcome(string Location, IReadOnlyList<SetCookieHeaderValue> Cookies)
{
    public SetCookieHeaderValue? Cookie(string name) => Cookies.FirstOrDefault(c => c.Name == name);
    public string Code => System.Web.HttpUtility.ParseQueryString(new Uri("https://x" + Location).Query)["microsoft"] ?? "";
}

/// <summary>
/// The controller run the way production runs it: ANONYMOUS (no ambient tenant), real validator over a test key, real data protection, real staff
/// create and notification raiser, real lockout; only Entra's token endpoint (the redeemer) is a fake. Start and callback are chained through the
/// real correlation cookie, so a test cannot pass by skipping the cookie.
/// </summary>
public sealed class MicrosoftAuthRig
{
    public const string PublicBase = "https://odip.example.test";
    public const string PlatformDomain = "platform.example.com";
    public static readonly IPAddress Client = IPAddress.Parse("203.0.113.7");

    public OdipDbContext Db { get; }
    public RecordingTracker Tracker { get; } = new();
    public FakeRedeemer Redeemer { get; } = new();
    public TestClock Clock { get; } = new();
    public IDataProtectionProvider Dp { get; } = new EphemeralDataProtectionProvider();
    public IMemoryCache Cache { get; } = new MemoryCache(new MemoryCacheOptions());
    public Dictionary<string, string?> Settings { get; } = new()
    {
        ["Jwt:Secret"] = new string('k', 48),
        ["Auth:SuperAdminDomain"] = PlatformDomain,
        ["Microsoft:ClientId"] = MicrosoftTestTokens.ClientId,
        ["Microsoft:ClientSecret"] = "secret",
        ["Microsoft:PublicBaseUrl"] = PublicBase,
    };
    public string Nonce { get; private set; } = "";
    public string RequestHost { get; set; } = new Uri(PublicBase).Host;

    public Guid? AmbientTenant { get; set; }

    /// <summary>Replaces the real raiser (a Postgres race test hooks the moment between staging and saving).</summary>
    public INotificationRaiser? Raiser { get; set; }

    /// <summary>What the audit interceptor reads the request from; set to the current request each time a controller is built.</summary>
    public HttpContextAccessor Accessor { get; } = new();

    /// <param name="audit">Runs AuditInterceptor on the in-memory database, for a test that reads the audit rows back.</param>
    public MicrosoftAuthRig(Func<OdipDbContext>? dbFactory = null, bool audit = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(() => AmbientTenant);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        if (dbFactory is not null) { Db = dbFactory(); return; }
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
        if (audit) options.AddInterceptors(new AuditInterceptor(Accessor));
        Db = new OdipDbContext(options.Options, tenant.Object);
    }

    public MicrosoftAuthController Controller(HttpContext http, Odip.Api.Services.IFirebaseUserService? firebase = null)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(Settings).Build();
        Accessor.HttpContext = http;
        return new MicrosoftAuthController(
            Db, config, new Mock<ILogger<MicrosoftAuthController>>().Object, Tracker, Redeemer, MicrosoftTestTokens.Validator(), Dp, Cache, Clock,
            new StaffCreateService(Db, config), Raiser ?? new NotificationRaiser(Db), firebase)
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    public DefaultHttpContext Http(ClaimsPrincipal? user = null, string? cookieHeader = null)
    {
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = Client;
        http.Request.Scheme = "https";
        http.Request.Host = new HostString(RequestHost);
        if (user is not null) http.User = user;
        if (cookieHeader is not null) http.Request.Headers.Cookie = cookieHeader;
        return http;
    }

    public static ClaimsPrincipal Signed(Guid userId, Guid orgId, UserRole role) => new(new ClaimsIdentity(new[]
    {
        new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, role.ToString()), new Claim("tenant_id", orgId.ToString()),
    }, "test"));

    private static Outcome Read(HttpContext http, IActionResult result)
    {
        var location = result switch
        {
            RedirectResult r => r.Url,
            LocalRedirectResult l => l.Url,
            _ => throw new Xunit.Sdk.XunitException("expected a redirect, got " + result.GetType().Name),
        };
        var cookies = http.Response.Headers.SetCookie.Select(h => SetCookieHeaderValue.Parse(h!)).ToList();
        return new Outcome(location, cookies);
    }

    /// <summary>The raw request-cookie header for a Set-Cookie the previous response sent.</summary>
    public static string? CookieHeader(Outcome o, string name) => o.Cookie(name) is { } c ? $"{c.Name}={c.Value}" : null;

    public async Task<Outcome> StartAsync(string? intent = "signin", string? defaultRole = null, ClaimsPrincipal? user = null)
    {
        var http = Http(user);
        var result = Controller(http).Start(intent, defaultRole);
        var outcome = Read(http, result);
        if (outcome.Cookie(MicrosoftAuthController.CorrelationCookie) is not null)
            Nonce = System.Web.HttpUtility.ParseQueryString(new Uri(outcome.Location).Query)["nonce"]!;
        await Task.CompletedTask;
        return outcome;
    }

    public async Task<Outcome> CallbackAsync(string? cookieHeader, string? state, string? code = "code1", string? error = null)
    {
        var http = Http(null, cookieHeader);
        return Read(http, await Controller(http).Callback(code, state, error, CancellationToken.None));
    }

    public static string StateOf(Outcome start) => System.Web.HttpUtility.ParseQueryString(new Uri(start.Location).Query)["state"]!;

    /// <summary>Start, then callback with the id token <paramref name="mint"/> builds for the nonce Start issued.</summary>
    public async Task<Outcome> RunAsync(Func<string, string?> mint, string intent = "signin", string? defaultRole = null, ClaimsPrincipal? user = null)
    {
        var start = await StartAsync(intent, defaultRole, user);
        Redeemer.Result = () => mint(Nonce);
        return await CallbackAsync(CookieHeader(start, MicrosoftAuthController.CorrelationCookie), StateOf(start));
    }

    // ── fixtures ──

    public Tenant Org(string name = "Acme", string? domain = "acme.test", bool active = true)
    {
        var t = new Tenant { Id = Guid.NewGuid(), Name = name, EmailDomain = domain, IsActive = active, CreatedAt = DateTime.UtcNow };
        Db.Tenants.Add(t);
        Db.SaveChanges();
        return t;
    }

    public User Person(Guid orgId, string email, UserRole role = UserRole.Coordinator, bool active = true, Guid? tid = null, Guid? oid = null)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = orgId, FirstName = "Jane", LastName = "Smith", Username = Guid.NewGuid().ToString("N"), Email = email,
            Role = role, IsActive = active, MicrosoftTenantId = tid, MicrosoftObjectId = oid, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        Db.Users.Add(u);
        Db.SaveChanges();
        return u;
    }

    public MicrosoftTenantLink Link(Guid orgId, Guid? tid = null, UserRole role = UserRole.SupportWorker, Guid? by = null)
    {
        var l = new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = orgId, MicrosoftTenantId = tid ?? MicrosoftTestTokens.OrgTid, DefaultRole = role, LinkedByUserId = by ?? Guid.NewGuid() };
        Db.MicrosoftTenantLinks.Add(l);
        Db.SaveChanges();
        return l;
    }

    public const string GlobalAdmin = "62e90394-69f5-4237-9190-012177145e10";
    public static readonly Guid PersonOid = Guid.Parse("cccccccc-0000-0000-0000-000000000003");

    /// <summary>A verified-domain id token (xms_edov) for the standard tid, with the given overrides.</summary>
    public static Func<string, string?> Token(string? email = "pat@contoso.example", string? upn = null, Guid? tid = null, Guid? oid = null, bool verified = true,
        IDictionary<string, object>? extra = null, bool withWids = true) => nonce =>
    {
        var claims = new Dictionary<string, object>(extra ?? new Dictionary<string, object>());
        if (verified) claims["xms_edov"] = "1";
        claims.TryAdd("name", "Pat Contoso");
        if (withWids) claims.TryAdd("wids", new[] { GlobalAdmin }); // so a link-tenant test passes the directory-admin check by default
        return MicrosoftTestTokens.Mint(tid, oid ?? PersonOid, nonce, email: email, upn: upn, extra: claims);
    };

    public static JwtSecurityToken Jwt(Outcome o) => new JwtSecurityTokenHandler().ReadJwtToken(Uri.UnescapeDataString(o.Cookie("odip_jwt")!.Value.Value!));
}
