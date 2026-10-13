using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Whether an imported record has been built on since its import, which stops its batch being undone. One query per kind of record, each over
/// the batch's ids, so a 2,000-row batch costs a dozen queries, not 24,000.
/// </summary>
public static class ImportUntouched
{
    /// <summary>The spec's rule: no shifts, patterns, notes, incidents, bookings, medications, agreements, funding plans or onboarding progress,
    /// no edits since creation (an Updated audit row: every write path to a participant is audited), and nothing recorded against them through
    /// their own screens (those writes audit the child row, not the participant). <paramref name="importedAt"/> is when the batch was saved: the
    /// import creates contact roles itself, so only later ones count.</summary>
    public static async Task<Dictionary<Guid, string>> ParticipantBlockersAsync(OdipDbContext db, IReadOnlyCollection<Guid> ids, DateTime importedAt, CancellationToken ct)
    {
        var list = ids.ToList();
        var reasons = new Dictionary<Guid, string>();
        async Task Add(IQueryable<Guid> blocked, string reason)
        {
            foreach (var id in await blocked.Distinct().ToListAsync(ct)) reasons.TryAdd(id, reason);
        }

        await Add(db.Shifts.Where(s => list.Contains(s.ParticipantId)).Select(s => s.ParticipantId), "has shifts");
        await Add(db.ShiftPatterns.Where(s => list.Contains(s.ParticipantId)).Select(s => s.ParticipantId), "has recurring shift patterns");
        await Add(db.ParticipantNotes.Where(n => list.Contains(n.ParticipantId)).Select(n => n.ParticipantId), "has notes");
        await Add(db.IncidentReports.Where(i => i.InvolvedParticipantId != null && list.Contains(i.InvolvedParticipantId.Value)).Select(i => i.InvolvedParticipantId!.Value), "is named in an incident");
        await Add(db.ParticipantBookings.Where(b => list.Contains(b.ParticipantId)).Select(b => b.ParticipantId), "has trip bookings");
        await Add(db.ParticipantMedications.Where(m => list.Contains(m.ParticipantId)).Select(m => m.ParticipantId), "has medications");
        await Add(db.ServiceAgreementDrafts.Where(a => list.Contains(a.ParticipantId)).Select(a => a.ParticipantId), "has a service agreement");
        await Add(db.FundingPlans.Where(f => list.Contains(f.ParticipantId)).Select(f => f.ParticipantId), "has a funding plan");
        // The onboarding checklist's stored steps: an agreement recorded, services begun, or made active by its button (only an onboarding import's
        // participants have an onboarding row, and they arrive as drafts).
        await Add(db.ParticipantOnboardings.Where(o => list.Contains(o.ParticipantId) && o.AgreementRecordedAt != null).Select(o => o.ParticipantId), "has onboarding progress");
        await Add(db.Participants.Where(p => list.Contains(p.Id) && p.ServicesStartedAt != null).Select(p => p.Id), "has begun services");
        await Add(db.Participants.Where(p => list.Contains(p.Id) && !p.IsDraft && db.ParticipantOnboardings.Any(o => o.ParticipantId == p.Id)).Select(p => p.Id), "was made active");
        await Add(db.AuditLogs.Where(a => a.EntityType == nameof(Participant) && a.Action == AuditAction.Updated && list.Contains(a.EntityId))
            .Select(a => a.EntityId), "was edited after the import");
        await Add(db.RestrictivePractices.Where(r => list.Contains(r.ParticipantId)).Select(r => r.ParticipantId), "has restrictive practices");
        await Add(db.ParticipantRoutines.Where(r => list.Contains(r.ParticipantId)).Select(r => r.ParticipantId), "has routines");
        await Add(db.SupportProfiles.Where(s => list.Contains(s.ParticipantId)).Select(s => s.ParticipantId), "has a support profile");
        await Add(db.StaffParticipantCompatibilities.Where(s => list.Contains(s.ParticipantId)).Select(s => s.ParticipantId), "has staff compatibility entries");
        await Add(db.ParticipantRiskEntries.Where(r => list.Contains(r.ParticipantId)).Select(r => r.ParticipantId), "has risk entries");
        await Add(db.ParticipantConsents.Where(c => list.Contains(c.ParticipantId)).Select(c => c.ParticipantId), "has consents");
        await Add(db.ParticipantHealthConditions.Where(h => list.Contains(h.ParticipantId)).Select(h => h.ParticipantId), "has health conditions");
        await Add(db.ParticipantAdlAssessments.Where(a => list.Contains(a.ParticipantId)).Select(a => a.ParticipantId), "has daily living assessments");
        await Add(db.ParticipantChecklistItems.Where(c => list.Contains(c.ParticipantId)).Select(c => c.ParticipantId), "has community access checklist items");
        await Add(db.ParticipantCommunityAccessRiskItems.Where(c => list.Contains(c.ParticipantId)).Select(c => c.ParticipantId), "has a community access risk assessment");
        await Add(db.CaregiverProfileSubmissions.Where(c => list.Contains(c.ParticipantId)).Select(c => c.ParticipantId), "has caregiver form submissions");
        // Signing evidence hangs off its snapshot, which carries the participant.
        await Add(db.ElectronicSigningSnapshots.Where(s => list.Contains(s.ParticipantId)).Select(s => s.ParticipantId), "has e-signing records");
        await Add(db.TripClaims.Where(t => t.ParticipantId != null && list.Contains(t.ParticipantId.Value)).Select(t => t.ParticipantId!.Value), "has trip claims");
        await Add(db.ParticipantContactRoles.Where(r => list.Contains(r.ParticipantId) && r.CreatedAt > importedAt).Select(r => r.ParticipantId), "has contacts added after the import");
        return reasons;
    }
}
