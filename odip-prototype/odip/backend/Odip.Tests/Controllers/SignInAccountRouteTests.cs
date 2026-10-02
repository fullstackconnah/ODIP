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

    private static AdminUsersController AdminController(OdipDbContext db, Mock<IFirebaseUserService> firebase, ILogger<AdminUsersController>? logger = null) =>
        new(db, logger ?? new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

    /// <summary>A caller with a role and an id: what the JWT's NameIdentifier and Role claims give a controller.</summary>
    private static ControllerContext ActingAs(string role, Guid actorId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role), new Claim(ClaimTypes.NameIdentifier, actorId.ToString())], "Test")),
        },
    };

    /// <summary>One Information line that names every fragment (the people involved and what happened), and no other.</summary>
    private static void VerifyOneInformationLine<T>(Mock<ILogger<T>> logger, params string[] fragments) =>
        logger.Verify(l => l.Log(
            LogLevel.Information, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((state, _) => fragments.All(fragment => state.ToString()!.Contains(fragment))),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);

    private static void VerifyNoInformationLine<T>(Mock<ILogger<T>> logger) =>
        logger.Verify(l => l.Log(
            LogLevel.Information, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<Exception?>(),
            It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Never);

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

    // The staff/user unification migration gave every staff row with no usable email "{username}@placeholder.local". No mailbox can receive it, so
    // making a verified account for it and telling the admin "we've sent a link" would be a lie that nothing can ever correct.
    [Theory]
    [InlineData("sam.staff@placeholder.local")]
    [InlineData("Sam.Staff@Placeholder.Local")]
    [InlineData("  sam.staff@placeholder.local ")]
    public async Task AdminUsers_route_refuses_a_placeholder_address_without_calling_Firebase(string storedEmail)
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, storedEmail);
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await AdminController(db, firebase).EnsureSignInAccount(user.Id, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Sam Staff has no real email address yet. Add one first.", Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors!.Single());
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task AdminUsers_route_does_not_mistake_a_look_alike_domain_for_the_placeholder()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@real-placeholder.local");

        var result = await AdminController(db, FirebaseReturning(SignInAccountResult.Created)).EnsureSignInAccount(user.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
    }

    // Three outcomes of the account step, worded for what the admin can DO about them: success, an address Firebase refuses as malformed
    // (correcting it fixes it, retrying never will: a 400 the admin acts on), and anything else (a 502 that says where to turn, not "try later").
    private static Mock<IFirebaseUserService> FirebaseThrowing(Exception failure)
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);
        return firebase;
    }

    private const string InvalidAddressSentence = "That doesn't look like a valid email address. Correct it first.";
    private const string NeutralFailureEnding = "If it keeps happening, ask whoever runs the Firebase project.";

    [Fact]
    public async Task AdminUsers_route_says_a_malformed_address_needs_correcting_and_that_is_a_400_not_a_502()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@acme");

        var result = await AdminController(db, FirebaseThrowing(FirebaseTestExceptions.InvalidEmail())).EnsureSignInAccount(user.Id, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(InvalidAddressSentence, Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors!.Single());
    }

    [Theory]
    [MemberData(nameof(OtherFirebaseFailures))]
    public async Task AdminUsers_route_keeps_every_other_failure_a_502_with_a_neutral_line_and_no_advice_to_try_later(Exception failure)
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@acme.example.com");

        var result = await AdminController(db, FirebaseThrowing(failure)).EnsureSignInAccount(user.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status502BadGateway, status.StatusCode);
        var message = Assert.IsType<ApiResponse<object>>(status.Value).Errors!.Single();
        Assert.Equal($"Unable to set up the user's sign-in account. {NeutralFailureEnding}", message);
        Assert.DoesNotContain("try again", message, StringComparison.OrdinalIgnoreCase);
    }

    // A 400 that is not about the address (a weak password), a refusal of the service account, and a failure that is not Firebase's at all.
    public static IEnumerable<object[]> OtherFirebaseFailures() =>
    [
        [FirebaseTestExceptions.WeakPassword()],
        [FirebaseTestExceptions.PermissionDenied()],
        [new InvalidOperationException("simulated Firebase outage")],
    ];

    // There is no audit record yet (the email itself goes from the browser to Firebase), and an account made here leaves no other trace of who asked
    // for it: so the routes log, at Information, who asked, for whom, and whether the account was made or already there.
    [Theory]
    [InlineData(SignInAccountResult.Created, "created")]
    [InlineData(SignInAccountResult.Existing, "existing")]
    public async Task AdminUsers_route_logs_who_asked_for_whose_account_and_whether_it_was_made_or_already_there(SignInAccountResult result, string word)
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@acme.example.com");
        var actorId = Guid.NewGuid();
        var logger = new Mock<ILogger<AdminUsersController>>();
        var controller = AdminController(db, FirebaseReturning(result), logger.Object);
        controller.ControllerContext = ActingAs("SuperAdmin", actorId);

        await controller.EnsureSignInAccount(user.Id, CancellationToken.None);

        VerifyOneInformationLine(logger, actorId.ToString(), user.Id.ToString(), word);
    }

    [Fact]
    public async Task AdminUsers_route_logs_no_Information_line_when_it_refuses_because_no_account_was_made()
    {
        using var db = AdminDb();
        var user = await SeedAdminSideUser(db, "sam.staff@placeholder.local");
        var logger = new Mock<ILogger<AdminUsersController>>();

        await AdminController(db, FirebaseReturning(SignInAccountResult.Created), logger.Object).EnsureSignInAccount(user.Id, CancellationToken.None);

        VerifyNoInformationLine(logger);
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

    private static StaffController StaffControllerFor(OdipDbContext db, string actorRole, Mock<IFirebaseUserService> firebase, ILogger<StaffController>? logger = null, Guid? actorId = null)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:SuperAdminDomain"] = SuperAdminDomain }).Build();
        return new StaffController(db, config: config, firebaseUserService: firebase.Object, logger: logger)
        {
            ControllerContext = ActingAs(actorRole, actorId ?? Guid.NewGuid()),
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

    [Theory]
    [InlineData("sam.staff@placeholder.local")]
    [InlineData("Sam.Staff@Placeholder.Local")]
    public async Task Staff_route_refuses_a_placeholder_address_without_calling_Firebase(string storedEmail)
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, storedEmail);
        var firebase = FirebaseReturning(SignInAccountResult.Created);

        var result = await StaffControllerFor(db, "Admin", firebase).EnsureSignInAccount(staff.Id, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Sam Staff has no real email address yet. Add one first.", Assert.IsType<ApiResponse<SignInAccountDto>>(badRequest.Value).Errors!.Single());
        VerifyNeverEnsured(firebase);
    }

    [Fact]
    public async Task Staff_route_does_not_mistake_a_look_alike_domain_for_the_placeholder()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@real-placeholder.local");

        var result = await StaffControllerFor(db, "Admin", FirebaseReturning(SignInAccountResult.Created)).EnsureSignInAccount(staff.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task Staff_route_says_a_malformed_address_needs_correcting_and_that_is_a_400_not_a_502()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme");

        var result = await StaffControllerFor(db, "Admin", FirebaseThrowing(FirebaseTestExceptions.InvalidEmail())).EnsureSignInAccount(staff.Id, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(InvalidAddressSentence, Assert.IsType<ApiResponse<SignInAccountDto>>(badRequest.Value).Errors!.Single());
    }

    [Theory]
    [MemberData(nameof(OtherFirebaseFailures))]
    public async Task Staff_route_keeps_every_other_failure_a_502_with_a_neutral_line_and_no_advice_to_try_later(Exception failure)
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com");

        var result = await StaffControllerFor(db, "Admin", FirebaseThrowing(failure)).EnsureSignInAccount(staff.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status502BadGateway, status.StatusCode);
        var message = Assert.IsType<ApiResponse<SignInAccountDto>>(status.Value).Errors!.Single();
        Assert.Equal($"Unable to set up the staff member's sign-in account. {NeutralFailureEnding}", message);
        Assert.DoesNotContain("try again", message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(SignInAccountResult.Created, "created")]
    [InlineData(SignInAccountResult.Existing, "existing")]
    public async Task Staff_route_logs_who_asked_for_whose_account_and_whether_it_was_made_or_already_there(SignInAccountResult result, string word)
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com");
        var actorId = Guid.NewGuid();
        var logger = new Mock<ILogger<StaffController>>();

        await StaffControllerFor(db, "Coordinator", FirebaseReturning(result), logger.Object, actorId).EnsureSignInAccount(staff.Id, CancellationToken.None);

        VerifyOneInformationLine(logger, actorId.ToString(), staff.Id.ToString(), word);
    }

    [Fact]
    public async Task Staff_route_logs_no_Information_line_when_it_refuses_because_no_account_was_made()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@placeholder.local");
        var logger = new Mock<ILogger<StaffController>>();

        await StaffControllerFor(db, "Admin", FirebaseReturning(SignInAccountResult.Created), logger.Object).EnsureSignInAccount(staff.Id, CancellationToken.None);

        VerifyNoInformationLine(logger);
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

    // An address on the SuperAdmin domain is a SuperAdmin session whatever the row's Role (AuthController.Exchange). Archiving a row only sets
    // IsActive = false and never touches Firebase, so a tenant caller who could bring such a row back to life, or change its role, would hand a
    // platform session to whoever still owns that mailbox.
    private const string ReservedRowRefusal = "Accounts at platform.example.com are reserved for platform administrators, so only a SuperAdmin can reactivate one or change its role.";

    private static UpdateStaffDto UpdateOf(string email, UserRole role, bool isActive) => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Role = role, Position = Position.SupportWorker, IsActive = isActive,
    };

    [Theory]
    [InlineData("legacy@platform.example.com")]
    [InlineData("Legacy@Platform.Example.com")]
    public async Task Staff_update_refuses_reactivating_an_archived_row_on_the_SuperAdmin_domain_for_a_tenant_caller(string storedEmail)
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, storedEmail, isActive: false);

        var refused = await StaffControllerFor(db, "Coordinator", new Mock<IFirebaseUserService>())
            .Update(staff.Id, UpdateOf(storedEmail, UserRole.SupportWorker, isActive: true), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(refused.Result);
        Assert.Equal(ReservedRowRefusal, Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value).Errors!.Single());
        Assert.False((await db.Users.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task Staff_update_lets_a_SuperAdmin_reactivate_such_a_row()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "legacy@platform.example.com", isActive: false);

        var result = await StaffControllerFor(db, "SuperAdmin", new Mock<IFirebaseUserService>())
            .Update(staff.Id, UpdateOf("legacy@platform.example.com", UserRole.SupportWorker, isActive: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.True((await db.Users.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task Staff_update_refuses_any_role_change_on_a_row_on_the_SuperAdmin_domain_for_a_tenant_caller()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "legacy@platform.example.com", role: UserRole.SupportWorker);

        var refused = await StaffControllerFor(db, "Admin", new Mock<IFirebaseUserService>())
            .Update(staff.Id, UpdateOf("legacy@platform.example.com", UserRole.Coordinator, isActive: true), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(refused.Result);
        Assert.Equal(ReservedRowRefusal, Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value).Errors!.Single());
        Assert.Equal(UserRole.SupportWorker, (await db.Users.SingleAsync()).Role);
    }

    [Fact]
    public async Task Staff_update_lets_a_SuperAdmin_change_the_role_of_such_a_row()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "legacy@platform.example.com", role: UserRole.SupportWorker);

        var result = await StaffControllerFor(db, "SuperAdmin", new Mock<IFirebaseUserService>())
            .Update(staff.Id, UpdateOf("legacy@platform.example.com", UserRole.Coordinator, isActive: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(UserRole.Coordinator, (await db.Users.SingleAsync()).Role);
    }

    [Fact]
    public async Task Staff_update_still_lets_a_tenant_caller_deactivate_such_a_row()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "legacy@platform.example.com");

        var archived = await StaffControllerFor(db, "Admin", new Mock<IFirebaseUserService>())
            .Update(staff.Id, UpdateOf("legacy@platform.example.com", UserRole.SupportWorker, isActive: false), CancellationToken.None);

        // Taking capability away is always safe, and it is how a legacy row on that domain gets switched off.
        Assert.IsType<OkObjectResult>(archived.Result);
        Assert.False((await db.Users.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task Staff_update_leaves_reactivation_and_role_changes_open_for_a_row_that_is_not_on_the_SuperAdmin_domain()
    {
        var (db, tenantId) = StaffDb();
        var staff = await SeedStaff(db, tenantId, "sam.staff@acme.example.com", isActive: false, role: UserRole.SupportWorker);

        var result = await StaffControllerFor(db, "Admin", new Mock<IFirebaseUserService>())
            .Update(staff.Id, UpdateOf("sam.staff@acme.example.com", UserRole.Coordinator, isActive: true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var row = await db.Users.SingleAsync();
        Assert.True(row.IsActive);
        Assert.Equal(UserRole.Coordinator, row.Role);
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
