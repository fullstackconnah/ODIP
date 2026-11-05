using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Domain.Integrations;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Retention;

/// <summary>
/// The sets of rows one participant (<see cref="X"/>) owns in one organisation (<see cref="T"/>), as id subqueries rooted at the participant. Every step of <see cref="PurgePlan"/>
/// reads them, never ids collected during a run, so a count and a delete cannot differ. The tenant filter is off and every query names the organisation itself.
/// </summary>
public sealed class PurgeScope
{
    public OdipDbContext Db { get; }
    public Guid T { get; }
    public Guid X { get; }
    /// <summary>The ids of every row deleted so far with an Id; the polymorphic tables (audit, outbox, notifications) are cleaned by these.</summary>
    public HashSet<Guid> Purged { get; } = [];
    /// <summary>A snapshot of <see cref="Purged"/> for a query parameter.</summary>
    public Guid[] PurgedIds => [.. Purged];

    public IQueryable<Guid> Participant { get; }
    public IQueryable<Guid> Shifts { get; }
    public IQueryable<Guid> Completions { get; }
    public IQueryable<Guid> ShiftNotes { get; }
    public IQueryable<Guid> Bookings { get; }
    public IQueryable<Guid> Incidents { get; }
    public IQueryable<Guid> MedAdministrations { get; }
    public IQueryable<Guid> Practices { get; }
    public IQueryable<Guid> Claims { get; }
    public IQueryable<Guid> ClaimLines { get; }
    public IQueryable<Guid> Invoices { get; }
    public IQueryable<Guid> Drafts { get; }
    public IQueryable<Guid> Plans { get; }
    public IQueryable<Guid> Pools { get; }
    public IQueryable<Guid> Routines { get; }
    public IQueryable<Guid> Snapshots { get; }
    public IQueryable<Guid> Inquiries { get; }

    public PurgeScope(OdipDbContext db, Guid tenantId, Guid participantId)
    {
        Db = db; T = tenantId; X = participantId;
        var t = tenantId; var x = participantId;

        var pts = Q<Participant>().Where(p => p.TenantId == t && p.Id == x).Select(p => p.Id);
        var shifts = Q<Shift>().Where(s => s.TenantId == t && s.ParticipantId == x).Select(s => s.Id);
        var bookings = Q<ParticipantBooking>().Where(b => pts.Contains(b.ParticipantId)).Select(b => b.Id);
        var claims = Q<TripClaim>().Where(c => c.TenantId == t && c.ParticipantId == x).Select(c => c.Id);
        var staff = Q<User>().Where(u => u.TenantId == t).Select(u => u.Id);
        var plans = Q<FundingPlan>().Where(p => p.TenantId == t && p.ParticipantId == x).Select(p => p.Id);

        Participant = pts;
        Shifts = shifts;
        Completions = Q<ShiftCompletion>().Where(c => c.TenantId == t && shifts.Contains(c.ShiftId)).Select(c => c.Id);
        ShiftNotes = Q<ShiftNote>().Where(n => n.TenantId == t && shifts.Contains(n.ShiftId)).Select(n => n.Id);
        Bookings = bookings;
        // An incident is scoped through the staff member who reported it, as the export does (its own TenantId is nullable).
        Incidents = Q<IncidentReport>().Where(i => i.InvolvedParticipantId == x && staff.Contains(i.ReportedByUserId)).Select(i => i.Id);
        MedAdministrations = Q<MedicationAdministration>().Where(m => m.TenantId == t && m.ParticipantId == x).Select(m => m.Id);
        Practices = Q<RestrictivePractice>().Where(r => r.TenantId == t && r.ParticipantId == x).Select(r => r.Id);
        Claims = claims;
        // A claim line is the participant's through its claim, its booking or its shift (a group claim has no participant of its own).
        ClaimLines = Q<ClaimLineItem>().Where(l => claims.Contains(l.TripClaimId)
            || (l.ParticipantBookingId != null && bookings.Contains(l.ParticipantBookingId.Value))
            || (l.ShiftId != null && shifts.Contains(l.ShiftId.Value))).Select(l => l.Id);
        Invoices = Q<Invoice>().Where(i => i.TenantId == t && i.ParticipantId == x).Select(i => i.Id);
        Drafts = Q<ServiceAgreementDraft>().Where(d => d.TenantId == t && d.ParticipantId == x).Select(d => d.Id);
        Plans = plans;
        Pools = Q<FundingPool>().Where(p => p.TenantId == t && plans.Contains(p.FundingPlanId)).Select(p => p.Id);
        Routines = Q<ParticipantRoutine>().Where(r => r.TenantId == t && r.ParticipantId == x).Select(r => r.Id);
        Snapshots = Q<ElectronicSigningSnapshot>().Where(s => s.TenantId == t && s.ParticipantId == x).Select(s => s.Id);
        Inquiries = Q<ParticipantInquiry>().Where(i => i.TenantId == t && i.ParticipantId == x).Select(i => i.Id);
    }

    public IQueryable<E> Q<E>() where E : class => Db.Set<E>().IgnoreQueryFilters([TenantFilter.Name]);
}

/// <summary>One table's rows for the participant: counted for the due list and deleted by the purge from the same query.</summary>
public abstract record PurgeStep(string Table)
{
    /// <summary>Ids of the rows, or null when the table has no Id column (a join row).</summary>
    public abstract IQueryable<Guid>? Ids(PurgeScope s);
    public abstract Task<int> CountAsync(PurgeScope s, CancellationToken ct);
    public abstract Task<int> DeleteAsync(PurgeScope s, CancellationToken ct);
    public abstract Type Entity { get; }
}

public sealed record PurgeStep<E>(string Table, Func<PurgeScope, IQueryable<E>> Rows, bool HasId = true) : PurgeStep(Table) where E : class
{
    public override Type Entity => typeof(E);
    public override IQueryable<Guid>? Ids(PurgeScope s) => HasId ? Rows(s).Select(e => EF.Property<Guid>(e, "Id")) : null;
    public override Task<int> CountAsync(PurgeScope s, CancellationToken ct) => Rows(s).CountAsync(ct);
    public override Task<int> DeleteAsync(PurgeScope s, CancellationToken ct) => Rows(s).ExecuteDeleteAsync(ct);
}

/// <summary>
/// The delete order over every table that holds the participant's data (PLAN section 4; dependents first, from the model's foreign keys), as one list. The due list counts it, the purge
/// walks it, and <c>PurgePlanModelTests</c> checks it against the model so a new table that points at a participant cannot be forgotten.
/// shortcut: the list is kept by hand and guarded by a model-walk test; generate it from the model if tables are added often.
/// </summary>
public static class PurgePlan
{
    private static PurgeStep Step<E>(string table, Func<PurgeScope, IQueryable<E>> rows, bool hasId = true) where E : class => new PurgeStep<E>(table, rows, hasId);

    public static readonly IReadOnlyList<PurgeStep> Steps =
    [
        // Tasks that name a purged shift, note, incident, medication round or booking (their title or link can carry the name).
        Step("BookingTasks", s => s.Q<BookingTask>().Where(t =>
            (t.ShiftId != null && s.Shifts.Contains(t.ShiftId.Value)) || (t.ShiftNoteId != null && s.ShiftNotes.Contains(t.ShiftNoteId.Value))
            || (t.IncidentReportId != null && s.Incidents.Contains(t.IncidentReportId.Value))
            || (t.MedicationAdministrationId != null && s.MedAdministrations.Contains(t.MedicationAdministrationId.Value))
            || (t.ParticipantBookingId != null && s.Bookings.Contains(t.ParticipantBookingId.Value)))),
        Step("Complaints", s => s.Q<Complaint>().Where(c => c.TenantId == s.T && c.ParticipantId == s.X)),
        Step("IncidentWitnesses", s => s.Q<IncidentWitness>().Where(w => s.Incidents.Contains(w.IncidentReportId))),
        Step("IncidentInjuries", s => s.Q<IncidentInjury>().Where(w => s.Incidents.Contains(w.IncidentReportId))),
        Step("IncidentReports", s => s.Q<IncidentReport>().Where(i => s.Incidents.Contains(i.Id))),
        Step("TripDocuments", s => s.Q<TripDocument>().Where(d => d.ParticipantBookingId != null && s.Bookings.Contains(d.ParticipantBookingId.Value))),
        Step("ClaimBatchLines", s => s.Q<ClaimBatchLine>().Where(l => l.ClaimLineItemId != null && s.ClaimLines.Contains(l.ClaimLineItemId.Value))),
        Step("InvoiceLines", s => s.Q<InvoiceLine>().Where(l => s.Invoices.Contains(l.InvoiceId))),
        Step("Invoices", s => s.Q<Invoice>().Where(i => s.Invoices.Contains(i.Id))),
        Step("ClaimLineItems", s => s.Q<ClaimLineItem>().Where(l => s.ClaimLines.Contains(l.Id))),
        Step("TripClaims", s => s.Q<TripClaim>().Where(c => s.Claims.Contains(c.Id))),
        Step("ShiftRoutineChecks", s => s.Q<ShiftRoutineCheck>().Where(c => s.Completions.Contains(c.ShiftCompletionId) || s.Routines.Contains(c.ParticipantRoutineId))),
        Step("ShiftBreaks", s => s.Q<ShiftBreak>().Where(b => s.Completions.Contains(b.ShiftCompletionId))),
        Step("HandoverAcknowledgements", s => s.Q<HandoverAcknowledgement>().Where(h => s.Shifts.Contains(h.ShiftId) || s.Completions.Contains(h.SourceCompletionId))),
        // Payroll sends are keyed by the completion's id (OPEN-a: Kind Timesheet only; leave kinds hold leave request ids).
        Step("EmploymentHeroOutbox", s => s.Q<EmploymentHeroOutbox>().Where(o => o.TenantId == s.T && o.Kind == EmploymentHeroOutboxKind.Timesheet && s.Completions.Contains(o.EntityId))),
        Step("ShiftCompletions", s => s.Q<ShiftCompletion>().Where(c => s.Completions.Contains(c.Id))),
        Step("ShiftNotes", s => s.Q<ShiftNote>().Where(n => s.ShiftNotes.Contains(n.Id))),
        Step("Shifts", s => s.Q<Shift>().Where(x => s.Shifts.Contains(x.Id))),
        Step("ShiftPatterns", s => s.Q<ShiftPattern>().Where(p => p.TenantId == s.T && p.ParticipantId == s.X)),
        Step("StaffParticipantCompatibilities", s => s.Q<StaffParticipantCompatibility>().Where(c => c.TenantId == s.T && c.ParticipantId == s.X)),
        Step("MedicationAdministrations", s => s.Q<MedicationAdministration>().Where(m => s.MedAdministrations.Contains(m.Id))),
        Step("RestrictivePracticeMonthlyReports", s => s.Q<RestrictivePracticeMonthlyReport>().Where(r => s.Practices.Contains(r.RestrictivePracticeId))),
        Step("RestrictivePractices", s => s.Q<RestrictivePractice>().Where(r => s.Practices.Contains(r.Id))),
        Step("ParticipantMedications", s => s.Q<ParticipantMedication>().Where(m => m.TenantId == s.T && m.ParticipantId == s.X)),
        Step("ServiceAgreementShares", s => s.Q<ServiceAgreementShare>().Where(h => h.TenantId == s.T && (h.ParticipantId == s.X || s.Drafts.Contains(h.DraftId)))),
        Step("ServiceAgreementDraftApprovals", s => s.Q<ServiceAgreementDraftApproval>().Where(a => a.TenantId == s.T && (a.ParticipantId == s.X || s.Drafts.Contains(a.DraftId)))),
        Step("ServiceAgreementDraftBlocks", s => s.Q<ServiceAgreementDraftBlock>().Where(b => s.Drafts.Contains(b.DraftId))),
        Step("ServiceAgreementDraftLines", s => s.Q<ServiceAgreementDraftLine>().Where(l => s.Drafts.Contains(l.DraftId))),
        Step("ServiceAgreementDrafts", s => s.Q<ServiceAgreementDraft>().Where(d => s.Drafts.Contains(d.Id))),
        Step("ElectronicSigningEvidence", s => s.Q<ElectronicSigningEvidence>().Where(e => s.Snapshots.Contains(e.SnapshotId))),
        Step("ElectronicSigningSnapshots", s => s.Q<ElectronicSigningSnapshot>().Where(e => s.Snapshots.Contains(e.Id))),
        Step("FundingPeriods", s => s.Q<FundingPeriod>().Where(p => s.Pools.Contains(p.FundingPoolId))),
        Step("FundingPools", s => s.Q<FundingPool>().Where(p => s.Pools.Contains(p.Id))),
        Step("FundingPlans", s => s.Q<FundingPlan>().Where(p => s.Plans.Contains(p.Id))),
        Step("ParticipantBookings", s => s.Q<ParticipantBooking>().Where(b => s.Bookings.Contains(b.Id))),
        Step("ParticipantRoutines", s => s.Q<ParticipantRoutine>().Where(r => s.Routines.Contains(r.Id))),
        Step("ParticipantNotes", s => s.Q<ParticipantNote>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantRiskEntries", s => s.Q<ParticipantRiskEntry>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantConsents", s => s.Q<ParticipantConsent>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantHealthConditions", s => s.Q<ParticipantHealthCondition>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantAdlAssessments", s => s.Q<ParticipantAdlAssessment>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantChecklistItems", s => s.Q<ParticipantChecklistItem>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantCommunityAccessRiskItems", s => s.Q<ParticipantCommunityAccessRiskItem>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantContactRoles", s => s.Q<ParticipantContactRole>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("CaregiverProfileSubmissions", s => s.Q<CaregiverProfileSubmission>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        // No TenantId of their own: scoped through the participant, as the export does.
        Step("ParticipantContacts", s => s.Q<ParticipantContact>().Where(c => s.Participant.Contains(c.ParticipantId)), hasId: false),
        Step("SupportProfiles", s => s.Q<SupportProfile>().Where(p => s.Participant.Contains(p.ParticipantId))),
        // The intake PDFs live in PdfContent on the snapshot row, so deleting the row removes them.
        Step("ParticipantIntakeSnapshots", s => s.Q<ParticipantIntakeSnapshot>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("ParticipantOnboardings", s => s.Q<ParticipantOnboarding>().Where(n => n.TenantId == s.T && n.ParticipantId == s.X)),
        Step("InquiryContacts", s => s.Q<InquiryContact>().Where(c => s.Inquiries.Contains(c.InquiryId))),
        Step("ParticipantInquiries", s => s.Q<ParticipantInquiry>().Where(i => s.Inquiries.Contains(i.Id))),
        Step("ParticipantGroupRevisions", s => s.Q<ParticipantGroupRevision>().Where(r => s.Participant.Contains(r.ParticipantId)), hasId: false),
        // Polymorphic tables: no foreign key, an EntityId that names any purged row (OPEN-b). The ids are the ones collected by the steps above.
        Step("ImportBatchItems", s => s.Q<ImportBatchItem>().Where(i => i.EntityId == s.X || s.PurgedIds.Contains(i.EntityId))),
        Step("NotificationLogs", s => s.Q<NotificationLog>().Where(l => s.Q<NotificationOutbox>().Any(o => o.Id == l.OutboxId && o.TenantId == s.T && (o.EntityId == s.X || s.PurgedIds.Contains(o.EntityId))))),
        Step("NotificationOutbox", s => s.Q<NotificationOutbox>().Where(o => o.TenantId == s.T && (o.EntityId == s.X || s.PurgedIds.Contains(o.EntityId)))),
        Step("InAppNotifications", s => s.Q<InAppNotification>().Where(n => n.TenantId == s.T && (n.EntityId == s.X || s.PurgedIds.Contains(n.EntityId)))),
        Step("Participants", s => s.Q<Participant>().Where(p => p.TenantId == s.T && p.Id == s.X)),
    ];

    /// <summary>The rows each table holds for the participant, for the due list. Counts the same queries the purge deletes.</summary>
    public static async Task<Dictionary<string, int>> CountAsync(OdipDbContext db, Guid tenantId, Guid participantId, CancellationToken ct)
    {
        var scope = new PurgeScope(db, tenantId, participantId);
        var counts = new Dictionary<string, int>();
        foreach (var step in Steps)
        {
            var ids = step.Ids(scope);
            if (ids is not null) foreach (var id in await ids.ToListAsync(ct)) scope.Purged.Add(id);
            var n = await step.CountAsync(scope, ct);
            if (n > 0) counts[step.Table] = n;
        }
        return counts;
    }
}
