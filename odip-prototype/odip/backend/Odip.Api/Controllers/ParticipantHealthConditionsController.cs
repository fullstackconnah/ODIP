using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// INTAKE sub-wave C1 — nested CRUD for a participant's structured health-condition grid
/// (<see cref="ParticipantHealthCondition"/>). Mirrors <see cref="ParticipantConsentsController"/>
/// exactly: a FIXED enumerated set — one row per <see cref="HealthConditionType"/> — so there is no
/// Create/Delete here, only Get (always all ten, synthesizing an unanswered placeholder for any
/// type with no row yet) and an upsert-by-type endpoint. This is the write path for ongoing edits
/// from the participant detail page; the wizard's initial/draft submissions instead go through
/// <see cref="ParticipantsController.UpsertHealthConditionsAsync"/>, sharing the same upsert
/// semantics via <see cref="ParticipantGridRules"/>.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantHealthConditionsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantHealthConditionsController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/health-conditions")]
    public async Task<ActionResult<ApiResponse<List<ParticipantHealthConditionDto>>>> GetForParticipant(Guid participantId, CancellationToken ct)
    {
        var participantExists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participantExists) return NotFound(ApiResponse<List<ParticipantHealthConditionDto>>.Fail("Participant not found"));

        var existing = await _db.ParticipantHealthConditions.Where(c => c.ParticipantId == participantId).ToListAsync(ct);
        return Ok(ApiResponse<List<ParticipantHealthConditionDto>>.Ok(MaterializeAll(participantId, existing)));
    }

    [HttpPut("participants/{participantId:guid}/health-conditions/{conditionType}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantHealthConditionDto>>> Upsert(
        Guid participantId, string conditionType, [FromBody] UpsertParticipantHealthConditionDto dto, CancellationToken ct)
    {
        if (!Enum.TryParse<HealthConditionType>(conditionType, ignoreCase: true, out var type))
            return BadRequest(ApiResponse<ParticipantHealthConditionDto>.Fail("Unrecognised health condition type."));

        var participant = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participant) return NotFound(ApiResponse<ParticipantHealthConditionDto>.Fail("Participant not found"));

        var row = await _db.ParticipantHealthConditions.FirstOrDefaultAsync(c => c.ParticipantId == participantId && c.ConditionType == type, ct);
        if (row == null)
        {
            row = new ParticipantHealthCondition { Id = Guid.NewGuid(), ParticipantId = participantId, ConditionType = type };
            _db.ParticipantHealthConditions.Add(row);
        }

        ParticipantGridRules.ApplyAnswer(row, dto.Has, dto.Severity, dto.PlanProvided, dto.TrainingRequired, dto.Notes);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantHealthConditionDto>.Ok(ToDto(row)));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>Every <see cref="HealthConditionType"/>, in declaration order, backed by <paramref name="existingRows"/>
    /// where a row exists and a synthesized (Id = null, Has = null) placeholder otherwise.</summary>
    internal static List<ParticipantHealthConditionDto> MaterializeAll(Guid participantId, List<ParticipantHealthCondition> existingRows)
    {
        var byType = existingRows.ToDictionary(c => c.ConditionType);
        return Enum.GetValues<HealthConditionType>()
            .Select(t => byType.TryGetValue(t, out var row)
                ? ToDto(row)
                : new ParticipantHealthConditionDto { ParticipantId = participantId, ConditionType = t })
            .ToList();
    }

    private static ParticipantHealthConditionDto ToDto(ParticipantHealthCondition c) => new()
    {
        Id = c.Id,
        ParticipantId = c.ParticipantId,
        ConditionType = c.ConditionType,
        Has = c.Has,
        Severity = c.Severity,
        PlanProvided = c.PlanProvided,
        TrainingRequired = c.TrainingRequired,
        Notes = c.Notes,
        CreatedAt = c.CreatedAt,
        UpdatedAt = c.UpdatedAt,
    };
}
