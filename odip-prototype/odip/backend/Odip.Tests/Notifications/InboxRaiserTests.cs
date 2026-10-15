using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// The raiser writes one bell row beside each outbox row (dashboard spec 2026-10-14): same SaveChanges, every recipient,
/// whatever their email preference, in the recipient's own organisation, and never a throw for a payload it does not know.
/// </summary>
public class InboxRaiserTests
{
    private static readonly LeaveRequestSubmittedPayload Leave = new("ignored@example.com", "Sam Lee", "Annual", new(2026, 10, 20), new(2026, 10, 24));

    private static User SeedUser(OdipDbContext db, Guid tenantId, UserRole role = UserRole.Coordinator)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Cara", LastName = "Coord",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = role, IsActive = true,
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    [Fact]
    public async Task Raise_WritesOneBellRowPerRecipient_InTheirOwnOrganisation_WithTheTitleAndLink()
    {
        var db = TestDb.Create();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        var a = SeedUser(db, tenantA);
        var b = SeedUser(db, tenantB);
        var leaveId = Guid.NewGuid();

        await new NotificationRaiser(db).RaiseAsync(NotificationEventType.LeaveRequestSubmitted, "LeaveRequest", leaveId, new[] { a.Id, b.Id, a.Id }, Leave);
        await db.SaveChangesAsync();

        var rows = await db.InAppNotifications.ToListAsync();
        Assert.Equal(2, rows.Count); // a, listed twice, is one recipient
        Assert.Equal(tenantA, rows.Single(r => r.RecipientUserId == a.Id).TenantId);
        Assert.Equal(tenantB, rows.Single(r => r.RecipientUserId == b.Id).TenantId);
        Assert.All(rows, r =>
        {
            Assert.Equal(NotificationEventType.LeaveRequestSubmitted, r.EventType);
            Assert.Equal("LeaveRequest", r.EntityType);
            Assert.Equal(leaveId, r.EntityId);
            Assert.Equal("Sam Lee asked for annual leave, 20 to 24 Oct.", r.Title);
            Assert.Equal("/rostering/leave", r.LinkTo);
            Assert.Null(r.ReadAt);
        });
    }

    [Fact]
    public async Task Raise_WritesTheBellRow_EvenWhenTheRecipientTurnedThatEmailOff()
    {
        var db = TestDb.Create();
        var tenantId = Guid.NewGuid();
        var user = SeedUser(db, tenantId, UserRole.SupportWorker);
        db.NotificationPreferences.Add(new NotificationPreference
        {
            Id = Guid.NewGuid(), TenantId = tenantId, UserId = user.Id,
            EventType = NotificationEventType.ShiftAssigned, Channel = NotificationChannelKind.Email, Enabled = false,
        });
        await db.SaveChangesAsync();

        await new NotificationRaiser(db).RaiseAsync(NotificationEventType.ShiftAssigned, "Shift", Guid.NewGuid(), new[] { user.Id },
            new ShiftAssignedPayload(user.Email, "Grace Palmer-Hughes", new(2026, 10, 13), new(9, 0), new(17, 0)));
        await db.SaveChangesAsync();

        Assert.Equal(user.Id, (await db.InAppNotifications.SingleAsync()).RecipientUserId);
    }

    [Fact]
    public async Task Raise_SavesNothingItself_TheCallersSaveCommitsTheBellRowWithTheDomainWrite()
    {
        var name = Guid.NewGuid().ToString();
        var db = TestDb.Create(name);
        var user = SeedUser(db, Guid.NewGuid());

        await new NotificationRaiser(db).RaiseAsync(NotificationEventType.LeaveRequestSubmitted, "LeaveRequest", Guid.NewGuid(), new[] { user.Id }, Leave);

        using (var other = TestDb.Create(name)) Assert.Equal(0, await other.InAppNotifications.CountAsync());
        await db.SaveChangesAsync();
        using (var other = TestDb.Create(name)) Assert.Equal(1, await other.InAppNotifications.CountAsync());
    }

    /// <summary>Review Focus 1: an event type appended later, with a payload the builder has never seen, still saves.</summary>
    [Fact]
    public async Task Raise_WithAnAnonymousPayload_WritesTheGenericTitle_AndTheCallersSaveSucceeds()
    {
        var db = TestDb.Create();
        var user = SeedUser(db, Guid.NewGuid());

        await new NotificationRaiser(db).RaiseAsync((NotificationEventType)999, "Future", Guid.NewGuid(), new[] { user.Id }, new { Anything = 1 });
        await db.SaveChangesAsync();

        var row = await db.InAppNotifications.SingleAsync();
        Assert.Equal(InAppNotificationText.GenericTitle, row.Title);
        Assert.Null(row.LinkTo);
    }

    [Fact]
    public async Task Raise_WithNoSignedInCaller_StampsTheRecipientsOrganisation()
    {
        var name = Guid.NewGuid().ToString();
        var tenantId = Guid.NewGuid();
        Guid userId;
        using (var admin = TestDb.Create(name)) userId = SeedUser(admin, tenantId).Id;

        // Caregiver submit: no principal, so SaveChanges has no ambient tenant to stamp.
        var anonymous = new Mock<ICurrentTenant>();
        anonymous.Setup(t => t.TenantId).Returns((Guid?)null);
        anonymous.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options;
        using (var db = new OdipDbContext(options, anonymous.Object))
        {
            await new NotificationRaiser(db).RaiseAsync(NotificationEventType.CaregiverSubmissionReceived, "CaregiverProfileSubmission",
                Guid.NewGuid(), new[] { userId }, new CaregiverSubmissionReceivedPayload("x@example.com", "Ann Hughes", "Grace Palmer-Hughes"));
            await db.SaveChangesAsync();
        }

        using var check = TestDb.Create(name);
        Assert.Equal(tenantId, (await check.InAppNotifications.SingleAsync()).TenantId);
    }

    [Fact]
    public async Task Raise_ForARecipientWhoIsNotAUser_WritesNoBellRow()
    {
        var db = TestDb.Create();
        await new NotificationRaiser(db).RaiseAsync(NotificationEventType.LeaveRequestSubmitted, "LeaveRequest", Guid.NewGuid(), new[] { Guid.NewGuid() }, Leave);
        await db.SaveChangesAsync();
        Assert.Equal(0, await db.InAppNotifications.CountAsync());
    }
}
