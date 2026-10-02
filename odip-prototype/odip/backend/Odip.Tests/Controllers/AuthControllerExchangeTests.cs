using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The sign-in exchange (Firebase ID token to ODIP session), run end to end through <see cref="IFirebaseTokenVerifier"/> with
/// a fake that returns claims (built the way the Admin SDK builds them, see <see cref="FirebaseTestClaims"/>). Firebase lower-cases every address, so a token's email is always lower-case; these tests pin that a
/// user row is found whatever case it was stored in (rows written before the email-identity rule existed are mixed-case, and no
/// migration repairs them), on both the tenant path and the SuperAdmin path.
/// </summary>
public class AuthControllerExchangeTests
{
    private const string TenantDomain = "acme.example.com";
    private const string SuperAdminDomain = "platform.example.com";

    private sealed class FakeVerifier(IReadOnlyDictionary<string, object> claims) : IFirebaseTokenVerifier
    {
        public Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<string, object>>(claims);
    }

    // The shape of the request that reaches the exchange in PRODUCTION: ANONYMOUS. CurrentTenant reads the tenant and the SuperAdmin flag from a JWT the
    // caller does not have yet, so the ambient tenant is none and the caller is no SuperAdmin; the Users query filter then admits no row at all, and
    // the exchange finds anyone only because its look-ups call IgnoreQueryFilters(). A context that said IsSuperAdmin = true (as these tests once did)
    // admits every row whether or not that call is there, so dropping it left every test green and every sign-in a 401 in production.
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static Tenant SeedTenant(OdipDbContext db, string name = "Acme Support", string domain = TenantDomain, bool isActive = true)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = name, EmailDomain = domain, IsActive = isActive, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, string storedEmail, UserRole role = UserRole.Coordinator, bool isActive = true, Guid? id = null)
    {
        var user = new User
        {
            Id = id ?? Guid.NewGuid(), TenantId = tenantId, FirstName = "Jane", LastName = "Smith", Username = Guid.NewGuid().ToString("N"),
            Email = storedEmail, Role = role, IsActive = isActive, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    // A person who signed in with email and password unless the test says otherwise (the one provider the app's own sign-in screen uses).
    private static AuthController CreateController(
        OdipDbContext db, string tokenEmail, bool emailVerified = true, ILogger<AuthController>? logger = null, string? signInProvider = "password",
        Dictionary<string, string?>? settings = null) =>
        CreateController(db, FirebaseTestClaims.For(tokenEmail, emailVerified, signInProvider), logger, settings);

    private static AuthController CreateController(
        OdipDbContext db, IReadOnlyDictionary<string, object> claims, ILogger<AuthController>? logger = null, Dictionary<string, string?>? settings = null)
    {
        var configured = new Dictionary<string, string?> { ["Jwt:Secret"] = new string('k', 48), ["Auth:SuperAdminDomain"] = SuperAdminDomain };
        foreach (var (key, value) in settings ?? [])
            configured[key] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(configured).Build();
        // The lockout is per client address. Each controller has its own tracker, so a test that wants every attempt to spend from one budget
        // reuses one controller.
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = ClientAddress;

        return new AuthController(
            db, config, logger ?? new Mock<ILogger<AuthController>>().Object, new LoginAttemptTracker(TimeProvider.System),
            new Mock<ICurrentTenant>().Object, new FakeVerifier(claims))
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    private static readonly IPAddress ClientAddress = IPAddress.Parse("203.0.113.7");

    // What is stored, read around the Users filter and the change tracker: the anonymous context the exchange runs on admits no row, and a tracked
    // row would show an unsaved change as if it had been written.
    private static DateTime? StoredLastLoginAt(OdipDbContext db, Guid userId) =>
        db.Users.IgnoreQueryFilters().AsNoTracking().Single(u => u.Id == userId).LastLoginAt;

    private static Task<ActionResult<ApiResponse<AuthResponseDto>>> Exchange(AuthController controller) =>
        controller.Exchange(new ExchangeTokenDto { IdToken = "token-the-fake-accepts" }, CancellationToken.None);

    // ── Tenant path ─────────────────────────────────────────────────────

    [Fact]
    public async Task Tenant_path_finds_a_row_stored_in_mixed_case_from_the_lower_case_email_in_the_token()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "Jane.Smith@acme.example.com");

        var result = await Exchange(CreateController(db, "jane.smith@acme.example.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value);
        Assert.Equal(user.Id, body.Data!.Id);
        Assert.Equal(tenant.Id, body.Data.TenantId);
    }

    [Fact]
    public async Task Tenant_path_also_normalises_the_token_email_it_compares_with()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "jane.smith@acme.example.com");

        var result = await Exchange(CreateController(db, "  Jane.Smith@ACME.example.com "));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(user.Id, Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!.Id);
    }

    [Fact]
    public async Task Tenant_path_does_not_match_an_inactive_user_or_a_different_address()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "Jane.Smith@acme.example.com", isActive: false);
        SeedUser(db, tenant.Id, "Janet.Smith@acme.example.com");

        // The only row for this address is inactive, and "janet" is not "jane": case-insensitive must not turn into fuzzy.
        var result = await Exchange(CreateController(db, "jane.smith@acme.example.com"));

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task An_unverified_email_is_still_refused_whatever_the_row_looks_like()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane.smith@acme.example.com");

        var result = await Exchange(CreateController(db, "jane.smith@acme.example.com", emailVerified: false));

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    // ── Any address: the user's own row decides the tenant ──────────────
    // Staff sign in with whatever address they own (a gmail.com mailbox as readily as the organisation's), so the domain of the address says
    // nothing about which tenant they belong to. The tenant is the one on the user's row, and an address that matches more than one active
    // row is refused rather than guessed at.

    [Fact]
    public async Task A_user_with_an_address_at_a_provider_domain_signs_in_to_their_own_tenant()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!;
        Assert.Equal(user.Id, body.Id);
        Assert.Equal(tenant.Id, body.TenantId);
        Assert.Equal("Acme Support", body.TenantName);
    }

    [Fact]
    public async Task A_user_at_the_tenants_own_domain_still_signs_in()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "jane.smith@acme.example.com");

        var result = await Exchange(CreateController(db, "jane.smith@acme.example.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!;
        Assert.Equal(user.Id, body.Id);
        Assert.Equal(tenant.Id, body.TenantId);
    }

    [Fact]
    public async Task The_users_own_tenant_decides_even_when_their_address_is_at_another_tenants_domain()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        SeedTenant(db, "Other Care", "other.example.org");
        var user = SeedUser(db, acme.Id, "jane.smith@other.example.org");

        var result = await Exchange(CreateController(db, "jane.smith@other.example.org"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!;
        Assert.Equal(user.Id, body.Id);
        Assert.Equal(acme.Id, body.TenantId);
    }

    [Fact]
    public async Task A_user_whose_tenant_is_inactive_is_refused_even_at_the_tenants_own_domain()
    {
        using var db = CreateDb();
        var inactive = SeedTenant(db, isActive: false);
        SeedUser(db, inactive.Id, "jane.smith@gmail.com");
        SeedUser(db, inactive.Id, "john.smith@acme.example.com");

        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com"))).Result);
        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "john.smith@acme.example.com"))).Result);
    }

    [Fact]
    public async Task An_address_no_active_user_has_is_refused_with_the_same_answer_as_any_other_refusal()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "someone.else@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result.Result);
        Assert.Equal("Invalid or expired token", Assert.IsType<ApiResponse<AuthResponseDto>>(unauthorized.Value).Errors!.Single());
    }

    [Fact]
    public async Task An_inactive_twin_does_not_make_the_address_ambiguous()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        var active = SeedUser(db, acme.Id, "jane.smith@gmail.com");
        SeedUser(db, other.Id, "jane.smith@gmail.com", isActive: false);

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!;
        Assert.Equal(active.Id, body.Id);
        Assert.Equal(acme.Id, body.TenantId);
    }

    [Fact]
    public async Task Two_active_users_with_the_same_address_in_different_tenants_are_refused_and_both_are_logged()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        var first = SeedUser(db, acme.Id, "jane.smith@gmail.com");
        var second = SeedUser(db, other.Id, "jane.smith@gmail.com");
        var logger = new Mock<ILogger<AuthController>>();

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", logger: logger.Object));

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result.Result);
        // Not distinguishable from any other refusal, so the answer never says which addresses exist twice.
        Assert.Equal("Invalid or expired token", Assert.IsType<ApiResponse<AuthResponseDto>>(unauthorized.Value).Errors!.Single());
        VerifyWarningNaming(logger, first.Id, second.Id);
    }

    [Fact]
    public async Task A_case_variant_pair_in_one_tenant_is_refused_too_instead_of_one_of_them_being_picked()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var mixed = SeedUser(db, tenant.Id, "Jane.Smith@gmail.com");
        var lower = SeedUser(db, tenant.Id, "jane.smith@gmail.com");
        var logger = new Mock<ILogger<AuthController>>();

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", logger: logger.Object));

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
        VerifyWarningNaming(logger, mixed.Id, lower.Id);
    }

    [Fact]
    public async Task The_ambiguity_line_names_the_two_lowest_ids_whatever_order_the_rows_were_written_in()
    {
        // Take(2) is enough to tell one row from many, but without an order the two rows it returns, and so the two ids the line names, are whichever the
        // database produces first. Written highest, lowest, middle, an unordered query names the first two written. (The order is the provider's own
        // comparison of ids, which Postgres does not share with the CLR; what this pins is that it is the same two every time.)
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var ids = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() }.OrderBy(id => id).ToArray();
        var (lowest, middle, highest) = (ids[0], ids[1], ids[2]);
        foreach (var id in new[] { highest, lowest, middle })
            SeedUser(db, tenant.Id, "jane.smith@gmail.com", id: id);
        var logger = new Mock<ILogger<AuthController>>();

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", logger: logger.Object));

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
        VerifyWarningNaming(logger, lowest, middle, butNot: highest);
    }

    private static void VerifyWarningNaming(Mock<ILogger<AuthController>> logger, Guid firstUserId, Guid secondUserId, Guid? butNot = null) =>
        logger.Verify(l => l.Log(
            LogLevel.Warning, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((state, _) => state.ToString()!.Contains(firstUserId.ToString()) && state.ToString()!.Contains(secondUserId.ToString())
                && (butNot == null || !state.ToString()!.Contains(butNot.Value.ToString()))),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);

    // ── SuperAdmin path ─────────────────────────────────────────────────

    [Fact]
    public async Task SuperAdmin_path_finds_a_row_stored_in_mixed_case_from_the_lower_case_email_in_the_token()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var superAdmin = SeedUser(db, tenant.Id, "Platform.Admin@platform.example.com", UserRole.SuperAdmin);

        var result = await Exchange(CreateController(db, "platform.admin@platform.example.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value);
        Assert.Equal(superAdmin.Id, body.Data!.Id);
        Assert.Equal("SuperAdmin", body.Data.Role);
        Assert.Null(body.Data.TenantId);
    }

    [Fact]
    public async Task SuperAdmin_path_is_unchanged_it_ignores_the_tenant_and_the_tenant_state()
    {
        using var db = CreateDb();
        var inactive = SeedTenant(db, isActive: false);
        var superAdmin = SeedUser(db, inactive.Id, "platform.admin@platform.example.com", UserRole.SuperAdmin);

        var result = await Exchange(CreateController(db, "platform.admin@platform.example.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!;
        Assert.Equal(superAdmin.Id, body.Id);
        Assert.Null(body.TenantId);
    }

    // ── The lockout and LastLoginAt ─────────────────────────────────────
    // Every refusal goes through Rejected(), which spends from the client's failure budget: a refusal that returned Unauthorized directly would be a
    // free retry, and the lockout could be dodged by aiming at that one case. A refusal never stamps LastLoginAt either, the record of when someone
    // last got in, because nobody did.

    private static async Task AssertRefusalsSpendTheFailureBudget(OdipDbContext db, string tokenEmail, bool emailVerified = true, string? signInProvider = "password")
    {
        // One controller, so one client address and one budget for every attempt.
        var controller = CreateController(db, tokenEmail, emailVerified, signInProvider: signInProvider);

        for (var attempt = 0; attempt < LoginAttemptTracker.MaxFailures; attempt++)
            Assert.IsType<UnauthorizedObjectResult>((await Exchange(controller)).Result);

        var lockedOut = Assert.IsType<ObjectResult>((await Exchange(controller)).Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, lockedOut.StatusCode);
    }

    [Fact]
    public async Task An_address_no_active_user_has_spends_from_the_failure_budget()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "someone.else@gmail.com");

        await AssertRefusalsSpendTheFailureBudget(db, "jane.smith@gmail.com");
    }

    [Fact]
    public async Task An_address_on_two_active_rows_spends_from_the_failure_budget()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        SeedUser(db, acme.Id, "jane.smith@gmail.com");
        SeedUser(db, other.Id, "jane.smith@gmail.com");

        await AssertRefusalsSpendTheFailureBudget(db, "jane.smith@gmail.com");
    }

    [Fact]
    public async Task A_user_whose_tenant_is_inactive_spends_from_the_failure_budget()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db, isActive: false).Id, "jane.smith@gmail.com");

        await AssertRefusalsSpendTheFailureBudget(db, "jane.smith@gmail.com");
    }

    [Fact]
    public async Task An_unverified_email_spends_from_the_failure_budget()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        await AssertRefusalsSpendTheFailureBudget(db, "jane.smith@gmail.com", emailVerified: false);
    }

    [Fact]
    public async Task A_SuperAdmin_address_with_no_active_row_spends_from_the_failure_budget()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "platform.admin@platform.example.com", UserRole.SuperAdmin, isActive: false);

        await AssertRefusalsSpendTheFailureBudget(db, "platform.admin@platform.example.com");
    }

    [Fact]
    public async Task A_refused_sign_in_stamps_nobodys_LastLoginAt()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        var closed = SeedTenant(db, "Closed Care", "closed.example.net", isActive: false);
        var twinOne = SeedUser(db, acme.Id, "twin@gmail.com");
        var twinTwo = SeedUser(db, other.Id, "twin@gmail.com");
        var inTheClosedTenant = SeedUser(db, closed.Id, "closed@gmail.com");
        var unverified = SeedUser(db, acme.Id, "unverified@gmail.com");

        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "twin@gmail.com"))).Result);
        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "closed@gmail.com"))).Result);
        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "unverified@gmail.com", emailVerified: false))).Result);

        Assert.All(new[] { twinOne, twinTwo, inTheClosedTenant, unverified }, row => Assert.Null(StoredLastLoginAt(db, row.Id)));
    }

    [Fact]
    public async Task A_sign_in_stamps_LastLoginAt_on_the_row_that_was_signed_in_to_and_on_no_other()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var signedIn = SeedUser(db, tenant.Id, "jane.smith@gmail.com");
        var bystander = SeedUser(db, tenant.Id, "john.smith@gmail.com");
        var before = DateTime.UtcNow;

        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com"))).Result);

        var stamped = StoredLastLoginAt(db, signedIn.Id);
        Assert.NotNull(stamped);
        Assert.InRange(stamped!.Value, before, DateTime.UtcNow);
        Assert.Null(StoredLastLoginAt(db, bystander.Id));
    }

    [Fact]
    public async Task A_SuperAdmin_sign_in_stamps_LastLoginAt_too()
    {
        using var db = CreateDb();
        var superAdmin = SeedUser(db, SeedTenant(db).Id, "platform.admin@platform.example.com", UserRole.SuperAdmin);
        var before = DateTime.UtcNow;

        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "platform.admin@platform.example.com"))).Result);

        var stamped = StoredLastLoginAt(db, superAdmin.Id);
        Assert.NotNull(stamped);
        Assert.InRange(stamped!.Value, before, DateTime.UtcNow);
    }

    // ── The sign-in provider ────────────────────────────────────────────
    // The exchange takes a token's verified email as the whole identity, and what "verified" proves depends on how the person signed in: control of the
    // mailbox for email and password, whatever the provider chooses to assert for a federated one. The Firebase project's web API key is public, so
    // anyone can obtain a token from every provider enabled in the console. Only the providers in Auth:AllowedSignInProviders (password and custom
    // unless it is set) get in, and a token that does not say which one it came from is refused.

    private static void VerifyWarningMentioning(Mock<ILogger<AuthController>> logger, string text) =>
        logger.Verify(l => l.Log(
            LogLevel.Warning, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((state, _) => state.ToString()!.Contains(text)),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);

    [Theory]
    [InlineData("password")]
    [InlineData("custom")]
    public async Task The_providers_accepted_by_default_sign_in(string provider)
    {
        using var db = CreateDb();
        var user = SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: provider));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(user.Id, Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!.Id);
    }

    [Theory]
    [InlineData("google.com")]
    [InlineData("microsoft.com")]
    [InlineData("apple.com")]
    [InlineData("phone")]
    [InlineData("anonymous")]
    [InlineData("saml.acme")]
    public async Task A_provider_that_is_not_listed_is_refused_for_a_user_who_exists_with_the_same_answer_as_any_other_refusal(string provider)
    {
        using var db = CreateDb();
        var user = SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");
        var logger = new Mock<ILogger<AuthController>>();

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", logger: logger.Object, signInProvider: provider));

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result.Result);
        Assert.Equal("Invalid or expired token", Assert.IsType<ApiResponse<AuthResponseDto>>(unauthorized.Value).Errors!.Single());
        Assert.Null(StoredLastLoginAt(db, user.Id));
        // The log, not the answer, says why.
        VerifyWarningMentioning(logger, provider);
    }

    [Fact]
    public async Task A_token_that_names_no_provider_is_refused()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: null));

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Theory]
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":"password"}""")]                      // not an object
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":null}""")]
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":{}}""")]                              // no provider in it
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":{"sign_in_provider":null}}""")]
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":{"sign_in_provider":5}}""")]          // not a string
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":{"sign_in_provider":" "}}""")]        // blank
    public async Task A_token_whose_firebase_claim_carries_no_readable_provider_is_refused(string payload)
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, FirebaseTestClaims.FromPayload(payload)));

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task The_SuperAdmin_path_needs_an_accepted_provider_too()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "platform.admin@platform.example.com", UserRole.SuperAdmin);

        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "platform.admin@platform.example.com", signInProvider: "google.com"))).Result);
        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "platform.admin@platform.example.com"))).Result);
    }

    [Fact]
    public async Task A_provider_that_is_not_listed_spends_from_the_failure_budget()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        await AssertRefusalsSpendTheFailureBudget(db, "jane.smith@gmail.com", signInProvider: "google.com");
    }

    [Fact]
    public async Task The_setting_replaces_the_default_list_whatever_the_case_it_is_written_in()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");
        var onlyMicrosoft = new Dictionary<string, string?> { ["Auth:AllowedSignInProviders:0"] = "Microsoft.com" };

        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: "microsoft.com", settings: onlyMicrosoft))).Result);
        // Replaces rather than adds to: email and password no longer gets in.
        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: "password", settings: onlyMicrosoft))).Result);
    }

    [Fact]
    public async Task A_single_comma_separated_setting_is_read_as_a_list_the_way_an_environment_variable_gives_one()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");
        var settings = new Dictionary<string, string?> { ["Auth:AllowedSignInProviders"] = "password, google.com" };

        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: "password", settings: settings))).Result);
        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: "google.com", settings: settings))).Result);
        Assert.IsType<UnauthorizedObjectResult>((await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: "microsoft.com", settings: settings))).Result);
    }
}
