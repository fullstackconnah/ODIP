using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>PUT /settings/security through the real MVC pipeline: a body with no sessionLengthMinutes key must be refused, not read as "No limit".
/// Same one-controller Kestrel host as ProviderSettingsHttpTests.</summary>
public class SecuritySettingsBindingTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");

    [Fact]
    public async Task A_body_with_no_key_is_400_and_the_stored_limit_is_unchanged()
    {
        await using var app = await StartAsync();
        Assert.True((await Put(app, """{"sessionLengthMinutes":60}""")).IsSuccessStatusCode);

        var missing = await Put(app, "{}");

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(60, await Stored(app));
    }

    [Fact]
    public async Task An_explicit_null_saves_No_limit_and_a_number_out_of_range_is_still_400()
    {
        await using var app = await StartAsync();
        await Put(app, """{"sessionLengthMinutes":60}""");

        Assert.Equal(HttpStatusCode.BadRequest, (await Put(app, """{"sessionLengthMinutes":14}""")).StatusCode);
        Assert.True((await Put(app, """{"sessionLengthMinutes":null}""")).IsSuccessStatusCode);
        Assert.Null(await Stored(app));
    }

    private static Task<HttpResponseMessage> Put(AppHost app, string body) =>
        app.Client.PutAsync("/api/v1/settings/security", new StringContent(body, Encoding.UTF8, "application/json"));

    private static async Task<int?> Stored(AppHost app)
    {
        using var scope = app.Services.CreateScope();
        return (await scope.ServiceProvider.GetRequiredService<OdipDbContext>().AppSettings.IgnoreQueryFilters().SingleAsync()).SessionLengthMinutes;
    }

    private static async Task<AppHost> StartAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var databaseName = Guid.NewGuid().ToString();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        builder.Services.AddSingleton(tenant.Object);
        builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, AdminHandler>("Test", null);
        builder.Services.AddControllers().ConfigureApplicationPartManager(m =>
        {
            m.ApplicationParts.Clear();
            m.ApplicationParts.Add(new OnlySettings());
        });
        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();
        return new AppHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
    }

    private sealed class AppHost(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;
        public IServiceProvider Services => app.Services;
        public async ValueTask DisposeAsync() { Client.Dispose(); await app.DisposeAsync(); }
    }

    private sealed class AdminHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync() => Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(
            new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "Admin")], "Test")), "Test")));
    }

    private sealed class OnlySettings : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlySettings);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(SettingsController).GetTypeInfo() };
    }
}
