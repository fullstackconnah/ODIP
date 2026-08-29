using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// The restrictive practices register for a participant — consolidates the previously fragmented
/// representation (<see cref="Participant.HasRestrictivePracticeFlag"/>,
/// <see cref="SupportProfile.RestrictivePracticeDetails"/>,
/// <see cref="ParticipantMedication.IsChemicalRestraint"/>) into typed, per-entry rows. CRUD
/// nested under participants, mirroring <see cref="ParticipantRoutinesController"/>'s shape.
/// Write actions are restricted to Admin/Coordinator/SuperAdmin — the same clinical/coordination
/// gate as medication management (<see cref="MedicationsController"/>), since a restrictive
/// practice entry carries authorisation/compliance information rather than shift-facing notes.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class RestrictivePracticesController : ControllerBase
{
    private readonly OdipDbContext _db;
    public RestrictivePracticesController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/restrictive-practices")]
    public async Task<ActionResult<ApiResponse<List<RestrictivePracticeDto>>>> GetForParticipant(
        Guid participantId, [FromQuery] bool includeInactive = false, CancellationToken ct = default)
    {
        var query = _db.RestrictivePractices
            .Include(rp => rp.RelatedMedication)
            .Where(rp => rp.ParticipantId == participantId);
        if (!includeInactive)
            query = query.Where(rp => rp.IsActive);

        var items = await query
            .OrderBy(rp => rp.ReviewDate)
            .ThenBy(rp => rp.Type)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<RestrictivePracticeDto>>.Ok(items.Select(ToDto).ToList()));
    }

    [HttpPost("participants/{participantId:guid}/restrictive-practices")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<RestrictivePracticeDto>>> Create(
        Guid participantId, [FromBody] CreateRestrictivePracticeDto dto, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant == null) return NotFound(ApiResponse<RestrictivePracticeDto>.Fail("Participant not found"));

        if (dto.RelatedMedicationId.HasValue)
        {
            var medicationError = await ValidateRelatedMedicationAsync(dto.RelatedMedicationId.Value, participantId, ct);
            if (medicationError != null) return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail(medicationError));
        }

        var practice = new RestrictivePractice
        {
            Id = Guid.NewGuid(),
            ParticipantId = participantId,
            Type = dto.Type,
            Description = dto.Description,
            AuthorisedBy = dto.AuthorisedBy,
            AuthorisationDate = dto.AuthorisationDate,
            ReviewDate = dto.ReviewDate,
            RelatedMedicationId = dto.RelatedMedicationId,
            IsActive = dto.IsActive,
        };
        _db.RestrictivePractices.Add(practice);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<RestrictivePracticeDto>.Ok(await ToDtoWithMedicationNameAsync(practice, ct)));
    }

    [HttpPut("participants/restrictive-practices/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<RestrictivePracticeDto>>> Update(
        Guid id, [FromBody] UpdateRestrictivePracticeDto dto, CancellationToken ct)
    {
        var practice = await _db.RestrictivePractices.FirstOrDefaultAsync(rp => rp.Id == id, ct);
        if (practice == null) return NotFound(ApiResponse<RestrictivePracticeDto>.Fail("Restrictive practice entry not found"));

        if (dto.RelatedMedicationId.HasValue)
        {
            var medicationError = await ValidateRelatedMedicationAsync(dto.RelatedMedicationId.Value, practice.ParticipantId, ct);
            if (medicationError != null) return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail(medicationError));
        }

        practice.Type = dto.Type;
        practice.Description = dto.Description;
        practice.AuthorisedBy = dto.AuthorisedBy;
        practice.AuthorisationDate = dto.AuthorisationDate;
        practice.ReviewDate = dto.ReviewDate;
        practice.RelatedMedicationId = dto.RelatedMedicationId;
        practice.IsActive = dto.IsActive;
        practice.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<RestrictivePracticeDto>.Ok(await ToDtoWithMedicationNameAsync(practice, ct)));
    }

    [HttpDelete("participants/restrictive-practices/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var practice = await _db.RestrictivePractices.FirstOrDefaultAsync(rp => rp.Id == id, ct);
        if (practice == null) return NotFound(ApiResponse<bool>.Fail("Restrictive practice entry not found"));

        _db.RestrictivePractices.Remove(practice);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>Returns an error message if the medication doesn't exist or belongs to a different participant; null if valid.</summary>
    private async Task<string?> ValidateRelatedMedicationAsync(Guid medicationId, Guid participantId, CancellationToken ct)
    {
        var medication = await _db.ParticipantMedications.FirstOrDefaultAsync(m => m.Id == medicationId, ct);
        if (medication == null) return "Related medication not found";
        if (medication.ParticipantId != participantId) return "Related medication does not belong to this participant";
        return null;
    }

    private static RestrictivePracticeDto ToDto(RestrictivePractice rp) => new()
    {
        Id = rp.Id,
        ParticipantId = rp.ParticipantId,
        Type = rp.Type,
        Description = rp.Description,
        AuthorisedBy = rp.AuthorisedBy,
        AuthorisationDate = rp.AuthorisationDate,
        ReviewDate = rp.ReviewDate,
        RelatedMedicationId = rp.RelatedMedicationId,
        RelatedMedicationName = rp.RelatedMedication?.Name,
        IsActive = rp.IsActive,
        CreatedAt = rp.CreatedAt,
        UpdatedAt = rp.UpdatedAt,
    };

    private async Task<RestrictivePracticeDto> ToDtoWithMedicationNameAsync(RestrictivePractice rp, CancellationToken ct)
    {
        string? medicationName = null;
        if (rp.RelatedMedicationId.HasValue)
        {
            medicationName = await _db.ParticipantMedications
                .Where(m => m.Id == rp.RelatedMedicationId.Value)
                .Select(m => m.Name)
                .FirstOrDefaultAsync(ct);
        }

        return ToDto(rp) with { RelatedMedicationName = medicationName };
    }
}
