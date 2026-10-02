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
/// What an admin is told when Firebase refuses what a user create or update asks of it, worded for what the admin can DO. An address Firebase will
/// never accept is a 400 they fix by correcting it (retrying fails the same way every time, so "try again later" is wrong); anything else is a 502
/// that says where to turn. The same rule as the sign-in-account routes (SignInAccountRouteTests), applied to Create and to the update's Firebase sync.
/// </summary>
public class AdminUsersFirebaseFailureTests
{
    private const string TenantDomain = "acme.example.com";
    private const string InvalidAddressSentence = "That doesn't look like a valid email address. Correct it first.";
    private const string NeutralEnding = "If it keeps happening, ask whoever runs the Firebase project.";

    private static OdipDbContext SuperAdminDb()
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns((Guid?)null);
        current.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, current.Object);
    }

    private static Tenant SeedTenant(OdipDbContext db)
    {
        var tenant = new Tenant { Id = Guid.NewGuid(), Name = "Acme Support", EmailDomain = TenantDomain, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static AdminUsersController Controller(OdipDbContext db, Mock<IFirebaseUserService> firebase, ILogger<AdminUsersController>? logger = null) =>
        new(db, logger ?? new Mock<ILogger<AdminUsersController>>().Object, firebase.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    // ── Create ──────────────────────────────────────────────────────────

    private static CreateAdminUserDto NewUser(Guid tenantId) => new()
    {
        FirstName = "Jane", LastName = "Smith", Email = "jane.smith@acme.example.com", Username = "jane.smith", Role = "Coordinator", TenantId = tenantId,
    };

    private static Mock<IFirebaseUserService> CreateFailing(Exception failure)
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);
        return firebase;
    }

    [Fact]
    public async Task Create_says_an_address_Firebase_refuses_needs_correcting_a_400_and_makes_no_row_and_no_account()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var firebase = CreateFailing(FirebaseTestExceptions.InvalidEmail());

        var result = await Controller(db, firebase).Create(NewUser(tenant.Id), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(InvalidAddressSentence, Assert.Single(Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors!));
        Assert.Empty(await db.Users.ToListAsync());
        firebase.Verify(f => f.DeleteUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_logs_which_tenant_the_refusal_was_for_by_id_and_never_the_address()
    {
        // No user exists yet to name, so the tenant it was for is the id there is. The address is personal data and stays out of the log.
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var logger = new Mock<ILogger<AdminUsersController>>();

        await Controller(db, CreateFailing(FirebaseTestExceptions.InvalidEmail()), logger.Object).Create(NewUser(tenant.Id), CancellationToken.None);

        logger.Verify(l => l.Log(
            LogLevel.Warning, It.IsAny<EventId>(), It.Is<It.IsAnyType>((state, _) => state.ToString()!.Contains(tenant.Id.ToString())),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
        logger.Verify(l => l.Log(
            It.IsAny<LogLevel>(), It.IsAny<EventId>(), It.Is<It.IsAnyType>((state, _) => state.ToString()!.Contains("jane.smith@acme.example.com")),
            It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Never);
    }

    [Theory]
    [MemberData(nameof(SignInAccountRouteTests.OtherFirebaseFailures), MemberType = typeof(SignInAccountRouteTests))]
    public async Task Create_keeps_every_other_failure_a_502_with_a_neutral_line_and_no_advice_to_try_later(Exception failure)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);

        var result = await Controller(db, CreateFailing(failure)).Create(NewUser(tenant.Id), CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status502BadGateway, status.StatusCode);
        var message = Assert.Single(Assert.IsType<ApiResponse<object>>(status.Value).Errors!);
        Assert.Equal($"Unable to create the user's sign-in account. {NeutralEnding}", message);
        Assert.DoesNotContain("try again", message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.Users.ToListAsync());
    }

    // ── Update (the Firebase sync that runs before the save) ────────────

    private static async Task<User> SeedUser(OdipDbContext db, Guid tenantId, string email)
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

    private static UpdateAdminUserDto Edit(string email) => new()
    {
        FirstName = "Jane", LastName = "Smith", Email = email, Username = "jane.smith", Role = "Coordinator", IsActive = true,
    };

    private static Mock<IFirebaseUserService> SyncFailing(Exception failure)
    {
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>())).ThrowsAsync(failure);
        return firebase;
    }

    [Fact]
    public async Task Update_says_a_malformed_stored_address_needs_correcting_when_the_edit_leaves_it_as_it_is()
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedUser(db, tenant.Id, "jane.smith@acme");

        var result = await Controller(db, SyncFailing(FirebaseTestExceptions.InvalidEmail())).Update(user.Id, Edit("jane.smith@acme"), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(InvalidAddressSentence, Assert.Single(Assert.IsType<ApiResponse<object>>(badRequest.Value).Errors!));
        Assert.Equal("jane.smith@acme", (await db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Update_saves_the_correction_when_the_edit_is_changing_a_malformed_stored_address_otherwise_the_row_could_never_be_fixed()
    {
        // The sync looks the account up by the ORIGINAL address, which a malformed address can never have. Refusing here would make exactly the edit
        // that fixes the address impossible; the way out is to skip the sync (there is no account to sync) and save the correction.
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedUser(db, tenant.Id, "jane.smith@acme");

        var result = await Controller(db, SyncFailing(FirebaseTestExceptions.InvalidEmail())).Update(user.Id, Edit("jane.smith@acme.example.com"), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal("jane.smith@acme.example.com", (await db.Users.SingleAsync()).Email);
    }

    [Theory]
    [MemberData(nameof(SignInAccountRouteTests.OtherFirebaseFailures), MemberType = typeof(SignInAccountRouteTests))]
    public async Task Update_keeps_every_other_failure_a_502_with_a_neutral_line_and_no_advice_to_try_later(Exception failure)
    {
        using var db = SuperAdminDb();
        var tenant = SeedTenant(db);
        var user = await SeedUser(db, tenant.Id, "jane.smith@acme.example.com");

        var result = await Controller(db, SyncFailing(failure)).Update(user.Id, Edit("jane.smith@acme.example.com"), CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status502BadGateway, status.StatusCode);
        var message = Assert.Single(Assert.IsType<ApiResponse<object>>(status.Value).Errors!);
        Assert.Equal($"Unable to sync the user's sign-in account. {NeutralEnding}", message);
        Assert.DoesNotContain("try again", message, StringComparison.OrdinalIgnoreCase);
    }
}
