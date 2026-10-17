using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Api.Serialization;
using Odip.Api.Services;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// The audit log must never hold a sign-up's personal details. AuditInterceptorTests shows the entity types are off the audited list;
/// this proves it through the production wiring: the same registrations Program.cs makes for the audit interceptor
/// (<c>AddScoped&lt;AuditInterceptor&gt;</c> and <c>AddInterceptors</c> on the DbContext) and for the early-access services
/// (<c>AddEarlyAccess()</c>), the real controllers, and real HTTP. A sign-up, a differing repeat and the SuperAdmin's Delete go in; the audit
/// rows that come out hold the Delete's own row and none of the details. (Program.cs itself needs Postgres, Firebase and a JWT secret to start,
/// so this hosts just the two early-access controllers; see <see cref="EarlyAccessHttpTests"/>.)
/// </summary>
public class EarlyAccessAuditWiringTests
{
    private const string Email = "audit.person@example.org";
    private const string Phone = "0491 570 156";
    private const string Role = "Zebra wrangler";
    private const string Message = "Please erase everything about me, ref zq-4471";
    private const string LaterPhone = "0400 123 456";
    private const string LaterMessage = "Second note, ref zq-9902";

    [Fact]
    public async Task ASignup_ADifferingRepeat_AndTheSuperAdminsDelete_LeaveNoPersonalDetailInTheAuditLog()
    {
        await using var host = await StartAsync();

        Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(Phone, Message)).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(LaterPhone, LaterMessage)).StatusCode);

        using var list = JsonDocument.Parse(await (await host.AdminAsync(HttpMethod.Get, "")).Content.ReadAsStringAsync());
        var item = list.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().Single();
        Assert.Equal(1, item.GetProperty("laterSubmissions").GetArrayLength());
        var id = item.GetProperty("id").GetGuid();

        // Past the cap, the first over-limit answers are kept in the over-limit row (later ones only count); they must stay out of the audit log like the rest.
        for (var i = 0; i < 12; i++)
            Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(LaterPhone, $"Over the limit zq-over-{i}")).StatusCode);
        using var full = JsonDocument.Parse(await (await host.AdminAsync(HttpMethod.Get, "")).Content.ReadAsStringAsync());
        var overItem = full.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().Single();
        Assert.Equal(10, overItem.GetProperty("laterSubmissions").GetArrayLength());
        Assert.Equal(3, overItem.GetProperty("overLimitCount").GetInt32());
        Assert.Contains("zq-over-9", overItem.GetProperty("firstOverLimit").GetProperty("message").GetString());
        Assert.NotEqual(JsonValueKind.Null, overItem.GetProperty("lastOverLimitAtUtc").ValueKind);
        Assert.True(overItem.GetProperty("followUpNeeded").GetBoolean());

        // Marking it followed up (the SuperAdmin's call) clears the marker; a new distinct over-limit repeat from the public form sets it again.
        Assert.Equal(HttpStatusCode.OK, (await host.AdminAsync(HttpMethod.Post, $"/{id}/followed-up", new { overLimitCount = 3 })).StatusCode);
        Assert.False(await host.FollowUpNeededAsync());
        Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(LaterPhone, "Over the limit zq-over-again")).StatusCode);
        Assert.True(await host.FollowUpNeededAsync());

        Assert.Equal(HttpStatusCode.OK, (await host.AdminAsync(HttpMethod.Delete, "/" + id)).StatusCode);

        var audit = await host.AuditRowsAsync();
        // The sign-ups themselves wrote nothing; only the SuperAdmin's two calls did, and each row names who and when but no answers.
        Assert.Equal(new[] { AuditAction.Updated, AuditAction.Deleted }, audit.OrderBy(a => a.ChangedAt).Select(a => a.Action));
        Assert.All(audit, a => Assert.Equal(id, a.EntityId));
        var delete = audit.Single(a => a.Action == AuditAction.Deleted);
        Assert.Equal("EarlyAccessRequest", delete.EntityType);
        Assert.Equal(id, delete.EntityId);
        // Every column of every audit row, as text: none of the details may appear in any of them.
        var everything = JsonSerializer.Serialize(audit);
        foreach (var detail in new[] { Email, "Audit Person", "Audit Care", Phone, LaterPhone, Role, "zq-4471", "zq-9902", "Second note", "zq-over" })
            Assert.DoesNotContain(detail, everything, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, await host.SignupRowsAsync()); // and the details really are gone from the tables
    }

    [Fact]
    public async Task AMarkFollowedUpFromBeforeANewOverLimitRepeat_IsRefused_AndTheMarkerStaysSet()
    {
        await using var host = await StartAsync();
        Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(Phone, Message)).StatusCode);
        for (var i = 0; i < 12; i++)
            Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(LaterPhone, $"Note {i}")).StatusCode); // 10 kept, 2 over the limit
        using var list = JsonDocument.Parse(await (await host.AdminAsync(HttpMethod.Get, "")).Content.ReadAsStringAsync());
        var item = list.RootElement.GetProperty("data").GetProperty("items").EnumerateArray().Single();
        var id = item.GetProperty("id").GetGuid();
        Assert.Equal(2, item.GetProperty("overLimitCount").GetInt32());

        // The SuperAdmin has the record open at count 2; a 13th arrives (count 3). The Mark followed up from the old view is refused.
        Assert.Equal(HttpStatusCode.Accepted, (await host.PostSignupAsync(LaterPhone, "A new one after the page loaded")).StatusCode);
        var stale = await host.AdminAsync(HttpMethod.Post, $"/{id}/followed-up", new { overLimitCount = 2 });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Contains("A new submission arrived after you opened this. Reload to see it.", await stale.Content.ReadAsStringAsync());
        Assert.True(await host.FollowUpNeededAsync());
        Assert.Empty(await host.AuditRowsAsync());

        // A fresh one with the count now on screen clears it.
        Assert.Equal(HttpStatusCode.OK, (await host.AdminAsync(HttpMethod.Post, $"/{id}/followed-up", new { overLimitCount = 3 })).StatusCode);
        Assert.False(await host.FollowUpNeededAsync());
    }

    private static async Task<AuditHost> StartAsync()
    {
        var databaseName = Guid.NewGuid().ToString();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        // As Program.cs: the interceptor is a scoped service and the DbContext is given it through AddInterceptors.
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<AuditInterceptor>();
        builder.Services.AddDbContext<OdipDbContext>((sp, options) =>
            options.UseInMemoryDatabase(databaseName).AddInterceptors(sp.GetRequiredService<AuditInterceptor>()));
        builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
        builder.Services.AddEarlyAccess();
        // The purge uses ExecuteDeleteAsync, which EF InMemory lacks; its own PostgreSQL facts cover it.
        builder.Services.Remove(builder.Services.Single(d => d.ImplementationType == typeof(EarlyAccessPurgeBackgroundService)));
        builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddControllers()
            .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new EarlyAccessControllers()); })
            .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

        var app = builder.Build();
        app.UseMiddleware<ExceptionHandlingMiddleware>();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        return new AuditHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) });
    }

    private sealed class EarlyAccessControllers : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(EarlyAccessControllers);
        public IEnumerable<TypeInfo> Types { get; } =
            new[] { typeof(EarlyAccessController).GetTypeInfo(), typeof(AdminEarlyAccessController).GetTypeInfo() };
    }

    /// <summary>Signs a request in as a SuperAdmin when it carries X-Test-SuperAdmin; otherwise it is anonymous, like the landing page.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.ContainsKey("X-Test-SuperAdmin")) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "SuperAdmin"), new Claim("fullName", "Jordan Lee"),
            };
            return Task.FromResult(AuthenticateResult.Success(
                new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class AuditHost(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public Task<HttpResponseMessage> PostSignupAsync(string phone, string message) =>
            client.PostAsync("/api/public/early-access", new StringContent(JsonSerializer.Serialize(new
            {
                name = "Audit Person", organisation = "Audit Care", email = Email, role = Role, phone, message, website = "",
            }), Encoding.UTF8, "application/json"));

        public async Task<bool> FollowUpNeededAsync()
        {
            using var scope = app.Services.CreateScope();
            return (await scope.ServiceProvider.GetRequiredService<OdipDbContext>().EarlyAccessRequests.AsNoTracking().SingleAsync()).FollowUpNeeded;
        }

        public Task<HttpResponseMessage> AdminAsync(HttpMethod method, string suffix, object? body = null)
        {
            var request = new HttpRequestMessage(method, "/api/v1/admin/early-access" + suffix);
            if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            request.Headers.Add("X-Test-SuperAdmin", "1");
            return client.SendAsync(request);
        }

        public async Task<List<Odip.Domain.Entities.AuditLog>> AuditRowsAsync()
        {
            using var scope = app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().AuditLogs.AsNoTracking().ToListAsync();
        }

        public async Task<int> SignupRowsAsync()
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            return await db.EarlyAccessRequests.CountAsync() + await db.EarlyAccessLaterSubmissions.CountAsync();
        }

        public async ValueTask DisposeAsync()
        {
            client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
