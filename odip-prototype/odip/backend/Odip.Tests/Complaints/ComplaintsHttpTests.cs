using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
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
using Odip.Api.Middleware;
using Odip.Api.Serialization;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Complaints;

/// <summary>
/// The complaints routes on a REAL host with the real authorisation pipeline (the role strings are only proved by the framework evaluating them): every route
/// answers 403 to SupportWorker and ReadOnly, with no list in the body, and an office role gets through. The caller's role comes from the X-Test-Role header.
/// </summary>
public class ComplaintsHttpTests
{
    private static readonly string Id = Guid.NewGuid().ToString();

    public static TheoryData<string, string, string> Routes
    {
        get
        {
            var data = new TheoryData<string, string, string>();
            foreach (var role in new[] { "SupportWorker", "ReadOnly" })
            {
                data.Add("GET", "/api/v1/complaints", role);
                data.Add("GET", $"/api/v1/complaints/{Id}", role);
                data.Add("POST", "/api/v1/complaints", role);
                data.Add("PUT", $"/api/v1/complaints/{Id}", role);
                data.Add("POST", $"/api/v1/complaints/{Id}/archive", role);
                data.Add("POST", $"/api/v1/complaints/{Id}/restore", role);
            }
            return data;
        }
    }

    [Theory, MemberData(nameof(Routes))]
    public async Task EveryRoute_IsForbiddenToSupportWorkerAndReadOnly(string method, string path, string role)
    {
        await using var host = await Host.StartAsync();
        var response = await host.SendAsync(method, path, role);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.DoesNotContain("items", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Admin_CanListTheRegister()
    {
        await using var host = await Host.StartAsync();
        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync("GET", "/api/v1/complaints", "Admin")).StatusCode);
    }

    private sealed class OnlyComplaintsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyComplaintsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ComplaintsController).GetTypeInfo() };
    }

    /// <summary>Signs every request in from X-Test-Role (none means anonymous).</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-Role"].FirstOrDefault() is not { } role) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new(ClaimTypes.Role, role), new("tenant_id", Guid.NewGuid().ToString()) };
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly HttpClient _client;

        private Host(WebApplication app, HttpClient client) { _app = app; _client = client; }

        public static async Task<Host> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyComplaintsController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            app.UseMiddleware<ExceptionHandlingMiddleware>();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
        }

        public Task<HttpResponseMessage> SendAsync(string method, string path, string role)
        {
            var request = new HttpRequestMessage(new HttpMethod(method), path);
            request.Headers.Add("X-Test-Role", role);
            if (method is "POST" or "PUT") request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
            return _client.SendAsync(request);
        }

        public async ValueTask DisposeAsync()
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
