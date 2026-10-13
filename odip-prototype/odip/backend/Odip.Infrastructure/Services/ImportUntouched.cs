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
    /// and no edits since creation (an Updated audit row: every write path to a participant is audited).</summary>
    public static async Task<Dictionary<Guid, string>> ParticipantBlockersAsync(OdipDbContext db, IReadOnlyCollection<Guid> ids, CancellationToken ct)
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
        await Add(db.ParticipantOnboardings.Where(o => list.Contains(o.ParticipantId) && (o.ProfileComplete || o.ServiceTypeConfirmed || o.ServiceAgreementSigned))
            .Select(o => o.ParticipantId), "has onboarding progress");
        await Add(db.AuditLogs.Where(a => a.EntityType == nameof(Participant) && a.Action == AuditAction.Updated && list.Contains(a.EntityId))
            .Select(a => a.EntityId), "was edited after the import");
        return reasons;
    }
}
