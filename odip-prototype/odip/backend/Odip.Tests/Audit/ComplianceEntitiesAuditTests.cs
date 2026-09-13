using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>
/// Confirms RestrictivePractice/TripClaim/ClaimLineItem/ParticipantConsent/ShiftNote/BookingTask —
/// all six added to AuditedEntities.Types by the compliance-coverage report (item 11) — actually
/// produce AuditLog rows via AuditInterceptor on update, not just that the type is listed.
/// Mirrors the EF InMemory + Moq&lt;ICurrentTenant&gt; + AuditInterceptor wiring used in
/// Odip.Tests/Leave/LeaveAuditTests.cs and Odip.Tests/Rostering/RosteringAuditTests.cs.
/// </summary>
public class ComplianceEntitiesAuditTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 9, 13);

    private static OdipDbContext CreateDb(Guid actingUserId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, actingUserId.ToString()),
                new Claim("fullName", "Jane Coordinator")
            ],
            "Test");
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant NewParticipant() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng"
    };

    private static User NewStaff() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Ben", LastName = "Turner",
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    private static TripInstance NewTrip() => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, TripName = "Beach Trip",
        StartDate = Today, DurationDays = 3,
    };

    private static Shift NewShift(Participant participant, User staff) => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, UserId = staff.Id,
        ServiceDate = Today, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
    };

    [Fact]
    public async Task UpdateRestrictivePractice_WritesAuditLogReflectingTheChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var practice = new RestrictivePractice
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id,
            Type = RestrictivePracticeType.Seclusion, Description = "Time-out room, max 10 min.",
            IsActive = true,
        };
        db.RestrictivePractices.Add(practice);
        await db.SaveChangesAsync();

        practice.IsActive = false;
        practice.Description = "Time-out room, max 10 min. Discontinued after plan review.";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(RestrictivePractice) && a.EntityId == practice.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("IsActive", updateLog.Changes);
        Assert.Contains("Discontinued after plan review.", updateLog.Changes);
    }

    [Fact]
    public async Task UpdateTripClaim_WritesAuditLogReflectingTheChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var trip = NewTrip();
        db.TripInstances.Add(trip);
        await db.SaveChangesAsync();

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, Status = TripClaimStatus.Draft,
            ClaimReference = "TC-0001",
        };
        db.TripClaims.Add(claim);
        await db.SaveChangesAsync();

        claim.Status = TripClaimStatus.Submitted;
        claim.SubmittedDate = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(TripClaim) && a.EntityId == claim.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Status", updateLog.Changes);
        Assert.Contains("Submitted", updateLog.Changes);
    }

    [Fact]
    public async Task UpdateClaimLineItem_WritesAuditLogReflectingTheChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var trip = NewTrip();
        var participant = NewParticipant();
        db.TripInstances.Add(trip);
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id,
            BookingDate = Today,
        };
        db.ParticipantBookings.Add(booking);
        await db.SaveChangesAsync();

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, Status = TripClaimStatus.Draft,
            ClaimReference = "TC-0002",
        };
        db.TripClaims.Add(claim);
        await db.SaveChangesAsync();

        var lineItem = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id,
            SupportItemCode = "01_011_0107_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = Today, SupportsDeliveredTo = Today,
            Hours = 8, UnitPrice = 50m, TotalAmount = 400m, GSTCode = GSTCode.NoGST,
        };
        db.ClaimLineItems.Add(lineItem);
        await db.SaveChangesAsync();

        lineItem.Status = ClaimLineItemStatus.Rejected;
        lineItem.RejectionReason = "Duplicate line.";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(ClaimLineItem) && a.EntityId == lineItem.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Status", updateLog.Changes);
        Assert.Contains("Duplicate line.", updateLog.Changes);
    }

    [Fact]
    public async Task UpdateParticipantConsent_WritesAuditLogReflectingTheChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var consent = new ParticipantConsent
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id,
            ConsentType = ConsentType.PhotoVideo, Granted = null,
        };
        db.ParticipantConsents.Add(consent);
        await db.SaveChangesAsync();

        consent.Granted = true;
        consent.RecordedAt = DateTime.UtcNow;
        consent.SignedByName = "Amy Ng";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(ParticipantConsent) && a.EntityId == consent.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Granted", updateLog.Changes);
        Assert.Contains("Amy Ng", updateLog.Changes);
    }

    [Fact]
    public async Task UpdateShiftNote_WritesAuditLogReflectingTheChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var participant = NewParticipant();
        var staff = NewStaff();
        db.Participants.Add(participant);
        db.Users.Add(staff);
        await db.SaveChangesAsync();

        var shift = NewShift(participant, staff);
        db.Shifts.Add(shift);
        await db.SaveChangesAsync();

        var note = new ShiftNote
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ShiftId = shift.Id, AuthorUserId = staff.Id,
            AuthorName = "Ben Turner", Body = "Uneventful shift.",
        };
        db.ShiftNotes.Add(note);
        await db.SaveChangesAsync();

        note.Body = "Participant had a fall near the pool.";
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(ShiftNote) && a.EntityId == note.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Body", updateLog.Changes);
        Assert.Contains("Participant had a fall near the pool.", updateLog.Changes);
    }

    [Fact]
    public async Task UpdateBookingTask_WritesAuditLogReflectingTheChange()
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var trip = NewTrip();
        db.TripInstances.Add(trip);
        await db.SaveChangesAsync();

        var task = new BookingTask
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, TaskType = TaskType.FamilyContact,
            Title = "Confirm pickup time", Priority = TaskPriority.Medium,
            Status = TaskItemStatus.NotStarted,
        };
        db.BookingTasks.Add(task);
        await db.SaveChangesAsync();

        task.Status = TaskItemStatus.Completed;
        task.CompletedDate = Today;
        await db.SaveChangesAsync();

        var updateLog = db.AuditLogs
            .Where(a => a.EntityType == nameof(BookingTask) && a.EntityId == task.Id && a.Action == AuditAction.Updated)
            .Single();
        Assert.Contains("Status", updateLog.Changes);
        Assert.Contains("Completed", updateLog.Changes);
    }
}
