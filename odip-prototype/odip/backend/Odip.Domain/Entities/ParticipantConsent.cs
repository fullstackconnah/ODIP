using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// INTAKE sub-wave B — a single consent decision for a participant, one row per
/// <see cref="ConsentType"/> (research spec §4.5/§1c-19 "Consent and Terms": photo/video, alcohol,
/// OTC/paracetamol medication, emergency medical treatment, privacy collection, travel insurance
/// acceptance, and the general Terms &amp; Conditions acceptance). Compliance-adjacent — modelled
/// as its own child entity rather than flat <see cref="Participant"/> columns (per this PR's
/// brief), auditable via <see cref="CreatedAt"/>/<see cref="UpdatedAt"/> like every other register
/// row in this codebase (c.f. <see cref="ParticipantRiskEntry"/>/<see cref="RestrictivePractice"/>).
///
/// <see cref="Granted"/> is a tri-state: null = not yet answered (the state every consent type
/// starts in), true = granted, false = explicitly declined — distinguishing "hasn't been asked
/// yet" from "was asked and said no" matters for a compliance record. <see cref="RecordedAt"/> is
/// stamped server-side whenever the answer actually changes (see ParticipantsController's
/// UpsertConsentsAsync / ParticipantConsentsController.Upsert), and cleared back to null if an
/// answer is cleared back to unanswered.
///
/// A participant normally has exactly one row per <see cref="ConsentType"/> (all seven created
/// transactionally with the participant — see ParticipantsController.Create/Update's
/// UpsertConsentsAsync call), but nothing in the schema enforces that at the database level beyond
/// a unique index on (ParticipantId, ConsentType) — see OdipDbContext. A pre-existing participant
/// from before this migration may have zero rows; ParticipantConsentsController.GetForParticipant
/// synthesizes an unanswered placeholder for any missing type rather than requiring a backfill.
///
/// No drawn-signature capture: <see cref="SignedByName"/> is a typed free-text name, not a
/// canvas/ink signature image — deferred, see this PR's report.
/// </summary>
public class ParticipantConsent : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public ConsentType ConsentType { get; set; }

    /// <summary>Tri-state: null = not yet answered, true = granted, false = declined.</summary>
    public bool? Granted { get; set; }

    /// <summary>When this consent was last (re-)answered — null while <see cref="Granted"/> is null.</summary>
    public DateTime? RecordedAt { get; set; }

    /// <summary>Typed (not drawn) signatory name. Not enforced server-side even when Granted is
    /// true — a caller may record the decision ahead of a formal signature pass.</summary>
    public string? SignedByName { get; set; }
    public DateOnly? SignedDate { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
