using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT COMMUNITY ACCESS RISK ITEM DTOs (PF-10.2, CommunityAccessDailyLiving stream)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// <see cref="Id"/> is null for a synthesized "not yet rated" placeholder row — see
/// ParticipantCommunityAccessRiskItemsController.GetForParticipant, which returns exactly one entry
/// per <see cref="CommunityAccessRiskItemType"/> regardless of whether a database row exists yet.
/// Same shape as <see cref="ParticipantChecklistItemDto"/>.
/// </summary>
public record ParticipantCommunityAccessRiskItemDto
{
    public Guid? Id { get; init; }
    public Guid ParticipantId { get; init; }
    public CommunityAccessRiskItemType ItemType { get; init; }
    public RiskRatingLevel? Rating { get; init; }
    public string? StrategyNotes { get; init; }
    public DateTime? CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// Shape used both by <see cref="CreateParticipantDto.CommunityAccessRiskItems"/> (rows submitted
/// alongside a new or drafted participant — see
/// ParticipantsController.UpsertCommunityAccessRiskItemsAsync) and by
/// ParticipantCommunityAccessRiskItemsController.Upsert's route-scoped single-row upsert. The
/// wizard always submits all twenty-two <see cref="CommunityAccessRiskItemType"/> entries (a fixed
/// enumerated set, not a repeatable add/remove list).
/// </summary>
public record CreateParticipantCommunityAccessRiskItemDto
{
    public CommunityAccessRiskItemType ItemType { get; init; }
    public RiskRatingLevel? Rating { get; init; }
    [StringLength(2000)]
    public string? StrategyNotes { get; init; }
}

/// <summary>Upsert payload for the detail-page nested edit endpoint — ParticipantId/ItemType come from the route.</summary>
public record UpsertParticipantCommunityAccessRiskItemDto
{
    public RiskRatingLevel? Rating { get; init; }
    [StringLength(2000)]
    public string? StrategyNotes { get; init; }
}
