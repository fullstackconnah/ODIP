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
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Api.RateLimiting;
using Odip.Api.Serialization;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

/// <summary>
/// POST /api/v1/imports/{kind}/preview and /commit on a REAL Kestrel host with the controller's own [ServiceFilter], as DataExportHttpTests hosts the export's.
/// The unit tests call the filter directly; only this goes through the real pipeline and the real wiring, so dropping the attribute or the keyed limiter fails here.
/// A request is held inside the action pipeline (after model binding, so after the upload was read), where an import spends its time.
/// </summary>
public class ImportConcurrencyHttpTests
{
    private const string Csv = "First name,Last name\nAva,Stone\n";

    [Fact]
    public async Task A_third_import_of_one_organisation_gets_429_whether_the_two_held_are_preview_and_commit_and_another_organisation_and_a_later_start_are_not_refused()
    {
        await using var host = await Host.StartAsync();
        var (tenant, otherTenant) = (Guid.NewGuid(), Guid.NewGuid());

        // One preview and one commit hold the organisation's two permits: they share one limiter.
        var heldPreview = host.PostAsync("preview", tenant, hold: true);
        var heldCommit = host.PostAsync("commit", tenant, hold: true);
        await host.BothHeldAsync();

        using (var refused = await host.PostAsync("preview", tenant))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
            using var json = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
            Assert.Equal(ImportConcurrencyFilter.BusyMessage, json.RootElement.GetProperty("errors")[0].GetString());
        }
        using (var other = await host.PostAsync("preview", otherTenant)) Assert.Equal(HttpStatusCode.OK, other.StatusCode);

        host.Release();
        using (var preview = await heldPreview) Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        using (var commit = await heldCommit) Assert.Equal(HttpStatusCode.OK, commit.StatusCode);
        using var after = await host.PostOnceThePermitIsFreeAsync("preview", tenant);
        Assert.Equal(HttpStatusCode.OK, after.StatusCode);
    }

    /// <summary>Holds each request that sends X-Test-Hold inside the action pipeline until released, and counts how many are held.</summary>
    private sealed class HoldGate : IAsyncActionFilter
    {
        private readonly TaskCompletionSource _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public SemaphoreSlim Held { get; } = new(0);

        public void Release() => _release.TrySetResult();

        public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            if (context.HttpContext.Request.Headers.ContainsKey("X-Test-Hold"))
            {
                Held.Release();
                await _release.Task.WaitAsync(TimeSpan.FromSeconds(20));
            }
            await next();
        }
    }

    private sealed class OnlyImportsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyImportsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ImportsController).GetTypeInfo() };
    }

    /// <summary>Signs every request in as an Admin of the organisation named by X-Test-Tenant.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, ImportTestSupport.AdminId.ToString()), new(ClaimTypes.Role, "Admin"), new("fullName", "Ada Admin"),
                new("tenant_id", Request.Headers["X-Test-Tenant"].Single()!),
            };
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly HoldGate _gate;

        private Host(WebApplication app, HttpClient client, HoldGate gate) { _app = app; Client = client; _gate = gate; }

        public HttpClient Client { get; }

        public static async Task<Host> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var gate = new HoldGate();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            // As Program.cs registers them: the imports' two-per-organisation filter over its own keyed limiter.
            builder.Services.AddKeyedSingleton(ImportConcurrencyFilter.LimiterKey, (_, _) => new PlanQuoteConcurrencyLimiter(ImportConcurrencyFilter.PermitsPerOrganisation));
            builder.Services.AddScoped<ImportConcurrencyFilter>();
            builder.Services.AddScoped(sp => ImportTestSupport.Service(sp.GetRequiredService<OdipDbContext>(), sp.GetRequiredService<ICurrentTenant>()));
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers(o => o.Filters.Add(gate))
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyImportsController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            // Program.cs's order: exception handling, then authentication and authorisation, then the endpoints.
            app.UseMiddleware<ExceptionHandlingMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) }, gate);
        }

        public void Release() => _gate.Release();

        /// <summary>Waits until two requests are held inside the pipeline, so both permits are known to be taken.</summary>
        public async Task BothHeldAsync()
        {
            for (var i = 0; i < 2; i++) Assert.True(await _gate.Held.WaitAsync(TimeSpan.FromSeconds(20)), "A held import never reached the action.");
        }

        public Task<HttpResponseMessage> PostAsync(string step, Guid tenant, bool hold = false)
        {
            var form = new MultipartFormDataContent
            {
                { new ByteArrayContent(Encoding.UTF8.GetBytes(Csv)), "file", "people.csv" },
                { new StringContent("Active"), "landing" },
                { new StringContent(Guid.NewGuid().ToString()), "idempotencyKey" },
            };
            var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/imports/participants/{step}") { Content = form };
            request.Headers.Add("X-Test-Tenant", tenant.ToString());
            if (hold) request.Headers.Add("X-Test-Hold", "1");
            return Client.SendAsync(request);
        }

        /// <summary>A start retried while it answers 429: the client can have the response a moment before the permit is released.</summary>
        public async Task<HttpResponseMessage> PostOnceThePermitIsFreeAsync(string step, Guid tenant)
        {
            var until = DateTime.UtcNow.AddSeconds(10);
            while (true)
            {
                var response = await PostAsync(step, tenant);
                if (response.StatusCode != HttpStatusCode.TooManyRequests || DateTime.UtcNow > until) return response;
                response.Dispose();
                await Task.Delay(50);
            }
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
