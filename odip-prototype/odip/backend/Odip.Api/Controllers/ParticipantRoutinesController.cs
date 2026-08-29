using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Per-day routines and shift-critical specifics for a participant — the things a support
/// worker must know/do on shift (e.g. a morning routine, a mealtime requirement). Unlike
/// <see cref="ParticipantNotesController"/> this is not a compliance record, so a DELETE
/// endpoint hard-removes rather than archiving.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantRoutinesController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantRoutinesController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/routines")]
    public async Task<ActionResult<ApiResponse<List<ParticipantRoutineDto>>>> GetForParticipant(
        Guid participantId, [FromQuery] bool includeInactive = false, CancellationToken ct = default)
    {
        var query = _db.ParticipantRoutines.Where(r => r.ParticipantId == participantId);
        if (!includeInactive)
            query = query.Where(r => r.IsActive);

        var items = await query
            .OrderByDescending(r => r.IsCritical)
            .ThenBy(r => r.DayOfWeek)
            .ThenBy(r => r.StartTime)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<ParticipantRoutineDto>>.Ok(items.Select(ToDto).ToList()));
    }

    [HttpPost("participants/{participantId:guid}/routines")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantRoutineDto>>> Create(
        Guid participantId, [FromBody] CreateParticipantRoutineDto dto, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant == null) return NotFound(ApiResponse<ParticipantRoutineDto>.Fail("Participant not found"));

        var routine = new ParticipantRoutine
        {
            Id = Guid.NewGuid(),
            ParticipantId = participantId,
            Title = dto.Title,
            Description = dto.Description,
            Category = dto.Category,
            DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime,
            EndTime = dto.EndTime,
            IsCritical = dto.IsCritical,
            IsActive = dto.IsActive,
        };
        _db.ParticipantRoutines.Add(routine);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantRoutineDto>.Ok(ToDto(routine)));
    }

    [HttpPut("participants/routines/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantRoutineDto>>> Update(
        Guid id, [FromBody] UpdateParticipantRoutineDto dto, CancellationToken ct)
    {
        var routine = await _db.ParticipantRoutines.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (routine == null) return NotFound(ApiResponse<ParticipantRoutineDto>.Fail("Routine not found"));

        routine.Title = dto.Title;
        routine.Description = dto.Description;
        routine.Category = dto.Category;
        routine.DayOfWeek = dto.DayOfWeek;
        routine.StartTime = dto.StartTime;
        routine.EndTime = dto.EndTime;
        routine.IsCritical = dto.IsCritical;
        routine.IsActive = dto.IsActive;
        routine.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantRoutineDto>.Ok(ToDto(routine)));
    }

    [HttpDelete("participants/routines/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var routine = await _db.ParticipantRoutines.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (routine == null) return NotFound(ApiResponse<bool>.Fail("Routine not found"));

        _db.ParticipantRoutines.Remove(routine);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // ── Helpers ────────────────────────────────────────────────────

    private static ParticipantRoutineDto ToDto(ParticipantRoutine r) => new()
    {
        Id = r.Id,
        ParticipantId = r.ParticipantId,
        Title = r.Title,
        Description = r.Description,
        Category = r.Category,
        DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime,
        EndTime = r.EndTime,
        IsCritical = r.IsCritical,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
    };
}
