using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>
/// The single fail-closed eligibility rule for participant activation and operational placement.
/// Readiness is derived from tenant-owned onboarding and immutable signing records; it is never
/// accepted from a participant, booking, or roster request. In particular, absent, stale,
/// unverified, and cross-tenant evidence is not treated as ready.
/// </summary>
public static class ParticipantReadinessGate
{
    public const string NotReadyMessage = "Participant is not ready for booking or rostering.";

    /// <summary>
    /// Returns persisted activation evidence without looking at the participant's current active
    /// flag. This lets the participant write path promote only an inactive record with complete
    /// evidence, while read/booking paths additionally require that it is already active.
    /// </summary>
    public static Task<bool> HasActivationEvidenceAsync(OdipDbContext db, Guid participantId, CancellationToken ct) =>
        ActivationEvidenceParticipants(db).AnyAsync(p => p.Id == participantId, ct);

    public static IQueryable<Participant> ActiveReadyParticipants(OdipDbContext db) =>
        ActivationEvidenceParticipants(db).Where(p => p.IsActive && !p.IsDraft);

    private static IQueryable<Participant> ActivationEvidenceParticipants(OdipDbContext db) =>
        // Evidence created from an unapproved source is never rehabilitated by a later status
        // mutation. This source is currently an UnapprovedDraft, so all activation, booking,
        // and roster eligibility must remain closed even for pre-existing "Verified" rows.
        !ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence
            || ProvisionalAgreementTemplate.State != "ApprovedForElectronicSigning"
            ? db.Participants.Where(_ => false)
            : ActivationEvidenceParticipantsForApprovedSource(db);

    /// <summary>
    /// Test-only pure query for exercising the immutable-evidence predicates as they would run
    /// after a separately approved source is introduced. It does not alter the production source
    /// decision: the public activation and active-ready wrappers always use the hard-closed
    /// <see cref="ProvisionalAgreementTemplate"/> guard above.
    /// </summary>
    internal static IQueryable<Participant> ActivationEvidenceParticipantsForApprovedSourceForTesting(OdipDbContext db) =>
        ActivationEvidenceParticipantsForApprovedSource(db);

    private static IQueryable<Participant> ActivationEvidenceParticipantsForApprovedSource(OdipDbContext db) =>
        db.Participants.Where(p =>
            p.IntakeCompletedAt != null
            && db.ParticipantOnboardings.Any(o =>
                o.ParticipantId == p.Id
                && o.TenantId == p.TenantId
                && o.ProfileComplete
                && o.ProfileCompletedAt != null
                && o.ServiceTypeConfirmed
                && o.ServiceTypeConfirmedAt != null)
            && db.ElectronicSigningSnapshots.Any(snapshot =>
                snapshot.ParticipantId == p.Id
                && snapshot.TenantId == p.TenantId
                && snapshot.DocumentHash != ""
                // The evidence must name the exact newest tenant/participant draft ID and
                // version. CreateAsync appends a new row per revision, so matching only the
                // snapshot's old row would otherwise leave stale evidence eligible.
                && db.ServiceAgreementDrafts.Any(draft =>
                    draft.Id == snapshot.DraftId
                    && draft.TenantId == p.TenantId
                    && draft.ParticipantId == p.Id
                    && draft.Version == snapshot.DraftVersion
                    && !db.ServiceAgreementDrafts.Any(newerDraft =>
                        newerDraft.TenantId == p.TenantId
                        && newerDraft.ParticipantId == p.Id
                        && newerDraft.Version > draft.Version))
                && db.ElectronicSigningEvidence.Any(evidence =>
                    evidence.SnapshotId == snapshot.Id
                    && evidence.TenantId == p.TenantId
                    // Pending in-app attestations are deliberately not sufficient. "Verified" is
                    // an internal state owned by the future approval workflow, not an API input.
                    && evidence.Status == "Verified"
                    && evidence.IsAuthorisedRepresentative
                    && evidence.ConsentToElectronicMethod
                    && evidence.IntendsToSign
                    && evidence.DocumentWasDisplayed
                    && evidence.EvidenceHash != "")));

    public static Task<bool> IsActiveReadyAsync(OdipDbContext db, Guid participantId, CancellationToken ct) =>
        ActiveReadyParticipants(db).AnyAsync(p => p.Id == participantId, ct);

    // ── Funding recorded: an ACTIVATION requirement, and only that ──────────────────────────────────────────────────────────────────────────
    // An NDIS-funded participant is ready for activation when a plan budget is recorded that has not ended (the plan's last day is on or after the provider's
    // calendar date: pass ProviderTimeZoneResolver.TodayAsync, never the UTC date). A participant whose funding is not the NDIS has no plan budget to record, so this
    // clause never applies to them. It is deliberately NOT part of ActivationEvidenceParticipants, and so not part of ActiveReadyParticipants or IsActiveReadyAsync: those
    // decide whether a participant may be rostered, booked and shown on the register, and a missing budget must not stop any of that (nor appear on a shift).

    private static Expression<Func<Participant, bool>> FundingRecorded(OdipDbContext db, DateOnly today) =>
        p => p.FundingSource != ParticipantFundingSource.Ndis
            || db.FundingPlans.Any(plan => plan.ParticipantId == p.Id && plan.TenantId == p.TenantId && plan.PlanEnd >= today);

    /// <summary>The participants whose plan budget is recorded, or who have none to record (funding that is not the NDIS).</summary>
    public static IQueryable<Participant> FundingRecordedParticipants(OdipDbContext db, DateOnly today) =>
        db.Participants.Where(FundingRecorded(db, today));

    /// <summary>The NDIS-funded participants with no current plan budget: what the activation checklist lists as "Funding not recorded".</summary>
    public static IQueryable<Participant> FundingMissingParticipants(OdipDbContext db, DateOnly today) =>
        db.Participants.Where(p => p.FundingSource == ParticipantFundingSource.Ndis
            && !db.FundingPlans.Any(plan => plan.ParticipantId == p.Id && plan.TenantId == p.TenantId && plan.PlanEnd >= today));

    public static Task<bool> HasFundingRecordedAsync(OdipDbContext db, Guid participantId, DateOnly today, CancellationToken ct) =>
        FundingRecordedParticipants(db, today).AnyAsync(p => p.Id == participantId, ct);
}
