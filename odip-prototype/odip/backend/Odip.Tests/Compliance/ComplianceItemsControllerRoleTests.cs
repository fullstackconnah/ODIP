using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Routing;
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

namespace Odip.Tests.Compliance;

/// <summary>Compliance dates name key personnel, so the list is for Admin, Coordinator and SuperAdmin, and only Admin and SuperAdmin write. Checked as the framework evaluates the role strings, then over a real pipeline for the 403.</summary>
public class ComplianceItemsControllerRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static IEnumerable<MethodInfo> Actions() =>
        typeof(ComplianceItemsController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt() =>
        Assert.Equal(
            new[] { nameof(ComplianceItemsController.Create), nameof(ComplianceItemsController.Delete), nameof(ComplianceItemsController.GetAll), nameof(ComplianceItemsController.Update) },
            Actions().Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));

    [Theory]
    [InlineData("SuperAdmin", true), InlineData("Admin", true), InlineData("Coordinator", true), InlineData("SupportWorker", false), InlineData("ReadOnly", false)]
    public void TheList_AdmitsAdminCoordinatorAndSuperAdminOnly(string role, bool allowed) =>
        Assert.Equal(allowed, Allows(typeof(ComplianceItemsController).GetMethod(nameof(ComplianceItemsController.GetAll))!, role));

    [Theory]
    [InlineData(nameof(ComplianceItemsController.Create)), InlineData(nameof(ComplianceItemsController.Update)), InlineData(nameof(ComplianceItemsController.Delete))]
    public void Writes_AdmitAdminAndSuperAdminOnly(string name)
    {
        var action = typeof(ComplianceItemsController).GetMethod(name)!;
        foreach (var role in new[] { "SuperAdmin", "Admin" }) Assert.True(Allows(action, role), role);
        foreach (var role in new[] { "Coordinator", "SupportWorker", "ReadOnly" }) Assert.False(Allows(action, role), role);
    }

    [Theory]
    [InlineData("Coordinator", "POST")]
    [InlineData("Coordinator", "PUT")]
    [InlineData("Coordinator", "DELETE")]
    [InlineData("SupportWorker", "POST")]
    [InlineData("ReadOnly", "DELETE")]
    public async Task A_role_that_may_not_write_gets_403_and_nothing_is_written(string role, string method)
    {
        await using var host = await Host.StartAsync();
        await host.SeedAsync();

        var id = await host.FirstIdAsync();
        var response = await host.SendAsync(role, new HttpMethod(method), method == "POST" ? "" : $"/{id}", new { kind = "Registration", label = "Changed", expiresOn = "2027-02-04" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(("NDIS registration", 1), await host.StateAsync());
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    public async Task An_admin_can_add_a_date(string role)
    {
        await using var host = await Host.StartAsync();

        var response = await host.SendAsync(role, HttpMethod.Post, "", new { kind = "Insurance", label = "Public liability insurance", expiresOn = "2027-02-04" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(("Public liability insurance", 1), await host.StateAsync());
    }

    [Theory]
    [InlineData("Coordinator", HttpStatusCode.OK)]
    [InlineData("SupportWorker", HttpStatusCode.Forbidden)]
    [InlineData("ReadOnly", HttpStatusCode.Forbidden)]
    public async Task The_list_is_read_by_a_coordinator_and_refused_to_the_other_roles(string role, HttpStatusCode expected)
    {
        await using var host = await Host.StartAsync();

        Assert.Equal(expected, (await host.SendAsync(role, HttpMethod.Get, "", null)).StatusCode);
    }

    private sealed class OnlyComplianceItemsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyComplianceItemsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ComplianceItemsController).GetTypeInfo() };
    }

    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-Role"].FirstOrDefault() is not { } role) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new(ClaimTypes.Role, role), new("tenant_id", Host.Tenant.ToString()) };
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        public static readonly Guid Tenant = Guid.NewGuid();
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
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyComplianceItemsController()); })
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
            var request = new HttpRequestMessage(method, "/api/v1/compliance-items" + suffix);
            request.Headers.Add("X-Test-Role", role);
            if (body is not null && method != HttpMethod.Get) request.Content = JsonContent.Create(body);
            return Client.SendAsync(request);
        }

        public async Task SeedAsync()
        {
            await using var scope = _app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.ComplianceItems.Add(new Odip.Domain.Entities.ComplianceItem { Id = Guid.NewGuid(), TenantId = Tenant, Label = "NDIS registration", ExpiresOn = new DateOnly(2027, 2, 4) });
            await db.SaveChangesAsync();
        }

        public async Task<Guid> FirstIdAsync()
        {
            await using var scope = _app.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().ComplianceItems.IgnoreQueryFilters().Select(i => i.Id).FirstOrDefaultAsync();
        }

        /// <summary>The first row's label and the row count: what a refused write must leave as it was.</summary>
        public async Task<(string? Label, int Count)> StateAsync()
        {
            await using var scope = _app.Services.CreateAsyncScope();
            var rows = await scope.ServiceProvider.GetRequiredService<OdipDbContext>().ComplianceItems.IgnoreQueryFilters().ToListAsync();
            return (rows.FirstOrDefault()?.Label, rows.Count);
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
