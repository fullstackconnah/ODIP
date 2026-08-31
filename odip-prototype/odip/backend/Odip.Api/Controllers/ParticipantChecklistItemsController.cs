using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// INTAKE-03/04 — nested CRUD for a participant's structured Community Access checklist grid
/// (<see cref="ParticipantChecklistItem"/>). Mirrors <see cref="ParticipantAdlAssessmentsController"/>
/// exactly: a FIXED enumerated set — one row per <see cref="ChecklistItemType"/> (21 values) — so
/// there is no Create/Delete here, only Get (always all twenty-one, synthesizing an unanswered
/// placeholder for any type with no row yet) and an upsert-by-type endpoint. This is the write path
/// for ongoing edits from the participant detail page; the wizard's initial/draft submissions
/// instead go through <see cref="ParticipantsController.UpsertChecklistItemsAsync"/>, sharing the
/// same upsert semantics via <see cref="ApplyAnswer"/>.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantChecklistItemsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantChecklistItemsController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/checklist-items")]
    public async Task<ActionResult<ApiResponse<List<ParticipantChecklistItemDto>>>> GetForParticipant(Guid participantId, CancellationToken ct)
    {
        var participantExists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participantExists) return NotFound(ApiResponse<List<ParticipantChecklistItemDto>>.Fail("Participant not found"));

        var existing = await _db.ParticipantChecklistItems.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        return Ok(ApiResponse<List<ParticipantChecklistItemDto>>.Ok(MaterializeAll(participantId, existing)));
    }

    [HttpPut("participants/{participantId:guid}/checklist-items/{itemType}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantChecklistItemDto>>> Upsert(
        Guid participantId, string itemType, [FromBody] UpsertParticipantChecklistItemDto dto, CancellationToken ct)
    {
        if (!Enum.TryParse<ChecklistItemType>(itemType, ignoreCase: true, out var type))
            return BadRequest(ApiResponse<ParticipantChecklistItemDto>.Fail("Unrecognised checklist item type."));

        var participant = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participant) return NotFound(ApiResponse<ParticipantChecklistItemDto>.Fail("Participant not found"));

        var row = await _db.ParticipantChecklistItems.FirstOrDefaultAsync(a => a.ParticipantId == participantId && a.ItemType == type, ct);
        if (row == null)
        {
            row = new ParticipantChecklistItem { Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = type };
            _db.ParticipantChecklistItems.Add(row);
        }

        ApplyAnswer(row, dto.Value, dto.Notes);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantChecklistItemDto>.Ok(ToDto(row)));
    }

    // ── Helpers ────────────────────────────────────────────────────

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
