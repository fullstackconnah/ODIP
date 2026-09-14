using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// Transactional-outbox proof: the outbox row lands in the SAME SaveChangesAsync call as the
/// domain write (ruling 4), and RaiseAsync itself performs no I/O.
/// docs/specs/2026-09-08-notifications-design.md, Testing section.
/// </summary>
public class NotificationOutboxTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedUser(OdipDbContext db, Guid? tenantId = null)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.Coordinator, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task RaiseAsync_ThenSaveChanges_PersistsOutboxRowInTheSameCall()
    {
        var dbName = Guid.NewGuid().ToString();
        var db = CreateDb(dbName);
        var recipient = SeedUser(db);
        var raiser = new NotificationRaiser(db);
        var entityId = Guid.NewGuid();

        await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", entityId, new[] { recipient.Id }, new { Note = "x" }, CancellationToken.None);
        await db.SaveChangesAsync();

        var row = await db.NotificationOutbox.SingleAsync();
        Assert.Equal(entityId, row.EntityId);
        Assert.Equal(recipient.Id, row.RecipientUserId);
        Assert.Equal(recipient.TenantId, row.TenantId);
        Assert.Equal(NotificationOutboxStatus.Pending, row.Status);
        Assert.Equal("Shift", row.EntityType);
    }

    [Fact]
    public async Task RaiseAsync_WithoutFollowingSaveChanges_LeavesNoRow()
    {
        var dbName = Guid.NewGuid().ToString();
        var db = CreateDb(dbName);
        var recipient = SeedUser(db);
        var raiser = new NotificationRaiser(db);

        // Deliberately no SaveChangesAsync call — proves RaiseAsync performs no I/O itself.
        await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", Guid.NewGuid(), new[] { recipient.Id }, new { }, CancellationToken.None);

        using var verifyDb = CreateDb(dbName); // fresh context, same InMemory store
        Assert.Empty(await verifyDb.NotificationOutbox.ToListAsync());
    }

    /// <summary>
    /// A write that never reaches SaveChangesAsync must not leave an outbox row either — the
    /// same guarantee as "RaiseAsync without a following SaveChangesAsync leaves no row" above,
    /// exercised from the angle of a caller that decides NOT to save (the domain-write
    /// equivalent of a rolled-back transaction) rather than one that never calls save at all.
    /// </summary>
    [Fact]
    public async Task WhenTheCallerNeverSaves_NeitherTheDomainWriteNorTheOutboxRowPersist()
    {
        var dbName = Guid.NewGuid().ToString();
        var db = CreateDb(dbName);
        var recipient = SeedUser(db);
        var raiser = new NotificationRaiser(db);
        var entityId = Guid.NewGuid();

        db.NotificationPreferences.Add(new NotificationPreference
        {
            Id = Guid.NewGuid(), TenantId = recipient.TenantId, UserId = recipient.Id,
            EventType = NotificationEventType.ShiftAssigned, Channel = NotificationChannelKind.Email, Enabled = false,
        });
        await raiser.RaiseAsync(NotificationEventType.LeaveRequestSubmitted, "LeaveRequest", entityId, new[] { recipient.Id }, new { }, CancellationToken.None);

        // Caller decides not to commit — e.g. an earlier validation step in the same request
        // short-circuits before SaveChangesAsync is ever reached.

        using var verifyDb = CreateDb(dbName);
        Assert.Empty(await verifyDb.NotificationOutbox.Where(o => o.EntityId == entityId).ToListAsync());
        Assert.Empty(await verifyDb.NotificationPreferences.Where(p => p.UserId == recipient.Id).ToListAsync());
    }
}
