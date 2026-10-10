using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Api.Controllers;

/// <summary>
/// INTAKE-03/04 — helpers for a participant's structured Community Access checklist grid
/// (<see cref="ParticipantChecklistItem"/>): a FIXED enumerated set, one row per
/// <see cref="ChecklistItemType"/> (21 values). The participant detail reads all twenty-one through
/// <see cref="MaterializeAll"/>. The class no longer has routes (the nested GET/PUT checklist-items endpoints had
/// no caller). The wizard's save writes these rows through ParticipantPatchApplier.UpsertChecklistItemsAsync, which
/// applies each answer with <see cref="Odip.Infrastructure.Services.ParticipantGridRules"/>.
/// </summary>
public static class ParticipantChecklistItemsController
{
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
