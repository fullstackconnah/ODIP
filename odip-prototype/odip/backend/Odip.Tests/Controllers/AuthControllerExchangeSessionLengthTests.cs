using Microsoft.AspNetCore.Mvc;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

// Session length (Settings > Security) through the Firebase exchange and dev-login. Tests marked GUARD pass on the code before this feature:
// they pin what must NOT change (null limit = today, SuperAdmin never bound).
public partial class AuthControllerExchangeTests
{
    private static void SeedLimit(OdipDbContext db, Guid tenantId, int? minutes)
    {
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = tenantId, SessionLengthMinutes = minutes });
        db.SaveChanges();
    }

    private static IReadOnlyDictionary<string, object> ClaimsSignedInAgo(string email, TimeSpan ago) =>
        FirebaseTestClaims.For(email, authTime: DateTimeOffset.UtcNow.Add(-ago).ToUnixTimeSeconds());

    private static DateTime JwtExpiry(string token) => new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(token).ValidTo;

    private static string CodeOf(ActionResult<ApiResponse<AuthResponseDto>> result) =>
        Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<UnauthorizedObjectResult>(result.Result).Value).Code!;

    // GUARD: the deploy-safety test. Every organisation's limit is null after deploy, and null must change nothing.
    [Fact]
    public async Task With_no_limit_an_old_sign_in_still_exchanges()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane@acme.example.com");
        SeedLimit(db, tenant.Id, null);

        var result = await Exchange(CreateController(db, ClaimsSignedInAgo("jane@acme.example.com", TimeSpan.FromDays(3))));

        var data = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.InRange((data.ExpiresAt - DateTime.UtcNow).TotalMinutes, 29, 30.1);
        Assert.InRange((JwtExpiry(data.Token) - DateTime.UtcNow).TotalMinutes, 29, 30.1);
    }

    // GUARD: no settings row at all (an organisation that never opened Settings) is also no limit.
    [Fact]
    public async Task With_no_settings_row_an_old_sign_in_still_exchanges()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane@acme.example.com");

        var result = await Exchange(CreateController(db, ClaimsSignedInAgo("jane@acme.example.com", TimeSpan.FromDays(3))));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Once_the_limit_has_passed_the_exchange_is_refused_SessionLengthReached()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "jane@acme.example.com");
        SeedLimit(db, tenant.Id, 60);

        var result = await Exchange(CreateController(db, ClaimsSignedInAgo("jane@acme.example.com", TimeSpan.FromMinutes(61))));

        Assert.Equal(ExchangeRefusal.SessionLengthReached, CodeOf(result));
        Assert.Null(StoredLastLoginAt(db, user.Id));
    }

    [Fact]
    public async Task Just_under_the_limit_exchanges_with_the_token_ending_at_the_cap()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane@acme.example.com");
        SeedLimit(db, tenant.Id, 60);
        var cap = DateTime.UtcNow.AddMinutes(-50).AddMinutes(60);

        var result = await Exchange(CreateController(db, ClaimsSignedInAgo("jane@acme.example.com", TimeSpan.FromMinutes(50))));

        var data = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.InRange(Math.Abs((data.ExpiresAt - cap).TotalSeconds), 0, 5);
        Assert.InRange(Math.Abs((JwtExpiry(data.Token) - cap).TotalSeconds), 0, 5);
    }

    [Fact]
    public async Task With_a_limit_a_token_without_auth_time_is_refused()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane@acme.example.com");
        SeedLimit(db, tenant.Id, 60);

        Assert.Equal(ExchangeRefusal.InvalidToken, CodeOf(await Exchange(CreateController(db, "jane@acme.example.com"))));
    }

    [Fact]
    public async Task With_a_limit_a_garbage_auth_time_is_refused()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane@acme.example.com");
        SeedLimit(db, tenant.Id, 60);

        var result = await Exchange(CreateController(db, FirebaseTestClaims.For("jane@acme.example.com", authTime: "soon")));

        Assert.Equal(ExchangeRefusal.InvalidToken, CodeOf(result));
    }

    // GUARD: with no limit a token without auth_time (every existing fixture) exchanges as today.
    [Fact]
    public async Task With_no_limit_a_token_without_auth_time_still_exchanges()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "jane@acme.example.com");

        Assert.IsType<OkObjectResult>((await Exchange(CreateController(db, "jane@acme.example.com"))).Result);
    }

    [Fact]
    public async Task Another_organisations_limit_does_not_apply()
    {
        using var db = CreateDb();
        var a = SeedTenant(db, "A", "a.example.com");
        var b = SeedTenant(db, "B", "b.example.com");
        SeedUser(db, a.Id, "jane@a.example.com");
        SeedLimit(db, a.Id, null);
        SeedLimit(db, b.Id, 15);

        var result = await Exchange(CreateController(db, ClaimsSignedInAgo("jane@a.example.com", TimeSpan.FromDays(2))));

        Assert.IsType<OkObjectResult>(result.Result);
    }

    // GUARD: a SuperAdmin is never bound, whatever any organisation sets; the token stays 30 minutes.
    [Fact]
    public async Task SuperAdmin_exchange_ignores_every_organisation_limit()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "root@" + SuperAdminDomain, UserRole.SuperAdmin);
        SeedLimit(db, tenant.Id, 15);

        var result = await Exchange(CreateController(db, ClaimsSignedInAgo("root@" + SuperAdminDomain, TimeSpan.FromDays(2))));

        var data = Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.InRange((JwtExpiry(data.Token) - DateTime.UtcNow).TotalMinutes, 29, 30.1);
    }

    [Fact]
    public async Task Dev_login_tenant_token_honours_a_short_limit()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "jane@acme.example.com");
        SeedLimit(db, tenant.Id, 15);

        var data = await DevLoginAsync(db, user.Username);

        Assert.InRange((JwtExpiry(data.Token) - DateTime.UtcNow).TotalMinutes, 14, 15.1);
        Assert.InRange((data.ExpiresAt - DateTime.UtcNow).TotalMinutes, 14, 15.1);
    }

    // GUARD: a dev SuperAdmin stays at 30 minutes whatever any organisation sets.
    [Fact]
    public async Task Dev_login_superadmin_token_stays_30_minutes()
    {
        using var db = CreateDb();
        var tenant = SeedTenant(db);
        var root = SeedUser(db, tenant.Id, "root@" + SuperAdminDomain, UserRole.SuperAdmin);
        SeedLimit(db, tenant.Id, 15);

        var data = await DevLoginAsync(db, root.Username);

        Assert.InRange((JwtExpiry(data.Token) - DateTime.UtcNow).TotalMinutes, 29, 30.1);
    }

    private static async Task<AuthResponseDto> DevLoginAsync(OdipDbContext db, string username)
    {
        var previous = Environment.GetEnvironmentVariable("DEV_AUTH_ENABLED");
        Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", "true");
        try
        {
            var result = await CreateController(db, "ignored@acme.example.com").DevLogin(new DevLoginDto { Username = username }, CancellationToken.None);
            return Assert.IsType<ApiResponse<AuthResponseDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        }
        finally
        {
            Environment.SetEnvironmentVariable("DEV_AUTH_ENABLED", previous);
        }
    }
}
