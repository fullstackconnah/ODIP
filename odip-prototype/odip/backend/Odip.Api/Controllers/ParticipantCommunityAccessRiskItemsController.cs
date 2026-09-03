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
/// PF-10.2 — nested CRUD for a participant's structured Community Access Risk Assessment matrix
/// (<see cref="ParticipantCommunityAccessRiskItem"/>). Mirrors
/// <see cref="ParticipantChecklistItemsController"/> exactly: a FIXED enumerated set — one row per
/// <see cref="CommunityAccessRiskItemType"/> (22 values) — so there is no Create/Delete here, only
/// Get (always all twenty-two, synthesizing an unrated placeholder for any type with no row yet)
/// and an upsert-by-type endpoint. This is the write path for ongoing edits from the participant
/// detail page; the wizard's initial/draft submissions instead go through
/// <see cref="ParticipantsController.UpsertCommunityAccessRiskItemsAsync"/>, sharing the same
/// upsert semantics via <see cref="ApplyAnswer"/>.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantCommunityAccessRiskItemsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantCommunityAccessRiskItemsController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/community-access-risk-items")]
    public async Task<ActionResult<ApiResponse<List<ParticipantCommunityAccessRiskItemDto>>>> GetForParticipant(Guid participantId, CancellationToken ct)
    {
        var participantExists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participantExists) return NotFound(ApiResponse<List<ParticipantCommunityAccessRiskItemDto>>.Fail("Participant not found"));

        var existing = await _db.ParticipantCommunityAccessRiskItems.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        return Ok(ApiResponse<List<ParticipantCommunityAccessRiskItemDto>>.Ok(MaterializeAll(participantId, existing)));
    }

    [HttpPut("participants/{participantId:guid}/community-access-risk-items/{itemType}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantCommunityAccessRiskItemDto>>> Upsert(
        Guid participantId, string itemType, [FromBody] UpsertParticipantCommunityAccessRiskItemDto dto, CancellationToken ct)
    {
        if (!Enum.TryParse<CommunityAccessRiskItemType>(itemType, ignoreCase: true, out var type))
            return BadRequest(ApiResponse<ParticipantCommunityAccessRiskItemDto>.Fail("Unrecognised community access risk item type."));

        var participant = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participant) return NotFound(ApiResponse<ParticipantCommunityAccessRiskItemDto>.Fail("Participant not found"));

        var row = await _db.ParticipantCommunityAccessRiskItems.FirstOrDefaultAsync(a => a.ParticipantId == participantId && a.ItemType == type, ct);
        if (row == null)
        {
            row = new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = type };
            _db.ParticipantCommunityAccessRiskItems.Add(row);
        }

        ApplyAnswer(row, dto.Rating, dto.StrategyNotes);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantCommunityAccessRiskItemDto>.Ok(ToDto(row)));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>Sets a risk-item row's answer — same "no separate audit timestamp" shape as ParticipantChecklistItem.ApplyAnswer.</summary>
    internal static void ApplyAnswer(ParticipantCommunityAccessRiskItem row, RiskRatingLevel? rating, string? strategyNotes)
    {
        row.Rating = rating;
        row.StrategyNotes = string.IsNullOrWhiteSpace(strategyNotes) ? null : strategyNotes.Trim();
        row.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Every <see cref="CommunityAccessRiskItemType"/>, in declaration order (Road &amp;
    /// Traffic Safety first, then Behaviours of Concern, then Health &amp; Personal Safety — see
    /// <see cref="CommunityAccessRiskItemTypeGroups"/>), backed by <paramref name="existingRows"/>
    /// where a row exists and a synthesized (Id = null, Rating = null) placeholder otherwise.</summary>
    internal static List<ParticipantCommunityAccessRiskItemDto> MaterializeAll(Guid participantId, List<ParticipantCommunityAccessRiskItem> existingRows)
    {
        var byType = existingRows.ToDictionary(a => a.ItemType);
        return Enum.GetValues<CommunityAccessRiskItemType>()
            .Select(t => byType.TryGetValue(t, out var row)
                ? ToDto(row)
                : new ParticipantCommunityAccessRiskItemDto { ParticipantId = participantId, ItemType = t })
            .ToList();
    }

    private static ParticipantCommunityAccessRiskItemDto ToDto(ParticipantCommunityAccessRiskItem a) => new()
    {
        Id = a.Id,
        ParticipantId = a.ParticipantId,
        ItemType = a.ItemType,
        Rating = a.Rating,
        StrategyNotes = a.StrategyNotes,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt,
    };
}
