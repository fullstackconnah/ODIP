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
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Sam Support", blank, new TenantSetupProviderDto { State = "VIC" }, null), CancellationToken.None));

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
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "jo.example.com", new TenantSetupProviderDto { State = "VIC" }, null), CancellationToken.None));

        var row = await db.ProviderSettings.IgnoreQueryFilters().SingleAsync();
        Assert.Equal((await db.Tenants.SingleAsync()).Id, row.TenantId);
        Assert.Equal("Jo Care", row.OrganisationName);
    }

    [Fact]
    public async Task Create_with_setup_falls_back_to_the_tenant_name_only_when_the_organisation_name_is_blank()
    {
        using var db = SuperAdminDb();
        var settings = new TenantSetupProviderDto { OrganisationName = "Jo Care Pty Ltd", State = "WA" };
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "", settings, null), CancellationToken.None));

        Assert.Equal("Jo Care Pty Ltd", (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).OrganisationName);
    }

    [Theory]
    [InlineData("WA", "WA")]
    [InlineData(" wa ", "WA")]
    public async Task Create_with_setup_stores_the_state_that_was_chosen(string chosen, string stored)
    {
        using var db = SuperAdminDb();
        var settings = new TenantSetupProviderDto { State = chosen };
        Assert.IsType<CreatedAtActionResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "", settings, null), CancellationToken.None));

        Assert.Equal(stored, (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State);
    }

    // Nobody is silently put on Victoria's prices and holidays: no state, or one that is not a state code, is refused and nothing is created.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("Victoria")]
    public async Task Create_with_setup_refuses_a_blank_or_unknown_state_and_creates_nothing(string? state)
    {
        using var db = SuperAdminDb();
        var result = await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "", new TenantSetupProviderDto { State = state }, null), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await db.Tenants.ToListAsync());
        Assert.Empty(await db.ProviderSettings.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Create_with_setup_refuses_a_request_with_no_provider_settings_at_all()
    {
        using var db = SuperAdminDb();
        Assert.IsType<BadRequestObjectResult>(await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto("Jo Care", "", null, null), CancellationToken.None));
        Assert.Empty(await db.Tenants.ToListAsync());
    }

    // The tenant name is copied into the 200-character column when no organisation name is typed, so an over-long one is a 400, not a database error.
    [Fact]
    public async Task Create_with_setup_refuses_a_tenant_name_too_long_to_become_the_organisation_name()
    {
        using var db = SuperAdminDb();
        var result = await Controller(db).CreateWithSetup(new CreateTenantWithSetupDto(new string('x', 201), "", new TenantSetupProviderDto { State = "VIC" }, null), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(await db.Tenants.ToListAsync());
    }

    // [ApiController] runs these before the action, so an over-long value is a 400 and never reaches the column limit (PostgreSQL 22001 is a 500).
    [Theory]
    [InlineData(nameof(TenantSetupProviderDto.RegistrationNumber), 21)]
    [InlineData(nameof(TenantSetupProviderDto.ABN), 21)]
    [InlineData(nameof(TenantSetupProviderDto.OrganisationName), 201)]
    [InlineData(nameof(TenantSetupProviderDto.Address), 501)]
    [InlineData(nameof(TenantSetupProviderDto.State), 11)]
    [InlineData(nameof(TenantSetupProviderDto.BSB), 11)]
    [InlineData(nameof(TenantSetupProviderDto.AccountNumber), 21)]
    [InlineData(nameof(TenantSetupProviderDto.BankAccountName), 201)]
    [InlineData(nameof(TenantSetupProviderDto.InvoiceFooterNotes), 2001)]
    public void The_setup_provider_fields_keep_the_column_limits_of_the_profile_save(string property, int length)
    {
        var dto = new TenantSetupProviderDto();
        typeof(TenantSetupProviderDto).GetProperty(property)!.SetValue(dto, new string('x', length));

        var errors = new List<System.ComponentModel.DataAnnotations.ValidationResult>();
        Assert.False(System.ComponentModel.DataAnnotations.Validator.TryValidateObject(dto, new System.ComponentModel.DataAnnotations.ValidationContext(dto), errors, validateAllProperties: true));
        Assert.Contains(errors, e => e.MemberNames.Contains(property));
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
