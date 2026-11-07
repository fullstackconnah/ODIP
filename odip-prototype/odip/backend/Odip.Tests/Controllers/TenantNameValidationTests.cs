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
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The organisation name is a trust boundary: blank, whitespace and over-column names get a 400, and a good one is saved trimmed. Run over a real HTTP host,
/// because MVC reads the DTO's validation attributes only when it binds the body (a Validator-only test cannot see a 500 from misplaced attributes).
/// </summary>
public class TenantNameValidationTests
{
    private const string Refusal = "Enter the organisation name.";

    [Fact]
    public async Task ANameWithSpaces_IsSavedTrimmed_OnCreateAndUpdate()
    {
        await using var host = await TestHost.StartAsync();

        var created = await host.Client.PostAsJsonAsync("/api/v1/admin/tenants", new { name = "  Jo Care  " });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var tenant = await host.Db.Tenants.SingleAsync();
        Assert.Equal("Jo Care", tenant.Name);

        var updated = await host.Client.PutAsJsonAsync($"/api/v1/admin/tenants/{tenant.Id}", new { name = "  Jo Care Co ", isActive = true });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal("Jo Care Co", (await host.Db.Tenants.AsNoTracking().SingleAsync()).Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ABlankName_Returns400_OnCreateAndUpdate(string name)
    {
        await using var host = await TestHost.StartAsync();
        var existing = await host.SeedAsync();

        var create = await host.Client.PostAsJsonAsync("/api/v1/admin/tenants", new { name });
        var update = await host.Client.PutAsJsonAsync($"/api/v1/admin/tenants/{existing}", new { name, isActive = true });

        foreach (var response in new[] { create, update })
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains(Refusal, await response.Content.ReadAsStringAsync());
        }
        Assert.Equal("Existing", (await host.Db.Tenants.AsNoTracking().SingleAsync()).Name);
    }

    [Fact]
    public async Task AnOver200Name_Returns400_AndExactly200Passes()
    {
        await using var host = await TestHost.StartAsync();
        var existing = await host.SeedAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.PostAsJsonAsync("/api/v1/admin/tenants", new { name = new string('a', 201) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await host.Client.PutAsJsonAsync($"/api/v1/admin/tenants/{existing}", new { name = new string('a', 201), isActive = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await host.Client.PostAsJsonAsync("/api/v1/admin/tenants", new { name = new string('a', 200) })).StatusCode);
    }

    /// <summary>Exposes just the tenants controller to MVC, so unrelated controllers' dependencies are never needed.</summary>
    private sealed class OnlyTenantsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyTenantsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(TenantsController).GetTypeInfo() };
    }

    /// <summary>Signs every request in as a SuperAdmin.</summary>
    private sealed class SuperAdminAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, "SuperAdmin")], "Test");
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
        }
    }

    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly IServiceScope _scope;

        private TestHost(WebApplication app, HttpClient client)
        {
            _app = app;
            _scope = app.Services.CreateScope();
            Client = client;
        }

        public HttpClient Client { get; }
        public OdipDbContext Db => _scope.ServiceProvider.GetRequiredService<OdipDbContext>();

        public static async Task<TestHost> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();

            var current = new Mock<ICurrentTenant>();
            current.Setup(t => t.TenantId).Returns((Guid?)null);
            current.Setup(t => t.IsSuperAdmin).Returns(true);
            builder.Services.AddSingleton(current.Object);
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, SuperAdminAuth>("Test", null);
            builder.Services.AddAuthorization();
            builder.Services.AddControllers().ConfigureApplicationPartManager(m =>
            {
                m.ApplicationParts.Clear();
                m.ApplicationParts.Add(new OnlyTenantsController());
            });

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();

            return new TestHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
        }

        public async Task<Guid> SeedAsync()
        {
            var tenant = new Odip.Domain.Entities.Tenant { Id = Guid.NewGuid(), Name = "Existing", IsActive = true, CreatedAt = DateTime.UtcNow };
            Db.Tenants.Add(tenant);
            await Db.SaveChangesAsync();
            return tenant.Id;
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            _scope.Dispose();
            await _app.DisposeAsync();
        }
    }
}
