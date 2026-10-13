using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Imports;

/// <summary>The spec's undo rule: a participant is untouched with no shifts, patterns, notes, incidents, bookings, medications, agreements, funding plans or onboarding progress, and no edits since creation.</summary>
public class ImportUntouchedTests
{
    [Fact]
    public async Task Each_kind_of_later_record_blocks_undo_with_its_own_reason_and_a_fresh_participant_does_not()
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var seeds = new (string Reason, Action<OdipDbContext, Guid> Seed)[]
        {
            ("has shifts", (d, id) => d.Shifts.Add(new Shift { Id = Guid.NewGuid(), ParticipantId = id, ServiceDate = new DateOnly(2026, 11, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), Status = ShiftStatus.Published })),
            ("has recurring shift patterns", (d, id) => d.ShiftPatterns.Add(new ShiftPattern { Id = Guid.NewGuid(), ParticipantId = id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), EffectiveFrom = new DateOnly(2026, 11, 2), IsActive = true })),
            ("has notes", (d, id) => d.ParticipantNotes.Add(new ParticipantNote { Id = Guid.NewGuid(), ParticipantId = id, Title = "t", Description = "d", CreatedByName = "x" })),
            ("is named in an incident", (d, id) => d.IncidentReports.Add(new IncidentReport { Id = Guid.NewGuid(), InvolvedParticipantId = id })),
            ("has trip bookings", (d, id) => d.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), ParticipantId = id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) })),
            ("has medications", (d, id) => d.ParticipantMedications.Add(new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = id, Name = "Paracetamol", TimesOfDay = "08:00", Type = MedicationType.Regular, StartDate = new DateTime(2026, 1, 1) })),
            ("has a service agreement", (d, id) => d.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), ParticipantId = id, Version = 1, State = "Draft", ParticipantNameSnapshot = "x", PlanStartDate = new(2026, 1, 1), PlanEndDate = new(2026, 12, 31), AgreementStartDate = new(2026, 1, 1), AgreementEndDate = new(2026, 12, 31) })),
            ("has a funding plan", (d, id) => d.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), ParticipantId = id, PlanStart = new(2026, 1, 1), PlanEnd = new(2026, 12, 31), CreatedAt = DateTime.UtcNow })),
            ("has onboarding progress", (d, id) => d.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), ParticipantId = id, ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow })),
            ("was edited after the import", (d, id) => d.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "Participant", EntityId = id, Action = AuditAction.Updated, ChangedAt = DateTimeOffset.UtcNow })),
        };
        var expected = new Dictionary<Guid, string>();
        foreach (var (reason, seed) in seeds)
        {
            var id = Guid.NewGuid();
            seed(db, id);
            expected[id] = reason;
        }
        var fresh = Guid.NewGuid();
        db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), ParticipantId = fresh });
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "Participant", EntityId = fresh, Action = AuditAction.Created, ChangedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();

        var blockers = await ImportUntouched.ParticipantBlockersAsync(db, [.. expected.Keys, fresh], CancellationToken.None);

        Assert.Equal(expected.OrderBy(e => e.Key), blockers.OrderBy(b => b.Key));
    }
}
