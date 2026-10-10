using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// INTAKE-03/04, CommunityAccessDailyLiving service-stream variant — one row per
/// <see cref="Enums.ChecklistItemType"/> (21 values: 9 Community Mobility &amp; Transport Risk +
/// 12 Community Behaviours of Concern), the Community Access variant document's Section 7 and
/// Section 8 checkbox lists (research spec §3). Exact same fixed-enumerated-set shape as
/// <see cref="ParticipantAdlAssessment"/> — one row per type, GET always materializes all
/// twenty-one with an unanswered placeholder for any type with no row yet (see
/// ParticipantChecklistItemsController.MaterializeAll), created/updated transactionally with
/// the participant (ParticipantsController.UpsertChecklistItemsAsync, copying
/// UpsertAdlAssessmentsAsync's documented load-bearing empty/null guard again).
///
/// CATEGORY IS DERIVED, NOT STORED: unlike splitting this into two entities/tables, a single
/// <see cref="Enums.ChecklistItemType"/> enum with a fixed declaration order (Community Mobility
/// &amp; Transport Risk first, then Community Behaviours of Concern — see
/// <see cref="Enums.ChecklistItemTypeGroups"/>) keeps the controller/materialization code
/// identical to ParticipantAdlAssessment's proven pattern. The wizard/detail-page grid still
/// renders as two visually grouped sections by asking ChecklistItemTypeGroups which group a type
/// belongs to, rather than persisting a redundant column that could drift out of sync with the
/// enum ordering.
///
/// TRI-STATE VALUE: <see cref="Value"/> uses <see cref="Enums.ChecklistItemValue"/> (No/Yes/
/// NotApplicable), null = not yet assessed — same nullable convention as
/// <see cref="ParticipantAdlAssessment.Level"/>.
///
/// This entity is deliberately separate from the free-text BOC fields on
/// <see cref="Participant"/> (BocTriggers/BocEarlyWarningSigns/BocDeEscalationStrategies/
/// BocWhatNotToDo) — those record narrative "how to support me" detail, while this checklist
/// records a structured Yes/No/N-A answer per named risk/behaviour item. Both are
/// CommunityAccessDailyLiving stream-specific; the conditional-visibility gating on which stream
/// sees this checklist happens in the frontend PR, not here.
/// </summary>
public class ParticipantChecklistItem : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public ChecklistItemType ItemType { get; set; }

    /// <summary>Nullable: null = not yet assessed. See <see cref="Enums.ChecklistItemValue"/>'s doc.</summary>
    public ChecklistItemValue? Value { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
