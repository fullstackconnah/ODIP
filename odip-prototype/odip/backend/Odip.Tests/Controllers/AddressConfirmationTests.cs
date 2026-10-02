using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
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
/// An address is the whole of someone's sign-in, and since any address can sign in nothing about it says whose it is. A typo ("jane@gmial.com") or
/// another organisation's address is a live login for a stranger. So an address that is at neither the tenant's own domain nor a common email
/// provider is refused (400, code AddressNeedsConfirmation) until the request carries an explicit confirmation, on the four places an address is
/// first entered: a user, a tenant's first user, a staff member, and a staff edit that changes the address. The rule is the server's, so it cannot be
/// skipped by calling the API directly.
/// </summary>
public class AddressConfirmationTests
{
    private const string TenantDomain = "acme.example.com";

    private static readonly string[] Providers =
    [
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "yahoo.com", "yahoo.com.au",
        "bigpond.com", "bigpond.net.au", "optusnet.com.au", "iinet.net.au", "tpg.com.au", "proton.me", "protonmail.com",
    ];

    // ── The rule itself ─────────────────────────────────────────────────

    [Fact]
    public void The_list_is_exactly_the_agreed_common_providers_so_a_change_to_it_is_deliberate()
    {
        Assert.Equal(Providers.OrderBy(d => d), CommonEmailProviders.Domains.OrderBy(d => d));
    }

    [Theory]
    [MemberData(nameof(ProviderAddresses))]
    public void An_address_at_a_common_provider_needs_no_confirmation(string address)
    {
        Assert.False(AddressConfirmation.Needed(address, TenantDomain));
    }

    public static IEnumerable<object[]> ProviderAddresses() => Providers.Select(domain => new object[] { $"jane.smith@{domain}" });

    [Fact]
    public void An_address_at_the_tenants_own_domain_needs_no_confirmation_whatever_the_case_of_the_domain_on_record()
    {
        Assert.False(AddressConfirmation.Needed($"jane.smith@{TenantDomain}", TenantDomain));
        Assert.False(AddressConfirmation.Needed($"jane.smith@{TenantDomain}", " ACME.Example.com "));
    }

    [Theory]
    [InlineData("jane.smith@gmial.com")]                       // a typo of a provider
    [InlineData("jane.smith@other.example.org")]               // another organisation
    [InlineData("jane.smith@mail.acme.example.com")]           // a subdomain is not the tenant's domain: the match is exact
    [InlineData("jane.smith@notgmail.com")]                    // a look-alike of a provider
    [InlineData("jane.smith@gmail.com.evil.example")]          // a provider's name inside someone else's
    [InlineData("jane.smith@platform.example.com")]
    public void Any_other_address_needs_a_confirmation(string address)
    {
        Assert.True(AddressConfirmation.Needed(address, TenantDomain));
    }

    [Theory]
    [InlineData("@acme.example.com")]
    [InlineData(" Acme.Example.COM ")]
    public void An_address_at_the_tenants_own_domain_needs_no_confirmation_even_when_the_domain_on_record_is_untidy(string onRecord)
    {
        Assert.False(AddressConfirmation.Needed("jane.smith@acme.example.com", onRecord));
        Assert.Equal(AddressConfirmation.Message("jane.smith@gmial.com", "acme.example.com"), AddressConfirmation.Message("jane.smith@gmial.com", onRecord));
    }

    [Fact]
    public void With_no_tenant_domain_known_only_the_providers_pass()
    {
        Assert.False(AddressConfirmation.Needed("jane.smith@gmail.com", null));
        Assert.True(AddressConfirmation.Needed("jane.smith@acme.example.com", null));
        Assert.True(AddressConfirmation.Needed("jane.smith@acme.example.com", "  "));
    }

    [Theory]
    [InlineData("no-at-sign")]
    [InlineData("jane.smith@")]
    public void An_address_with_no_domain_is_not_this_rules_concern_the_other_checks_refuse_it(string address)
    {
        Assert.False(AddressConfirmation.Needed(address, TenantDomain));
    }

    [Fact]
    public void It_asks_the_admin_to_check_the_address_in_these_words()
    {
        Assert.Equal(
            "jane.smith@gmial.com is not at acme.example.com or a common email provider. The sign-in link goes to whoever owns this address. Check it is right.",
            AddressConfirmation.Message("jane.smith@gmial.com", TenantDomain));
    }

    // ── A user (SuperAdmin, Settings > Users) ───────────────────────────

    private static OdipDbContext SuperAdminDb(bool ignoreInMemoryTransactions = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
        if (ignoreInMemoryTransactions) builder.ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning));
        return new OdipDbContext(builder.Options, tenant.Object);
    }

    private static Tenant SeedTenant(OdipDbContext db, string name = "Acme Support", string domain = TenantDomain)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = name, EmailDomain = domain, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static Mock<IFirebaseUserService> AccountMaker()
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");
        return firebase;
    }

    private static void VerifyNoAccountMade(Mock<IFirebaseUserService> firebase) =>
        firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);

    private static CreateAdminUserDto AdminUserAt(Guid tenantId, string email, bool confirmed = false) => new()
    {
        FirstName = "Jane", LastName = "Smith", Email = email, Username = "jane.smith", Role = "Coordinator", TenantId = tenantId, AddressConfirmed = confirmed,
    };

    private static void AssertAsksForConfirmation(IActionResult result, string address, string tenantDomain)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<ApiResponse<object>>(badRequest.Value);
        Assert.Equal(AddressConfirmation.Code, body.Code);
        Assert.Equal(AddressConfirmation.Message(address, tenantDomain), Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task AdminUsers_create_refuses_an_unusual_address_until_the_admin_has_confirmed_it_and_makes_no_account_meanwhile()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var firebase = AccountMaker();
        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var refused = await controller.Create(AdminUserAt(tenant.Id, "Jane.Smith@Gmial.com"), CancellationToken.None);

        AssertAsksForConfirmation(refused, "jane.smith@gmial.com", TenantDomain);
        Assert.Empty(await db.Users.ToListAsync());
        VerifyNoAccountMade(firebase);
    }

    [Fact]
    public async Task AdminUsers_create_goes_ahead_once_the_address_is_confirmed()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, AccountMaker().Object);

        var result = await controller.Create(AdminUserAt(tenant.Id, "jane.smith@gmial.com", confirmed: true), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal("jane.smith@gmial.com", (await db.Users.SingleAsync()).Email);
    }

    [Theory]
    [InlineData("jane.smith@acme.example.com")]
    [InlineData("jane.smith@gmail.com")]
    [InlineData("jane.smith@yahoo.com.au")]
    public async Task AdminUsers_create_asks_for_nothing_when_the_address_is_at_the_tenants_domain_or_a_common_provider(string address)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, AccountMaker().Object);

        var result = await controller.Create(AdminUserAt(tenant.Id, address), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
    }

    [Fact]
    public async Task AdminUsers_create_reports_an_address_that_is_taken_before_it_asks_for_a_confirmation_of_it()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, FirstName = "Existing", LastName = "Person", Username = "existing", Email = "jane.smith@gmial.com",
            Role = UserRole.Coordinator, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, AccountMaker().Object);

        var result = await controller.Create(AdminUserAt(tenant.Id, "jane.smith@gmial.com"), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
    }

    // ── A user edit that changes the address (SuperAdmin, Settings > Users) ──

    private static UpdateAdminUserDto AdminUserEdit(string email, bool confirmed = false) => new()
    {
        FirstName = "Jane", LastName = "Smith", Email = email, Username = "jane.smith", Role = "Coordinator", IsActive = true, AddressConfirmed = confirmed,
    };

    private static async Task<User> SeedAdminSideUser(OdipDbContext db, Guid tenantId, string email)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Jane", LastName = "Smith", Username = "jane.smith", Email = email,
            Role = UserRole.Coordinator, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static AdminUsersController AdminUsersWith(OdipDbContext db, Mock<IFirebaseUserService>? firebase = null) =>
        new(db, new Mock<ILogger<AdminUsersController>>().Object, (firebase ?? new Mock<IFirebaseUserService>()).Object);

    [Fact]
    public async Task AdminUsers_update_refuses_a_change_to_an_unusual_address_until_it_is_confirmed_and_leaves_the_row_and_Firebase_as_they_were()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedAdminSideUser(db, tenant.Id, "jane.smith@acme.example.com");
        var firebase = new Mock<IFirebaseUserService>();

        var refused = await AdminUsersWith(db, firebase).Update(user.Id, AdminUserEdit("Jane.Smith@Gmial.com"), CancellationToken.None);

        AssertAsksForConfirmation(refused, "jane.smith@gmial.com", TenantDomain);
        Assert.Equal("jane.smith@acme.example.com", (await db.Users.SingleAsync()).Email);
        firebase.Verify(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AdminUsers_update_goes_ahead_once_the_new_address_is_confirmed()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedAdminSideUser(db, tenant.Id, "jane.smith@acme.example.com");

        var result = await AdminUsersWith(db).Update(user.Id, AdminUserEdit("jane.smith@gmial.com", confirmed: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal("jane.smith@gmial.com", (await db.Users.SingleAsync()).Email);
    }

    [Theory]
    [InlineData("jane.smith.new@acme.example.com")]
    [InlineData("jane.smith@gmail.com")]
    [InlineData("jane.smith@yahoo.com.au")]
    public async Task AdminUsers_update_asks_for_nothing_when_the_new_address_is_at_the_tenants_domain_or_a_common_provider(string address)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedAdminSideUser(db, tenant.Id, "jane.smith@acme.example.com");

        var result = await AdminUsersWith(db).Update(user.Id, AdminUserEdit(address), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
    }

    [Theory]
    [InlineData("jane.smith@gmial.com")]
    [InlineData("  Jane.Smith@GMIAL.com ")]
    public async Task AdminUsers_update_does_not_ask_again_for_the_address_the_row_already_has_so_legacy_rows_stay_editable(string submitted)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedAdminSideUser(db, tenant.Id, "jane.smith@gmial.com");

        var result = await AdminUsersWith(db).Update(user.Id, AdminUserEdit(submitted), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task AdminUsers_update_reports_an_address_that_is_taken_before_it_asks_for_a_confirmation_of_it()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedAdminSideUser(db, tenant.Id, "jane.smith@acme.example.com");
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, FirstName = "Existing", LastName = "Person", Username = "existing", Email = "jane.smith@gmial.com",
            Role = UserRole.Coordinator, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        var result = await AdminUsersWith(db).Update(user.Id, AdminUserEdit("jane.smith@gmial.com"), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task AdminUsers_update_checks_the_address_against_the_domain_of_the_users_own_tenant_not_another_tenants()
    {
        using var db = SuperAdminDb();
        SeedTenant(db);
        var other = SeedTenant(db, "Other Care", "other.example.org");
        var user = await SeedAdminSideUser(db, other.Id, "jane.smith@other.example.org");

        // acme.example.com is another tenant's own domain: for this user it is as unusual as any, and the question names HER tenant's domain.
        var refused = await AdminUsersWith(db).Update(user.Id, AdminUserEdit("jane.smith@acme.example.com"), CancellationToken.None);

        AssertAsksForConfirmation(refused, "jane.smith@acme.example.com", "other.example.org");
    }

    // ── A tenant's first user ───────────────────────────────────────────

    private static CreateTenantWithSetupDto TenantWithFirstUserAt(string email, bool confirmed = false) => new(
        "Brightside Care", "brightside.example.com", null,
        new CreateInitialUserDto("Jane", "Smith", email, "jane.smith", "Admin", null, confirmed));

    [Fact]
    public async Task Tenant_create_refuses_an_unusual_first_user_address_until_confirmed_and_creates_nothing_meanwhile()
    {
        using var db = SuperAdminDb(ignoreInMemoryTransactions: true);
        var firebase = AccountMaker();

        var refused = await new TenantsController(db, firebase.Object).CreateWithSetup(TenantWithFirstUserAt("jane.smith@brightside.example.org"), CancellationToken.None);

        AssertAsksForConfirmation(refused, "jane.smith@brightside.example.org", "brightside.example.com");
        Assert.Empty(await db.Tenants.ToListAsync());
        Assert.Empty(await db.Users.IgnoreQueryFilters().ToListAsync());
        VerifyNoAccountMade(firebase);
    }

    [Fact]
    public async Task Tenant_create_goes_ahead_once_the_first_users_address_is_confirmed()
    {
        using var db = SuperAdminDb(ignoreInMemoryTransactions: true);

        var result = await new TenantsController(db, AccountMaker().Object).CreateWithSetup(TenantWithFirstUserAt("jane.smith@brightside.example.org", confirmed: true), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal("jane.smith@brightside.example.org", (await db.Users.IgnoreQueryFilters().SingleAsync()).Email);
    }

    [Theory]
    [InlineData("jane.smith@brightside.example.com")]
    [InlineData("jane.smith@gmail.com")]
    public async Task Tenant_create_asks_for_nothing_when_the_first_users_address_is_at_the_new_tenants_domain_or_a_common_provider(string address)
    {
        using var db = SuperAdminDb(ignoreInMemoryTransactions: true);

        var result = await new TenantsController(db, AccountMaker().Object).CreateWithSetup(TenantWithFirstUserAt(address), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
    }

    // ── Staff create and the staff edit that changes the address ────────

    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant, Tenant Acme) StaffDb(string actorRole = "Admin")
    {
        var acme = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = TenantDomain, IsActive = true, CreatedAt = DateTime.UtcNow };
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(acme.Id);
        current.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, current.Object);
        db.Tenants.Add(acme);
        db.SaveChanges();
        return (db, current, acme);
    }

    private static StaffController StaffAs(OdipDbContext db, ICurrentTenant tenant, string role, Mock<IFirebaseUserService>? firebase = null) =>
        new(db, firebaseUserService: (firebase ?? AccountMaker()).Object, currentTenant: tenant)
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

    private static async Task<User> SeedStaff(OdipDbContext db, Guid tenantId, string email)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Staff", Username = Guid.NewGuid().ToString("N"), Email = email,
            Role = UserRole.SupportWorker, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static void AssertStaffAsksForConfirmation<T>(ActionResult<ApiResponse<T>> result, string address)
    {
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<T>>(badRequest.Value);
        Assert.Equal(AddressConfirmation.Code, body.Code);
        Assert.Equal(AddressConfirmation.Message(address, TenantDomain), Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task Staff_create_refuses_an_unusual_address_until_it_is_confirmed()
    {
        var (db, tenant, _) = StaffDb();
        using var _ = db;

        var refused = await StaffAs(db, tenant.Object, "Coordinator").Create(StaffAt("Sam.Staff@Gmial.com"), CancellationToken.None);

        AssertStaffAsksForConfirmation(refused, "sam.staff@gmial.com");
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Fact]
    public async Task Staff_create_goes_ahead_once_the_address_is_confirmed()
    {
        var (db, tenant, _) = StaffDb();
        using var _ = db;

        var result = await StaffAs(db, tenant.Object, "Coordinator").Create(StaffAt("sam.staff@gmial.com", confirmed: true), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal("sam.staff@gmial.com", (await db.Users.SingleAsync()).Email);
    }

    [Theory]
    [InlineData("sam.staff@acme.example.com")]
    [InlineData("sam.staff@gmail.com")]
    [InlineData("sam.staff@optusnet.com.au")]
    public async Task Staff_create_asks_for_nothing_when_the_address_is_at_the_tenants_domain_or_a_common_provider(string address)
    {
        var (db, tenant, _) = StaffDb();
        using var _ = db;

        var result = await StaffAs(db, tenant.Object, "Coordinator").Create(StaffAt(address), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task Staff_update_refuses_a_change_to_an_unusual_address_until_it_is_confirmed_and_leaves_the_row_as_it_was()
    {
        var (db, tenant, acme) = StaffDb();
        using var _ = db;
        var staff = await SeedStaff(db, acme.Id, "sam.staff@acme.example.com");

        var refused = await StaffAs(db, tenant.Object, "Admin").Update(staff.Id, UpdateAt("sam.staff@gmial.com"), CancellationToken.None);

        AssertStaffAsksForConfirmation(refused, "sam.staff@gmial.com");
        Assert.Equal("sam.staff@acme.example.com", (await db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Staff_update_goes_ahead_once_the_new_address_is_confirmed()
    {
        var (db, tenant, acme) = StaffDb();
        using var _ = db;
        var staff = await SeedStaff(db, acme.Id, "sam.staff@acme.example.com");

        var result = await StaffAs(db, tenant.Object, "Admin").Update(staff.Id, UpdateAt("sam.staff@gmial.com", confirmed: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("sam.staff@gmial.com", (await db.Users.SingleAsync()).Email);
    }

    [Theory]
    [InlineData("legacy@elsewhere.example.org")]
    [InlineData("Legacy@Elsewhere.Example.org")]
    public async Task Staff_update_does_not_ask_again_for_an_address_the_row_already_has_so_legacy_rows_stay_editable(string submitted)
    {
        var (db, tenant, acme) = StaffDb();
        using var _ = db;
        var staff = await SeedStaff(db, acme.Id, "legacy@elsewhere.example.org");

        var result = await StaffAs(db, tenant.Object, "Admin").Update(staff.Id, UpdateAt(submitted), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }
}
