using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Api.RateLimiting;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ProblemReports;

/// <summary>
/// The wire-level contract of POST /api/v1/problem-reports against a REAL Kestrel host: real authentication
/// (a header-driven test scheme), the real CurrentTenant, the real ReadOnlyMiddleware, the same "api" limiter policy
/// as Program.cs (so a wrong policy name on the controller fails here), and a fake Work Board sender.
/// </summary>
public class ProblemReportsHttpTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000002");
    private const string Body = "{\"text\":\"The roster will not save.\",\"pagePath\":\"/schedule\",\"appVersion\":\"1.2.3 (abc1234)\"}";

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task EverySignedInRole_Gets201_AndTheRowIsInTheirTenant(string role)
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(Body, Caller(role));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = await host.SingleRowAsync();
        Assert.Equal(TenantA, row.TenantId);
        Assert.Equal(role, row.ReporterRole);
        Assert.Equal("Sam Sample", row.ReporterName);
        Assert.Equal("Sample Support Co", row.OrganisationName);
    }

    [Fact]
    public async Task AMissingToken_Gets401()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(Body, caller: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, await host.CountAsync());
    }

    [Fact]
    public async Task ASuperAdminWithNoTenantInView_Gets400()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(Body, Caller("SuperAdmin", noTenant: true));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Choose an organisation to view first.", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await host.CountAsync());
    }

    [Fact]
    public async Task ASuperAdminViewingTenantA_Gets201_WithANameFromTheClaims_AndTheRowInA()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(Body, Caller("SuperAdmin", noTenant: true, viewAs: TenantA, fullName: null, name: "super@example.com"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = await host.SingleRowAsync();
        Assert.Equal(TenantA, row.TenantId);
        Assert.Equal("super@example.com", row.ReporterName);
        Assert.Equal("SuperAdmin", row.ReporterRole);
        Assert.Equal("Sample Support Co", row.OrganisationName);
    }

    [Fact]
    public async Task ABodyTenantId_IsIgnored()
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync($"{{\"text\":\"hi there\",\"tenantId\":\"{TenantB}\",\"reporterName\":\"Someone Else\"}}", Caller("Admin"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = await host.SingleRowAsync();
        Assert.Equal(TenantA, row.TenantId);
        Assert.Equal("Sam Sample", row.ReporterName);
    }

    [Fact]
    public async Task TheAnswer_IsSent_WithTheCardId_WhenTheBoardAccepts()
    {
        await using var host = await TestHost.StartAsync(sender: new FakeSender((_, _) => Task.FromResult(new ProblemReportSendResult(true, 42, null))));

        var response = await host.PostAsync(Body, Caller("Coordinator"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var (id, status) = await ReadAnswer(response);
        Assert.Equal("Sent", status);
        var row = await host.SingleRowAsync();
        Assert.Equal(id, row.Id);
        Assert.Equal(ProblemReportStatus.Sent, row.Status);
        Assert.Equal(42, row.CardId);
        Assert.NotNull(row.SentAt);
    }

    [Fact]
    public async Task ASenderThatThrows_StillGives201Saved_WithTheRetryScheduled()
    {
        await using var host = await TestHost.StartAsync(sender: new FakeSender((_, _) => throw new InvalidOperationException("boom TYPEDWORDS")));

        var response = await host.PostAsync(Body, Caller("Coordinator"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Saved", (await ReadAnswer(response)).Status);
        var row = await host.SingleRowAsync();
        Assert.Equal(ProblemReportStatus.Saved, row.Status);
        Assert.Equal(0, row.Attempts);
        Assert.True(row.NextAttemptAt > DateTime.UtcNow);
        Assert.Equal(ProblemReportSendResult.UnknownOutcome, row.LastError);
        Assert.Null(row.CardId);
    }

    [Fact]
    public async Task ANotConfiguredSender_GivesSaved_AndNoErrorToTheUser()
    {
        await using var host = await TestHost.StartAsync(sender: new FakeSender((_, _) => Task.FromResult(new ProblemReportSendResult(false, null, ProblemReportSendResult.NotConfigured))));

        var response = await host.PostAsync(Body, Caller("Coordinator"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Saved", (await ReadAnswer(response)).Status);
        Assert.Equal(ProblemReportSendResult.NotConfigured, (await host.SingleRowAsync()).LastError);
    }

    [Fact]
    public async Task ASlowBoard_IsCutAtAboutFourSeconds_AndTheReportIsSaved()
    {
        await using var host = await TestHost.StartAsync(sender: new FakeSender(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10), ct);
            return new ProblemReportSendResult(true, 1, null);
        }));

        var watch = Stopwatch.StartNew();
        var response = await host.PostAsync(Body, Caller("Coordinator"));
        watch.Stop();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"took {watch.Elapsed}");
        Assert.Equal("Saved", (await ReadAnswer(response)).Status);
        var row = await host.SingleRowAsync();
        Assert.Equal(ProblemReportStatus.Saved, row.Status);
        Assert.Equal(ProblemReportSendResult.UnknownOutcome, row.LastError);
    }

    // ── Validation ──────────────────────────────────────────

    [Theory]
    [InlineData("{\"text\":\"\"}")]
    [InlineData("{\"text\":\"   \\n \"}")]
    [InlineData("{}")]
    public async Task EmptyText_Gets400_WithTheHouseCopy(string json)
    {
        await using var host = await TestHost.StartAsync();

        var response = await host.PostAsync(json, Caller("Admin"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Write a few words about what went wrong.", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await host.CountAsync());
    }

    [Fact]
    public async Task Text2001Long_Gets400_And2000IsAccepted()
    {
        await using var host = await TestHost.StartAsync();

        var tooLong = await host.PostAsync($"{{\"text\":\"{new string('a', 2001)}\"}}", Caller("Admin"));
        var justRight = await host.PostAsync($"{{\"text\":\"{new string('a', 2000)}\"}}", Caller("Admin"));

        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Contains("Keep it under 2,000 characters.", await tooLong.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created, justRight.StatusCode);
    }

    [Fact]
    public async Task LongOptionalFields_AreTruncated_NotRefused_AndTheServerSetsTheBrowser()
    {
        await using var host = await TestHost.StartAsync();
        var json = $"{{\"text\":\"hello there\",\"pagePath\":\"/{new string('p', 500)}\",\"appVersion\":\"{new string('v', 500)}\"}}";

        var response = await host.PostAsync(json, Caller("Admin"), userAgent: new string('u', 600));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var row = await host.SingleRowAsync();
        Assert.True(row.PagePath.Length <= 200);
        Assert.True(row.AppVersion.Length <= 64);
        Assert.True(row.UserAgent.Length <= 300);
        Assert.NotEmpty(row.UserAgent);
    }

    // ── Per-user cap ────────────────────────────────────────

    [Fact]
    public async Task TheSixthReportInTenMinutes_Gets429_WithRetryAfter_AndAnotherUserIsNotAffected()
    {
        await using var host = await TestHost.StartAsync();
        var user = Caller("Coordinator");
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Created, (await host.PostAsync(Body, user)).StatusCode);

        var sixth = await host.PostAsync(Body, user);
        var other = await host.PostAsync(Body, Caller("Coordinator"));

        Assert.Equal(HttpStatusCode.TooManyRequests, sixth.StatusCode);
        Assert.Equal("600", sixth.Headers.GetValues("Retry-After").Single());
        Assert.Equal(HttpStatusCode.Created, other.StatusCode);
        Assert.Equal(6, await host.CountAsync());
    }

    [Fact]
    public async Task ReportsOlderThanTenMinutes_DoNotCountTowardTheCap()
    {
        await using var host = await TestHost.StartAsync();
        var user = Caller("Coordinator");
        await host.SeedOldReportsAsync(user.UserId, count: 5, age: TimeSpan.FromMinutes(11));

        var response = await host.PostAsync(Body, user);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // ── ReadOnly middleware ─────────────────────────────────

    [Fact]
    public async Task AReadOnlyUser_CanPostAReport_ButNotAnythingElseUnderTheSamePrefix()
    {
        await using var host = await TestHost.StartAsync();
        var readOnly = Caller("ReadOnly");

        var report = await host.PostAsync(Body, readOnly);
        var sub = await host.PostAsync(Body, readOnly, path: "/api/v1/problem-reports/abc");
        var elsewhere = await host.PostAsync("{}", readOnly, path: "/api/v1/something-else");
        var put = await host.SendAsync(HttpMethod.Put, "/api/v1/problem-reports", Body, readOnly);

        Assert.Equal(HttpStatusCode.Created, report.StatusCode);
        Assert.NotEqual(HttpStatusCode.Created, sub.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, elsewhere.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
    }

    // ── Helpers ─────────────────────────────────────────────

    private static async Task<(Guid Id, string Status)> ReadAnswer(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var data = json.RootElement.GetProperty("data");
        return (data.GetProperty("id").GetGuid(), data.GetProperty("status").GetString()!);
    }

    private static Identity Caller(string role, bool noTenant = false, Guid? viewAs = null, string? fullName = "Sam Sample", string? name = null) =>
        new(Guid.NewGuid(), role, noTenant ? null : TenantA, viewAs, fullName, name);

    private sealed record Identity(Guid UserId, string Role, Guid? Tenant, Guid? ViewAs, string? FullName, string? Name);

    private sealed class FakeSender : IProblemReportSender
    {
        private readonly Func<ProblemReport, CancellationToken, Task<ProblemReportSendResult>> _send;
        public FakeSender(Func<ProblemReport, CancellationToken, Task<ProblemReportSendResult>> send) => _send = send;
        public Task<ProblemReportSendResult> TrySendAsync(ProblemReport report, CancellationToken ct) => _send(report, ct);
    }

    /// <summary>Builds a principal from X-Test-* headers; no X-Test-User header means no credentials at all.</summary>
    private sealed class HeaderAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public HeaderAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
            : base(options, logger, encoder) { }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var h = Request.Headers;
            if (!h.TryGetValue("X-Test-User", out var user)) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user!), new(ClaimTypes.Role, h["X-Test-Role"]!) };
            if (h.TryGetValue("X-Test-Tenant", out var tenant)) claims.Add(new Claim("tenant_id", tenant!));
            if (h.TryGetValue("X-Test-FullName", out var full)) claims.Add(new Claim("fullName", full!));
            if (h.TryGetValue("X-Test-Name", out var name)) claims.Add(new Claim(ClaimTypes.Name, name!));
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")), "Test");
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    private sealed class OnlyProblemReportsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyProblemReportsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ProblemReportsController).GetTypeInfo() };
    }

    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private TestHost(WebApplication app, HttpClient client) { _app = app; Client = client; }
        public HttpClient Client { get; }

        public static async Task<TestHost> StartAsync(IProblemReportSender? sender = null)
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();

            builder.Services.AddHttpContextAccessor();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            builder.Services.AddSingleton<IProblemReportSender>(sender ?? new FakeSender((_, _) => Task.FromResult(new ProblemReportSendResult(false, null, ProblemReportSendResult.NotConfigured))));
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, HeaderAuthHandler>("Test", null);
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m =>
                {
                    m.ApplicationParts.Clear();
                    m.ApplicationParts.Add(new OnlyProblemReportsController());
                })
                .AddJsonOptions(o => Odip.Api.Serialization.ApiJsonOptions.Configure(o.JsonSerializerOptions));
            builder.Services.AddRateLimiter(o =>
            {
                o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                // The same shape as Program.cs's "api" policy: a controller naming any other policy would 500 here.
                o.AddPolicy("api", context => RateLimitPartition.GetFixedWindowLimiter("api:test", _ =>
                    new FixedWindowRateLimiterOptions { PermitLimit = 100, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
                o.OnRejected = RateLimitRejection.WriteAsync;
            });

            var app = builder.Build();
            // Program.cs order: exception handling, rate limiter, authentication, authorization, ReadOnly, endpoints.
            app.UseMiddleware<ExceptionHandlingMiddleware>();
            app.UseRateLimiter();
            app.UseAuthentication();
            app.UseAuthorization();
            app.UseMiddleware<ReadOnlyMiddleware>();
            app.MapControllers();
            app.MapPost("/api/v1/something-else", () => "ok").RequireAuthorization();
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
                db.Tenants.Add(new Tenant { Id = TenantA, Name = "Sample Support Co" });
                db.Tenants.Add(new Tenant { Id = TenantB, Name = "Other Org" });
                await db.SaveChangesAsync();
            }
            await app.StartAsync();

            return new TestHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
        }

        public Task<HttpResponseMessage> PostAsync(string body, Identity? caller, string path = "/api/v1/problem-reports", string? userAgent = null) =>
            SendAsync(HttpMethod.Post, path, body, caller, userAgent);

        public Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string body, Identity? caller, string? userAgent = null)
        {
            var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            if (userAgent is not null) request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
            if (caller is not null)
            {
                request.Headers.Add("X-Test-User", caller.UserId.ToString());
                request.Headers.Add("X-Test-Role", caller.Role);
                if (caller.Tenant is { } t) request.Headers.Add("X-Test-Tenant", t.ToString());
                if (caller.ViewAs is { } v) request.Headers.Add("X-View-As-Tenant", v.ToString());
                if (caller.FullName is not null) request.Headers.Add("X-Test-FullName", caller.FullName);
                if (caller.Name is not null) request.Headers.Add("X-Test-Name", caller.Name);
            }
            return Client.SendAsync(request);
        }

        private OdipDbContext Db(IServiceScope scope) =>
            new(scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>(), new Odip.Infrastructure.Notifications.ScopedTenantOverride { IsSuperAdmin = true });

        public async Task<int> CountAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await Db(scope).ProblemReports.CountAsync();
        }

        public async Task<ProblemReport> SingleRowAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await Db(scope).ProblemReports.AsNoTracking().SingleAsync();
        }

        public async Task SeedOldReportsAsync(Guid userId, int count, TimeSpan age)
        {
            using var scope = _app.Services.CreateScope();
            var db = Db(scope);
            for (var i = 0; i < count; i++)
            {
                var r = ProblemReportCardTests.Report(x => { x.Id = Guid.NewGuid(); x.TenantId = TenantA; x.ReporterUserId = userId; x.CreatedAt = DateTime.UtcNow - age; });
                db.ProblemReports.Add(r);
            }
            await db.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
