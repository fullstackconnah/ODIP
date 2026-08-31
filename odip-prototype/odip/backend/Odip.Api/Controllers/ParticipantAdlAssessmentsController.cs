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
/// INTAKE sub-wave C2 — nested CRUD for a participant's structured ADL rating grid
/// (<see cref="ParticipantAdlAssessment"/>). Mirrors <see cref="ParticipantHealthConditionsController"/>
/// exactly: a FIXED enumerated set — one row per <see cref="AdlType"/> (20 values) — so there is no
/// Create/Delete here, only Get (always all twenty, synthesizing an unanswered placeholder for any
/// type with no row yet) and an upsert-by-type endpoint. This is the write path for ongoing edits
/// from the participant detail page; the wizard's initial/draft submissions instead go through
/// <see cref="ParticipantsController.UpsertAdlAssessmentsAsync"/>, sharing the same upsert semantics
/// via <see cref="ApplyAnswer"/>.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantAdlAssessmentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantAdlAssessmentsController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/adl-assessments")]
    public async Task<ActionResult<ApiResponse<List<ParticipantAdlAssessmentDto>>>> GetForParticipant(Guid participantId, CancellationToken ct)
    {
        var participantExists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participantExists) return NotFound(ApiResponse<List<ParticipantAdlAssessmentDto>>.Fail("Participant not found"));

        var existing = await _db.ParticipantAdlAssessments.Where(a => a.ParticipantId == participantId).ToListAsync(ct);
        return Ok(ApiResponse<List<ParticipantAdlAssessmentDto>>.Ok(MaterializeAll(participantId, existing)));
    }

    [HttpPut("participants/{participantId:guid}/adl-assessments/{adlType}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantAdlAssessmentDto>>> Upsert(
        Guid participantId, string adlType, [FromBody] UpsertParticipantAdlAssessmentDto dto, CancellationToken ct)
    {
        if (!Enum.TryParse<AdlType>(adlType, ignoreCase: true, out var type))
            return BadRequest(ApiResponse<ParticipantAdlAssessmentDto>.Fail("Unrecognised ADL type."));

        var participant = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participant) return NotFound(ApiResponse<ParticipantAdlAssessmentDto>.Fail("Participant not found"));

        var row = await _db.ParticipantAdlAssessments.FirstOrDefaultAsync(a => a.ParticipantId == participantId && a.AdlType == type, ct);
        if (row == null)
        {
            row = new ParticipantAdlAssessment { Id = Guid.NewGuid(), ParticipantId = participantId, AdlType = type };
            _db.ParticipantAdlAssessments.Add(row);
        }

        ApplyAnswer(row, dto.Level, dto.Notes);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantAdlAssessmentDto>.Ok(ToDto(row)));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>Sets an ADL row's answer — same "no separate audit timestamp" shape as ParticipantHealthCondition.ApplyAnswer.</summary>
    internal static void ApplyAnswer(ParticipantAdlAssessment row, AdlLevel? level, string? notes)
    {
        row.Level = level;
        row.Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        row.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Every <see cref="AdlType"/>, in declaration order (Personal ADLs first, then Community/Domestic —
    /// see <see cref="AdlTypeGroups"/>), backed by <paramref name="existingRows"/> where a row exists and a
    /// synthesized (Id = null, Level = null) placeholder otherwise.</summary>
    internal static List<ParticipantAdlAssessmentDto> MaterializeAll(Guid participantId, List<ParticipantAdlAssessment> existingRows)
    {
        var byType = existingRows.ToDictionary(a => a.AdlType);
        return Enum.GetValues<AdlType>()
            .Select(t => byType.TryGetValue(t, out var row)
                ? ToDto(row)
                : new ParticipantAdlAssessmentDto { ParticipantId = participantId, AdlType = t })
            .ToList();
    }

    private static ParticipantAdlAssessmentDto ToDto(ParticipantAdlAssessment a) => new()
    {
        Id = a.Id,
        ParticipantId = a.ParticipantId,
        AdlType = a.AdlType,
        Level = a.Level,
        Notes = a.Notes,
        // INTAKE-03, CommunityAccessDailyLiving stream-specific — read-only here; no write path
        // yet (Create/Upsert DTOs deliberately unchanged, see ParticipantAdlAssessment.HowToHelpNotes's doc).
        HowToHelpNotes = a.HowToHelpNotes,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt,
    };
}
