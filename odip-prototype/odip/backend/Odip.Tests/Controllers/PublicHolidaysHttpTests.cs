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
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Interfaces;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>A holiday sent with no date must be refused over a real pipeline: the body binds to a missing date, not to 0001-01-01 (H21-2).</summary>
public class PublicHolidaysHttpTests
{
    [Fact]
    public async Task A_holiday_posted_with_no_date_gets_400_and_nothing_is_saved()
    {
        await using var host = await Host.StartAsync();

        var response = await host.PostAsync(new { name = "Test day" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Enter the holiday date.", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await host.CountAsync());
    }

    [Fact]
    public async Task A_holiday_posted_with_a_date_is_saved()
    {
        await using var host = await Host.StartAsync();

        var response = await host.PostAsync(new { name = "Test day", date = "2026-10-12" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, await host.CountAsync());
    }

    private sealed class OnlyPublicHolidaysController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyPublicHolidaysController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(PublicHolidaysController).GetTypeInfo() };
    }

    private sealed class SuperAdminAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new(ClaimTypes.Role, "SuperAdmin") };
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
            builder.Services.AddSingleton(TimeProvider.System);
            builder.Services.AddSingleton(Mock.Of<IPublicHolidaySyncService>());
            builder.Services.AddAuthentication(SuperAdminAuth.Scheme).AddScheme<AuthenticationSchemeOptions, SuperAdminAuth>(SuperAdminAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyPublicHolidaysController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) });
        }

        public Task<HttpResponseMessage> PostAsync(object body) => Client.PostAsJsonAsync("/api/v1/public-holidays", body);

        public async Task<int> CountAsync()
        {
            await using var scope = _app.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().PublicHolidays.IgnoreQueryFilters().CountAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
