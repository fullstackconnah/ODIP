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
        // Incidents unfiltered: a row the previous image filed after a rollback has no TenantId yet, and still has to block undo. The ids are this organisation's already.
        await Add(db.IncidentReports.IgnoreQueryFilters([TenantFilter.Name]).Where(i => i.InvolvedParticipantId != null && list.Contains(i.InvolvedParticipantId.Value)).Select(i => i.InvolvedParticipantId!.Value), "is named in an incident");
        await Add(db.ParticipantBookings.Where(b => list.Contains(b.ParticipantId)).Select(b => b.ParticipantId), "has trip bookings");
        await Add(db.ParticipantMedications.Where(m => list.Contains(m.ParticipantId)).Select(m => m.ParticipantId), "has medications");
        await Add(db.ServiceAgreementDrafts.Where(a => list.Contains(a.ParticipantId)).Select(a => a.ParticipantId), "has a service agreement");
        await Add(db.FundingPlans.Where(f => list.Contains(f.ParticipantId)).Select(f => f.ParticipantId), "has a funding plan");
        // The onboarding checklist's stored steps: an agreement or the complaints and rights explanation recorded, services begun, or made active by its button (only an onboarding import's
        // participants have an onboarding row, and they arrive as drafts).
        await Add(db.ParticipantOnboardings.Where(o => list.Contains(o.ParticipantId) && (o.AgreementRecordedAt != null || o.ExplainedRecordedAt != null)).Select(o => o.ParticipantId), "has onboarding progress");
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
        await Add(db.ParticipantInquiries.Where(q => q.ParticipantId != null && list.Contains(q.ParticipantId.Value)).Select(q => q.ParticipantId!.Value), "is linked to an inquiry");
        await Add(db.ParticipantContactRoles.Where(r => list.Contains(r.ParticipantId) && r.CreatedAt > importedAt).Select(r => r.ParticipantId), "has contacts added after the import");
        return reasons;
    }

    /// <summary>
    /// The spec's rule (never signed in; no shifts, completions or leave) plus every record someone else can point at the account, because
    /// deleting it would cascade them away or null them out (availability, pairings, patterns, preferred staff, trip roles, incidents, tasks).
    /// What only the person themselves can write needs a sign-in first. A Restrict or ClientSetNull foreign key missed here fails the undo (409)
    /// rather than deleting; the one SetNull it does not list (TripClaim.AuthorisedByUserId) is only set by the person themselves authorising a claim, which "has signed in" covers.
    /// </summary>
    public static async Task<Dictionary<Guid, string>> StaffBlockersAsync(OdipDbContext db, IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        var list = ids.ToList();
        var reasons = new Dictionary<Guid, string>();
        async Task Add(IQueryable<Guid> blocked, string reason)
        {
            foreach (var id in await blocked.Distinct().ToListAsync(ct)) reasons.TryAdd(id, reason);
        }

        await Add(db.Users.Where(u => list.Contains(u.Id) && u.LastLoginAt != null).Select(u => u.Id), "has signed in");
        await Add(db.Shifts.Where(s => s.UserId != null && list.Contains(s.UserId.Value)).Select(s => s.UserId!.Value), "has shifts");
        await Add(db.ShiftPatterns.Where(p => p.DefaultUserId != null && list.Contains(p.DefaultUserId.Value)).Select(p => p.DefaultUserId!.Value), "is on a recurring shift pattern");
        await Add(db.ShiftCompletions.Where(c => list.Contains(c.SubmittedByUserId)).Select(c => c.SubmittedByUserId), "has completed shifts");
        await Add(db.LeaveRequests.Where(l => list.Contains(l.UserId)).Select(l => l.UserId), "has leave");
        await Add(db.RecurringUnavailabilities.Where(r => list.Contains(r.UserId)).Select(r => r.UserId), "has recurring unavailability");
        // StaffAvailability has no tenant filter; the ids are this organisation's own imported users.
        await Add(db.StaffAvailabilities.Where(a => list.Contains(a.UserId)).Select(a => a.UserId), "has availability");
        await Add(db.StaffParticipantCompatibilities.Where(c => list.Contains(c.UserId)).Select(c => c.UserId), "has participant pairings");
        await Add(db.StaffAssignments.Where(a => list.Contains(a.UserId)).Select(a => a.UserId), "is assigned to a trip");
        await Add(db.VehicleAssignments.Where(v => v.DriverUserId != null && list.Contains(v.DriverUserId.Value)).Select(v => v.DriverUserId!.Value), "drives on a trip");
        await Add(db.Participants.Where(p => p.PreferredUserId != null && list.Contains(p.PreferredUserId.Value)).Select(p => p.PreferredUserId!.Value), "is a participant's preferred staff member");
        // Incidents unfiltered, as for participants above.
        await Add(db.IncidentReports.IgnoreQueryFilters([TenantFilter.Name]).Where(i => list.Contains(i.ReportedByUserId)).Select(i => i.ReportedByUserId), "is named in an incident");
        await Add(db.IncidentReports.IgnoreQueryFilters([TenantFilter.Name]).Where(i => i.InvolvedUserId != null && list.Contains(i.InvolvedUserId.Value)).Select(i => i.InvolvedUserId!.Value), "is named in an incident");
        await Add(db.IncidentWitnesses.Where(w => w.WitnessUserId != null && list.Contains(w.WitnessUserId.Value)).Select(w => w.WitnessUserId!.Value), "is a witness to an incident");
        await Add(db.TripInstances.Where(t => t.LeadCoordinatorId != null && list.Contains(t.LeadCoordinatorId.Value)).Select(t => t.LeadCoordinatorId!.Value), "leads a trip");
        await Add(db.BookingTasks.Where(t => t.OwnerId != null && list.Contains(t.OwnerId.Value)).Select(t => t.OwnerId!.Value), "owns tasks");
        await Add(db.ParticipantInquiries.Where(q => q.IntakeStaffUserId != null && list.Contains(q.IntakeStaffUserId.Value)).Select(q => q.IntakeStaffUserId!.Value), "is booked for an intake visit");
        await Add(db.ParticipantInquiries.Where(q => q.IntakeBookedByUserId != null && list.Contains(q.IntakeBookedByUserId.Value)).Select(q => q.IntakeBookedByUserId!.Value), "booked an intake visit");
        return reasons;
    }

    /// <summary>
    /// An imported funding plan changed or used since the import. Changed: every change to a plan, its pools or its periods is a replace, which raises its
    /// revision. Used: nothing stores a reference to a plan (the ledger and the alerts compute from it on every read), so use is work recorded against its
    /// participant in its dates since <paramref name="importedAt"/>: a shift booked or a service agreement made. Deleting the plan would leave that work
    /// with no budget behind it.
    /// </summary>
    public static async Task<Dictionary<Guid, string>> FundingPlanBlockersAsync(OdipDbContext db, IReadOnlyCollection<Guid> ids, DateTime importedAt, CancellationToken ct)
    {
        var list = ids.ToList();
        var plans = await db.FundingPlans.Where(f => list.Contains(f.Id)).Select(f => new { f.Id, f.ParticipantId, f.PlanStart, f.PlanEnd, f.Revision }).ToListAsync(ct);
        var people = plans.Select(p => p.ParticipantId).Distinct().ToList();
        var reasons = plans.Where(p => p.Revision > 1).ToDictionary(p => p.Id, _ => "was changed after the import");
        void Used(IEnumerable<(Guid ParticipantId, DateOnly From, DateOnly To)> uses, string reason)
        {
            foreach (var use in uses)
                foreach (var plan in plans.Where(p => p.ParticipantId == use.ParticipantId && p.PlanStart <= use.To && use.From <= p.PlanEnd))
                    reasons.TryAdd(plan.Id, reason);
        }

        Used((await db.Shifts.Where(s => people.Contains(s.ParticipantId) && s.CreatedAt > importedAt).Select(s => new { s.ParticipantId, s.ServiceDate }).ToListAsync(ct))
            .Select(s => (s.ParticipantId, s.ServiceDate, s.ServiceDate)), "has shifts booked in its dates since the import");
        Used((await db.ServiceAgreementDrafts.Where(a => people.Contains(a.ParticipantId) && a.CreatedAt > importedAt)
                .Select(a => new { a.ParticipantId, a.AgreementStartDate, a.AgreementEndDate }).ToListAsync(ct))
            .Select(a => (a.ParticipantId, a.AgreementStartDate, a.AgreementEndDate)), "has a service agreement made since the import");
        return reasons;
    }
}
