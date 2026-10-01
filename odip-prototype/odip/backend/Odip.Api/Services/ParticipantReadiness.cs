using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>What a readiness check decided for one participant, and what is missing.</summary>
/// <param name="Allowed">
/// Whether a new placement (a shift, a pattern, a compatibility row, a trip booking) may be made.
/// Always false for a participant who does not exist in the caller's tenant, is a draft, or is not
/// active, in either mode. Otherwise: Warn allows it; Enforce allows it only when the strict
/// <see cref="ParticipantReadinessGate"/> predicate accepts the participant.
/// </param>
/// <param name="Mode">The participant's organisation's readiness mode.</param>
/// <param name="Issues">Human strings naming what is missing, in a stable order. Empty when nothing is.</param>
public sealed record ParticipantReadinessResult(bool Allowed, ParticipantReadinessMode Mode, IReadOnlyList<string> Issues)
{
    /// <summary>The 400 message for a refused action; null when it is allowed.</summary>
    public string? Rejection => Allowed ? null : ParticipantReadinessGate.NotReadyMessage;

    /// <summary>The issues for a response DTO: null (so the field is omitted from the JSON) when there are none.</summary>
    public List<string>? IssuesOrNull => Issues.Count == 0 ? null : Issues.ToList();
}

/// <summary>
/// The mode-aware readiness API every operational caller uses. Readiness is a per-organisation
/// setting (<see cref="ProviderSettings.ParticipantReadinessMode"/>, Warn by default):
/// <list type="bullet">
/// <item><b>Warn</b>: an active, non-draft participant can be rostered, booked and activated, and
/// what is missing comes back as <see cref="ParticipantReadinessResult.Issues"/> for the response
/// and the UI to show.</item>
/// <item><b>Enforce</b>: exactly the strict, fail-closed rule in <see cref="ParticipantReadinessGate"/>,
/// called unchanged, so it is ready the day electronic signing exists.</item>
/// </list>
/// The mode is looked up by the PARTICIPANT's tenant, never the caller's ambient tenant, so a
/// SuperAdmin working across tenants is held to each organisation's own choice. An organisation
/// with no ProviderSettings row is Warn.
/// </summary>
public static class ParticipantReadiness
{
    public const string IntakeNotComplete = "Intake not complete";
    public const string OnboardingProfileNotComplete = "Onboarding not complete: profile";
    public const string OnboardingServiceTypeNotComplete = "Onboarding not complete: service type";
    public const string NoSignedServiceAgreement = "No signed service agreement";

    // ── Mode ────────────────────────────────────────────────────────────────

    /// <summary>
    /// True when the tenant's organisation enforces readiness. If an organisation somehow has more
    /// than one ProviderSettings row, Enforce wins: the strict reading is the safe one.
    /// </summary>
    public static Task<bool> IsEnforcedAsync(OdipDbContext db, Guid tenantId, CancellationToken ct) =>
        db.ProviderSettings.AnyAsync(
            s => s.TenantId == tenantId && s.ParticipantReadinessMode == ParticipantReadinessMode.Enforce, ct);

    /// <summary>Which of <paramref name="tenantIds"/> enforce readiness (for read paths that cover many participants).</summary>
    public static async Task<HashSet<Guid>> EnforcingTenantsAsync(
        OdipDbContext db, IEnumerable<Guid> tenantIds, CancellationToken ct)
    {
        var ids = tenantIds.Distinct().ToList();
        if (ids.Count == 0) return new HashSet<Guid>();
        var enforcing = await db.ProviderSettings
            .Where(s => s.ParticipantReadinessMode == ParticipantReadinessMode.Enforce && ids.Contains(s.TenantId))
            .Select(s => s.TenantId)
            .ToListAsync(ct);
        return enforcing.ToHashSet();
    }

    /// <summary>
    /// The tenants that enforce readiness, as a subquery to compose into a participant query. EF
    /// inlines it, so a register filter can ask "is this participant's organisation in Warn mode"
    /// per row without a second round trip.
    /// </summary>
    public static IQueryable<Guid> EnforcingTenantIds(OdipDbContext db) =>
        db.ProviderSettings
            .Where(s => s.ParticipantReadinessMode == ParticipantReadinessMode.Enforce)
            .Select(s => s.TenantId);

    /// <summary>
    /// The operational participant register: non-draft participants, where a record introduced
    /// through the onboarding workflow (it has an onboarding row) stays in the onboarding stage
    /// until it has been ACTIVATED. For an organisation that enforces readiness, activated means the
    /// strict gate accepts it (unchanged); in Warn mode activation proceeds without signed-agreement
    /// evidence, so an activated participant is on the register like any other. Older non-draft
    /// records have no onboarding row, so they keep their historic visibility.
    /// A query-shaped predicate (it composes into the register's SQL), so it has its own
    /// translation test: the EF InMemory provider would not notice if it stopped translating.
    /// </summary>
    public static IQueryable<Participant> OperationalRegister(OdipDbContext db, IQueryable<Participant> participants) =>
        participants.Where(p => !p.IsDraft &&
            (!db.ParticipantOnboardings.Any(o => o.ParticipantId == p.Id && o.TenantId == p.TenantId)
             || (p.IsActive && !EnforcingTenantIds(db).Contains(p.TenantId))
             || ParticipantReadinessGate.ActiveReadyParticipants(db).Any(ready => ready.Id == p.Id)));

    // ── Checks ──────────────────────────────────────────────────────────────

    /// <summary>
    /// May this participant be placed (rostered, booked)? One call for every roster write and for
    /// trip booking creation.
    /// </summary>
    public static async Task<ParticipantReadinessResult> CheckAsync(OdipDbContext db, Guid participantId, CancellationToken ct)
    {
        var participant = await db.Participants.AsNoTracking()
            .Where(p => p.Id == participantId)
            .Select(p => new { p.TenantId, p.IsActive, p.IsDraft })
            .FirstOrDefaultAsync(ct);
        if (participant is null)
            return new ParticipantReadinessResult(false, ParticipantReadinessMode.Warn, Array.Empty<string>());

        var enforced = await IsEnforcedAsync(db, participant.TenantId, ct);
        var issues = (await IssuesAsync(db, new[] { participantId }, ct)).GetValueOrDefault(participantId)
            ?? new List<string>();

        // Enforce goes through the existing strict predicate, unchanged. Warn is that same rule
        // minus the evidence requirement: the participant must still exist, be active, and not be a draft.
        var allowed = enforced
            ? await ParticipantReadinessGate.IsActiveReadyAsync(db, participantId, ct)
            : participant.IsActive && !participant.IsDraft;

        return new ParticipantReadinessResult(
            allowed, enforced ? ParticipantReadinessMode.Enforce : ParticipantReadinessMode.Warn, issues);
    }

    /// <summary>
    /// May an inactive, non-draft participant be activated? Warn: yes. Enforce: only when persisted,
    /// tenant-matched evidence exists (<see cref="ParticipantReadinessGate.HasActivationEvidenceAsync"/>).
    /// The caller still decides draft state; this answers the readiness question only.
    /// </summary>
    public static async Task<bool> MayActivateAsync(OdipDbContext db, Participant participant, CancellationToken ct) =>
        !await IsEnforcedAsync(db, participant.TenantId, ct)
        || await ParticipantReadinessGate.HasActivationEvidenceAsync(db, participant.Id, ct);

    // ── Issues ──────────────────────────────────────────────────────────────

    /// <summary>
    /// What is missing for each participant, computed from data that exists today. One entry per
    /// participant found (an empty list when nothing is missing); ids that do not exist in the
    /// caller's tenant are absent. Three queries however many participants there are.
    /// </summary>
    public static async Task<Dictionary<Guid, List<string>>> IssuesAsync(
        OdipDbContext db, IReadOnlyCollection<Guid> participantIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, List<string>>();
        var ids = participantIds.Distinct().ToList();
        if (ids.Count == 0) return result;

        var people = await db.Participants.AsNoTracking()
            .Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.TenantId, p.IntakeCompletedAt })
            .ToListAsync(ct);
        if (people.Count == 0) return result;

        var onboardings = await db.ParticipantOnboardings.AsNoTracking()
            .Where(o => ids.Contains(o.ParticipantId))
            .Select(o => new
            {
                o.ParticipantId, o.TenantId, o.ProfileComplete, o.ProfileCompletedAt,
                o.ServiceTypeConfirmed, o.ServiceTypeConfirmedAt,
            })
            .ToListAsync(ct);

        var signed = (await SignedAgreementParticipants(db)
            .Where(p => ids.Contains(p.Id))
            .Select(p => p.Id)
            .ToListAsync(ct)).ToHashSet();

        foreach (var person in people)
        {
            var issues = new List<string>();
            if (person.IntakeCompletedAt is null) issues.Add(IntakeNotComplete);

            // Only a participant who has an onboarding row (one introduced through the onboarding
            // workflow) can be incomplete there. A legacy participant has none, and the strict gate
            // never reads a row from another tenant, so neither does this.
            var onboarding = onboardings.FirstOrDefault(o => o.ParticipantId == person.Id && o.TenantId == person.TenantId);
            if (onboarding is not null)
            {
                if (!(onboarding.ProfileComplete && onboarding.ProfileCompletedAt != null))
                    issues.Add(OnboardingProfileNotComplete);
                if (!(onboarding.ServiceTypeConfirmed && onboarding.ServiceTypeConfirmedAt != null))
                    issues.Add(OnboardingServiceTypeNotComplete);
            }

            if (!signed.Contains(person.Id)) issues.Add(NoSignedServiceAgreement);
            result[person.Id] = issues;
        }

        return result;
    }

    /// <summary>The issues for a response DTO: null (omitted from the JSON) when the participant has none.</summary>
    public static List<string>? IssuesOrNull(IReadOnlyDictionary<Guid, List<string>> issuesById, Guid participantId) =>
        issuesById.TryGetValue(participantId, out var issues) && issues.Count > 0 ? issues : null;

    // ── Signed agreement ────────────────────────────────────────────────────

    /// <summary>
    /// Participants with a current, verified, signed service agreement. This is the signing clause
    /// of the strict predicate on its own, so the "No signed service agreement" issue says
    /// exactly what Enforce would be waiting for. It follows the same source rule as
    /// <see cref="ParticipantReadinessGate"/>: while the agreement source is not approved for
    /// electronic signing, nobody has a signed agreement, however the evidence rows look.
    /// </summary>
    internal static IQueryable<Participant> SignedAgreementParticipants(OdipDbContext db) =>
        !ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence
            || ProvisionalAgreementTemplate.State != "ApprovedForElectronicSigning"
            ? db.Participants.Where(_ => false)
            : SignedAgreementParticipantsForApprovedSource(db);

    /// <summary>Test seam: the signing clause as it would run once a source is approved. Not a runtime switch.</summary>
    internal static IQueryable<Participant> SignedAgreementParticipantsForApprovedSourceForTesting(OdipDbContext db) =>
        SignedAgreementParticipantsForApprovedSource(db);

    // KEEP IN STEP with the snapshot/evidence clause of
    // ParticipantReadinessGate.ActivationEvidenceParticipantsForApprovedSource (same newest-draft,
    // same Verified-with-every-flag rule). ParticipantReadinessIssuesTests holds the two together:
    // strict-ready must equal intake && onboarding complete && this clause.
    private static IQueryable<Participant> SignedAgreementParticipantsForApprovedSource(OdipDbContext db) =>
        db.Participants.Where(p =>
            db.ElectronicSigningSnapshots.Any(snapshot =>
                snapshot.ParticipantId == p.Id
                && snapshot.TenantId == p.TenantId
                && snapshot.DocumentHash != ""
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
                    && evidence.Status == "Verified"
                    && evidence.IsAuthorisedRepresentative
                    && evidence.ConsentToElectronicMethod
                    && evidence.IntendsToSign
                    && evidence.DocumentWasDisplayed
                    && evidence.EvidenceHash != "")));
}
