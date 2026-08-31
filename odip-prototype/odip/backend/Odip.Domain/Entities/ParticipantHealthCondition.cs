using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// INTAKE sub-wave C1 — one row per <see cref="Enums.HealthConditionType"/>, the Participant
/// Profile source form's structured "Diagnoses &amp; Medical Conditions" table (research spec
/// §1c-8/§4.6, Master Data Dictionary MED-002..011). Same fixed-enumerated-set shape as
/// <see cref="ParticipantConsent"/> — one row per type, GET always materializes all ten with an
/// unanswered placeholder for any type with no row yet (see
/// ParticipantHealthConditionsController.GetForParticipant), created/updated transactionally with
/// the participant (ParticipantsController.UpsertHealthConditionsAsync, copying
/// UpsertConsentsAsync's documented load-bearing empty/null guard).
///
/// Field shape is the Yes/No + severity + plan-provided + training-required pattern the research
/// spec's §5 gives for this domain (deliberately NOT the illegible "Y N N" 3-column checkbox
/// header flagged as ambiguous in the spec's §6 item 1, and NOT the unnamed/dotted condition-plan
/// row flagged in §6 item 2 — see this PR's report). <see cref="Severity"/> is free text, not a
/// shared enum: the source form uses a DIFFERENT severity vocabulary per condition (Intellectual
/// Disability: Mild/Mod/Severe/ABI; Visual/Hearing Impairment: None/Mild/Mod/Profound; Epilepsy:
/// Petit/Absence/GrandMal frequency; Diabetes: Type1/Type2) — collapsing ten different
/// vocabularies into one shared enum would misrepresent the source, and the spec explicitly warns
/// against inventing a scale it doesn't support.
///
/// RECONCILIATION with DIAG-01 (research spec §5, this PR's brief): this grid is support-planning
/// detail — WHICH conditions need a support plan, how severe, whether a plan/training exists — not
/// a replacement for <see cref="Participant.PrimaryDiagnosis"/>/<see cref="Participant.OtherDiagnoses"/>,
/// which remain the participant's clinical diagnosis labels (free text, curated-picklist-plus-
/// other, DIAG-01). A participant can have a diagnosis with no corresponding support-planning row
/// yet (grid unanswered), or a support-planning row with <see cref="Has"/> false even though a
/// diagnosis is recorded (diagnosed but not currently needing this support). The two are
/// deliberately NOT merged into one field/table.
///
/// EPILEPSY DERIVATION — wired ONE WAY, grid does not auto-set diagnoses: an Epilepsy diagnosis
/// (PrimaryDiagnosis or any OtherDiagnoses entry) pre-selects this grid's Epilepsy row's
/// <see cref="Has"/> to true as a DEFAULT (not a lock), via the exact same transition-only/
/// user-override-survives/edit-mode-safe `useDeriveFieldValues` contract DIAG-02's HIDPA
/// derivation already uses on the frontend (src/lib/conditionalFields.ts) — see
/// ParticipantCreatePage.tsx's FIELD_DERIVATIONS for the wiring. The reverse (ticking this grid's
/// Epilepsy row does NOT add an Epilepsy diagnosis) is deliberately not implemented: the grid
/// answers "does support planning need an Epilepsy plan", the diagnosis field answers "is Epilepsy
/// a clinical diagnosis" — a coordinator ticking the support-planning row is not asserting a new
/// clinical diagnosis, so driving that back onto PrimaryDiagnosis/OtherDiagnoses would put words in
/// the diagnosis field the source form never puts there. Backend has no special-casing for this
/// rule either direction; it just stores whatever the client submits, same as DIAG-02.
/// </summary>
public class ParticipantHealthCondition : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public HealthConditionType ConditionType { get; set; }

    /// <summary>Tri-state: null = not yet answered, true = has this condition/support need, false = does not.</summary>
    public bool? Has { get; set; }

    /// <summary>
    /// Free text — see this type's doc comment for why a shared enum across all ten condition
    /// types would misrepresent the source form's per-condition severity vocabularies.
    /// </summary>
    public string? Severity { get; set; }

    /// <summary>Tri-state: whether a support/management plan is in place for this condition.</summary>
    public bool? PlanProvided { get; set; }

    /// <summary>Tri-state: whether staff training is required to support this condition.</summary>
    public bool? TrainingRequired { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
