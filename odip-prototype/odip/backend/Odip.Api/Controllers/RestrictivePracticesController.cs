using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;
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
    private readonly TimeProvider _clock;
    public RestrictivePracticesController(OdipDbContext db, SafetyNoteSyncService safetyNoteSync, TimeProvider? clock = null)
    {
        _db = db;
        _safetyNoteSync = safetyNoteSync;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The organisation's calendar date now: an authorisation dated tomorrow there is not yet in force, whatever the UTC date says.</summary>
    private async Task<DateOnly> ProviderTodayAsync(Guid tenantId, CancellationToken ct) =>
        ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone);

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

        if (items.Count == 0) return Ok(ApiResponse<List<RestrictivePracticeDto>>.Ok(new List<RestrictivePracticeDto>()));
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, items[0].TenantId, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, zone);
        var earliest = await EarliestUsesAsync(items, zone, ct);
        return Ok(ApiResponse<List<RestrictivePracticeDto>>.Ok(items.Select(rp => ToDto(rp, today, earliest.GetValueOrDefault(rp.Id))).ToList()));
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
    /// <see cref="Update"/> already uses.
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
        var linkedInBatch = new HashSet<Guid>();
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
            var pairError = AuthorisationPairError(row.AuthorisedBy, row.AuthorisationDate);
            if (pairError != null) errors.Add($"{label}: {pairError}");
            var endError = EndDateError(row.AuthorisationDate, row.AuthorisationEndDate);
            if (endError != null) errors.Add($"{label}: {endError}.");
            if (row.RelatedMedicationId.HasValue)
            {
                var medicationError = await ValidateRelatedMedicationAsync(row.Type, row.RelatedMedicationId.Value, participantId, ct);
                if (medicationError != null) errors.Add($"{label}: {medicationError}");
                else
                {
                    var medicine = await _db.ParticipantMedications.FirstAsync(m => m.Id == row.RelatedMedicationId.Value, ct);
                    if (!linkedInBatch.Add(medicine.Id) || await _db.RestrictivePractices.AnyAsync(rp => rp.RelatedMedicationId == medicine.Id, ct))
                        errors.Add($"{label}: {RestraintRegisterSync.MedicineLabel(medicine)} already has its own register entry.");
                    else if (row.IsActive && medicine.Status == MedicationStatus.Ceased)
                        errors.Add($"{label}: {RestraintRegisterSync.MedicineLabel(medicine)} is ceased. Restart the medicine to reactivate this entry.");
                }
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
            UseKind = row.UseKind,
            AuthorisationEndDate = row.AuthorisationEndDate,
            RelatedMedicationId = row.RelatedMedicationId,
            IsActive = row.IsActive,
        }).ToList();

        _db.RestrictivePractices.AddRange(practices);

        // Register to medicine: each active linked row ticks its medicine.
        foreach (var linked in practices.Where(p => p.IsActive && p.RelatedMedicationId.HasValue))
            RestraintRegisterSync.ApplyEntryToMedication(linked,
                await _db.ParticipantMedications.FirstAsync(m => m.Id == linked.RelatedMedicationId!.Value, ct));

        // Sync-write: recompute the participant's derived flag once for the whole
        // batch. The query only sees already-committed rows (none of `practices` is saved yet),
        // so whether any new row is active is OR'd in explicitly, same as Update/Delete.
        var hasOtherActiveEntry = await _db.RestrictivePractices
            .Where(rp => rp.ParticipantId == participantId && rp.IsActive)
            .AnyAsync(ct);
        participant.HasRestrictivePracticeFlag = practices.Any(p => p.IsActive) || hasOtherActiveEntry;

        // PD-5: keeps the restrictive-practices auto-note in sync alongside the flag above.
        await _safetyNoteSync.SyncRestrictivePracticeNoteAsync(participant, ct);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Another request linked one of these medicines between our check and our save.
            return Conflict(ApiResponse<List<RestrictivePracticeDto>>.Fail(AlreadyLinkedCopy));
        }

        // A linked row follows its medicine's Regular or PRN setting, so the DTO needs the medicine loaded.
        foreach (var linked in practices.Where(p => p.RelatedMedicationId.HasValue))
            linked.RelatedMedication = await _db.ParticipantMedications.FirstAsync(m => m.Id == linked.RelatedMedicationId!.Value, ct);
        var today = await ProviderTodayAsync(participant.TenantId, ct);
        return Ok(ApiResponse<List<RestrictivePracticeDto>>.Ok(practices.Select(rp => ToDto(rp, today)).ToList()));
    }

    /// <summary>The end date needs a start and must not precede it (inclusive: the same day is fine); null when valid.</summary>
    private static string? EndDateError(DateOnly? start, DateOnly? end) =>
        end == null ? null
        : start == null ? "Add the authorisation date before an end date"
        : end < start ? "The end date can't be before the authorisation date"
        : null;

    /// <summary>The authoriser and the authorisation date are given together, or not at all (same wording as the client).</summary>
    private static string? AuthorisationPairError(string? authorisedBy, DateOnly? authorisationDate)
    {
        var hasWho = !string.IsNullOrWhiteSpace(authorisedBy);
        if (hasWho == authorisationDate.HasValue) return null;
        return hasWho ? "Add the date it was authorised." : "Add who authorised it.";
    }

    private const string AlreadyLinkedCopy = "This medicine already has its own register entry.";

    private const string ChangedByOther = "Someone else just changed this entry, so your changes weren't saved. Close it and open it again to see theirs.";

    private const string DeleteChangedByOther = "Someone else just changed this entry, so it wasn't deleted. Check their change, then delete it again if you still want to.";

    [HttpPut("participants/restrictive-practices/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<RestrictivePracticeDto>>> Update(
        Guid id, [FromBody] UpdateRestrictivePracticeDto dto, CancellationToken ct)
    {
        var practice = await _db.RestrictivePractices.FirstOrDefaultAsync(rp => rp.Id == id, ct);
        if (practice == null) return NotFound(ApiResponse<RestrictivePracticeDto>.Fail("Restrictive practice entry not found"));

        // A form from an older tab sends no version and saves as before. A stale one is refused before any other check;
        // the token below (the UPDATE's WHERE) stays as the backstop for a save that races this read.
        if (dto.ExpectedUpdatedAt is DateTime expected && expected != practice.UpdatedAt)
            return Conflict(ApiResponse<RestrictivePracticeDto>.Fail(ChangedByOther));

        // A linked entry is the medicine's other half (M16): its type and link are fixed, and it ends only by deactivating it or unticking the medicine.
        var med = practice.RelatedMedicationId is Guid linkedId
            ? await _db.ParticipantMedications.FirstOrDefaultAsync(m => m.Id == linkedId, ct)
            : null;
        if (med != null)
        {
            if (dto.Type != RestrictivePracticeType.ChemicalRestraint)
                return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail($"This entry is linked to {RestraintRegisterSync.MedicineLabel(med)}, so it stays a chemical restraint."));
            if (dto.RelatedMedicationId != practice.RelatedMedicationId)
                return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail($"This entry is linked to {RestraintRegisterSync.MedicineLabel(med)}. To stop this restraint, untick Chemical restraint on the medicine or deactivate this entry."));
        }

        var newlyLinking = practice.RelatedMedicationId == null && dto.RelatedMedicationId.HasValue;
        if (dto.RelatedMedicationId.HasValue)
        {
            var medicationError = await ValidateRelatedMedicationAsync(dto.Type, dto.RelatedMedicationId.Value, practice.ParticipantId, ct);
            if (medicationError != null) return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail(medicationError));

            if (newlyLinking)
            {
                med = await _db.ParticipantMedications.FirstAsync(m => m.Id == dto.RelatedMedicationId.Value, ct);
                if (await _db.RestrictivePractices.AnyAsync(rp => rp.Id != practice.Id && rp.RelatedMedicationId == med.Id, ct))
                    return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail($"{RestraintRegisterSync.MedicineLabel(med)} already has its own register entry."));
            }
        }

        if (med != null && dto.IsActive && (!practice.IsActive || newlyLinking) && med.Status == MedicationStatus.Ceased)
            return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail($"{RestraintRegisterSync.MedicineLabel(med)} is ceased. Restart the medicine to reactivate this entry."));

        // An older tab sends none of the four dates, and must not wipe them (DatesIncluded is the new form's way to say they are meant).
        var datesIncluded = dto.DatesIncluded == true;
        var endDate = datesIncluded ? dto.AuthorisationEndDate : practice.AuthorisationEndDate;
        var firstUsedOn = datesIncluded ? dto.FirstUsedOn : practice.FirstUsedOn;

        // Legacy half-filled rows stay editable: only check when an authorisation field changes.
        if (dto.AuthorisedBy != practice.AuthorisedBy || dto.AuthorisationDate != practice.AuthorisationDate)
        {
            var pairError = AuthorisationPairError(dto.AuthorisedBy, dto.AuthorisationDate);
            if (pairError != null) return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail(pairError));
        }

        // Same legacy tolerance: only check what this save changes.
        if (endDate != practice.AuthorisationEndDate || dto.AuthorisationDate != practice.AuthorisationDate)
        {
            var endError = EndDateError(dto.AuthorisationDate, endDate);
            if (endError != null) return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail(endError));
        }
        if (firstUsedOn != practice.FirstUsedOn && firstUsedOn > await ProviderTodayAsync(practice.TenantId, ct))
            return BadRequest(ApiResponse<RestrictivePracticeDto>.Fail("The first use date can't be in the future"));

        var wasActive = practice.IsActive;
        practice.Type = dto.Type;
        practice.Description = dto.Description;
        practice.AuthorisedBy = dto.AuthorisedBy;
        practice.AuthorisationDate = dto.AuthorisationDate;
        practice.ReviewDate = dto.ReviewDate;
        practice.AuthorisationEndDate = endDate;
        practice.FirstUsedOn = firstUsedOn;
        if (datesIncluded)
        {
            practice.InterimBspDate = dto.InterimBspDate;
            practice.ComprehensiveBspDate = dto.ComprehensiveBspDate;
        }
        practice.RelatedMedicationId = dto.RelatedMedicationId;
        // A linked entry follows its medicine, so the stored kind only changes while unlinked.
        if (dto.UseKind is { } useKind && practice.RelatedMedicationId == null) practice.UseKind = useKind;
        practice.IsActive = dto.IsActive;
        if (dto.RequiresReporting is bool reporting) practice.RequiresReporting = reporting;
        practice.UpdatedAt = DateTime.UtcNow;

        // Register to medicine, only on a change of active state (or a fresh link), so a description or review-date edit never touches the medicine.
        // Linking an inactive entry to a ticked medicine unticks it: it cannot stay ticked behind an inactive entry.
        if (med != null && (wasActive != dto.IsActive || newlyLinking))
            RestraintRegisterSync.ApplyEntryToMedication(practice, med);

        // Sync-write (see CreateBulk): recompute the participant's derived flag in the same
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

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(ApiResponse<RestrictivePracticeDto>.Fail(ChangedByOther));
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict(ApiResponse<RestrictivePracticeDto>.Fail(AlreadyLinkedCopy));
        }

        return Ok(ApiResponse<RestrictivePracticeDto>.Ok(await ToDtoWithMedicationNameAsync(practice, ct)));
    }

    [HttpDelete("participants/restrictive-practices/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(
        Guid id, CancellationToken ct, [FromQuery] DateTimeOffset? expectedUpdatedAt = null)
    {
        var practice = await _db.RestrictivePractices.FirstOrDefaultAsync(rp => rp.Id == id, ct);
        if (practice == null) return NotFound(ApiResponse<bool>.Fail("Restrictive practice entry not found"));

        // As Update: no version (an older tab) deletes as before; a stale one is refused. A DateTimeOffset binds without a Local-kind shift.
        if (expectedUpdatedAt is DateTimeOffset expected && expected.UtcDateTime != practice.UpdatedAt)
            return Conflict(ApiResponse<bool>.Fail(DeleteChangedByOther));

        // A linked entry goes with its medicine, whatever the medicine's status: deleting it would lose the authorisation record.
        if (practice.RelatedMedicationId is Guid linkedId)
        {
            var linked = await _db.ParticipantMedications.FirstOrDefaultAsync(m => m.Id == linkedId, ct);
            if (linked != null)
                return BadRequest(ApiResponse<bool>.Fail(practice.IsActive
                    ? $"This entry is linked to {RestraintRegisterSync.MedicineLabel(linked)}. Deactivate it instead."
                    : $"This entry is linked to {RestraintRegisterSync.MedicineLabel(linked)}, so it's kept as the record of that restraint."));
        }

        _db.RestrictivePractices.Remove(practice);

        // Sync-write (see CreateBulk): the deleted row can no longer contribute regardless of its own
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

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(ApiResponse<bool>.Fail(DeleteChangedByOther));
        }

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

    /// <summary>Needs <c>RelatedMedication</c> loaded for a linked entry (the use kind follows the medicine). <paramref name="earliestUse"/> is the suggestion for the first use date.</summary>
    internal static RestrictivePracticeDto ToDto(RestrictivePractice rp, DateOnly today, DateOnly? earliestUse = null)
    {
        var interimDue = rp.FirstUsedOn is { } first ? BspTimeline.InterimDue(first) : (DateOnly?)null;
        var comprehensiveDue = rp.FirstUsedOn is { } first2 ? BspTimeline.ComprehensiveDue(first2) : (DateOnly?)null;
        return new()
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
        RelatedMedicationStatus = rp.RelatedMedication?.Status,
        RequiresReporting = rp.RequiresReporting,
        IsActive = rp.IsActive,
        IsAuthorised = RestrictivePracticeAuthorisation.IsAuthorised(rp, today),
        UseKind = RestrictivePracticeAuthorisation.UseKindOf(rp),
        AuthorisationEndDate = rp.AuthorisationEndDate,
        FirstUsedOn = rp.FirstUsedOn,
        InterimBspDate = rp.InterimBspDate,
        ComprehensiveBspDate = rp.ComprehensiveBspDate,
        EarliestRecordedUseDate = earliestUse,
        InterimBspDueOn = interimDue,
        ComprehensiveBspDueOn = comprehensiveDue,
        InterimBspState = rp.IsActive ? BspTimeline.InterimState(interimDue, rp.InterimBspDate, rp.ComprehensiveBspDate, today) : BspPlanState.NotStarted,
        ComprehensiveBspState = rp.IsActive ? BspTimeline.State(comprehensiveDue, rp.ComprehensiveBspDate, today) : BspPlanState.NotStarted,
        CreatedAt = rp.CreatedAt,
        UpdatedAt = rp.UpdatedAt,
        };
    }

    /// <summary>
    /// The earliest recorded use of each entry, as a suggestion for its first use date: the first active use incident linked to it (a wall-clock date, kept
    /// as entered), and for a linked chemical entry the first administered dose of its medicine (UTC, read in the provider's zone). One grouped query per
    /// source, never one per entry.
    /// </summary>
    private async Task<Dictionary<Guid, DateOnly?>> EarliestUsesAsync(IReadOnlyCollection<RestrictivePractice> items, TimeZoneInfo zone, CancellationToken ct)
    {
        var ids = items.Select(rp => rp.Id).ToList();
        var result = new Dictionary<Guid, DateOnly?>();
        void Keep(Guid id, DateOnly date) { if (!result.TryGetValue(id, out var have) || date < have) result[id] = date; }

        var incidents = await _db.IncidentReports
            .Where(i => i.IsActive && i.IncidentType == IncidentType.RestrictivePracticeUse && i.RestrictivePracticeId != null && ids.Contains(i.RestrictivePracticeId.Value))
            .GroupBy(i => i.RestrictivePracticeId!.Value)
            .Select(g => new { Id = g.Key, First = g.Min(i => i.IncidentDateTime) })
            .ToListAsync(ct);
        foreach (var row in incidents) Keep(row.Id, DateOnly.FromDateTime(row.First));

        var byMedicine = items.Where(rp => rp.RelatedMedicationId != null).ToDictionary(rp => rp.RelatedMedicationId!.Value, rp => rp.Id);
        if (byMedicine.Count == 0) return result;
        var medIds = byMedicine.Keys.ToList();
        var doses = await _db.MedicationAdministrations
            .Where(a => medIds.Contains(a.ParticipantMedicationId) && a.Status == MedicationAdministrationStatus.Administered && a.AdministeredAt != null)
            .GroupBy(a => a.ParticipantMedicationId)
            .Select(g => new { Id = g.Key, First = g.Min(a => a.AdministeredAt) })
            .ToListAsync(ct);
        foreach (var row in doses)
            Keep(byMedicine[row.Id], DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(row.First!.Value), zone)));
        return result;
    }

    private async Task<RestrictivePracticeDto> ToDtoWithMedicationNameAsync(RestrictivePractice rp, CancellationToken ct)
    {
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, rp.TenantId, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, zone);
        var earliest = (await EarliestUsesAsync(new[] { rp }, zone, ct)).GetValueOrDefault(rp.Id);
        if (!rp.RelatedMedicationId.HasValue) return ToDto(rp, today, earliest);

        // The use kind follows the medicine, so load it onto the entry before the DTO reads it.
        rp.RelatedMedication = await _db.ParticipantMedications.FirstAsync(m => m.Id == rp.RelatedMedicationId.Value, ct);
        return ToDto(rp, today, earliest);
    }
}
