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
/// Every place that writes <c>User.Email</c> stores the trimmed, lower-case form and hands Firebase that same value, and every
/// uniqueness check compares in that form. Firebase lower-cases an address, so a row stored as typed ("Jane.Smith@...") can never
/// be matched by the exchange (see AuthControllerExchangeTests) and its owner is locked out after setting a password.
/// </summary>
public class EmailIdentityWritersTests
{
    private static ICurrentTenant SuperAdminTenant()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return tenant.Object;
    }

    private static OdipDbContext CreateSuperAdminDb(bool ignoreInMemoryTransactions = false)
    {
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString());
        // CreateWithSetup runs inside a transaction, which the InMemory provider refuses unless told to ignore it.
        if (ignoreInMemoryTransactions) builder.ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning));
        return new OdipDbContext(builder.Options, SuperAdminTenant());
    }

    private static Tenant SeedTenant(OdipDbContext db, string domain = "acme.example.com")
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = domain, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, string storedEmail, string username)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Original", LastName = "Name", Username = username, Email = storedEmail,
            Role = UserRole.Coordinator, IsActive = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    // ── Admin Users ─────────────────────────────────────────────────────

    private static AdminUsersController AdminUsers(OdipDbContext db, Mock<IFirebaseUserService> firebase) =>
        new(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

    [Fact]
    public async Task AdminUsers_create_stores_the_lower_case_address_and_hands_Firebase_the_same_value()
    {
        using var db = CreateSuperAdminDb();
        var tenant = SeedTenant(db);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");

        var result = await AdminUsers(db, firebase).Create(new CreateAdminUserDto
        {
            FirstName = "Jane", LastName = "Smith", Email = "  Jane.Smith@Acme.Example.com ", Username = "jane.smith", Role = "Coordinator", TenantId = tenant.Id,
        }, CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal("jane.smith@acme.example.com", (await db.Users.IgnoreQueryFilters().SingleAsync()).Email);
        firebase.Verify(f => f.CreateUserAsync("jane.smith@acme.example.com", "Jane Smith", null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AdminUsers_create_refuses_an_address_that_differs_only_in_case_from_an_existing_user()
    {
        using var db = CreateSuperAdminDb();
        var tenant = SeedTenant(db);
        SeedUser(db, tenant.Id, "Jane.Smith@acme.example.com", "existing");
        var firebase = new Mock<IFirebaseUserService>();

        var result = await AdminUsers(db, firebase).Create(new CreateAdminUserDto
        {
            FirstName = "Jane", LastName = "Smith", Email = "JANE.SMITH@acme.example.com", Username = "jane.two", Role = "Coordinator", TenantId = tenant.Id,
        }, CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
        firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AdminUsers_update_repairs_a_mixed_case_row_and_looks_the_Firebase_account_up_by_the_lower_case_address()
    {
        using var db = CreateSuperAdminDb();
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "Legacy.Mixed@acme.example.com", "legacy");
        var firebase = new Mock<IFirebaseUserService>();

        var result = await AdminUsers(db, firebase).Update(user.Id, new UpdateAdminUserDto
        {
            FirstName = "Legacy", LastName = "Mixed", Email = "Legacy.Mixed@acme.example.com", Username = "legacy", Role = "Coordinator", IsActive = true,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal("legacy.mixed@acme.example.com", (await db.Users.IgnoreQueryFilters().SingleAsync()).Email);
        firebase.Verify(f => f.UpdateUserByEmailAsync("legacy.mixed@acme.example.com", "Legacy Mixed", false, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Tenant first user ───────────────────────────────────────────────

    private static CreateTenantWithSetupDto NewTenantWithFirstUser(string email) => new(
        "Brightside Care", "brightside.example.com", null,
        new CreateInitialUserDto("Jane", "Smith", email, "jane.smith", "Admin", null));

    [Fact]
    public async Task Tenant_first_user_is_stored_lower_case_and_Firebase_gets_the_same_value()
    {
        using var db = CreateSuperAdminDb(ignoreInMemoryTransactions: true);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync("uid-1");
        var controller = new TenantsController(db, firebase.Object);

        var result = await controller.CreateWithSetup(NewTenantWithFirstUser("  Jane.Smith@Brightside.Example.com "), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal("jane.smith@brightside.example.com", (await db.Users.IgnoreQueryFilters().SingleAsync()).Email);
        firebase.Verify(f => f.CreateUserAsync("jane.smith@brightside.example.com", "Jane Smith", null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Tenant_first_user_refuses_an_address_that_differs_only_in_case_from_an_existing_user_and_creates_no_tenant()
    {
        using var db = CreateSuperAdminDb(ignoreInMemoryTransactions: true);
        var other = SeedTenant(db, "other.example.com");
        SeedUser(db, other.Id, "Jane.Smith@brightside.example.com", "existing");
        var firebase = new Mock<IFirebaseUserService>();
        var controller = new TenantsController(db, firebase.Object);

        var result = await controller.CreateWithSetup(NewTenantWithFirstUser("JANE.SMITH@brightside.example.com"), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
        Assert.Single(await db.Tenants.ToListAsync());
        firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Staff ───────────────────────────────────────────────────────────

    private static (OdipDbContext Db, Guid TenantId, StaffController Controller) StaffFixture()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin")], "Test");
        var controller = new StaffController(db)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
        return (db, tenantId, controller);
    }

    private static CreateStaffDto StaffDto(string email) => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    [Fact]
    public async Task Staff_create_stores_the_lower_case_address()
    {
        var (db, _, controller) = StaffFixture();

        var result = await controller.Create(StaffDto("  Sam.Staff@Acme.Example.com "), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal("sam.staff@acme.example.com", (await db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Staff_update_repairs_a_mixed_case_row()
    {
        var (db, tenantId, controller) = StaffFixture();
        var row = SeedUser(db, tenantId, "Sam.Staff@acme.example.com", "sam.staff");

        var result = await controller.Update(row.Id, new UpdateStaffDto
        {
            FirstName = "Sam", LastName = "Staff", Email = "Sam.Staff@acme.example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("sam.staff@acme.example.com", (await db.Users.SingleAsync()).Email);
    }
}
