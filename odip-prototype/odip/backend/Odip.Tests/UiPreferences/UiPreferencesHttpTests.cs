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
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.UiPreferences;

/// <summary>
/// The saved itinerary view through a real host: each person reads and writes only their own row (the id comes from the claims),
/// every role including ReadOnly can save it, and anything but lower-case days or list is a 400 that saves nothing.
/// Same harness as WhatsNewHttpTests.
/// </summary>
public class UiPreferencesHttpTests
{
    private const string Path = "/api/v1/me/ui-preferences";
    private static string Body(string? value) => value is null ? "{}" : $"{{\"itineraryView\":{JsonSerializer.Serialize(value)}}}";

    [Fact]
    public async Task Put_ThenGet_ReturnsTheChoice_ForThatUserOnly()
    {
        await using var host = await TestHost.StartAsync();
        var (sam, samsColleague, otherOrg) = (await host.AddUserAsync(), await host.AddUserAsync(host.TenantA), await host.AddUserAsync(Guid.NewGuid()));

        Assert.Null(await host.ViewAsync(sam));

        var put = await host.SendAsync(HttpMethod.Put, "Admin", sam, Body("list"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("list", await ReadView(put));

        Assert.Equal("list", await host.ViewAsync(sam));
        Assert.Null(await host.ViewAsync(samsColleague));
        Assert.Null(await host.ViewAsync(otherOrg));
    }

    [Fact]
    public async Task OnePersonsSave_LeavesAnotherPersonsSavedRowAlone_InTheSameOrganisation()
    {
        await using var host = await TestHost.StartAsync();
        var (a, b) = (await host.AddUserAsync(), await host.AddUserAsync());

        await host.SendAsync(HttpMethod.Put, "Admin", b, Body("days"));
        await host.SendAsync(HttpMethod.Put, "Admin", a, Body("list"));

        Assert.Equal("days", await host.ViewAsync(b));
        Assert.Equal("list", await host.ViewAsync(a));
        Assert.Equal(2, await host.RowCountAsync());
    }

    [Fact]
    public async Task SecondPut_UpdatesTheOneRow()
    {
        await using var host = await TestHost.StartAsync();
        var sam = await host.AddUserAsync();

        await host.SendAsync(HttpMethod.Put, "Admin", sam, Body("list"));
        var second = await host.SendAsync(HttpMethod.Put, "Admin", sam, Body("days"));

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("days", await host.ViewAsync(sam));
        Assert.Equal(1, await host.RowCountAsync());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"itineraryView\":null}")]
    [InlineData("{\"itineraryView\":\"\"}")]
    [InlineData("{\"itineraryView\":\"   \"}")]
    [InlineData("{\"itineraryView\":\"grid\"}")]
    [InlineData("{\"itineraryView\":\"LIST\"}")]
    [InlineData("{\"itineraryView\":\"Days\"}")]
    [InlineData("{\"itineraryView\":\"list \"}")]
    [InlineData("{\"itineraryView\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}")]
    [InlineData("{\"itineraryView\":5}")]
    [InlineData("null")]
    public async Task BadInput_Is400_AndSavesNothing(string json)
    {
        await using var host = await TestHost.StartAsync();
        var sam = await host.AddUserAsync();

        var response = await host.SendAsync(HttpMethod.Put, "Admin", sam, json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await host.RowCountAsync());
        Assert.Null(await host.ViewAsync(sam));
    }

    [Fact]
    public async Task BadInput_LeavesAnEarlierChoiceAlone()
    {
        await using var host = await TestHost.StartAsync();
        var sam = await host.AddUserAsync();
        await host.SendAsync(HttpMethod.Put, "Admin", sam, Body("list"));

        var response = await host.SendAsync(HttpMethod.Put, "Admin", sam, Body("LIST"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("list", await host.ViewAsync(sam));
    }

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    [InlineData("Coordinator")]
    public async Task EveryRole_CanSaveItsOwnChoice(string role)
    {
        await using var host = await TestHost.StartAsync();
        var sam = await host.AddUserAsync();

        var response = await host.SendAsync(HttpMethod.Put, role, sam, Body("list"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("list", await host.ViewAsync(sam));
    }

    [Fact]
    public async Task ReadOnly_IsStillRefusedElsewhere()
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Put, "ReadOnly", Guid.NewGuid(), Body("list"), "/api/v1/me/ui-preferences/other");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task NotSignedIn_Is401()
    {
        await using var host = await TestHost.StartAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.SendAsync(HttpMethod.Get, null, null, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await host.SendAsync(HttpMethod.Put, null, null, Body("list"))).StatusCode);
        Assert.Equal(0, await host.RowCountAsync());
    }

    [Fact]
    public async Task ATokenForAUserWhoNoLongerExists_SavesNothing_AndIsNotASessionError()
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Put, "Admin", Guid.NewGuid(), Body("list"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, await host.RowCountAsync());
    }

    [Fact]
    public void ASavedViewChoice_IsNotAudited()
    {
        Assert.DoesNotContain(typeof(UserUiPreference), AuditedEntities.Types);
    }

    private static async Task<string?> ReadView(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var view = doc.RootElement.GetProperty("data").GetProperty("itineraryView");
        return view.ValueKind == JsonValueKind.Null ? null : view.GetString();
    }

    private sealed class HeaderAuth : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder) : base(options, logger, encoder) { }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var user = Request.Headers["X-Test-User"].FirstOrDefault();
            if (user is null) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user) };
            var role = Request.Headers["X-Test-Role"].FirstOrDefault();
            if (role is not null) claims.Add(new Claim(ClaimTypes.Role, role));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, "Test")), "Test")));
        }
    }

    private sealed class FixedTenant : ICurrentTenant
    {
        public Guid? TenantId => Guid.NewGuid();
        public bool IsSuperAdmin => false;
        public Guid? ViewAsUserId => null;
    }

    private sealed class OnlyUiPreferencesController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyUiPreferencesController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(UiPreferencesController).GetTypeInfo() };
    }

    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly HttpClient _client;
        public Guid TenantA { get; } = Guid.NewGuid();

        private TestHost(WebApplication app, HttpClient client)
        {
            _app = app;
            _client = client;
        }

        public static async Task<TestHost> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddScoped<ICurrentTenant, FixedTenant>();
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, HeaderAuth>("Test", null);
            builder.Services.AddAuthorization();
            builder.Services.AddControllers().ConfigureApplicationPartManager(m =>
            {
                m.ApplicationParts.Clear();
                m.ApplicationParts.Add(new OnlyUiPreferencesController());
            });

            var app = builder.Build();
            app.UseAuthentication();
            app.UseMiddleware<ReadOnlyMiddleware>();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();

            return new TestHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
        }

        /// <summary>A user row in the given organisation (default: this host's first one).</summary>
        public async Task<Guid> AddUserAsync(Guid? tenantId = null)
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            var id = Guid.NewGuid();
            db.Users.Add(new User { Id = id, TenantId = tenantId ?? TenantA, Username = "u" + id.ToString("N"), Email = "u@example.com", FirstName = "A", LastName = "B", CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return id;
        }

        public async Task<int> RowCountAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().UserUiPreferences.CountAsync();
        }

        public async Task<string?> ViewAsync(Guid userId) => await ReadView(await SendAsync(HttpMethod.Get, "Admin", userId, null));

        public Task<HttpResponseMessage> SendAsync(HttpMethod method, string? role, Guid? userId, string? json, string path = Path)
        {
            var request = new HttpRequestMessage(method, path);
            if (userId is not null) request.Headers.Add("X-Test-User", userId.Value.ToString());
            if (role is not null) request.Headers.Add("X-Test-Role", role);
            if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            return _client.SendAsync(request);
        }

        public async ValueTask DisposeAsync()
        {
            _client.Dispose();
            await _app.DisposeAsync();
        }
    }
}
