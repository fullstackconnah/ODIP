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
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.WhatsNew;

/// <summary>
/// What a real host does with What's new: a ReadOnly account can still mark its own reads (the middleware allow-list), but cannot
/// write release notes, and only a SuperAdmin can. Same harness as InboxReadAllHttpTests, plus a role header and the ReadOnly middleware.
/// </summary>
public class WhatsNewHttpTests
{
    private const string NewEntry = "{\"title\":\"T\",\"body\":\"B\",\"roles\":[\"Admin\"],\"important\":false}";

    [Theory]
    [InlineData("/api/v1/whats-new/seen")]
    [InlineData("/api/v1/whats-new/popup-seen")]
    public async Task ReadOnly_CanMarkItsOwnReads(string path)
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Post, path, "ReadOnly", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Admin_CannotCreateAnEntry()
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Post, "/api/v1/admin/whats-new", "Admin", NewEntry);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_CanCreateAnEntry()
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Post, "/api/v1/admin/whats-new", "SuperAdmin", NewEntry);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_MisspeltRole_Returns400_AndSavesNoRow()
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Post, "/api/v1/admin/whats-new", "SuperAdmin", "{\"title\":\"T\",\"body\":\"B\",\"roles\":[\"Admin\",\"Cordinator\"],\"important\":false}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Cordinator", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await host.EntryCountAsync());
    }

    [Fact]
    public async Task ReadOnly_CannotEditAnEntry()
    {
        await using var host = await TestHost.StartAsync();
        var response = await host.SendAsync(HttpMethod.Put, $"/api/v1/admin/whats-new/{Guid.NewGuid()}", "ReadOnly", NewEntry);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
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

    private sealed class OnlyWhatsNewControllers : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyWhatsNewControllers);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(WhatsNewController).GetTypeInfo(), typeof(AdminWhatsNewController).GetTypeInfo() };
    }

    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly HttpClient _client;

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
                m.ApplicationParts.Add(new OnlyWhatsNewControllers());
            });

            var app = builder.Build();
            app.UseAuthentication();
            app.UseMiddleware<ReadOnlyMiddleware>();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();

            return new TestHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
        }

        public async Task<int> EntryCountAsync()
        {
            using var scope = _app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().WhatsNewEntries.CountAsync();
        }

        public Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string role, string? json)
        {
            var request = new HttpRequestMessage(method, path);
            request.Headers.Add("X-Test-User", Guid.NewGuid().ToString());
            request.Headers.Add("X-Test-Role", role);
            if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
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
