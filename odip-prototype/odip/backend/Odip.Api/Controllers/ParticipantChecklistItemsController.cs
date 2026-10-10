using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Api.Controllers;

/// <summary>
/// INTAKE-03/04 — the answer rules for a participant's structured Community Access checklist grid
/// (<see cref="ParticipantChecklistItem"/>): a FIXED enumerated set, one row per
/// <see cref="ChecklistItemType"/> (21 values). The wizard's submissions go through
/// <see cref="ParticipantsController.UpsertChecklistItemsAsync"/> via <see cref="ApplyAnswer"/>, and the
/// participant detail reads all twenty-one through <see cref="MaterializeAll"/>. The class no longer has routes
/// (the nested GET/PUT checklist-items endpoints had no caller); these helpers stay until the ApplyAnswer rules
/// are merged into one place.
/// </summary>
public static class ParticipantChecklistItemsController
{
    /// <summary>Sets a checklist row's answer — same "no separate audit timestamp" shape as ParticipantAdlAssessment.ApplyAnswer.</summary>
    internal static void ApplyAnswer(ParticipantChecklistItem row, ChecklistItemValue? value, string? notes)
    {
        row.Value = value;
        row.Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        row.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Every <see cref="ChecklistItemType"/>, in declaration order (Community Mobility &amp;
    /// Transport Risk first, then Community Behaviours of Concern — see <see cref="ChecklistItemTypeGroups"/>),
    /// backed by <paramref name="existingRows"/> where a row exists and a synthesized (Id = null,
    /// Value = null) placeholder otherwise.</summary>
    internal static List<ParticipantChecklistItemDto> MaterializeAll(Guid participantId, List<ParticipantChecklistItem> existingRows)
    {
        var byType = existingRows.ToDictionary(a => a.ItemType);
        return Enum.GetValues<ChecklistItemType>()
            .Select(t => byType.TryGetValue(t, out var row)
                ? ToDto(row)
                : new ParticipantChecklistItemDto { ParticipantId = participantId, ItemType = t })
            .ToList();
    }

    private static ParticipantChecklistItemDto ToDto(ParticipantChecklistItem a) => new()
    {
        Id = a.Id,
        ParticipantId = a.ParticipantId,
        ItemType = a.ItemType,
        Value = a.Value,
        Notes = a.Notes,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt,
    };
}
