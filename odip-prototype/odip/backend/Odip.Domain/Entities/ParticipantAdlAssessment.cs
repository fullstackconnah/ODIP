using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// INTAKE sub-wave C2 — one row per <see cref="Enums.AdlType"/> (20 values: 6 Personal + 14
/// Community/Domestic ADLs), the Participant Profile source form's "Personal Activities of Daily
/// Living" (§1c-15) and "Community and Domestic ADL" (§1c-17) tables (research spec §4.9, Master
/// Data Dictionary PADL-002..007/CADL-001..015). Exact same fixed-enumerated-set shape as
/// <see cref="ParticipantHealthCondition"/> (INTAKE sub-wave C1) — one row per type, GET always
/// materializes all twenty with an unanswered placeholder for any type with no row yet (see
/// ParticipantAdlAssessmentsController.GetForParticipant), created/updated transactionally with the
/// participant (ParticipantsController.UpsertAdlAssessmentsAsync, copying
/// UpsertHealthConditionsAsync's documented load-bearing empty/null guard again).
///
/// CATEGORY IS DERIVED, NOT STORED: unlike splitting this into two entities/tables, a single
/// <see cref="Enums.AdlType"/> enum with a fixed declaration order (Personal first, then Community/
/// Domestic — see <see cref="Enums.AdlTypeGroups"/>) keeps the controller/materialization code
/// identical to ParticipantHealthCondition's proven pattern. The wizard/detail-page grid still
/// renders as two visually grouped sections by asking AdlTypeGroups which group a type belongs to,
/// rather than persisting a redundant column that could drift out of sync with the enum ordering.
///
/// I/S/A/F SCALE: <see cref="Level"/> uses <see cref="Enums.AdlLevel"/> — see that enum's doc for
/// why "Independent/Supervision/Assistance/FullSupport" is this PR's plain-English reading of the
/// source form's unexpanded "I/S/A/F" column headers, flagged as an assumption rather than a
/// confirmed source-document expansion.
///
/// FUTURE EXTENSION (INTAKE-03, next PR): the Community Access service-stream variant adds a
/// per-ADL "how to help me" free-text instruction column to this same table (research spec §3).
/// <see cref="Notes"/> is deliberately the landing spot for that later addition (rather than a new
/// column) so it arrives as an additive migration with no reshaping of this entity — do not repurpose
/// Notes for anything narrower than "free-text elaboration for this row" in the meantime.
/// </summary>
public class ParticipantAdlAssessment : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public AdlType AdlType { get; set; }

    /// <summary>Nullable: null = not yet assessed. See <see cref="Enums.AdlLevel"/>'s doc for the I/S/A/F source labels this expands.</summary>
    public AdlLevel? Level { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
