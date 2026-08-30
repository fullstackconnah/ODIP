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
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Regression tests for the data-integrity bug where AdminUsersController wrote to the database
/// BEFORE calling Firebase, with no compensation — a Firebase failure left an orphaned DB row
/// (Create) or a DB update Firebase never learned about (Update). The fix reorders each action
/// to call Firebase first and only persist to the DB once Firebase succeeds, compensating
/// (deleting/reverting the Firebase side) if the subsequent DB save then fails.
/// </summary>
public class AdminUsersControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    // EF Core's InMemory provider is a plain dictionary keyed on primary key, with no SQL engine
    // underneath it — it does NOT enforce HasIndex(...).IsUnique() constraints at all, not even
    // within a single SaveChanges() call in a single DbContext, let alone by racing two separate
    // DbContext instances against the same named store (verified experimentally: neither a
    // same-context double-add, nor a committed row from a second context sharing the store name,
    // ever produces a DbUpdateException here — only a duplicate primary key does, because that's
    // a genuine dictionary-key collision). So a real unique-index violation can never be induced
    // this way. This subclass instead overrides SaveChangesAsync to throw a DbUpdateException on
    // demand, standing in for the unique-constraint violation Postgres would raise in production
    // when a concurrent request's write lands between this request's uniqueness pre-check and its
    // own save.
    private sealed class ThrowingOdipDbContext : OdipDbContext
    {
        private readonly Func<bool> _shouldFailSave;

        public ThrowingOdipDbContext(DbContextOptions<OdipDbContext> options, ICurrentTenant tenant, Func<bool> shouldFailSave)
            : base(options, tenant)
        {
            _shouldFailSave = shouldFailSave;
        }

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            if (_shouldFailSave())
            {
                throw new DbUpdateException(
                    "Simulated unique-constraint violation: a conflicting Email/Username row landed " +
                    "between this request's uniqueness check and its own SaveChangesAsync.",
                    new InvalidOperationException("simulated unique_violation"));
            }

            return base.SaveChangesAsync(cancellationToken);
        }
    }

    private static ThrowingOdipDbContext CreateThrowingDb(string dbName, Func<bool> shouldFailSave)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new ThrowingOdipDbContext(options, tenant.Object, shouldFailSave);
    }

    private static Tenant SeedTenant(OdipDbContext db)
    {
        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = "Test Tenant",
            EmailDomain = "test.example.com",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        db.Tenants.Add(tenant);
        db.SaveChanges();
        return tenant;
    }

    private static User SeedUser(OdipDbContext db, Guid tenantId, string email, string username)
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            FirstName = "Original",
            LastName = "Name",
            Email = email,
            Username = username,
            Role = Odip.Domain.Enums.UserRole.Coordinator,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    // ── Create ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_FirebaseSucceeds_PersistsUserAndReturnsCreated()
    {
        var dbName = Guid.NewGuid().ToString();
        using var db = CreateDb(dbName);
        var tenant = SeedTenant(db);

        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync("new.user@test.example.com", "New User", "P@ssword1", It.IsAny<CancellationToken>()))
            .ReturnsAsync("firebase-uid-1");

        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var dto = new CreateAdminUserDto
        {
            FirstName = "New", LastName = "User", Email = "new.user@test.example.com",
            Username = "newuser", Role = "Coordinator", TenantId = tenant.Id, Password = "P@ssword1",
        };

        var result = await controller.Create(dto, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        var body = Assert.IsType<ApiResponse<AdminUserDto>>(created.Value);
        Assert.True(body.Success);

        var saved = await db.Users.IgnoreQueryFilters().Where(u => u.Email == "new.user@test.example.com").ToListAsync();
        Assert.Single(saved);

        firebase.Verify(f => f.CreateUserAsync("new.user@test.example.com", "New User", "P@ssword1", It.IsAny<CancellationToken>()), Times.Once);
        firebase.Verify(f => f.DeleteUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_FirebaseFails_ReturnsBadGatewayAndLeavesNoOrphanRow()
    {
        // This is the exact bug from the incident report: Firebase throws (e.g. a
        // TokenResponseException from a bad service account), and the DB must NOT end up with
        // a row for a user that doesn't exist in Firebase.
        var dbName = Guid.NewGuid().ToString();
        using var db = CreateDb(dbName);
        var tenant = SeedTenant(db);

        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.CreateUserAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("simulated Firebase outage (e.g. TokenResponseException)"));

        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var dto = new CreateAdminUserDto
        {
            FirstName = "New", LastName = "User", Email = "new.user@test.example.com",
            Username = "newuser", Role = "Coordinator", TenantId = tenant.Id, Password = "P@ssword1",
        };

        var result = await controller.Create(dto, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status502BadGateway, objectResult.StatusCode);
        var body = Assert.IsType<ApiResponse<object>>(objectResult.Value);
        Assert.False(body.Success);

        // No orphan row — this is the whole point of the fix.
        Assert.Empty(await db.Users.IgnoreQueryFilters().Where(u => u.Email == "new.user@test.example.com").ToListAsync());

        firebase.Verify(f => f.DeleteUserAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_DbSaveFailsAfterFirebaseSucceeds_CompensatesByDeletingFirebaseUser()
    {
        // See ThrowingOdipDbContext above for why this doesn't try to race two DbContexts against
        // a real EF InMemory unique index — that provider doesn't enforce them at all, so no such
        // race can ever genuinely throw. The Firebase mock's callback arms the throwing override
        // so the failure fires on the SaveChangesAsync call that happens AFTER Firebase has
        // already succeeded — exactly the compensation scenario under test.
        var dbName = Guid.NewGuid().ToString();
        var shouldFailSave = false;
        using var db = CreateThrowingDb(dbName, () => shouldFailSave);
        var tenant = SeedTenant(db);

        var firebase = new Mock<IFirebaseUserService>();
        // Display name here must match dto's FirstName+LastName ("New User") — a mismatch here
        // means Moq's Setup silently never matches the controller's actual call, so the mock
        // falls back to its loose-mock default return value instead of running this callback.
        firebase.Setup(f => f.CreateUserAsync("race.user@test.example.com", "New User", "P@ssword1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                // Firebase "succeeded" — now arm the DB save to fail, simulating a conflicting
                // write that landed between this request's uniqueness check and its own save.
                shouldFailSave = true;
                return "firebase-uid-race";
            });

        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var dto = new CreateAdminUserDto
        {
            FirstName = "New", LastName = "User", Email = "race.user@test.example.com",
            Username = "newuser-noconflict", Role = "Coordinator", TenantId = tenant.Id, Password = "P@ssword1",
        };

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Create(dto, CancellationToken.None));

        // Compensation: the Firebase account created just before the failed save must be deleted.
        firebase.Verify(f => f.DeleteUserAsync("firebase-uid-race", It.IsAny<CancellationToken>()), Times.Once);

        // Nothing was ever persisted — the throwing override never calls base.SaveChangesAsync.
        using var verifyDb = CreateDb(dbName);
        Assert.Empty(await verifyDb.Users.IgnoreQueryFilters().Where(u => u.Email == "race.user@test.example.com").ToListAsync());
    }

    // ── Update ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_FirebaseSucceeds_PersistsChanges()
    {
        var dbName = Guid.NewGuid().ToString();
        using var db = CreateDb(dbName);
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "existing@test.example.com", "existinguser");

        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.UpdateUserByEmailAsync("existing@test.example.com", "Updated Name", false, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var dto = new UpdateAdminUserDto
        {
            FirstName = "Updated", LastName = "Name", Email = "existing@test.example.com",
            Username = "existinguser", Role = "Coordinator", IsActive = true,
        };

        var result = await controller.Update(user.Id, dto, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);

        var reloaded = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == user.Id);
        Assert.Equal("Updated", reloaded.FirstName);

        firebase.Verify(f => f.UpdateUserByEmailAsync("existing@test.example.com", "Updated Name", false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_FirebaseFails_ReturnsBadGatewayAndLeavesDbUnchanged()
    {
        // Previously the DB save happened FIRST, so a Firebase failure here (which, for the
        // real-world TokenResponseException, was never even caught) surfaced as an unhandled
        // 500 after the DB had already been updated — silently diverging from Firebase. The fix
        // must leave the DB row untouched when Firebase fails.
        var dbName = Guid.NewGuid().ToString();
        using var db = CreateDb(dbName);
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "existing@test.example.com", "existinguser");

        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.UpdateUserByEmailAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("simulated Firebase outage"));

        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var dto = new UpdateAdminUserDto
        {
            FirstName = "Updated", LastName = "Name", Email = "existing@test.example.com",
            Username = "existinguser", Role = "Coordinator", IsActive = true,
        };

        var result = await controller.Update(user.Id, dto, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status502BadGateway, objectResult.StatusCode);
        var body = Assert.IsType<ApiResponse<object>>(objectResult.Value);
        Assert.False(body.Success);

        var reloaded = await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == user.Id);
        Assert.Equal("Original", reloaded.FirstName); // unchanged — no silent DB/Firebase divergence
    }

    [Fact]
    public async Task Update_DbSaveFailsAfterFirebaseSucceeds_CompensatesByRevertingFirebase()
    {
        // See ThrowingOdipDbContext above (and the comment on the analogous Create test) for why
        // this doesn't race two DbContexts against a real EF InMemory unique index — the InMemory
        // provider never enforces those, so that race can never genuinely throw. The Firebase
        // mock's callback arms the throwing override so the failure fires on the SaveChangesAsync
        // call that happens AFTER Firebase has already been updated — exactly the compensation
        // scenario under test.
        var dbName = Guid.NewGuid().ToString();
        var shouldFailSave = false;
        using var db = CreateThrowingDb(dbName, () => shouldFailSave);
        var tenant = SeedTenant(db);
        var user = SeedUser(db, tenant.Id, "target@test.example.com", "targetuser");

        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.UpdateUserByEmailAsync("target@test.example.com", "New Name", false, It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                // Firebase "succeeded" — now arm the DB save to fail, simulating a conflicting
                // write that landed between this request's uniqueness check and its own save.
                shouldFailSave = true;
                return Task.CompletedTask;
            });

        var controller = new AdminUsersController(db, new Mock<ILogger<AdminUsersController>>().Object, firebase.Object);

        var dto = new UpdateAdminUserDto
        {
            FirstName = "New", LastName = "Name", Email = "target@test.example.com",
            Username = "targetuser-renamed", Role = "Coordinator", IsActive = true,
        };

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.Update(user.Id, dto, CancellationToken.None));

        // Compensation: Firebase must be reverted to the pre-update display name / disabled state.
        firebase.Verify(f => f.UpdateUserByEmailAsync("target@test.example.com", "Original Name", false, It.IsAny<CancellationToken>()), Times.Once);

        // The DB row itself was never actually persisted with the new values — the throwing
        // override never calls base.SaveChangesAsync. Check via a fresh context (rather than the
        // same `db`) since the controller already mutated the tracked entity's in-memory property
        // values before the save attempt, and a query on the same context would just return that
        // same tracked instance rather than reflecting what's genuinely in the store.
        using var verifyDb = CreateDb(dbName);
        var reloaded = await verifyDb.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == user.Id);
        Assert.Equal("Original", reloaded.FirstName);
    }
}
