using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
/// The address on a row is the whole of that person's sign-in. A Coordinator who could re-point an existing colleague's row at their own mailbox
/// (say a personal gmail address), ask for the set-password link and sign in as that colleague, would be taking over a working identity with its
/// role, history and attribution: impersonation inside the tenant, and the colleague's own account would no longer match any row. So once a row has
/// signed in (LastLoginAt is set), changing its address needs an Admin or a SuperAdmin; before the first sign-in it is only a typo to fix. And every
/// address change leaves a trace (who changed whose, never the addresses themselves).
/// </summary>
public class AddressChangeTests
{
    private const string TenantDomain = "acme.example.com";
    private const string OldAddress = "sam.staff@acme.example.com";
    private const string NewAddress = "sam.q.staff@acme.example.com";

    // ── Staff update ────────────────────────────────────────────────────

    private sealed class StaffSetup : IDisposable
    {
        public required OdipDbContext Db { get; init; }
        public required Mock<ICurrentTenant> Current { get; init; }
        public required Tenant Tenant { get; init; }
        public void Dispose() => Db.Dispose();
    }

    private static StaffSetup StaffWorld()
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = TenantDomain, IsActive = true, CreatedAt = DateTime.UtcNow };
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(tenant.Id);
        current.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, current.Object);
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return new StaffSetup { Db = db, Current = current, Tenant = tenant };
    }

    private static ControllerContext ActingAs(string role, Guid actorId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role), new Claim(ClaimTypes.NameIdentifier, actorId.ToString())], "Test")),
        },
    };

    private static StaffController StaffAs(StaffSetup world, string role, Guid actorId, ILogger<StaffController>? logger = null) =>
        new(world.Db, firebaseUserService: new Mock<IFirebaseUserService>().Object, logger: logger, currentTenant: world.Current.Object)
        {
            ControllerContext = ActingAs(role, actorId),
        };

    private static async Task<User> SeedStaff(StaffSetup world, DateTime? lastLoginAt)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = world.Tenant.Id, FirstName = "Sam", LastName = "Staff", Username = Guid.NewGuid().ToString("N"), Email = OldAddress,
            Role = UserRole.SupportWorker, IsActive = true, LastLoginAt = lastLoginAt, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        world.Db.Users.Add(user);
        await world.Db.SaveChangesAsync();
        return user;
    }

    private static UpdateStaffDto UpdateTo(string email, string notes = "") => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, Notes = notes,
    };

    private static void VerifyOneInformationLine<T>(Mock<ILogger<T>> logger, params string[] fragments) =>
        logger.Verify(l => l.Log(
            LogLevel.Information, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((state, _) => fragments.All(fragment => state.ToString()!.Contains(fragment))),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);

    private static void VerifyNoInformationLine<T>(Mock<ILogger<T>> logger) =>
        logger.Verify(l => l.Log(
            LogLevel.Information, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Never);

    [Fact]
    public async Task Staff_update_refuses_a_Coordinator_changing_the_address_of_someone_who_has_signed_in_and_leaves_the_row_as_it_was()
    {
        using var world = StaffWorld();
        var staff = await SeedStaff(world, lastLoginAt: DateTime.UtcNow.AddDays(-1));

        var result = await StaffAs(world, "Coordinator", Guid.NewGuid()).Update(staff.Id, UpdateTo(NewAddress), CancellationToken.None);

        var refused = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status403Forbidden, refused.StatusCode);
        Assert.Equal("Only an Admin can change the address of someone who has already signed in.",
            Assert.Single(Assert.IsType<ApiResponse<StaffDetailDto>>(refused.Value).Errors!));
        Assert.Equal(OldAddress, (await world.Db.Users.SingleAsync()).Email);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("SuperAdmin")]
    public async Task Staff_update_lets_an_Admin_or_a_SuperAdmin_change_the_address_of_someone_who_has_signed_in(string role)
    {
        using var world = StaffWorld();
        var staff = await SeedStaff(world, lastLoginAt: DateTime.UtcNow.AddDays(-1));

        var result = await StaffAs(world, role, Guid.NewGuid()).Update(staff.Id, UpdateTo(NewAddress), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(NewAddress, (await world.Db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Staff_update_still_lets_a_Coordinator_fix_the_address_of_someone_who_has_never_signed_in()
    {
        using var world = StaffWorld();
        var staff = await SeedStaff(world, lastLoginAt: null);

        var result = await StaffAs(world, "Coordinator", Guid.NewGuid()).Update(staff.Id, UpdateTo(NewAddress), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(NewAddress, (await world.Db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Staff_update_still_lets_a_Coordinator_edit_everything_else_about_someone_who_has_signed_in()
    {
        using var world = StaffWorld();
        var staff = await SeedStaff(world, lastLoginAt: DateTime.UtcNow.AddDays(-1));

        // Same address, differently cased: not a change.
        var result = await StaffAs(world, "Coordinator", Guid.NewGuid()).Update(staff.Id, UpdateTo("Sam.Staff@Acme.Example.com", notes: "Moved to nights."), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("Moved to nights.", (await world.Db.Users.SingleAsync()).Notes);
    }

    [Fact]
    public async Task Staff_update_logs_who_changed_whose_address_and_never_the_addresses_themselves()
    {
        using var world = StaffWorld();
        var staff = await SeedStaff(world, lastLoginAt: DateTime.UtcNow.AddDays(-1));
        var actorId = Guid.NewGuid();
        var logger = new Mock<ILogger<StaffController>>();

        await StaffAs(world, "Admin", actorId, logger.Object).Update(staff.Id, UpdateTo(NewAddress), CancellationToken.None);

        VerifyOneInformationLine(logger, actorId.ToString(), staff.Id.ToString());
        logger.Verify(l => l.Log(
            LogLevel.Information, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((state, _) => state.ToString()!.Contains(OldAddress) || state.ToString()!.Contains(NewAddress)),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Never);
    }

    [Fact]
    public async Task Staff_update_logs_no_Information_line_when_the_address_does_not_change_or_when_the_change_is_refused()
    {
        using var world = StaffWorld();
        var signedIn = await SeedStaff(world, lastLoginAt: DateTime.UtcNow.AddDays(-1));
        var unchangedLogger = new Mock<ILogger<StaffController>>();
        var refusedLogger = new Mock<ILogger<StaffController>>();

        await StaffAs(world, "Admin", Guid.NewGuid(), unchangedLogger.Object).Update(signedIn.Id, UpdateTo(OldAddress, notes: "Only a note."), CancellationToken.None);
        await StaffAs(world, "Coordinator", Guid.NewGuid(), refusedLogger.Object).Update(signedIn.Id, UpdateTo(NewAddress), CancellationToken.None);

        VerifyNoInformationLine(unchangedLogger);
        VerifyNoInformationLine(refusedLogger);
    }

    // ── Admin users update (SuperAdmin) ─────────────────────────────────

    private static OdipDbContext SuperAdminDb()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns((Guid?)null);
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, current.Object);
    }

    private static async Task<User> SeedAdminSideUser(OdipDbContext db)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = TenantDomain, IsActive = true, CreatedAt = DateTime.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenant.Id, FirstName = "Sam", LastName = "Staff", Username = "sam.staff", Email = OldAddress,
            Role = UserRole.Coordinator, IsActive = true, LastLoginAt = DateTime.UtcNow.AddDays(-1), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Tenants.Add(tenant);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static UpdateAdminUserDto AdminUpdateTo(string email) => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Username = "sam.staff", Role = "Coordinator", IsActive = true,
    };

    [Fact]
    public async Task AdminUsers_update_logs_who_changed_whose_address_and_never_the_addresses_themselves()
    {
        using var db = SuperAdminDb();
        var user = await SeedAdminSideUser(db);
        var actorId = Guid.NewGuid();
        var logger = new Mock<ILogger<AdminUsersController>>();
        var controller = new AdminUsersController(db, logger.Object, new Mock<IFirebaseUserService>().Object) { ControllerContext = ActingAs("SuperAdmin", actorId) };

        var result = await controller.Update(user.Id, AdminUpdateTo(NewAddress), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        VerifyOneInformationLine(logger, actorId.ToString(), user.Id.ToString());
        logger.Verify(l => l.Log(
            LogLevel.Information, It.IsAny<EventId>(),
            It.Is<It.IsAnyType>((state, _) => state.ToString()!.Contains(OldAddress) || state.ToString()!.Contains(NewAddress)),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Never);
    }

    [Fact]
    public async Task AdminUsers_update_logs_no_Information_line_when_the_address_does_not_change()
    {
        using var db = SuperAdminDb();
        var user = await SeedAdminSideUser(db);
        var logger = new Mock<ILogger<AdminUsersController>>();
        var controller = new AdminUsersController(db, logger.Object, new Mock<IFirebaseUserService>().Object) { ControllerContext = ActingAs("SuperAdmin", Guid.NewGuid()) };

        await controller.Update(user.Id, AdminUpdateTo("Sam.Staff@Acme.Example.com"), CancellationToken.None);

        VerifyNoInformationLine(logger);
    }
}
