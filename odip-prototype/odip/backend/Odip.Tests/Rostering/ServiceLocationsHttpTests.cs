using System.Net;
using System.Net.Http.Json;
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

namespace Odip.Tests.Rostering;

/// <summary>Service locations PR1: the write gate of /api/v1/service-locations over a real pipeline. Admin, Coordinator and SuperAdmin write; every other role gets 403 on POST and PUT, and a signed-in user of any role reads.</summary>
public class ServiceLocationsHttpTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    [Theory]
    [InlineData("SupportWorker", "POST")]
    [InlineData("SupportWorker", "PUT")]
    [InlineData("ReadOnly", "POST")]
    [InlineData("ReadOnly", "PUT")]
    public async Task Roles_outside_Admin_Coordinator_SuperAdmin_get_403_and_nothing_is_written(string role, string method)
    {
        await using var host = await Host.StartAsync();

        var response = await host.SendAsync(role, new HttpMethod(method), method == "PUT" ? $"/{Guid.NewGuid()}" : "", new { name = "Day centre", isActive = false });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await host.CountAsync());
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    [InlineData("SuperAdmin")]
    public async Task Managers_can_add_a_place(string role)
    {
        await using var host = await Host.StartAsync();

        var response = await host.SendAsync(role, HttpMethod.Post, "", new { name = "Day centre", latitude = -33.8688, longitude = 151.2093 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, await host.CountAsync());
    }

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task Roles_outside_the_managers_get_403_on_archive(string role)
    {
        await using var host = await Host.StartAsync();

        var response = await host.SendAsync(role, HttpMethod.Post, $"/{Guid.NewGuid()}/archive", new { });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task Any_signed_in_role_with_an_organisation_can_read_the_list(string role)
    {
        await using var host = await Host.StartAsync();

        Assert.Equal(HttpStatusCode.OK, (await host.SendAsync(role, HttpMethod.Get, "", null)).StatusCode);
    }

    private sealed class OnlyServiceLocationsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyServiceLocationsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ServiceLocationsController).GetTypeInfo() };
    }

    /// <summary>Signs every request in from the X-Test-Role header (none means anonymous), with the test organisation's tenant_id claim.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-Role"].FirstOrDefault() is not { } role) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new(ClaimTypes.Role, role), new("tenant_id", Tenant.ToString()) };
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
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyServiceLocationsController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) });
        }

        public Task<HttpResponseMessage> SendAsync(string role, HttpMethod method, string suffix, object? body)
        {
            var request = new HttpRequestMessage(method, "/api/v1/service-locations" + suffix);
            request.Headers.Add("X-Test-Role", role);
            if (body is not null && method != HttpMethod.Get) request.Content = JsonContent.Create(body);
            return Client.SendAsync(request);
        }

        public async Task<int> CountAsync()
        {
            await using var scope = _app.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().ServiceLocations.IgnoreQueryFilters().CountAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
