using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// PARTICIPANT CHECKLIST ITEM DTOs (INTAKE-03/04, CommunityAccessDailyLiving stream)
// ══════════════════════════════════════════════════════════════

/// <summary>
/// <see cref="Id"/> is null for a synthesized "not yet assessed" placeholder row — see
/// ParticipantChecklistItemsController.MaterializeAll, which returns exactly one entry per
/// <see cref="ChecklistItemType"/> regardless of whether a database row exists yet. Same shape as
/// <see cref="ParticipantAdlAssessmentDto"/> (INTAKE sub-wave C2).
/// </summary>
public record ParticipantChecklistItemDto
{
    public Guid? Id { get; init; }
    public Guid ParticipantId { get; init; }
    public ChecklistItemType ItemType { get; init; }
    public ChecklistItemValue? Value { get; init; }
    public string? Notes { get; init; }
    public DateTime? CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
}

/// <summary>
/// Shape used both by <see cref="CreateParticipantDto.ChecklistItems"/> (rows submitted alongside a
/// new or drafted participant — see ParticipantsController.UpsertChecklistItemsAsync). The wizard always
/// submits all twenty-one <see cref="ChecklistItemType"/> entries (a fixed enumerated set, not a
/// repeatable add/remove list).
/// </summary>
public record CreateParticipantChecklistItemDto
{
    public ChecklistItemType ItemType { get; init; }
    public ChecklistItemValue? Value { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
}
