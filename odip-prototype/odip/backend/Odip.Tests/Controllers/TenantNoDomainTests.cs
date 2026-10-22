using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// A sole trader whose staff use personal addresses has no email domain of its own. The domain is optional: blank is stored as no domain (null, so the
/// unique index allows many), the duplicate checks skip it, and staff addresses are still held to the "check this address" confirmation.
/// </summary>
public class TenantNoDomainTests
{
    private static OdipDbContext SuperAdminDb()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns((Guid?)null);
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)).Options;
        return new OdipDbContext(options, current.Object);
    }

    private static TenantsController Controller(OdipDbContext db) => new(db, new Mock<IFirebaseUserService>().Object);

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData(" @ ")]
    public async Task Two_organisations_can_be_set_up_with_no_domain(string blank)
    {
        using var db = SuperAdminDb();
        Assert.IsType<CreatedAtActionResult>(await Controller(db).Create(new CreateTenantDto("Jo Care", blank)));
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Sam Support", blank, null, null), CancellationToken.None));

        var tenants = await db.Tenants.ToListAsync();
        Assert.Equal(2, tenants.Count);
        Assert.All(tenants, t => Assert.Null(t.EmailDomain));
    }

    [Fact]
    public async Task Clearing_the_domain_of_an_organisation_stores_none_and_a_second_blank_is_not_a_duplicate()
    {
        using var db = SuperAdminDb();
        var a = new Tenant { Id = Guid.NewGuid(), Name = "A", EmailDomain = "a.example.com", IsActive = true, CreatedAt = DateTime.UtcNow };
        var b = new Tenant { Id = Guid.NewGuid(), Name = "B", EmailDomain = null, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.AddRange(a, b);
        db.SaveChanges();

        Assert.IsType<OkObjectResult>(await Controller(db).Update(a.Id, new UpdateTenantDto("A", "", true)));
        Assert.All(await db.Tenants.ToListAsync(), t => Assert.Null(t.EmailDomain));
    }

    [Fact]
    public async Task A_typed_domain_is_still_checked_for_duplicates()
    {
        using var db = SuperAdminDb();
        db.Tenants.Add(new Tenant { Id = Guid.NewGuid(), Name = "A", EmailDomain = "a.example.com", IsActive = true, CreatedAt = DateTime.UtcNow });
        db.SaveChanges();

        Assert.IsType<ConflictObjectResult>(await Controller(db).Create(new CreateTenantDto("B", "A.example.com")));
    }

    [Fact]
    public async Task Create_with_setup_always_makes_the_provider_row_named_after_the_organisation()
    {
        using var db = SuperAdminDb();
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "", null, null), CancellationToken.None));

        var row = await db.ProviderSettings.IgnoreQueryFilters().SingleAsync();
        Assert.Equal((await db.Tenants.SingleAsync()).Id, row.TenantId);
        Assert.Equal("Jo Care", row.OrganisationName);
    }

    [Fact]
    public async Task Create_with_setup_keeps_the_state_that_was_chosen()
    {
        using var db = SuperAdminDb();
        var settings = new TenantSetupProviderDto { OrganisationName = "Jo Care Pty Ltd", State = "WA" };
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "", settings, null), CancellationToken.None));

        Assert.Equal("WA", (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State);
    }

    // ── The staff create still asks about an address when the organisation has no domain ──

    [Fact]
    public async Task Staff_create_asks_to_check_an_unusual_address_but_lets_a_gmail_one_through()
    {
        var own = new Tenant { Id = Guid.NewGuid(), Name = "Own", EmailDomain = null, IsActive = true, CreatedAt = DateTime.UtcNow };
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), own.Id);
        db.Tenants.Add(own);
        db.SaveChanges();
        var admin = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin")], "Test"));
        var service = new StaffCreateService(db, null);
        CreateStaffDto Staff(string email) => new() { FirstName = "Jo", LastName = "Ng", Email = email, Role = UserRole.SupportWorker };

        Assert.Equal(AddressConfirmation.Code, (await service.StageAsync(Staff("jo@gmial.example.net"), admin, own.Id, CancellationToken.None)).ErrorCode);
        Assert.Null((await service.StageAsync(Staff("jo.ng@gmail.com"), admin, own.Id, CancellationToken.None)).Error);
    }
}
