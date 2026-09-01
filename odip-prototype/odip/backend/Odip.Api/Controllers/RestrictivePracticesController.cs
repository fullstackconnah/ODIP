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
    private readonly SafetyNoteSyncService _safetyNoteSync;
    public RestrictivePracticesController(OdipDbContext db, SafetyNoteSyncService safetyNoteSync)
    {
        _db = db;
        _safetyNoteSync = safetyNoteSync;
    }

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
            var medicationError = await ValidateRelatedMedicationAsync(dto.Type, dto.RelatedMedicationId.Value, participantId, ct);
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

        // Sync-write: keep Participant.HasRestrictivePracticeFlag consistent with the register in
        // the SAME SaveChangesAsync call. RosteringController/PortalController read that column
        // directly (not the derived computation ParticipantsController uses on read), so this is
        // what keeps field staff seeing correct status without touching either controller. The
        // query below only sees already-committed rows (this new `practice` isn't saved yet), so
        // its own IsActive is OR'd in explicitly.
        var hasOtherActiveEntry = await _db.RestrictivePractices
            .Where(rp => rp.ParticipantId == participantId && rp.IsActive)
            .AnyAsync(ct);
        participant.HasRestrictivePracticeFlag = practice.IsActive || hasOtherActiveEntry;

        // PD-5: keeps the restrictive-practices auto-note in sync alongside the flag above, in
        // the same SaveChangesAsync.
        await _safetyNoteSync.SyncRestrictivePracticeNoteAsync(participant, ct);

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<RestrictivePracticeDto>.Ok(await ToDtoWithMedicationNameAsync(practice, ct)));
    }

    /// <summary>
    /// PD-2: bulk-create N register entries in one request — now the ONLY create path ("Add
    /// entries"), including a single row, since the single-entry create form was removed in
    /// favour of this flow. All rows are validated together and the write is all-or-nothing:
    /// either every row is created, or (on any validation failure) none are and the response
    /// carries one message per failing row so the table can surface errors against the right row.
    /// A single <see cref="OdipDbContext.SaveChangesAsync"/> call is already wrapped in one
    /// implicit DB transaction by EF Core, so no explicit <c>BeginTransactionAsync</c> is needed
    /// here — and since every row is validated in memory before anything is added to the context,
    /// a bad row never reaches SaveChangesAsync at all.
    ///
    /// ChemicalRestraint rows are supported (unlike the earlier RP-01-only version of this
    /// endpoint): once this is the only create path, rejecting them outright would make it
    /// impossible to create a chemical restraint entry at all. A row's
    /// <see cref="BulkCreateRestrictivePracticeRowDto.RelatedMedicationId"/> is optional and,
    /// when set, validated with the same <see cref="ValidateRelatedMedicationAsync"/> helper
    /// <see cref="Create"/>/<see cref="Update"/> already use.
    /// </summary>
    [HttpPost("participants/{participantId:guid}/restrictive-practices/bulk")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<RestrictivePracticeDto>>>> CreateBulk(
        Guid participantId, [FromBody] BulkCreateRestrictivePracticeDto dto, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant == null) return NotFound(ApiResponse<List<RestrictivePracticeDto>>.Fail("Participant not found"));

        if (dto.Items.Count == 0)
            return BadRequest(ApiResponse<List<RestrictivePracticeDto>>.Fail("At least one row is required"));

        // The frontend caps the row-count input at 50, but that's a UI courtesy, not a security
        // boundary — anything hitting this endpoint directly (curl, a script, a future consumer)
        // must be stopped here too, before an unbounded payload can bulk-insert into a
        // compliance-relevant register in a single SaveChangesAsync.
        if (dto.Items.Count > 50)
            return BadRequest(ApiResponse<List<RestrictivePracticeDto>>.Fail("A maximum of 50 rows can be added at once."));

        var errors = new List<string>();
        for (var i = 0; i < dto.Items.Count; i++)
        {
            var row = dto.Items[i];
            var label = $"Row {i + 1}";

            if (string.IsNullOrWhiteSpace(row.Description))
            {
                errors.Add($"{label}: Description is required");
                continue;
            }
            if (row.Description.Length > 2000)
            {
                errors.Add($"{label}: Description must be 2000 characters or fewer");
                continue;
            }
            if (row.AuthorisedBy != null && row.AuthorisedBy.Length > 200)
            {
                errors.Add($"{label}: Authorised by must be 200 characters or fewer");
            }
            if (row.RelatedMedicationId.HasValue)
            {
                var medicationError = await ValidateRelatedMedicationAsync(row.Type, row.RelatedMedicationId.Value, participantId, ct);
                if (medicationError != null) errors.Add($"{label}: {medicationError}");
            }
        }

        if (errors.Count > 0)
            return BadRequest(ApiResponse<List<RestrictivePracticeDto>>.Fail(errors));

        var practices = dto.Items.Select(row => new RestrictivePractice
        {
            Id = Guid.NewGuid(),
            ParticipantId = participantId,
            Type = row.Type,
            Description = row.Description,
            AuthorisedBy = row.AuthorisedBy,
            AuthorisationDate = row.AuthorisationDate,
            ReviewDate = row.ReviewDate,
            RelatedMedicationId = row.RelatedMedicationId,
            IsActive = row.IsActive,
        }).ToList();

        _db.RestrictivePractices.AddRange(practices);

        // Sync-write (see Create): recompute the participant's derived flag once for the whole
        // batch. The query only sees already-committed rows (none of `practices` is saved yet),
        // so whether any new row is active is OR'd in explicitly, same as Create/Update/Delete.
        var hasOtherActiveEntry = await _db.RestrictivePractices
            .Where(rp => rp.ParticipantId == participantId && rp.IsActive)
            .AnyAsync(ct);
        participant.HasRestrictivePracticeFlag = practices.Any(p => p.IsActive) || hasOtherActiveEntry;

        // PD-5: keeps the restrictive-practices auto-note in sync alongside the flag above.
        await _safetyNoteSync.SyncRestrictivePracticeNoteAsync(participant, ct);

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<List<RestrictivePracticeDto>>.Ok(practices.Select(ToDto).ToList()));
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
            var medicationError = await ValidateRelatedMedicationAsync(dto.Type, dto.RelatedMedicationId.Value, practice.ParticipantId, ct);
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

        // Sync-write (see Create): recompute the participant's derived flag in the same
        // SaveChangesAsync call. The query below still reflects this row's pre-update committed
        // IsActive, so it's excluded and the new state (dto.IsActive) is OR'd in explicitly.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == practice.ParticipantId, ct);
        if (participant != null)
        {
            var hasOtherActiveEntry = await _db.RestrictivePractices
                .Where(rp => rp.ParticipantId == practice.ParticipantId && rp.Id != practice.Id && rp.IsActive)
                .AnyAsync(ct);
            participant.HasRestrictivePracticeFlag = dto.IsActive || hasOtherActiveEntry;

            // PD-5: keeps the restrictive-practices auto-note in sync alongside the flag above.
            await _safetyNoteSync.SyncRestrictivePracticeNoteAsync(participant, ct);
        }

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

        // Sync-write (see Create): the deleted row can no longer contribute regardless of its own
        // IsActive, so the recomputed flag is just "does any other active row remain".
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == practice.ParticipantId, ct);
        if (participant != null)
        {
            var hasOtherActiveEntry = await _db.RestrictivePractices
                .Where(rp => rp.ParticipantId == practice.ParticipantId && rp.Id != practice.Id && rp.IsActive)
                .AnyAsync(ct);
            participant.HasRestrictivePracticeFlag = hasOtherActiveEntry;

            // PD-5: keeps the restrictive-practices auto-note in sync alongside the flag above —
            // when the last active entry is deleted, this archives the note (unless a human
            // manually edited it).
            await _safetyNoteSync.SyncRestrictivePracticeNoteAsync(participant, ct);
        }

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>
    /// Returns an error message if RelatedMedicationId is set for a non-ChemicalRestraint type, if
    /// the medication doesn't exist, or if it belongs to a different participant; null if valid.
    /// </summary>
    private async Task<string?> ValidateRelatedMedicationAsync(RestrictivePracticeType type, Guid medicationId, Guid participantId, CancellationToken ct)
    {
        if (type != RestrictivePracticeType.ChemicalRestraint)
            return "RelatedMedicationId can only be set when Type is ChemicalRestraint";

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
