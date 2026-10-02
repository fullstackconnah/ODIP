using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
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
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The two "ensure a sign-in account" routes: POST admin/users/{id}/sign-in-account (SuperAdmin, sees every tenant) and POST
/// staff/{id}/sign-in-account (Admin, Coordinator, SuperAdmin; own tenant only). Each makes sure the user has a Firebase account, says
/// whether it created one or found one, and leaves an existing account exactly as it was, so the browser can then send the
/// set-password email and word it truthfully. Staff added through the staff form have no Firebase account at all until this runs.
/// </summary>
public class SignInAccountRouteTests
{
    private const string SuperAdminDomain = "platform.example.com";

    private static User NewUser(Guid tenantId, string email, bool isActive = true, UserRole role = UserRole.SupportWorker) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Staff", Username = Guid.NewGuid().ToString("N"), Email = email,
        Role = role, IsActive = isActive, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
    };

    private static Mock<IFirebaseUserService> FirebaseReturning(SignInAccountResult result)
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
        return firebase;
    }

    private static void VerifyNeverEnsured(Mock<IFirebaseUserService> firebase) =>
        firebase.Verify(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);

    // ── POST admin/users/{id}/sign-in-account ───────────────────────────

    // The ambient tenant is somebody else's and the caller is NOT flagged SuperAdmin on the context: the route must still find the user,
    // because (like GetAll) it looks past the tenant filter. Authorization is the controller's SuperAdmin role requirement, not the filter.
    private static OdipDbContext AdminDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Guid.NewGuid());
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static AdminUsersController AdminController(OdipDbContext db, Mock<IFirebaseUserService> firebase) =>
        new(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

    private static async Task<User> SeedAdminSideUser(OdipDbContext db, string email, bool isActive = true)
    {
        var user = NewUser(Guid.NewGuid(), email, isActive, UserRole.Coordinator);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task AdminUsers_route_creates_the_account_for_the_normalised_address_and_says_so()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "Sam.Staff@acme.example.com");
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await AdminController(db, firebase).EnsureSignInAccount(user.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<SignInAccountDto>>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal("created", body.Data!.FirebaseAccount);
        firebase.Verify(f => f.EnsureSignInAccountAsync("sam.staff@acme.example.com", "Sam Staff", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AdminUsers_route_reports_an_account_that_was_already_there_as_existing()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@acme.example.com");

        var result = await AdminController(db, FirebaseReturning(SignInAccountResult.Existing)).EnsureSignInAccount(user.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<SignInAccountDto>>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal("existing", body.Data!.FirebaseAccount);
    }

    [Fact]
    public async Task AdminUsers_route_refuses_an_inactive_user_without_calling_Firebase()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@acme.example.com", isActive: false);
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await AdminController(db, firebase).EnsureSignInAccount(user.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task AdminUsers_route_refuses_a_user_with_no_email_without_calling_Firebase()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "   ");
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await AdminController(db, firebase).EnsureSignInAccount(user.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task AdminUsers_route_is_a_404_for_an_unknown_user()
    {
        using var db = AdminDb();
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await AdminController(db, firebase).EnsureSignInAccount(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task AdminUsers_route_is_a_502_when_Firebase_fails_the_same_status_as_create()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@acme.example.com");
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("simulated Firebase outage"));

        var result = await AdminController(db, firebase).EnsureSignInAccount(user.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status502BadGateway, status.StatusCode);
        Assert.False(Assert.IsType<ApiResponse<object>>(status.Value).Success);
    }

    [Fact]
    public void AdminUsers_route_is_reachable_by_a_SuperAdmin_only()
    {
        var attribute = typeof(AdminUsersController).GetCustomAttribute<AuthorizeAttribute>();

        Assert.Equal("SuperAdmin", attribute?.Roles);
        Assert.Null(typeof(AdminUsersController).GetMethod(nameof(AdminUsersController.EnsureSignInAccount))!.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    // ── POST staff/{id}/sign-in-account ─────────────────────────────────

    private static (OdipDbContext Db, Guid TenantId) StaffDb()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, tenantId);
    }

    private static StaffController StaffControllerFor(OdipDbContext db, string actorRole, Mock<IFirebaseUserService> firebase)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:SuperAdminDomain"] = SuperAdminDomain }).Build();
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.Role, actorRole)], "Test");
        return new StaffController(db, config: config, firebaseUserService: firebase.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static async Task<User> SeedStaff(OdipDbContext db, Guid tenantId, string email, bool isActive = true, UserRole role = UserRole.SupportWorker)
    {
        var user = NewUser(tenantId, email, isActive, role);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task Staff_route_creates_the_account_for_the_normalised_address_and_says_so()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "Sam.Staff@acme.example.com");
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await StaffControllerFor(db, "Coordinator", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<SignInAccountDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("created", body.Data!.FirebaseAccount);
        firebase.Verify(f => f.EnsureSignInAccountAsync("sam.staff@acme.example.com", "Sam Staff", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Staff_route_reports_an_account_that_was_already_there_as_existing()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com");

        var result = await StaffControllerFor(db, "Admin", FirebaseReturning(SignInAccountResult.Existing)).EnsureSignInAccount(staff.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<SignInAccountDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("existing", body.Data!.FirebaseAccount);
    }

    [Fact]
    public async Task Staff_route_does_not_find_a_staff_member_of_another_tenant()
    {
        var (db, _) = StaffDb();
        var someoneElses = await SeedStaff(db, Guid.NewGuid(), "other.tenant@acme.example.com");
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(someoneElses.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task Staff_route_refuses_an_inactive_staff_member_without_calling_Firebase()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com", isActive: false);
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task Staff_route_refuses_a_staff_member_with_no_email_without_calling_Firebase()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "");
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task Staff_route_is_a_502_when_Firebase_fails_the_same_status_as_create()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com");
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("simulated Firebase outage"));

        var result = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Staff_route_refuses_an_address_on_the_SuperAdmin_domain_unless_the_caller_is_a_SuperAdmin()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "Pat.Platform@platform.example.com");
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var refused = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(refused.Result);
        Assert.Equal("Addresses at platform.example.com are reserved for platform administrators.",
            Assert.IsType<ApiResponse<SignInAccountDto>>(badRequest.Value).Errors![0]);
        VerifyNeverEnsured(firebase);

        var allowed = await StaffControllerFor(db, "SuperAdmin", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(allowed.Result);
    }

    [Fact]
    public async Task Staff_route_leaves_a_SuperAdmin_account_to_SuperAdmins()
    {
        var (db, tenantId) = StaffDb();
        var superAdmin = await SeedStaff(db, tenantId, "someone@acme.example.com", role: UserRole.SuperAdmin);
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(superAdmin.Id, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public void Staff_route_is_reachable_by_Admin_Coordinator_and_SuperAdmin_only()
    {
        var method = typeof(StaffController).GetMethod(nameof(StaffController.EnsureSignInAccount))!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", method.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
    }

    // ── The SuperAdmin-domain refusal on staff create and update ────────

    private static CreateStaffDto StaffDto(string email) => new()
    {
        FirstName = "Pat", LastName = "Platform", Email = email, Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    [Fact]
    public async Task Staff_create_refuses_a_SuperAdmin_domain_address_for_a_tenant_caller_but_not_for_a_SuperAdmin()
    {
        var (db, _) = StaffDb();
        var firebase = new Mock<IFirebaseUserService>();

        var refused = await StaffControllerFor(db, "Coordinator", firebase).Create(StaffDto("Pat@Platform.Example.com"), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(refused.Result);
        Assert.Equal("Addresses at platform.example.com are reserved for platform administrators.",
            Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value).Errors![0]);
        Assert.Empty(await db.Users.ToListAsync());

        var allowed = await StaffControllerFor(db, "SuperAdmin", firebase).Create(StaffDto("Pat@Platform.Example.com"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(allowed.Result);
    }

    [Fact]
    public async Task Staff_update_refuses_changing_an_address_to_the_SuperAdmin_domain_for_a_tenant_caller()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com");
        var update = new UpdateStaffDto
        {
            FirstName = "Sam", LastName = "Staff", Email = "sam.staff@platform.example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };

        var refused = await StaffControllerFor(db, "Admin", new Mock<IFirebaseUserService>()).Update(staff.Id, update, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(refused.Result);
        Assert.Equal("sam.staff@acme.example.com", (await db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Staff_update_does_not_start_failing_for_a_row_that_already_holds_such_an_address_when_the_address_is_unchanged()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "legacy@platform.example.com");
        var update = new UpdateStaffDto
        {
            FirstName = "Sam", LastName = "Staff", Email = "legacy@platform.example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            Notes = "Edited a different field.",
        };

        var result = await StaffControllerFor(db, "Admin", new Mock<IFirebaseUserService>()).Update(staff.Id, update, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }
}
