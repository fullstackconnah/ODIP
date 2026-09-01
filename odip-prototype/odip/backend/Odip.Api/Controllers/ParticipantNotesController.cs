using System.Security.Claims;
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
/// Free-text notes about a participant — e.g. personal-care preferences or general
/// observations. No DELETE endpoint anywhere here — a note is retired via
/// <see cref="ParticipantNote.IsArchived"/> rather than removed (record retention).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantNotesController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly SafetyNoteSyncService _safetyNoteSync;
    public ParticipantNotesController(OdipDbContext db, SafetyNoteSyncService safetyNoteSync)
    {
        _db = db;
        _safetyNoteSync = safetyNoteSync;
    }

    [HttpGet("participants/{participantId:guid}/notes")]
    public async Task<ActionResult<ApiResponse<List<ParticipantNoteDto>>>> GetForParticipant(
        Guid participantId, [FromQuery] bool includeArchived = false, CancellationToken ct = default)
    {
        // PD-5 item 5d: bounded read-time reconciliation safety net — see
        // SafetyNoteSyncService.ReconcileForParticipantAsync's doc for why this can't turn this
        // endpoint into an N+1 or a write-on-every-read.
        await _safetyNoteSync.ReconcileForParticipantAsync(participantId, ct);
        await _db.SaveChangesAsync(ct);

        var query = _db.ParticipantNotes.Where(n => n.ParticipantId == participantId);
        if (!includeArchived)
            query = query.Where(n => !n.IsArchived);

        var items = await query
            .OrderByDescending(n => n.IsPinned)
            .ThenByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        var result = items.Select(ToDto).ToList();
        return Ok(ApiResponse<List<ParticipantNoteDto>>.Ok(result));
    }

    [HttpPost("participants/{participantId:guid}/notes")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantNoteDto>>> Create(
        Guid participantId, [FromBody] CreateParticipantNoteDto dto, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant == null) return NotFound(ApiResponse<ParticipantNoteDto>.Fail("Participant not found"));

        var note = new ParticipantNote
        {
            Id = Guid.NewGuid(),
            ParticipantId = participantId,
            Title = dto.Title,
            Description = dto.Description,
            IsPinned = dto.IsPinned,
            CreatedByName = GetCreatedByName(),
        };
        _db.ParticipantNotes.Add(note);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantNoteDto>.Ok(ToDto(note)));
    }

    [HttpPut("participants/notes/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantNoteDto>>> Update(
        Guid id, [FromBody] UpdateParticipantNoteDto dto, CancellationToken ct)
    {
        var note = await _db.ParticipantNotes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note == null) return NotFound(ApiResponse<ParticipantNoteDto>.Fail("Note not found"));

        note.Title = dto.Title;
        note.Description = dto.Description;
        note.IsPinned = dto.IsPinned;
        note.IsArchived = dto.IsArchived;
        note.UpdatedAt = DateTime.UtcNow;

        // PD-5: any human-initiated save on an auto-generated note (SourceKey != null) — title
        // only, description only, or both — permanently detaches it from the sync going forward.
        // Archiving a note (confirmArchive routes through this same Update call) also counts.
        if (note.SourceKey != null)
            note.IsManuallyEdited = true;

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantNoteDto>.Ok(ToDto(note)));
    }

    /// <summary>PD-5: "Dismiss" — acknowledges source drift without touching the note's text.</summary>
    [HttpPut("participants/notes/{id:guid}/dismiss-drift")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantNoteDto>>> DismissDrift(Guid id, CancellationToken ct)
    {
        var note = await _db.ParticipantNotes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note == null) return NotFound(ApiResponse<ParticipantNoteDto>.Fail("Note not found"));

        var ok = await _safetyNoteSync.DismissDriftAsync(note, ct);
        if (!ok) return NotFound(ApiResponse<ParticipantNoteDto>.Fail("Note is not an auto-generated note"));

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantNoteDto>.Ok(ToDto(note)));
    }

    /// <summary>PD-5: "Regenerate" — restores machine-generated text and re-arms auto-sync.</summary>
    [HttpPut("participants/notes/{id:guid}/regenerate")]
    [Authorize(Roles = "Admin,Coordinator,SupportWorker,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantNoteDto>>> Regenerate(Guid id, CancellationToken ct)
    {
        var note = await _db.ParticipantNotes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note == null) return NotFound(ApiResponse<ParticipantNoteDto>.Fail("Note not found"));

        var ok = await _safetyNoteSync.RegenerateAsync(note, ct);
        if (!ok) return NotFound(ApiResponse<ParticipantNoteDto>.Fail("Note is not an auto-generated note"));

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantNoteDto>.Ok(ToDto(note)));
    }

    // ── Helpers ────────────────────────────────────────────────────

    private string GetCreatedByName() =>
        User?.FindFirst("fullName")?.Value
        ?? User?.FindFirst(ClaimTypes.Name)?.Value
        ?? "Unknown";

    private static ParticipantNoteDto ToDto(ParticipantNote n) => new()
    {
        Id = n.Id,
        ParticipantId = n.ParticipantId,
        Title = n.Title,
        Description = n.Description,
        IsPinned = n.IsPinned,
        IsArchived = n.IsArchived,
        CreatedByName = n.CreatedByName,
        CreatedAt = n.CreatedAt,
        UpdatedAt = n.UpdatedAt,
        SourceKey = n.SourceKey,
        HasSourceDrift = n.HasSourceDrift,
    };
}
