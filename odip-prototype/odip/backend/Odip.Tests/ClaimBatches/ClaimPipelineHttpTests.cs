using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>The gate of GET api/v1/claim-hub/pipeline over a real pipeline: Admin, Coordinator and SuperAdmin read it, other roles get 403, and a caller with no organisation gets 400.</summary>
public class ClaimPipelineHttpTests
{
    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task Other_roles_get_403(string role)
    {
        await using var host = await Host.StartAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await host.GetAsync(role, withTenant: true)).StatusCode);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SuperAdmin")]
    public async Task Managers_with_an_organisation_get_200_and_twelve_weeks(string role)
    {
        await using var host = await Host.StartAsync();

        var response = await host.GetAsync(role, withTenant: true);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(12, json.RootElement.GetProperty("data").GetProperty("weeks").GetArrayLength());
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    public async Task A_caller_with_no_organisation_gets_400(string role)
    {
        await using var host = await Host.StartAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await host.GetAsync(role, withTenant: false)).StatusCode);
    }

    private sealed class OnlyClaimBatchesController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyClaimBatchesController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ClaimBatchesController).GetTypeInfo() };
    }

    /// <summary>Signs every request in from the X-Test-Role header (none means anonymous), with a tenant_id claim when X-Test-Tenant is sent.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-Role"].FirstOrDefault() is not { } role) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new(ClaimTypes.Role, role) };
            if (Request.Headers["X-Test-Tenant"].FirstOrDefault() is { } tenant) claims.Add(new Claim("tenant_id", tenant));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private Host(WebApplication app, HttpClient client) { _app = app; Client = client; }
        public HttpClient Client { get; }

        public static async Task<Host> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            // The pipeline read touches neither the BPR writer nor the invoice service.
            builder.Services.AddScoped(sp => new ClaimBatchService(sp.GetRequiredService<OdipDbContext>(), null!, null!, TimeProvider.System));
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyClaimBatchesController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) });
        }

        public Task<HttpResponseMessage> GetAsync(string role, bool withTenant)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/claim-hub/pipeline");
            request.Headers.Add("X-Test-Role", role);
            if (withTenant) request.Headers.Add("X-Test-Tenant", Guid.NewGuid().ToString());
            return Client.SendAsync(request);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
