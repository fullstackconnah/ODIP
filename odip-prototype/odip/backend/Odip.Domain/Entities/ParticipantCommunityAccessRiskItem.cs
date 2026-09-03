using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// PF-10.2 (SPEC-05 <c>docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md</c>),
/// CommunityAccessDailyLiving service-stream variant — one row per
/// <see cref="Enums.CommunityAccessRiskItemType"/> (22 values across three categories: Road &amp;
/// Traffic Safety, Behaviours of Concern, Health &amp; Personal Safety), the Community Access
/// variant document's §10 "Community Access Risk Assessment" itemised rating matrix (research spec
/// §10). Same fixed-enumerated-set shape as <see cref="ParticipantAdlAssessment"/>/
/// <see cref="ParticipantChecklistItem"/> — one row per type, GET always materializes all
/// twenty-two with an unanswered placeholder for any type with no row yet (see
/// ParticipantCommunityAccessRiskItemsController.GetForParticipant), created/updated
/// transactionally with the participant
/// (ParticipantsController.UpsertCommunityAccessRiskItemsAsync, copying
/// UpsertChecklistItemsAsync's documented load-bearing empty/null guard again).
///
/// GENUINELY A DIFFERENT SHAPE FROM <see cref="ParticipantChecklistItem"/>: that entity's
/// <see cref="ParticipantChecklistItem.Value"/> is a tri-state Yes/No/N-A checkbox answer. This
/// entity's <see cref="Rating"/> is a Low/Medium/High/Critical severity rating (reusing
/// <see cref="Enums.RiskRatingLevel"/>, already shared by <see cref="Participant.FallsRiskRating"/>/
/// <see cref="Participant.BehaviourRiskRating"/> per that enum's own doc comment inviting reuse),
/// paired with a free-text <see cref="StrategyNotes"/> per item — a rated register, not a
/// checklist. It is also NOT the same tool as <see cref="ParticipantRiskEntry"/> (INTAKE-09's
/// lighter at-risk-party/description/mitigation register) — see that entity's own
/// documentMapping.ts note for the "not yet built" flag this entity now resolves.
///
/// CATEGORY IS DERIVED, NOT STORED: a single <see cref="Enums.CommunityAccessRiskItemType"/> enum
/// with a fixed declaration order (Road &amp; Traffic Safety, then Behaviours of Concern, then
/// Health &amp; Personal Safety — see <see cref="Enums.CommunityAccessRiskItemTypeGroups"/>) keeps
/// the controller/materialization code identical to ParticipantChecklistItem's proven pattern,
/// rather than persisting a redundant column that could drift out of sync with the enum ordering.
///
/// The matrix's 23rd rated value — an overall, non-itemised Community Access risk rating — is NOT
/// a row here: it lives directly on <see cref="Participant.OverallCommunityAccessRiskRating"/>
/// (single scalar value, not part of this fixed-enumerated-set collection).
/// </summary>
public class ParticipantCommunityAccessRiskItem : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public CommunityAccessRiskItemType ItemType { get; set; }

    /// <summary>Nullable: null = not yet rated. See <see cref="Enums.RiskRatingLevel"/>'s doc.</summary>
    public RiskRatingLevel? Rating { get; set; }

    /// <summary>Free-text "Support/Strategy" note per item, per the source form's column of the same name.</summary>
    public string? StrategyNotes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
