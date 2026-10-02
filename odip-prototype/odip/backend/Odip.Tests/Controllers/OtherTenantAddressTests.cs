using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Global uniqueness of an address is what makes a squat permanent: the first tenant to type an address owns it, and an archived row keeps it. So a
/// staff member must not be given an address at ANOTHER organisation's own email domain: a Coordinator of tenant A creating
/// <c>new.hire@tenantb.com.au</c> would block tenant B from ever adding that person (409), and the person, following the emailed link, would sign in to
/// tenant A's workspace. The refusal is for every caller but a SuperAdmin, applies to a staff create and to a staff edit that CHANGES the address, and
/// cannot be confirmed away.
/// </summary>
public class OtherTenantAddressTests
{
    private const string OwnDomain = "acme.example.com";
    private const string OtherDomain = "tenantb.example.org";
    private const string Refusal = "That address belongs to another organisation on ODIP.";

    private sealed class Setup : IDisposable
    {
        public required OdipDbContext Db { get; init; }
        public required Mock<ICurrentTenant> Current { get; init; }
        public required Tenant Own { get; init; }
        public required Tenant Other { get; init; }
        public void Dispose() => Db.Dispose();
    }

    private static Setup TwoTenants(bool otherIsActive = true)
    {
        var own = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = OwnDomain, IsActive = true, CreatedAt = DateTime.UtcNow };
        var other = new Tenant { Id = Guid.NewGuid(), Name = "Tenant B", EmailDomain = OtherDomain, IsActive = otherIsActive, CreatedAt = DateTime.UtcNow };
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(own.Id);
        current.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, current.Object);
        db.Tenants.AddRange(own, other);
        db.SaveChanges();
        return new Setup { Db = db, Current = current, Own = own, Other = other };
    }

    private static StaffController StaffAs(Setup setup, string role) =>
        new(setup.Db, firebaseUserService: new Mock<IFirebaseUserService>().Object, currentTenant: setup.Current.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role), new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")),
                },
            },
        };

    private static CreateStaffDto StaffAt(string email, bool confirmed = false) => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, AddressConfirmed = confirmed,
    };

    private static UpdateStaffDto UpdateAt(string email, bool confirmed = false) => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, AddressConfirmed = confirmed,
    };

    private static async Task<User> SeedStaff(Setup setup, Guid tenantId, string email)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Staff", Username = Guid.NewGuid().ToString("N"), Email = email,
            Role = UserRole.SupportWorker, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        setup.Db.Users.Add(user);
        await setup.Db.SaveChangesAsync();
        return user;
    }

    private static void AssertRefused<T>(ActionResult<ApiResponse<T>> result)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<T>>(badRequest.Value);
        Assert.Equal(Refusal, Assert.Single(body.Errors!));
        // A refusal, not a question: it carries no confirmation code, so no screen offers to override it.
        Assert.Null(body.Code);
    }

    // ── Staff create ────────────────────────────────────────────────────

    [Theory]
    [InlineData("new.hire@tenantb.example.org")]
    [InlineData("New.Hire@TenantB.Example.org")]
    public async Task Staff_create_refuses_an_address_at_another_tenants_domain_for_a_tenant_caller(string address)
    {
        using var setup = TwoTenants();

        var result = await StaffAs(setup, "Coordinator").Create(StaffAt(address), CancellationToken.None);

        AssertRefused(result);
        Assert.Empty(await setup.Db.Users.ToListAsync());
    }

    [Fact]
    public async Task Staff_create_cannot_be_confirmed_past_it()
    {
        using var setup = TwoTenants();

        var result = await StaffAs(setup, "Admin").Create(StaffAt("new.hire@tenantb.example.org", confirmed: true), CancellationToken.None);

        AssertRefused(result);
        Assert.Empty(await setup.Db.Users.ToListAsync());
    }

    [Fact]
    public async Task Staff_create_refuses_it_even_when_the_other_tenant_is_inactive_because_the_domain_is_still_theirs()
    {
        using var setup = TwoTenants(otherIsActive: false);

        var result = await StaffAs(setup, "Admin").Create(StaffAt("new.hire@tenantb.example.org"), CancellationToken.None);

        AssertRefused(result);
    }

    [Theory]
    [InlineData("new.hire@acme.example.com")]       // the caller's own organisation
    [InlineData("new.hire@gmail.com")]              // a common provider
    public async Task Staff_create_still_allows_the_callers_own_domain_and_a_common_provider(string address)
    {
        using var setup = TwoTenants();

        var result = await StaffAs(setup, "Coordinator").Create(StaffAt(address), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Staff_create_matches_the_other_tenants_domain_exactly_so_a_subdomain_is_only_unusual_not_foreign()
    {
        using var setup = TwoTenants();
        var staff = StaffAs(setup, "Admin");

        // Not refused as another organisation's address; it is merely unusual, so it is asked about.
        var asked = await staff.Create(StaffAt("new.hire@mail.tenantb.example.org"), CancellationToken.None);
        var badRequest = Assert.IsType<BadRequestObjectResult>(asked.Result);
        Assert.Equal(AddressConfirmation.Code, Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value).Code);

        var confirmed = await staff.Create(StaffAt("new.hire@mail.tenantb.example.org", confirmed: true), CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(confirmed.Result);
    }

    [Fact]
    public async Task Staff_create_lets_a_SuperAdmin_do_it_once_the_unusual_address_is_confirmed()
    {
        using var setup = TwoTenants();

        var result = await StaffAs(setup, "SuperAdmin").Create(StaffAt("new.hire@tenantb.example.org", confirmed: true), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    // ── Staff update ────────────────────────────────────────────────────

    [Fact]
    public async Task Staff_update_refuses_a_change_to_an_address_at_another_tenants_domain_and_leaves_the_row_as_it_was()
    {
        using var setup = TwoTenants();
        var staff = await SeedStaff(setup, setup.Own.Id, "sam.staff@acme.example.com");

        var result = await StaffAs(setup, "Admin").Update(staff.Id, UpdateAt("sam.staff@tenantb.example.org", confirmed: true), CancellationToken.None);

        AssertRefused(result);
        Assert.Equal("sam.staff@acme.example.com", (await setup.Db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Staff_update_leaves_a_legacy_row_that_already_holds_such_an_address_editable_when_the_address_is_unchanged()
    {
        using var setup = TwoTenants();
        var staff = await SeedStaff(setup, setup.Own.Id, "legacy@tenantb.example.org");

        var result = await StaffAs(setup, "Admin").Update(staff.Id, UpdateAt("Legacy@TenantB.Example.org"), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Staff_update_lets_a_SuperAdmin_change_it_once_the_unusual_address_is_confirmed()
    {
        using var setup = TwoTenants();
        var staff = await SeedStaff(setup, setup.Own.Id, "sam.staff@acme.example.com");

        var result = await StaffAs(setup, "SuperAdmin").Update(staff.Id, UpdateAt("sam.staff@tenantb.example.org", confirmed: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("sam.staff@tenantb.example.org", (await setup.Db.Users.SingleAsync()).Email);
    }
}
