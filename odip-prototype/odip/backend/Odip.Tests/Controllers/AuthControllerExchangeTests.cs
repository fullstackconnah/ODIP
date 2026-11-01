using System.Net;
using System.Reflection;
using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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
public partial class AuthControllerExchangeTests
{
    private const string TenantDomain = "acme.example.com";
    private const string SuperAdminDomain = "platform.example.com";

    private sealed class FakeVerifier(IReadOnlyDictionary<string, object> claims) : IFirebaseTokenVerifier
    {
        public Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct) =>
            Task.FromResult<IReadOnlyDictionary<string, object>>(claims);
    }

    /// <summary>A token Firebase will not vouch for (malformed, expired, wrong project): the SDK throws.</summary>
    private sealed class RefusingVerifier(FirebaseAuthException failure) : IFirebaseTokenVerifier
    {
        public Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct) => throw failure;
    }

    /// <summary>
    /// A token whose shape the guard accepts but the SDK still cannot decode, so the failure comes out of the SDK's own parsers rather
    /// than out of a <see cref="FirebaseAuthException"/>. It throws whatever it is given, and records whether it was reached at all, which
    /// is what separates "refused before the SDK was asked" from "the SDK was asked and said no".
    /// </summary>
    private sealed class ParseFailingVerifier(Exception failure) : IFirebaseTokenVerifier
    {
        public bool WasAsked { get; private set; }

        public Task<IReadOnlyDictionary<string, object>> VerifyIdTokenAsync(string idToken, CancellationToken ct)
        {
            WasAsked = true;
            throw failure;
        }
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
        OdipDbContext db, IReadOnlyDictionary<string, object> claims, ILogger<AuthController>? logger = null, Dictionary<string, string?>? settings = null) =>
        CreateController(db, new FakeVerifier(claims), logger, settings);

    private static AuthController CreateController(
        OdipDbContext db, IFirebaseTokenVerifier verifier, ILogger<AuthController>? logger = null, Dictionary<string, string?>? settings = null)
    {
        var configured = new Dictionary<string, string?> { ["Jwt:Secret"] = new string('k', 48), ["Auth:SuperAdminDomain"] = SuperAdminDomain };
        foreach (var (key, value) in settings ?? [])
            configured[key] = value;
        var config = new ConfigurationBuilder().AddInMemoryCollection(configured).Build();
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = ClientAddress;

        return new AuthController(
            db, config, logger ?? new Mock<ILogger<AuthController>>().Object,
            new Mock<ICurrentTenant>().Object, verifier)
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    private static readonly IPAddress ClientAddress = IPAddress.Parse("203.0.113.7");

    // What is stored, read around the Users filter and the change tracker: the anonymous context the exchange runs on admits no row, and a tracked
    // row would show an unsaved change as if it had been written.
    private static DateTime? StoredLastLoginAt(OdipDbContext db, Guid userId) =>
        db.Users.IgnoreQueryFilters().AsNoTracking().Single(u => u.Id == userId).LastLoginAt;

    // A token the shape guard (FirebaseIdTokenShape) accepts and the fakes above never inspect the contents of: three legal
    // base64url segments. The fake verifier returns canned claims regardless of the string, so only the SHAPE has to be real —
    // an earlier placeholder ("token-the-fake-accepts") was one segment and would now be refused before the verifier was ever asked.
    private const string AnyShapedToken = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1aWQtMSJ9.c2lnbmF0dXJl";

    private static Task<ActionResult<ApiResponse<AuthResponseDto>>> Exchange(AuthController controller) =>
        controller.Exchange(new ExchangeTokenDto { IdToken = AnyShapedToken }, CancellationToken.None);

    /// <summary>The exchange with a token of THIS shape, for the cases where the token string is the thing under test.</summary>
    private static Task<ActionResult<ApiResponse<AuthResponseDto>>> ExchangeWith(AuthController controller, string idToken) =>
        controller.Exchange(new ExchangeTokenDto { IdToken = idToken }, CancellationToken.None);

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
    public async Task An_address_no_active_user_has_is_refused()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "someone.else@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        // What it says is pinned below ("Why a refusal was a refusal"): a verified address with no account is NoOdipAccount.
        Assert.IsType<UnauthorizedObjectResult>(result.Result);
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

        // The answer says no more than to ask the administrator: not that another account shares the address, and never WHICH rows (the log names those).
        AssertRefusal(result, "Ambiguous", "We can't sign you in with this email address yet. Ask your administrator to check your account.");
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

    // ── Refusals stay 401, and LastLoginAt ──────────────────────────────
    // There is no failure counter: a wrong guess is a forged Firebase token, so however often a refused request is repeated it is a 401, never a 429.
    // (The "login" flood limiter is the only thing that answers 429.) A refusal never stamps LastLoginAt either, the record of when someone last got in,
    // because nobody did.
    private const int RepeatedAttempts = 25;

    private static Task AssertRefusalsStayUnauthorized(OdipDbContext db, string tokenEmail, bool emailVerified = true, string? signInProvider = "password") =>
        AssertRefusalsStayUnauthorized(CreateController(db, tokenEmail, emailVerified, signInProvider: signInProvider));

    // One controller, so every attempt comes from one client address.
    private static async Task AssertRefusalsStayUnauthorized(AuthController controller)
    {
        for (var attempt = 0; attempt < RepeatedAttempts; attempt++)
            Assert.IsType<UnauthorizedObjectResult>((await Exchange(controller)).Result);
        Assert.False(controller.Response.Headers.ContainsKey("Retry-After"));
    }

    // The same, for the cases where the TOKEN is what is under test, so every attempt presents the same malformed shape.
    private static async Task AssertRefusalsStayUnauthorized(AuthController controller, string idToken)
    {
        for (var attempt = 0; attempt < RepeatedAttempts; attempt++)
            Assert.IsType<UnauthorizedObjectResult>((await ExchangeWith(controller, idToken)).Result);
        Assert.False(controller.Response.Headers.ContainsKey("Retry-After"));
    }

    [Fact]
    public async Task An_address_no_active_user_has_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "someone.else@gmail.com");

        await AssertRefusalsStayUnauthorized(db, "jane.smith@gmail.com");
    }

    [Fact]
    public async Task An_address_on_two_active_rows_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        SeedUser(db, acme.Id, "jane.smith@gmail.com");
        SeedUser(db, other.Id, "jane.smith@gmail.com");

        await AssertRefusalsStayUnauthorized(db, "jane.smith@gmail.com");
    }

    [Fact]
    public async Task A_user_whose_tenant_is_inactive_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db, isActive: false).Id, "jane.smith@gmail.com");

        await AssertRefusalsStayUnauthorized(db, "jane.smith@gmail.com");
    }

    [Fact]
    public async Task An_unverified_email_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        await AssertRefusalsStayUnauthorized(db, "jane.smith@gmail.com", emailVerified: false);
    }

    [Fact]
    public async Task A_SuperAdmin_address_with_no_active_row_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "platform.admin@platform.example.com", UserRole.SuperAdmin, isActive: false);

        await AssertRefusalsStayUnauthorized(db, "platform.admin@platform.example.com");
    }

    // The generic InvalidToken has three ways in, and each is a way to guess at the exchange: a token Firebase will not vouch for, one with no email, and one
    // whose provider cannot be read. All three go through Rejected() like the rest, so none is a free retry.
    [Fact]
    public async Task A_token_Firebase_will_not_vouch_for_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();

        await AssertRefusalsStayUnauthorized(CreateController(db, new RefusingVerifier(FirebaseTestExceptions.WithCode(AuthErrorCode.InvalidIdToken))));
    }

    [Theory]
    [InlineData("""{"email_verified":true,"firebase":{"sign_in_provider":"password"}}""")]                    // no email in it
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true}""")]                                 // no provider it can read
    public async Task A_token_that_is_missing_what_the_exchange_needs_is_a_401_however_often_it_is_repeated(string payload)
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        await AssertRefusalsStayUnauthorized(CreateController(db, FirebaseTestClaims.FromPayload(payload)));
    }

    // ── A malformed token is a refusal like any other, not an unhandled 500 ────────────────────
    // The exchange used to let the SDK's PARSE failures escape: JsonReaderException (from a three-segment token that is not a JWT)
    // matches no arm of ExceptionHandlingMiddleware's switch, so it became HTTP 500 — and because it never returned through
    // Rejected(), it was a 500 rather than a refusal.
    // Measured against FirebaseAdmin 3.5.0, which class escapes depends on the shape, hence the theories below.

    /// <summary>The card's case: three segments that are not a JWT, which is what the SDK fails to parse.</summary>
    [Fact]
    public async Task A_three_segment_token_that_is_not_a_JWT_is_refused_401_and_stays_the_generic_InvalidToken()
    {
        using var db = CreateDb();
        var verifier = new ParseFailingVerifier(new Newtonsoft.Json.JsonReaderException("Unexpected character encountered while parsing value."));
        var logger = new Mock<ILogger<AuthController>>();

        var result = await ExchangeWith(CreateController(db, verifier, logger.Object), "aaa.bbb.ccc");

        // 401, not the 500 the unhandled JsonReaderException used to produce, and the same generic answer as any other bad token.
        AssertRefusal(result, "InvalidToken", "Invalid or expired token");
        // The SDK really was asked, so this is the catch doing the work rather than the shape guard short-circuiting it.
        Assert.True(verifier.WasAsked);
        // Logged at the same level as every other refusal, so the 500's error-level noise is gone too.
        VerifyWarningMentioning(logger, "could not be decoded");
    }

    /// <summary>The other parse class the SDK produces: short segments fail as FormatException, not JsonReaderException.</summary>
    [Fact]
    public async Task A_token_whose_segments_are_too_short_to_decode_is_refused_401_as_well()
    {
        using var db = CreateDb();

        var result = await ExchangeWith(
            CreateController(db, new ParseFailingVerifier(new FormatException("The input is not a valid Base-64 string"))), "a.b.c");

        AssertRefusal(result, "InvalidToken", "Invalid or expired token");
    }

    // Every one of these is a 401, repeated, never a 500 and never a 429.
    [Theory]
    [InlineData("aaa.bbb.ccc")]                                     // three segments, not a JWT -> JsonReaderException
    [InlineData("aaa.###.ccc")]                                    // payload outside the base64url alphabet
    [InlineData("aaaa.bbbb.cccc")]                                 // legal base64url, junk content
    [InlineData("aaa.e30.ccc")]                                    // payload decodes to {} — valid JSON, not a JWT
    public async Task A_token_the_SDK_cannot_decode_is_a_401_however_often_it_is_repeated(string idToken)
    {
        using var db = CreateDb();

        await AssertRefusalsStayUnauthorized(
            CreateController(db, new ParseFailingVerifier(new Newtonsoft.Json.JsonReaderException("parse failed"))),
            idToken);
    }

    [Fact]
    public async Task A_token_whose_segments_cannot_be_base64_decoded_is_a_401_however_often_it_is_repeated_too()
    {
        using var db = CreateDb();

        await AssertRefusalsStayUnauthorized(
            CreateController(db, new ParseFailingVerifier(new FormatException("not base-64"))), "a.b.c");
    }

    // ── The shape guard: refused BEFORE the SDK is asked, and still counted ───────────────────
    // The SDK's parse of these is not a defined failure — ".." makes it throw NullReferenceException — so they are turned away
    // at the door rather than by catching everything, which is what keeps a real fault elsewhere a real 500.

    [Theory]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("not-a-firebase-token")]
        [InlineData("a.b")]
        [InlineData("a.b.c.d")]
        [InlineData("a..b")]
        [InlineData("..")]                                             // all dots: the SDK throws NullReferenceException on this
        [InlineData("a.b.c=")]                                         // padded, so not base64url
        [InlineData(" a.b.c")]
        public async Task A_token_that_is_not_shaped_like_an_ID_token_is_refused_before_the_verifier_is_asked(string idToken)
        {
            using var db = CreateDb();
            var verifier = new ParseFailingVerifier(new InvalidOperationException("the SDK must never be asked about a token of this shape"));

            var result = await ExchangeWith(CreateController(db, verifier), idToken);

            AssertRefusal(result, "InvalidToken", "Invalid or expired token");
            Assert.False(verifier.WasAsked, "the guard should have refused this without troubling the SDK");
        }

        /// <summary>
        /// The new catch is filtered to parser failure types only: a genuine fault raised by the verifier must still escape rather than
        /// be laundered into a caller's generic 401. The shape guard must therefore let the verifier see the token first.
        /// </summary>
        [Theory]
        [InlineData("invalid operation")]
        [InlineData("null reference")]
        public async Task A_non_parse_fault_from_the_verifier_is_not_relabelled_as_an_invalid_token(string fault)
        {
            using var db = CreateDb();
            Exception expected = fault switch
            {
                "null reference" => new NullReferenceException("BUG: the verifier dereferenced something it should not have"),
                _ => new InvalidOperationException("BUG: the verifier is misconfigured"),
            };
            var verifier = new ParseFailingVerifier(expected);
            var controller = CreateController(db, verifier);

            var thrown = await Assert.ThrowsAnyAsync<Exception>(() => Exchange(controller));

            Assert.Same(expected, thrown);
            Assert.True(verifier.WasAsked, "the shaped token passes the guard; the verifier's fault is the thing being pinned here");
        }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-firebase-token")]
    [InlineData("a.b.c.d")]
    [InlineData("..")]
    [InlineData("a..b")]
    public async Task A_token_that_is_not_shaped_like_an_ID_token_is_a_401_however_often_it_is_repeated(string idToken)
    {
        using var db = CreateDb();

        await AssertRefusalsStayUnauthorized(
            CreateController(db, new ParseFailingVerifier(new InvalidOperationException("unreachable"))), idToken);
    }

    // A real Firebase ID token is three legal base64url segments, so the guard must not refuse one. The fake verifier stands in
    // for the SDK and returns claims whatever the string, so a successful sign-in here proves the token got PAST the guard and the
    // rest of the exchange ran unchanged — a guard that were too strict would refuse this as InvalidToken.
    [Fact]
    public async Task A_well_formed_three_segment_token_still_gets_past_the_guard_and_signs_in()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(ok.Value).Data!;
        Assert.Equal(user.Id, body.Id);
        Assert.Equal(tenant.Id, body.TenantId);
    }

    // The exact token the deploy probe used, pinned as a literal so the regression names the reported input rather than a
    // near-miss of it: three segments, none of them a JWT, which is what the SDK fails to parse.
    [Fact]
    public void The_reported_regression_token_is_the_shape_this_fix_covers()
    {
        // It is three legal base64url segments, so the shape guard lets it through to the SDK — which is exactly why the guard
        // alone would NOT have fixed this, and why the parse-failure catch is load-bearing.
        Assert.True(FirebaseIdTokenShape.LooksLikeAnIdToken("aaa.bbb.ccc"));
    }

    [Fact]
    public async Task The_reported_token_through_the_real_Firebase_verifier_returns_401_every_time()
    {
        using var db = CreateDb();
        var controller = CreateController(db, new FirebaseTokenVerifier());
        // The first call parses before touching credentials or the network. The DefaultInstance guard on the real verifier may
        // therefore fail before parsing if the test process did not initialise a Firebase app; set up the minimum valid fake SA
        // inline first. GoogleCredential parses the real PKCS#8 key; the SDK's payload parser then throws JsonReaderException.
        EnsureFirebaseAppForLocalParse();

        for (var attempt = 0; attempt < RepeatedAttempts; attempt++)
        {
            var refused = await ExchangeWith(controller, "aaa.bbb.ccc");
            var unauthorized = Assert.IsType<UnauthorizedObjectResult>(refused.Result);
            var body = Assert.IsType<ApiResponse<AuthResponseDto>>(unauthorized.Value);
            Assert.Equal("InvalidToken", body.Code);
        }
    }

    private static void EnsureFirebaseAppForLocalParse()
    {
        if (FirebaseAdmin.FirebaseApp.DefaultInstance is not null)
            return;

        using var rsa = System.Security.Cryptography.RSA.Create(2048);
        var credential = Google.Apis.Auth.OAuth2.GoogleCredential.FromJson(System.Text.Json.JsonSerializer.Serialize(new
        {
            type = "service_account",
            project_id = "odip-probe",
            private_key_id = "probe",
            private_key = new string(rsa.ExportPkcs8PrivateKeyPem()),
            client_email = "probe@odip-probe.iam.gserviceaccount.com",
            client_id = "1",
            auth_uri = "https://accounts.google.com/o/oauth2/auth",
            token_uri = "https://oauth2.googleapis.com/token",
        }));
        FirebaseAdmin.FirebaseApp.Create(new FirebaseAdmin.AppOptions { Credential = credential });
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
    public async Task A_provider_that_is_not_listed_is_refused_for_a_user_who_exists_and_leaves_their_LastLoginAt_alone(string provider)
    {
        using var db = CreateDb();
        var user = SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");
        var logger = new Mock<ILogger<AuthController>>();

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", logger: logger.Object, signInProvider: provider));

        AssertRefusal(result, "ProviderNotAllowed", "This sign-in method is not enabled for Bunya Support.");
        Assert.Null(StoredLastLoginAt(db, user.Id));
        // The answer says the method is not enabled; the log says which one it was.
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
    public async Task A_provider_that_is_not_listed_is_a_401_however_often_it_is_repeated()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        await AssertRefusalsStayUnauthorized(db, "jane.smith@gmail.com", signInProvider: "google.com");
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

    // ── Why a refusal was a refusal ─────────────────────────────────────
    // Every refusal is a 401, and it says WHY in ApiResponse.Code, so the sign-in page can tell the
    // person what to do instead of "login failed" (an account Firebase re-created arrives unverified, and nobody could tell). Safe to say, because of
    // the ORDER the exchange decides in: the codes that depend on ODIP's own data (NoOdipAccount, TenantInactive, Ambiguous) come only after the email
    // is verified and the provider allowed, so only someone who controls the mailbox ever sees one, and only about their own address. Firebase lets
    // anyone sign up with any address and hold a token for it, which is why EmailNotVerified, decided from the token alone, answers the same for an
    // address ODIP knows and one it does not. Anything else about the token stays the generic InvalidToken.

    private static ApiResponse<AuthResponseDto> AssertRefusal(ActionResult<ApiResponse<AuthResponseDto>> result, string code, string message)
    {
        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(unauthorized.Value);
        Assert.False(body.Success);
        Assert.Equal(code, body.Code);
        Assert.Equal(message, Assert.Single(body.Errors!));
        return body;
    }

    [Fact]
    public async Task An_unverified_email_is_refused_as_EmailNotVerified()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", emailVerified: false));

        AssertRefusal(result, "EmailNotVerified", "The email address on this sign-in has not been verified.");
    }

    [Fact]
    public async Task A_verified_address_with_no_active_user_is_refused_as_NoOdipAccount()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "someone.else@gmail.com");
        SeedUser(db, SeedTenant(db, "Other Care", "other.example.org").Id, "jane.smith@gmail.com", isActive: false);

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        AssertRefusal(result, "NoOdipAccount", "No active Bunya Support account uses this email address.");
    }

    [Fact]
    public async Task A_SuperAdmin_domain_address_with_no_active_row_is_refused_as_NoOdipAccount_too()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "platform.admin@platform.example.com", UserRole.SuperAdmin, isActive: false);

        var result = await Exchange(CreateController(db, "platform.admin@platform.example.com"));

        AssertRefusal(result, "NoOdipAccount", "No active Bunya Support account uses this email address.");
    }

    [Fact]
    public async Task A_user_whose_tenant_is_inactive_or_gone_is_refused_as_TenantInactive()
    {
        using var db = CreateDb();
        var inactive = SeedTenant(db, isActive: false);
        SeedUser(db, inactive.Id, "jane.smith@gmail.com");
        SeedUser(db, Guid.NewGuid(), "orphan@gmail.com");

        AssertRefusal(await Exchange(CreateController(db, "jane.smith@gmail.com")), "TenantInactive", "The organisation this account belongs to is inactive.");
        AssertRefusal(await Exchange(CreateController(db, "orphan@gmail.com")), "TenantInactive", "The organisation this account belongs to is inactive.");
    }

    [Fact]
    public async Task A_held_user_is_refused_at_the_exchange_and_never_stamped_until_an_Admin_confirms_the_address()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var held = SeedUser(db, tenant.Id, "held@other.org");
        held.SignInAddressUnconfirmed = true;
        db.SaveChanges();

        var refused = CreateController(db, "held@other.org");
        AssertRefusal(await Exchange(refused), "AddressUnconfirmed", "Your organisation needs to confirm this email address before you can sign in to Bunya Support.");
        Assert.False(refused.Response.Headers.ContainsKey("Set-Cookie"));   // no session on the refusal
        Assert.Null(StoredLastLoginAt(db, held.Id));

        held.SignInAddressUnconfirmed = false;   // an Admin confirmed it
        db.SaveChanges();
        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "held@other.org"))).Result);
        Assert.NotNull(StoredLastLoginAt(db, held.Id));
    }

    [Fact]
    public async Task A_held_user_in_an_inactive_organisation_is_told_the_organisation_is_inactive_first()
    {
        using var db = CreateDb();
        var closed = SeedTenant(db, isActive: false);
        var held = SeedUser(db, closed.Id, "held@other.org");
        held.SignInAddressUnconfirmed = true;
        db.SaveChanges();

        AssertRefusal(await Exchange(CreateController(db, "held@other.org")), "TenantInactive", "The organisation this account belongs to is inactive.");
        Assert.Null(StoredLastLoginAt(db, held.Id));
    }

    [Fact]
    public async Task A_provider_that_is_not_listed_is_refused_as_ProviderNotAllowed()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com", signInProvider: "google.com"));

        AssertRefusal(result, "ProviderNotAllowed", "This sign-in method is not enabled for Bunya Support.");
    }

    [Fact]
    public async Task An_address_on_two_active_rows_is_refused_as_Ambiguous()
    {
        using var db = CreateDb();
        var acme = SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        SeedUser(db, acme.Id, "jane.smith@gmail.com");
        SeedUser(db, other.Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, "jane.smith@gmail.com"));

        AssertRefusal(result, "Ambiguous", "We can't sign you in with this email address yet. Ask your administrator to check your account.");
    }

    [Fact]
    public async Task A_token_Firebase_will_not_vouch_for_stays_the_generic_InvalidToken()
    {
        using var db = CreateDb();
        var verifier = new RefusingVerifier(FirebaseTestExceptions.WithCode(AuthErrorCode.InvalidIdToken));

        AssertRefusal(await Exchange(CreateController(db, verifier)), "InvalidToken", "Invalid or expired token");
    }

    [Theory]
    [InlineData("""{"email_verified":true,"firebase":{"sign_in_provider":"password"}}""")]                    // no email in it
    [InlineData("""{"email":"  ","email_verified":true,"firebase":{"sign_in_provider":"password"}}""")]       // a blank one
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true}""")]                                 // no provider it can read
    [InlineData("""{"email":"jane.smith@gmail.com","email_verified":true,"firebase":{"sign_in_provider":5}}""")]
    public async Task A_token_that_is_missing_what_the_exchange_needs_stays_the_generic_InvalidToken(string payload)
    {
        // A claim the exchange cannot read is a fault with the token (or the SDK), not something the person can act on: it must not read as "that sign-in
        // method is not enabled" when they did use email and password.
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "jane.smith@gmail.com");

        var result = await Exchange(CreateController(db, FirebaseTestClaims.FromPayload(payload)));

        AssertRefusal(result, "InvalidToken", "Invalid or expired token");
    }

    [Fact]
    public async Task An_unverified_token_gets_the_same_answer_for_an_address_ODIP_knows_and_one_it_does_not()
    {
        // Anyone can sign up to Firebase with any address and hold an (unverified) token for it. That must teach them nothing about ODIP's rows.
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "has.account@gmail.com");

        var known = AssertRefusal(await Exchange(CreateController(db, "has.account@gmail.com", emailVerified: false)), "EmailNotVerified", "The email address on this sign-in has not been verified.");
        var unknown = AssertRefusal(await Exchange(CreateController(db, "no.account@gmail.com", emailVerified: false)), "EmailNotVerified", "The email address on this sign-in has not been verified.");

        Assert.Equal(known.Code, unknown.Code);
        Assert.Equal(known.Errors, unknown.Errors);
    }

    [Fact]
    public async Task A_provider_that_is_not_listed_gets_the_same_answer_for_an_address_ODIP_knows_and_one_it_does_not()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, "has.account@gmail.com");

        AssertRefusal(await Exchange(CreateController(db, "has.account@gmail.com", signInProvider: "google.com")), "ProviderNotAllowed", "This sign-in method is not enabled for Bunya Support.");
        AssertRefusal(await Exchange(CreateController(db, "no.account@gmail.com", signInProvider: "google.com")), "ProviderNotAllowed", "This sign-in method is not enabled for Bunya Support.");
    }

    [Fact]
    public async Task A_wrong_token_sent_over_and_over_is_a_401_every_time_and_never_a_429()
    {
        using var db = CreateDb();
        var controller = CreateController(db, "nobody@gmail.com");   // no such row: every attempt is a refusal from one client address
        for (var attempt = 0; attempt < RepeatedAttempts; attempt++)
        {
            var refused = Assert.IsType<UnauthorizedObjectResult>((await Exchange(controller)).Result);
            Assert.Equal("NoOdipAccount", Assert.IsType<ApiResponse<AuthResponseDto>>(refused.Value).Code);
        }

        Assert.False(controller.Response.Headers.ContainsKey("Retry-After"));
    }

    /// <summary>
    /// With no failure counter, the "login" flood limiter is the only brake on sign-in guessing. An attribute is only a declaration, so it is read off each
    /// compiled action and compared with the policy name, so a dropped or renamed policy fails here rather than silently limiting nothing.
    /// </summary>
    [Theory]
    [InlineData(typeof(AuthController), nameof(AuthController.Exchange))]
    [InlineData(typeof(AuthController), nameof(AuthController.DevLogin))]
    [InlineData(typeof(AuthController), nameof(AuthController.DevUsers))]
    [InlineData(typeof(AuthController), nameof(AuthController.DevWhoAmi))]
    [InlineData(typeof(MicrosoftAuthController), nameof(MicrosoftAuthController.Start))]
    [InlineData(typeof(MicrosoftAuthController), nameof(MicrosoftAuthController.Callback))]
    public void TheSignInActionsAreRateLimitedOnTheLoginPolicy(Type controller, string action)
    {
        var policy = controller.GetMethod(action)!.GetCustomAttribute<EnableRateLimitingAttribute>();

        Assert.Equal("login", policy!.PolicyName);   // the policy Program.cs registers: a typo here would leave sign-in unlimited
    }
}
