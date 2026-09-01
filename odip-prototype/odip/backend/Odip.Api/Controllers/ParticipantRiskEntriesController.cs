using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// INTAKE-09 — potential risks in supporting a participant, categorised by who is at risk (the
/// participant, other participants, the public, or staff). Shape (routes, role gate, active/
/// inactive handling, hard-delete) deliberately mirrors <see cref="ParticipantRoutinesController"/>:
/// like routines, this is not a compliance record, so a DELETE endpoint hard-removes rather than
/// archiving. A new participant's risk rows are instead created transactionally via
/// <see cref="ParticipantsController.Create"/> (<see cref="CreateParticipantDto.RiskEntries"/>) —
/// this controller is the write path for everything after that, i.e. edit-mode.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantRiskEntriesController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    public ParticipantRiskEntriesController(OdipDbContext db, SafetyNoteSyncService safetyNoteSync)
    {
        _db = db;
        _safetyNoteSync = safetyNoteSync;
    }

    [HttpGet("participants/{participantId:guid}/risk-entries")]
    public async Task<ActionResult<ApiResponse<List<ParticipantRiskEntryDto>>>> GetForParticipant(
        Guid participantId, [FromQuery] bool includeInactive = false, CancellationToken ct = default)
    {
        var query = _db.ParticipantRiskEntries.Where(r => r.ParticipantId == participantId);
        if (!includeInactive)
            query = query.Where(r => r.IsActive);

        var items = await query
            .OrderBy(r => r.AtRiskParty)
            .ThenByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<ParticipantRiskEntryDto>>.Ok(items.Select(ToDto).ToList()));
    }

    [HttpPost("participants/{participantId:guid}/risk-entries")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantRiskEntryDto>>> Create(
        Guid participantId, [FromBody] CreateParticipantRiskEntryDto dto, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant == null) return NotFound(ApiResponse<ParticipantRiskEntryDto>.Fail("Participant not found"));

        var entry = new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(),
            ParticipantId = participantId,
            AtRiskParty = dto.AtRiskParty,
            Description = dto.Description.Trim(),
            MitigationNotes = string.IsNullOrWhiteSpace(dto.MitigationNotes) ? null : dto.MitigationNotes.Trim(),
            IsActive = dto.IsActive,
        };
        _db.ParticipantRiskEntries.Add(entry);
        // PD-5: closes the "ParticipantRiskEntry rows" hole for the ongoing (post-creation) create
        // path — same "sync-write in the same SaveChangesAsync" shape as RestrictivePracticesController.
        await _safetyNoteSync.SyncRiskEntryNotesAsync(participantId, ct);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantRiskEntryDto>.Ok(ToDto(entry)));
    }

    [HttpPut("participants/risk-entries/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantRiskEntryDto>>> Update(
        Guid id, [FromBody] UpdateParticipantRiskEntryDto dto, CancellationToken ct)
    {
        var entry = await _db.ParticipantRiskEntries.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (entry == null) return NotFound(ApiResponse<ParticipantRiskEntryDto>.Fail("Risk entry not found"));

        entry.AtRiskParty = dto.AtRiskParty;
        entry.Description = dto.Description.Trim();
        entry.MitigationNotes = string.IsNullOrWhiteSpace(dto.MitigationNotes) ? null : dto.MitigationNotes.Trim();
        entry.IsActive = dto.IsActive;
        entry.UpdatedAt = DateTime.UtcNow;

        // PD-5: closes the "ParticipantRiskEntry rows" hole for the ongoing edit path.
        await _safetyNoteSync.SyncRiskEntryNotesAsync(entry.ParticipantId, ct);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantRiskEntryDto>.Ok(ToDto(entry)));
    }

    [HttpDelete("participants/risk-entries/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var entry = await _db.ParticipantRiskEntries.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (entry == null) return NotFound(ApiResponse<bool>.Fail("Risk entry not found"));

        var participantId = entry.ParticipantId;
        _db.ParticipantRiskEntries.Remove(entry);
        // PD-5: closes the "ParticipantRiskEntry rows" hole for the delete path — deleting the
        // last active entry archives the risks/hazards auto-note (unless manually edited).
        await _safetyNoteSync.SyncRiskEntryNotesAsync(participantId, ct);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // ── Helpers ────────────────────────────────────────────────────

    private static ParticipantRiskEntryDto ToDto(ParticipantRiskEntry r) => new()
    {
        Id = r.Id,
        ParticipantId = r.ParticipantId,
        AtRiskParty = r.AtRiskParty,
        Description = r.Description,
        MitigationNotes = r.MitigationNotes,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
    };
}
