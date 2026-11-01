using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

// Two-step verification at the exchange. Auth:RequireMfaForAdmins is OFF unless a test sets it. OFF never refuses (shadow mode: one Warning,
// MfaWouldRefuse, then the same sign-in as before); ON refuses an Admin or SuperAdmin whose token carries no totp second factor.
public partial class AuthControllerExchangeTests
{
    private const string AdminEmail = "ann.admin@gmail.com";
    private const string SuperAdminEmail = "platform.admin@platform.example.com";
    private static readonly Dictionary<string, string?> SwitchOn = new() { [MfaPolicy.ConfigKey] = "true" };

    private static IReadOnlyDictionary<string, object> Token(string email, string? secondFactor, string provider = "password") =>
        FirebaseTestClaims.For(email, signInProvider: provider, signInSecondFactor: secondFactor);

    private static async Task<ActionResult<ApiResponse<AuthResponseDto>>> ExchangeAs(
        UserRole role, string email, string? secondFactor, Dictionary<string, string?>? settings = null, ILogger<AuthController>? logger = null,
        string provider = "password", Action<OdipDbContext, Guid>? seed = null)
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, email, role);
        seed?.Invoke(db, tenant.Id);
        return await Exchange(CreateController(db, Token(email, secondFactor, provider), logger, settings));
    }

    private static string EmailFor(UserRole role) => role == UserRole.SuperAdmin ? SuperAdminEmail : AdminEmail;

    private static Mock<ILogger<AuthController>> RecordingLogger(List<string> warnings)
    {
        var logger = new Mock<ILogger<AuthController>>();
        logger.Setup(l => l.Log(LogLevel.Warning, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()))
            .Callback(new InvocationAction(i => warnings.Add(i.Arguments[2].ToString()!)));
        return logger;
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task Switch_on_required_role_without_second_factor_is_refused_MfaEnrolmentRequired(UserRole role)
    {
        var result = await ExchangeAs(role, EmailFor(role), null, SwitchOn);

        Assert.Equal(ExchangeRefusal.MfaEnrolmentRequired, CodeOf(result));
        var body = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<UnauthorizedObjectResult>(result.Result).Value);
        Assert.Equal("Set up two-step verification to sign in to Bunya Support.", body.Errors![0]);
    }

    [Fact]
    public async Task Switch_on_refusal_sets_no_cookie_and_leaves_LastLoginAt_alone()
    {
        using var db = CreateDb();
        var user = SeedUser(db, SeedTenant(db).Id, AdminEmail, UserRole.Admin);
        var controller = CreateController(db, Token(AdminEmail, null), settings: SwitchOn);

        var result = await Exchange(controller);

        Assert.Equal(ExchangeRefusal.MfaEnrolmentRequired, CodeOf(result));
        Assert.False(controller.Response.Headers.ContainsKey("Set-Cookie"));
        Assert.Null(StoredLastLoginAt(db, user.Id));
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task Switch_on_required_role_with_totp_is_signed_in(UserRole role)
    {
        var result = await ExchangeAs(role, EmailFor(role), "totp", SwitchOn);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Switch_on_Admin_custom_provider_without_second_factor_is_refused()
    {
        var result = await ExchangeAs(UserRole.Admin, AdminEmail, null, SwitchOn, provider: "custom");

        Assert.Equal(ExchangeRefusal.MfaEnrolmentRequired, CodeOf(result));
    }

    [Theory]
    [InlineData(UserRole.Coordinator)]
    [InlineData(UserRole.SupportWorker)]
    [InlineData(UserRole.ReadOnly)]
    public async Task Switch_on_optional_roles_without_second_factor_are_signed_in(UserRole role)
    {
        var result = await ExchangeAs(role, "sam.staff@gmail.com", null, SwitchOn);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Theory]
    [InlineData("phone")]
    [InlineData("TOTP")]
    [InlineData("")]
    public async Task Switch_on_Admin_with_any_second_factor_but_totp_is_refused(string factor)
    {
        var result = await ExchangeAs(UserRole.Admin, AdminEmail, factor, SwitchOn);

        Assert.Equal(ExchangeRefusal.MfaEnrolmentRequired, CodeOf(result));
    }

    // GUARD: the deploy-safety tests. With the switch missing or false the exchange behaves as it did before this feature.
    [Theory]
    [InlineData(null, UserRole.Admin)]
    [InlineData("false", UserRole.Admin)]
    [InlineData(null, UserRole.SuperAdmin)]
    [InlineData("false", UserRole.SuperAdmin)]
    [InlineData(null, UserRole.Coordinator)]
    [InlineData("false", UserRole.ReadOnly)]
    public async Task Switch_off_signs_in_without_second_factor_with_the_same_body_and_cookie_as_with_one(string? setting, UserRole role)
    {
        var email = role == UserRole.Admin || role == UserRole.SuperAdmin ? EmailFor(role) : "sam.staff@gmail.com";
        var settings = setting is null ? null : new Dictionary<string, string?> { [MfaPolicy.ConfigKey] = setting };
        using var plainDb = CreateDb();
        SeedUser(plainDb, SeedTenant(plainDb).Id, email, role);
        var plain = CreateController(plainDb, Token(email, null), settings: settings);
        using var factorDb = CreateDb();
        SeedUser(factorDb, SeedTenant(factorDb).Id, email, role);
        var withFactor = CreateController(factorDb, Token(email, "totp"), settings: settings);

        var a = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>((await Exchange(plain)).Result).Value).Data!;
        var b = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>((await Exchange(withFactor)).Result).Value).Data!;

        Assert.Equal((b.FullName, b.Role, b.TenantName is null), (a.FullName, a.Role, a.TenantName is null));
        Assert.Equal(withFactor.Response.Headers.SetCookie.Count, plain.Response.Headers.SetCookie.Count);
        Assert.Contains("odip_jwt=", plain.Response.Headers.SetCookie.ToString());
        Assert.InRange((a.ExpiresAt - DateTime.UtcNow).TotalMinutes, 29, 30.1);
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.SuperAdmin)]
    public async Task Switch_off_required_role_without_factor_logs_MfaWouldRefuse_with_ids_and_no_email(UserRole role)
    {
        var warnings = new List<string>();
        using var db = CreateDb();
        var user = SeedUser(db, SeedTenant(db).Id, EmailFor(role), role);

        var result = await Exchange(CreateController(db, Token(EmailFor(role), null), RecordingLogger(warnings).Object));

        Assert.IsType<OkObjectResult>(result.Result);
        var line = Assert.Single(warnings, w => w.Contains("MfaWouldRefuse"));
        Assert.Contains(user.Id.ToString(), line);
        Assert.Contains(role.ToString(), line);
        Assert.Contains("password", line);
        Assert.DoesNotContain("@", line);
    }

    [Fact]
    public async Task Switch_off_with_totp_or_an_optional_role_logs_no_MfaWouldRefuse()
    {
        var warnings = new List<string>();
        await ExchangeAs(UserRole.Admin, AdminEmail, "totp", logger: RecordingLogger(warnings).Object);
        await ExchangeAs(UserRole.Coordinator, "sam.staff@gmail.com", null, logger: RecordingLogger(warnings).Object);

        Assert.DoesNotContain(warnings, w => w.Contains("MfaWouldRefuse"));
    }

    [Fact]
    public async Task Switch_on_refusal_does_not_also_log_MfaWouldRefuse()
    {
        var warnings = new List<string>();
        await ExchangeAs(UserRole.Admin, AdminEmail, null, SwitchOn, RecordingLogger(warnings).Object);

        Assert.DoesNotContain(warnings, w => w.Contains("MfaWouldRefuse"));
    }

    [Fact]
    public async Task Refusal_order_unverified_email_beats_mfa()
    {
        using var db = CreateDb();
        SeedUser(db, SeedTenant(db).Id, AdminEmail, UserRole.Admin);

        var result = await Exchange(CreateController(db, AdminEmail, emailVerified: false, settings: SwitchOn));

        Assert.Equal(ExchangeRefusal.EmailNotVerified, CodeOf(result));
    }

    [Fact]
    public async Task Refusal_order_address_unconfirmed_beats_mfa()
    {
        using var db = CreateDb();
        var user = SeedUser(db, SeedTenant(db).Id, AdminEmail, UserRole.Admin);
        user.SignInAddressUnconfirmed = true;
        db.SaveChanges();

        var result = await Exchange(CreateController(db, Token(AdminEmail, null), settings: SwitchOn));

        Assert.Equal(ExchangeRefusal.AddressUnconfirmed, CodeOf(result));
    }

    [Fact]
    public async Task Mfa_beats_session_length()
    {
        var result = await ExchangeAs(UserRole.Admin, AdminEmail, null, SwitchOn, seed: (db, tenantId) => SeedLimit(db, tenantId, 60));

        Assert.Equal(ExchangeRefusal.MfaEnrolmentRequired, CodeOf(result));
    }

    // ── MfaPolicy and SignInProviders.SecondFactor ──────────────────────

    [Fact]
    public void SecondFactor_reads_the_claim_and_is_null_on_odd_shapes_instead_of_throwing()
    {
        Assert.Equal("totp", SignInProviders.SecondFactor(FirebaseTestClaims.For("a@b.example", signInSecondFactor: "totp")));
        Assert.Null(SignInProviders.SecondFactor(FirebaseTestClaims.For("a@b.example")));
        Assert.Null(SignInProviders.SecondFactor(FirebaseTestClaims.For("a@b.example", signInProvider: null)));
        Assert.Null(SignInProviders.SecondFactor(new Dictionary<string, object>()));
        Assert.Null(SignInProviders.SecondFactor(new Dictionary<string, object> { ["firebase"] = "totp" }));
        Assert.Null(SignInProviders.SecondFactor(new Dictionary<string, object> { ["firebase"] = 7 }));
        Assert.Null(SignInProviders.SecondFactor(new Dictionary<string, object> { ["firebase"] = new Dictionary<string, object> { ["sign_in_second_factor"] = 5 } }));
        Assert.Null(SignInProviders.SecondFactor(new Dictionary<string, object> { ["firebase"] = new Dictionary<string, object> { ["sign_in_second_factor"] = " " } }));
        Assert.Equal("totp", SignInProviders.SecondFactor(new Dictionary<string, object> { ["firebase"] = new Dictionary<string, object> { ["sign_in_second_factor"] = "totp" } }));
        Assert.Equal("totp", SignInProviders.SecondFactor(new Dictionary<string, object>
            { ["firebase"] = System.Text.Json.JsonDocument.Parse("""{"sign_in_second_factor":"totp"}""").RootElement }));
        Assert.Null(SignInProviders.SecondFactor(new Dictionary<string, object>
            { ["firebase"] = System.Text.Json.JsonDocument.Parse("""{"sign_in_second_factor":3}""").RootElement }));
    }

    [Theory]
    [InlineData(UserRole.Admin, true)]
    [InlineData(UserRole.SuperAdmin, true)]
    [InlineData(UserRole.Coordinator, false)]
    [InlineData(UserRole.SupportWorker, false)]
    [InlineData(UserRole.ReadOnly, false)]
    public void Only_Admin_and_SuperAdmin_are_required(UserRole role, bool required) => Assert.Equal(required, MfaPolicy.RequiredFor(role));

    [Fact]
    public void Enforced_follows_the_switch_and_defaults_to_off()
    {
        static IConfiguration Cfg(string? v) => new ConfigurationBuilder()
            .AddInMemoryCollection(v is null ? [] : new Dictionary<string, string?> { [MfaPolicy.ConfigKey] = v }).Build();
        Assert.False(MfaPolicy.Enforced(Cfg(null)));
        Assert.False(MfaPolicy.Enforced(Cfg("false")));
        Assert.True(MfaPolicy.Enforced(Cfg("true")));
    }
}
