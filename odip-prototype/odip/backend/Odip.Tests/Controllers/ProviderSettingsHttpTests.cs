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
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The organisation contact fields (Settings 2b) through the real MVC pipeline: model binding and the DTO's [StringLength] rules,
/// which the controller-level tests (calling Upsert directly) never run. Same one-controller Kestrel host as EarlyAccessHttpTests.
/// </summary>
public class ProviderSettingsHttpTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");

    [Theory]
    [InlineData("tradingName", 200)]
    [InlineData("contactEmail", 254)]
    [InlineData("contactPhone", 30)]
    [InlineData("website", 500)]
    public async Task An_over_length_contact_field_is_refused_with_400_by_the_pipeline_and_the_row_is_untouched(string field, int limit)
    {
        await using var app = await StartAsync();
        var body = $$"""{"registrationNumber":"REG","abn":"12345678901","organisationName":"Org","address":"1 St","state":"NSW","{{field}}":"{{new string('1', limit + 1)}}"}""";

        var response = await app.Client.PutAsync("/api/v1/provider-settings", new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var scope = app.Services.CreateScope();
        Assert.Empty(await scope.ServiceProvider.GetRequiredService<OdipDbContext>().ProviderSettings.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task The_admin_organisation_read_returns_the_four_contact_fields()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, current.Object);
        db.Tenants.Add(new Tenant { Id = TenantA, Name = "Alpha Support", EmailDomain = "alpha.example.com", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantA, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "NSW",
            TradingName = "Alpha", ContactEmail = "office@alpha.example.com", ContactPhone = "0200000000", Website = "https://alpha.example.com",
        });
        db.SaveChanges();

        var result = await new TenantsController(db, new Mock<IFirebaseUserService>().Object).GetProviderSettings(TenantA, CancellationToken.None);

        var dto = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>(result).Value).Data!;
        Assert.Equal(("Alpha", "office@alpha.example.com", "0200000000", "https://alpha.example.com"), (dto.TradingName, dto.ContactEmail, dto.ContactPhone, dto.Website));
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
            m.ApplicationParts.Add(new OnlyProviderSettings());
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

    private sealed class OnlyProviderSettings : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyProviderSettings);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ProviderSettingsController).GetTypeInfo() };
    }
}
