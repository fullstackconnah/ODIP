using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
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
}
