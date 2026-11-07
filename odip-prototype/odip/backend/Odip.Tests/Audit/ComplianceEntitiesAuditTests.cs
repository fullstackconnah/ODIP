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
            TenantId = trip.TenantId,
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
            TenantId = trip.TenantId,
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, Status = TripClaimStatus.Draft,
            ClaimReference = "TC-0002",
        };
        db.TripClaims.Add(claim);
        await db.SaveChangesAsync();

        var lineItem = new ClaimLineItem
        {
            TenantId = claim.TenantId,
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
    public async Task WithdrawParticipantConsent_AuditKeepsTheEarlierGrantedAsOld()
    {
        using var db = CreateDb(Guid.NewGuid());
        var participant = NewParticipant();
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        var consent = new ParticipantConsent
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id,
            ConsentType = ConsentType.PhotoVideo, Granted = true, RecordedAt = DateTime.UtcNow, SignedByName = "Amy Ng",
        };
        db.ParticipantConsents.Add(consent);
        await db.SaveChangesAsync();

        consent.Granted = false;
        consent.SignedByName = "Ben Ng";
        await db.SaveChangesAsync();

        var changes = db.AuditLogs.Single(a => a.EntityType == nameof(ParticipantConsent) && a.EntityId == consent.Id && a.Action == AuditAction.Updated).Changes;
        Assert.Contains("{\"Field\":\"Granted\",\"Old\":\"True\",\"New\":\"False\"}", changes);
        Assert.Contains("\"Old\":\"Amy Ng\"", changes);
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

    // The checklist's "Signed agreement" record is a compliance record (Practice Standards: a signed copy, or why there is none). A new record replaces
    // the last in place, so the history has to live in the audit trail (LIFE fix round 1, V8).
    [Fact]
    public async Task ParticipantOnboarding_AgreementRecordReplaced_KeepsBothVersionsInTheAuditTrail()
    {
        var actor = Guid.NewGuid();
        using var db = CreateDb(actor);
        var participant = NewParticipant();
        var onboarding = new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id };
        db.AddRange(participant, onboarding);
        await db.SaveChangesAsync();

        onboarding.RecordAgreement(new DateOnly(2026, 10, 2), null, "coordinator-1", DateTime.UtcNow);
        await db.SaveChangesAsync();
        onboarding.RecordAgreement(null, "Participant chose not to have a written agreement.", "coordinator-1", DateTime.UtcNow);
        await db.SaveChangesAsync();

        var updates = await db.AuditLogs.Where(a => a.EntityType == nameof(ParticipantOnboarding) && a.EntityId == onboarding.Id && a.Action == AuditAction.Updated)
            .OrderBy(a => a.ChangedAt).ToListAsync();
        Assert.Equal(2, updates.Count);
        var signedOn = System.Text.Json.JsonDocument.Parse(updates[1].Changes).RootElement.EnumerateArray().Single(c => c.GetProperty("Field").GetString() == "AgreementSignedOn");
        Assert.False(string.IsNullOrEmpty(signedOn.GetProperty("Old").GetString()));   // the replaced date is kept
        Assert.Contains("Participant chose not to have a written agreement.", updates[1].Changes);
    }

    // H31-2/H31-3: who changed or removed a guardian's medical authorisation, a risk entry or a health condition must be recoverable.
    private async Task AssertUpdateAndDeleteAreAudited<T>(Func<Participant, Person, T> make, Action<T> change, string changedField, string changedValue) where T : class
    {
        var actingUserId = Guid.NewGuid();
        using var db = CreateDb(actingUserId);
        var participant = NewParticipant();
        var person = new Person { Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Cara", LastName = "Ng" };
        db.Participants.Add(participant);
        db.People.Add(person);
        await db.SaveChangesAsync();
        var row = make(participant, person);
        db.Set<T>().Add(row);
        await db.SaveChangesAsync();
        var id = (Guid)typeof(T).GetProperty("Id")!.GetValue(row)!;

        change(row);
        await db.SaveChangesAsync();
        db.Set<T>().Remove(row);
        await db.SaveChangesAsync();

        var logs = db.AuditLogs.Where(a => a.EntityType == typeof(T).Name && a.EntityId == id).ToList();
        var update = Assert.Single(logs, a => a.Action == AuditAction.Updated);
        Assert.Contains(changedField, update.Changes);
        Assert.Contains(changedValue, update.Changes);
        Assert.Single(logs, a => a.Action == AuditAction.Deleted);
        Assert.All(logs.Where(a => a.Action != AuditAction.Created), a => Assert.Equal((actingUserId, "Jane Coordinator"), (a.ChangedById, a.ChangedByName)));
    }

    [Fact]
    public Task ParticipantContactRole_UpdateAndDelete_AreAudited() => AssertUpdateAndDeleteAreAudited<ParticipantContactRole>(
        (p, person) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, PersonId = person.Id, RoleType = ContactRoleType.EmergencyContact, AuthorisedForMedicalInfo = true },
        r => r.AuthorisedForMedicalInfo = false, "AuthorisedForMedicalInfo", "False");

    [Fact]
    public Task ParticipantRiskEntry_UpdateAndDelete_AreAudited() => AssertUpdateAndDeleteAreAudited<ParticipantRiskEntry>(
        (p, _) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, AtRiskParty = AtRiskParty.Participant, Description = "Leaves the house alone." },
        r => r.Description = "Absconds at night.", "Description", "Absconds at night.");

    [Fact]
    public Task ParticipantHealthCondition_UpdateAndDelete_AreAudited() => AssertUpdateAndDeleteAreAudited<ParticipantHealthCondition>(
        (p, _) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, ConditionType = HealthConditionType.IntellectualDisability, Has = true },
        r => r.Notes = "Seizure plan added.", "Notes", "Seizure plan added.");

    // H36-1: the care-plan records a coordinator edits (ADL levels, routines, checklist, community-access risks) need the same history.
    [Fact]
    public Task ParticipantAdlAssessment_UpdateAndDelete_AreAudited() => AssertUpdateAndDeleteAreAudited<ParticipantAdlAssessment>(
        (p, _) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, AdlType = AdlType.Toileting, Level = AdlLevel.Independent },
        r => r.Level = AdlLevel.FullSupport, "Level", "FullSupport");

    [Fact]
    public Task ParticipantRoutine_Retire_IsAudited() => AssertUpdateAndDeleteAreAudited<ParticipantRoutine>(
        (p, _) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, Title = "Morning meds", IsActive = true },
        r => r.IsActive = false, "IsActive", "False");

    [Fact]
    public Task ParticipantChecklistItem_UpdateAndDelete_AreAudited() => AssertUpdateAndDeleteAreAudited<ParticipantChecklistItem>(
        (p, _) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, ItemType = default },
        r => r.Notes = "Checked with guardian.", "Notes", "Checked with guardian.");

    [Fact]
    public Task ParticipantCommunityAccessRiskItem_UpdateAndDelete_AreAudited() => AssertUpdateAndDeleteAreAudited<ParticipantCommunityAccessRiskItem>(
        (p, _) => new() { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = p.Id, ItemType = default },
        r => r.StrategyNotes = "Staff stays within arm length.", "StrategyNotes", "Staff stays within arm length.");
}
