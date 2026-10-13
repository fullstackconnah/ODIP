using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Imports;

/// <summary>The spec's undo rule: a participant is untouched with no shifts, patterns, notes, incidents, bookings, medications, agreements, funding plans or onboarding progress, no edits since creation,
/// and nothing recorded against them on their own screens.</summary>
public class ImportUntouchedTests
{
    [Fact]
    public async Task Each_kind_of_later_record_blocks_undo_with_its_own_reason_and_a_fresh_participant_does_not()
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var importedAt = DateTime.UtcNow;
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
            ("has onboarding progress", (d, id) =>
            {
                var onboarding = new ParticipantOnboarding { Id = Guid.NewGuid(), ParticipantId = id };
                onboarding.RecordAgreement(new DateOnly(2026, 10, 1), null, "coordinator", DateTime.UtcNow);
                d.ParticipantOnboardings.Add(onboarding);
            }),
            ("has begun services", (d, id) => d.Participants.Add(new Participant { Id = id, FirstName = "B", LastName = "S", IsDraft = true, IsActive = true, ServicesStartedAt = DateTime.UtcNow })),
            ("was made active", (d, id) =>
            {
                d.Participants.Add(new Participant { Id = id, FirstName = "M", LastName = "A", IsDraft = false, IsActive = true });
                d.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), ParticipantId = id });
            }),
            ("has restrictive practices", (d, id) => d.RestrictivePractices.Add(new RestrictivePractice { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has routines", (d, id) => d.ParticipantRoutines.Add(new ParticipantRoutine { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has a support profile", (d, id) => d.SupportProfiles.Add(new SupportProfile { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has staff compatibility entries", (d, id) => d.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), ParticipantId = id, UserId = Guid.NewGuid() })),
            ("has risk entries", (d, id) => d.ParticipantRiskEntries.Add(new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = id, Description = "d" })),
            ("has consents", (d, id) => d.ParticipantConsents.Add(new ParticipantConsent { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has health conditions", (d, id) => d.ParticipantHealthConditions.Add(new ParticipantHealthCondition { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has daily living assessments", (d, id) => d.ParticipantAdlAssessments.Add(new ParticipantAdlAssessment { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has community access checklist items", (d, id) => d.ParticipantChecklistItems.Add(new ParticipantChecklistItem { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has a community access risk assessment", (d, id) => d.ParticipantCommunityAccessRiskItems.Add(new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has caregiver form submissions", (d, id) => d.CaregiverProfileSubmissions.Add(new CaregiverProfileSubmission { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has e-signing records", (d, id) => d.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot { Id = Guid.NewGuid(), ParticipantId = id, DraftId = Guid.NewGuid() })),
            ("has trip claims", (d, id) => d.TripClaims.Add(new TripClaim { Id = Guid.NewGuid(), ParticipantId = id })),
            ("has contacts added after the import", (d, id) => d.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = id, PersonId = Guid.NewGuid(), CreatedAt = importedAt.AddMinutes(1) })),
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
        // A fresh onboarding import: a draft with an untouched onboarding row and the contact role the import made.
        db.Participants.Add(new Participant { Id = fresh, FirstName = "F", LastName = "R", IsDraft = true });
        db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), ParticipantId = fresh });
        db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), ParticipantId = fresh, PersonId = Guid.NewGuid(), CreatedAt = importedAt.AddSeconds(-1) });
        db.AuditLogs.Add(new AuditLog { Id = Guid.NewGuid(), EntityType = "Participant", EntityId = fresh, Action = AuditAction.Created, ChangedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();

        var blockers = await ImportUntouched.ParticipantBlockersAsync(db, [.. expected.Keys, fresh], importedAt, CancellationToken.None);

        Assert.Equal(expected.OrderBy(e => e.Key), blockers.OrderBy(b => b.Key));
    }
}
