using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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
/// What a tenant's email domain may be. It is the organisation's OWN domain: staff at it are not asked about, and no other tenant's staff may be given an
/// address at it. A shared mail provider (gmail.com) is nobody's own, so it is refused as a tenant's domain at create and update, instead of leaving one
/// tenant owning the address space every organisation's staff use.
/// </summary>
public class TenantEmailDomainTests
{
    private static string SharedProviderMessage(string domain) =>
        $"{domain} is a shared email provider, so it cannot be an organisation's email domain. Enter the organisation's own domain.";

    public static IEnumerable<object[]> EveryProvider() => CommonEmailProviders.Domains.Select(domain => new object[] { domain });

    private static OdipDbContext SuperAdminDb()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns((Guid?)null);
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        // CreateWithSetup runs inside a transaction, which the InMemory provider refuses unless told to ignore it.
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options;
        return new OdipDbContext(options, current.Object);
    }

    private static Tenant SeedTenant(OdipDbContext db, string domain, string name = "Acme Support")
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = name, EmailDomain = domain, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static TenantsController Controller(OdipDbContext db, Mock<IFirebaseUserService>? firebase = null) =>
        new(db, (firebase ?? new Mock<IFirebaseUserService>()).Object);

    private static string Refusal(IActionResult result)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        return Assert.Single(Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors!);
    }

    // ── Create ──────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(EveryProvider))]
    public async Task Create_refuses_every_common_provider_domain_and_makes_no_tenant(string provider)
    {
        using var db = SuperAdminDb();

        var result = await Controller(db).Create(new CreateTenantDto("Acme Support", provider));

        Assert.Equal(SharedProviderMessage(provider), Refusal(result));
        Assert.Empty(await db.Tenants.ToListAsync());
    }

    [Fact]
    public async Task Create_refuses_a_provider_domain_whatever_case_it_is_typed_in()
    {
        using var db = SuperAdminDb();

        var result = await Controller(db).Create(new CreateTenantDto("Acme Support", "Gmail.COM"));

        Assert.Equal(SharedProviderMessage("gmail.com"), Refusal(result));
        Assert.Empty(await db.Tenants.ToListAsync());
    }

    [Theory]
    [InlineData("acme.example.com")]
    [InlineData("mail.gmail.com")]          // a subdomain of a provider is not the provider
    [InlineData("notgmail.com")]
    public async Task Create_still_accepts_an_ordinary_domain(string domain)
    {
        using var db = SuperAdminDb();

        var result = await Controller(db).Create(new CreateTenantDto("Acme Support", domain));

        Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(domain, (await db.Tenants.SingleAsync()).EmailDomain);
    }

    [Fact]
    public async Task Create_with_setup_refuses_a_provider_domain_before_a_tenant_a_user_or_an_account_is_made()
    {
        using var db = SuperAdminDb();
        var firebase = new Mock<IFirebaseUserService>();
        var dto = new CreateTenantWithSetupDto("Acme Support", "gmail.com", null,
            new CreateInitialUserDto("Jane", "Smith", "jane.smith@gmail.com", "jane.smith", "Admin", null));

        var result = await Controller(db, firebase).CreateWithSetup(dto, CancellationToken.None);

        Assert.Equal(SharedProviderMessage("gmail.com"), Refusal(result));
        Assert.Empty(await db.Tenants.ToListAsync());
        Assert.Empty(await db.Users.IgnoreQueryFilters().ToListAsync());
        firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Update ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_refuses_changing_the_domain_to_a_provider_and_leaves_the_tenant_as_it_was()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db, "acme.example.com");

        var result = await Controller(db).Update(tenant.Id, new UpdateTenantDto("Acme Support Renamed", "outlook.com", true));

        Assert.Equal(SharedProviderMessage("outlook.com"), Refusal(result));
        var stored = await db.Tenants.SingleAsync();
        Assert.Equal("acme.example.com", stored.EmailDomain);
        Assert.Equal("Acme Support", stored.Name);
    }

    [Fact]
    public async Task Update_leaves_a_tenant_that_already_holds_a_provider_domain_editable_while_the_domain_is_unchanged()
    {
        // No live tenant has one, but a legacy row must not become impossible to rename or switch off because of a domain it already had.
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db, "gmail.com");

        var result = await Controller(db).Update(tenant.Id, new UpdateTenantDto("Renamed", "gmail.com", false));

        Assert.IsType<OkObjectResult>(result);
        var stored = await db.Tenants.SingleAsync();
        Assert.Equal("Renamed", stored.Name);
        Assert.False(stored.IsActive);
    }

    [Fact]
    public async Task Update_still_changes_the_domain_to_an_ordinary_one()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db, "gmail.com");

        var result = await Controller(db).Update(tenant.Id, new UpdateTenantDto("Acme Support", "acme.example.com", true));

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal("acme.example.com", (await db.Tenants.SingleAsync()).EmailDomain);
    }
}
