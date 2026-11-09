using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Auth;

/// <summary>A signed-in token is rechecked against the user's row on every request: a deactivated, missing or re-roled user is refused (401).</summary>
public class SessionRecheckTests
{
    private static readonly Guid Org = Guid.NewGuid();

    private static (OdipDbContext Db, User User) Seeded(UserRole role = UserRole.Coordinator, bool active = true)
    {
        var db = TestDb.Create();
        var user = new User { Id = Guid.NewGuid(), TenantId = Org, Username = "sam", Email = "sam@example.test", Role = role, IsActive = active };
        db.Users.Add(user);
        db.SaveChanges();
        return (db, user);
    }

    private const string PlatformDomain = "platform.test";
    private static readonly IConfiguration Config = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { [SuperAdminDomain.ConfigKey] = PlatformDomain }).Build();

    private static ClaimsPrincipal Claims(string? id, string role, Guid? tenant = null) => new(new ClaimsIdentity(new[]
    {
        new Claim(ClaimTypes.NameIdentifier, id ?? ""), new Claim(ClaimTypes.Role, role), new Claim("tenant_id", (tenant ?? Org).ToString()),
    }, "test"));

    [Fact]
    public async Task An_active_user_with_the_same_role_passes()
    {
        var (db, user) = Seeded();
        Assert.Null(await SessionRecheck.RefusalAsync(db, Config, Claims(user.Id.ToString(), "Coordinator"), default));
    }

    [Fact]
    public async Task A_deactivated_user_is_refused()
    {
        var (db, user) = Seeded(active: false);
        Assert.NotNull(await SessionRecheck.RefusalAsync(db, Config, Claims(user.Id.ToString(), "Coordinator"), default));
    }

    [Theory]
    [InlineData(UserRole.SupportWorker, "Coordinator")] // lowered since the token was issued
    [InlineData(UserRole.Admin, "Coordinator")]         // raised since the token was issued
    public async Task A_changed_role_is_refused(UserRole now, string claim)
    {
        var (db, user) = Seeded(now);
        Assert.NotNull(await SessionRecheck.RefusalAsync(db, Config, Claims(user.Id.ToString(), claim), default));
    }

    [Fact]
    public async Task A_user_with_no_row_is_refused()
    {
        var (db, _) = Seeded();
        Assert.NotNull(await SessionRecheck.RefusalAsync(db, Config, Claims(Guid.NewGuid().ToString(), "Coordinator"), default));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    public async Task A_missing_or_bad_id_claim_is_refused(string? id)
    {
        var (db, _) = Seeded();
        Assert.NotNull(await SessionRecheck.RefusalAsync(db, Config, Claims(id, "Coordinator"), default));
    }

    [Fact]
    public async Task A_super_admin_viewing_as_another_organisation_passes()
    {
        var (db, user) = Seeded(UserRole.SuperAdmin);
        Assert.Null(await SessionRecheck.RefusalAsync(db, Config, Claims(user.Id.ToString(), "SuperAdmin", Guid.NewGuid()), default));
    }

    [Fact]
    public void Program_installs_the_recheck_on_the_bearer_events() => Assert.NotNull(OdipJwtEvents.Create().OnTokenValidated);

    [Theory]
    [InlineData(UserRole.Admin, true, "sam@platform.test", true)]   // the exchange issues SuperAdmin to this row, so the recheck keeps it
    [InlineData(UserRole.Admin, true, "sam@example.test", false)]   // not on the domain: a SuperAdmin claim is forged or stale
    [InlineData(UserRole.Admin, false, "sam@platform.test", false)] // deactivated
    public async Task A_super_admin_claim_on_a_non_super_admin_row_passes_only_for_an_active_user_on_the_domain(UserRole role, bool active, string email, bool passes)
    {
        var (db, user) = Seeded(role, active);
        user.Email = email;
        await db.SaveChangesAsync();
        var refusal = await SessionRecheck.RefusalAsync(db, Config, Claims(user.Id.ToString(), "SuperAdmin"), default);
        Assert.Equal(passes, refusal is null);
    }

    [Fact]
    public async Task Through_the_real_bearer_pipeline_a_deactivated_users_token_gets_401()
    {
        const string secret = "0123456789-0123456789-0123456789-0123456789";
        var dbName = Guid.NewGuid().ToString();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(dbName));
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = "Odip", ValidAudience = "Odip", IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
            };
            o.Events = OdipJwtEvents.Create();
        });
        builder.Services.AddAuthorization();
        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapGet("/ping", () => "ok").RequireAuthorization();
        app.MapGet("/tenant", (ICurrentTenant t) => t.TenantId?.ToString() ?? "none").RequireAuthorization();
        await app.StartAsync();
        try
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            var user = new User { Id = Guid.NewGuid(), TenantId = Org, Username = "sam", Email = "sam@example.test", Role = UserRole.Coordinator, IsActive = true };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:Secret"] = secret }).Build();
            var token = OdipSession.Token(user, Org, config, DateTime.UtcNow.AddMinutes(30));
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/ping")).StatusCode);
            // The recheck runs before authentication finishes; it must not build the request's own tenant from the still-anonymous user.
            Assert.Equal(Org.ToString(), await client.GetStringAsync("/tenant"));

            user.IsActive = false;
            await db.SaveChangesAsync();
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/ping")).StatusCode);
        }
        finally { await app.DisposeAsync(); }
    }
}
