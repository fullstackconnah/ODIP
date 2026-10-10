using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Notifications;

/// <summary>
/// 5-minute sliding dedupe window (design spec §1) — a double-click or retry-on-transient-error
/// re-submitting the same action must not raise a second outbox row for the same
/// (EventType, EntityId, RecipientUserId) triple within 5 minutes; further apart, it must.
/// </summary>
public class DedupeTests
{
    private static OdipDbContext CreateDb() => TestDb.Create();

    private static User SeedUser(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.Coordinator, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task RaiseAsync_SameTripleWithinFiveMinutes_YieldsOneRow()
    {
        var db = CreateDb();
        var recipient = SeedUser(db);
        var raiser = new NotificationRaiser(db);
        var entityId = Guid.NewGuid();

        await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", entityId, new[] { recipient.Id }, new { }, CancellationToken.None);
        await db.SaveChangesAsync();

        // Immediately re-raised — well within the 5-minute window.
        await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", entityId, new[] { recipient.Id }, new { }, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Equal(1, await db.NotificationOutbox.CountAsync());
    }

    [Fact]
    public async Task RaiseAsync_SameTripleNineMinutesApart_YieldsTwoRows()
    {
        var db = CreateDb();
        var recipient = SeedUser(db);
        var raiser = new NotificationRaiser(db);
        var entityId = Guid.NewGuid();

        await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", entityId, new[] { recipient.Id }, new { }, CancellationToken.None);
        await db.SaveChangesAsync();

        // Push the first row's CreatedAt outside the 5-minute window.
        var firstRow = await db.NotificationOutbox.SingleAsync();
        firstRow.CreatedAt = DateTime.UtcNow.AddMinutes(-9);
        await db.SaveChangesAsync();

        await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", entityId, new[] { recipient.Id }, new { }, CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Equal(2, await db.NotificationOutbox.CountAsync());
    }
}
