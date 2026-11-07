using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>H36-2/H36-3: the SuperAdmin user form can't take an organisation's last Admin, the last SuperAdmin or the caller's own account out of service, and keeps SuperAdmin-domain addresses off other roles.</summary>
public class AdminUsersGuardTests
{
    private const string LastAdmin = "Add another Admin first. An organisation needs at least one active Admin.";
    private const string LastSuperAdmin = "Add another SuperAdmin first. Bunya Support needs at least one active SuperAdmin.";
    private const string Self = "You can't deactivate or change the role of your own account. Ask another SuperAdmin.";
    private const string Reserved = "Accounts at this email domain are always SuperAdmins. Use a different email for this role.";

    private readonly OdipDbContext _db = TestDb.Create(Guid.NewGuid().ToString());
    private readonly Mock<IFirebaseUserService> _firebase = new();
    private readonly Guid _caller = Guid.NewGuid();

    private AdminUsersController Controller() => new(_db, new Mock<ILogger<AdminUsersController>>().Object, _firebase.Object,
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [SuperAdminDomain.ConfigKey] = "platform.example" }).Build())
    {
        ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Role, "SuperAdmin"), new Claim(ClaimTypes.NameIdentifier, _caller.ToString())], "Test")) } },
    };

    private Tenant SeedTenant()
    {
        var t = new Tenant { Id = Guid.NewGuid(), Name = "Org", EmailDomain = "org.example", IsActive = true, CreatedAt = DateTime.UtcNow };
        _db.Tenants.Add(t);
        _db.SaveChanges();
        return t;
    }

    private User SeedUser(Guid tenantId, UserRole role, bool active = true, string? email = null, Guid? id = null)
    {
        var n = Guid.NewGuid().ToString("N");
        var u = new User
        {
            Id = id ?? Guid.NewGuid(), TenantId = tenantId, FirstName = "A", LastName = "B", Email = email ?? $"{n}@org.example", Username = n, Role = role,
            IsActive = active, LastLoginAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        _db.Users.Add(u);
        _db.SaveChanges();
        return u;
    }

    private static UpdateAdminUserDto Edit(User u, string role, bool active) => new()
    {
        FirstName = u.FirstName, LastName = u.LastName, Email = u.Email, Username = u.Username, Role = role, IsActive = active,
    };

    private static string Error(IActionResult r) => Assert.IsType<ApiResponse<object>>(Assert.IsAssignableFrom<ObjectResult>(r).Value).Errors!.Single();

    private void AssertRefused(IActionResult r, int status, string message, User u, bool wasActive, UserRole wasRole)
    {
        Assert.Equal(status, Assert.IsAssignableFrom<ObjectResult>(r).StatusCode);
        Assert.Equal(message, Error(r));
        var saved = _db.Users.IgnoreQueryFilters().Single(x => x.Id == u.Id);
        Assert.Equal((wasActive, wasRole), (saved.IsActive, saved.Role));
        _firebase.Verify(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Update_LastActiveAdmin_CannotBeDeactivated()
    {
        var t = SeedTenant();
        var admin = SeedUser(t.Id, UserRole.Admin);
        SeedUser(t.Id, UserRole.Admin, active: false);
        SeedUser(SeedTenant().Id, UserRole.Admin);   // another organisation's Admin does not count

        AssertRefused(await Controller().Update(admin.Id, Edit(admin, "Admin", false), default), 409, LastAdmin, admin, true, UserRole.Admin);
    }

    [Fact]
    public async Task Update_LastActiveAdmin_CannotBeMovedToAnotherRole()
    {
        var t = SeedTenant();
        var admin = SeedUser(t.Id, UserRole.Admin);

        AssertRefused(await Controller().Update(admin.Id, Edit(admin, "Coordinator", true), default), 409, LastAdmin, admin, true, UserRole.Admin);
    }

    [Fact]
    public async Task Update_AdminWithAnotherActiveAdminInTheTenant_CanBeDeactivated()
    {
        var t = SeedTenant();
        var admin = SeedUser(t.Id, UserRole.Admin);
        SeedUser(t.Id, UserRole.Admin);

        Assert.IsType<OkObjectResult>(await Controller().Update(admin.Id, Edit(admin, "Admin", false), default));
        Assert.False(_db.Users.IgnoreQueryFilters().Single(x => x.Id == admin.Id).IsActive);
    }

    [Fact]
    public async Task Update_OwnAccount_CannotBeDeactivatedOrChanged()
    {
        var t = SeedTenant();
        var me = SeedUser(t.Id, UserRole.Coordinator, id: _caller);

        AssertRefused(await Controller().Update(me.Id, Edit(me, "Coordinator", false), default), 409, Self, me, true, UserRole.Coordinator);
        AssertRefused(await Controller().Update(me.Id, Edit(me, "Admin", true), default), 409, Self, me, true, UserRole.Coordinator);
    }

    [Fact]
    public async Task Update_LastActiveSuperAdmin_CannotBeDemoted()
    {
        var t = SeedTenant();
        var sa = SeedUser(t.Id, UserRole.SuperAdmin);

        AssertRefused(await Controller().Update(sa.Id, Edit(sa, "Admin", true), default), 409, LastSuperAdmin, sa, true, UserRole.SuperAdmin);
    }

    [Fact]
    public async Task Update_SuperAdminWithAnotherActiveSuperAdmin_CanBeDemoted()
    {
        var t = SeedTenant();
        var sa = SeedUser(t.Id, UserRole.SuperAdmin);
        SeedUser(t.Id, UserRole.SuperAdmin);

        Assert.IsType<OkObjectResult>(await Controller().Update(sa.Id, Edit(sa, "Coordinator", true), default));
    }

    [Fact]
    public async Task Update_SuperAdminDomainEmail_RefusesAnyOtherRoleAndSavesNothing()
    {
        var t = SeedTenant();
        var u = SeedUser(t.Id, UserRole.Coordinator, email: "pat@platform.example");

        AssertRefused(await Controller().Update(u.Id, Edit(u, "Admin", true), default), 400, Reserved, u, true, UserRole.Coordinator);
    }

    [Fact]
    public async Task Create_SuperAdminDomainEmail_RefusesAnyOtherRoleAndSavesNothing()
    {
        var t = SeedTenant();
        var dto = new CreateAdminUserDto { FirstName = "P", LastName = "Q", Email = "pat@platform.example", Username = "patq", Role = "Admin", TenantId = t.Id, AddressConfirmed = true };

        var r = await Controller().Create(dto, default);

        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>(r).StatusCode);
        Assert.Equal(Reserved, Error(r));
        Assert.Empty(_db.Users.IgnoreQueryFilters().Where(x => x.Email == "pat@platform.example"));
        _firebase.Verify(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
