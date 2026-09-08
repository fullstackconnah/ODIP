using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// The staff member portal ("My Shifts") — a self-service read surface scoped to the caller's
/// own account, resolved via <see cref="ResolveCurrentStaffIdAsync"/> (post staff/user
/// unification this is simply the caller's own <see cref="User.Id"/>).
///
/// Access rule: a caller can read ONLY their own shifts (matched on <c>Shift.UserId</c>) and
/// only the participant/medication/routine data attached to those shifts — a shift id
/// belonging to another staff member 404s exactly the same as one that doesn't exist at all,
/// so this surface can never be used to enumerate other staff's roster ids. Coordinator/admin
/// routes (<see cref="RosteringController"/>, <see cref="MedicationsController"/>,
/// <see cref="ParticipantRoutinesController"/>) are unaffected — reads here always go via
/// purpose-built portal DTOs, never the coordinator-scoped ones. The one write surface is witness
/// approve/decline (<see cref="ApproveWitnessRequest"/>/<see cref="DeclineWitnessRequest"/>), and
/// the same "only your own, 404 otherwise" scoping applies — matched on
/// <c>MedicationAdministration.WitnessUserId</c> instead of <c>Shift.UserId</c>. These POSTs
/// still go through <c>ReadOnlyMiddleware</c> like every other write in the app — there is no
/// portal-specific exemption from the ReadOnly role's 403.
///
/// Respects the SuperAdmin "view as" switching mechanism: <see cref="ICurrentTenant.ViewAsUserId"/>
/// (set from the X-View-As-User header, only once a SuperAdmin has also scoped to a tenant via
/// X-View-As-Tenant — see <see cref="Odip.Infrastructure.Services.CurrentTenant"/>) takes
/// priority over the caller's own JWT subject claim, so previewing a specific user's portal
/// shows THAT user's shifts, not the SuperAdmin's own (who typically has no linked Staff record
/// at all).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/portal")]
public class PortalController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _currentTenant;
    private readonly IConfiguration? _config;

    public PortalController(OdipDbContext db, ICurrentTenant currentTenant, IConfiguration? config = null)
    {
        _db = db;
        _currentTenant = currentTenant;
        _config = config;
    }

    private int VarianceReviewMinutes => _config?.GetValue<int>("Rostering:VarianceReviewMinutes", 15) ?? 15;

    /// <summary>
    /// The caller's own upcoming shifts (and, if cheap, trip staffing assignments) in
    /// [from, to]. Defaults to a 14-day window starting today when omitted. Always 200s — when
    /// the caller's identity can't be resolved to a User row at all (should not normally happen
    /// for an authenticated request), this simply returns empty lists rather than an error; there
    /// is no separate "not linked" state any more; every User IS its own staff identity.
    /// </summary>
    [HttpGet("my-shifts")]
    public async Task<ActionResult<ApiResponse<PortalShiftsResponseDto>>> GetMyShifts(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
        {
            return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
                new PortalShiftsResponseDto(new List<PortalShiftSummaryDto>(), new List<PortalTripAssignmentSummaryDto>())));
        }

        var start = from ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var end = to ?? start.AddDays(13);

        // INTAKE-08: a draft participant can't have a real shift going forward (Rostering's
        // ValidateRefsAsync gates that at creation) — this filter is defence in depth for the
        // edge case of a participant later flipped back to draft mid-edit while an old shift
        // still references them, so the portal never shows it.
        var shifts = await _db.Shifts
            .Include(s => s.Participant)
            .Where(s => s.UserId == staffId.Value && s.ServiceDate >= start && s.ServiceDate <= end
                        && !s.Participant!.IsDraft)
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .ToListAsync(ct);
        var shiftDtos = shifts.Select(ToSummaryDto).ToList();

        // Trip staffing is optional per the brief — included here since it's a single cheap
        // query against the already-resolved staffId, scoped the same way the shifts are.
        var tripAssignments = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => a.UserId == staffId.Value && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= end && a.AssignmentEnd >= start)
            .OrderBy(a => a.AssignmentStart)
            .ToListAsync(ct);
        var tripDtos = tripAssignments.Select(a => new PortalTripAssignmentSummaryDto(
            a.Id, a.TripInstanceId, a.TripInstance.TripCode, a.TripInstance.TripName,
            a.AssignmentStart, a.AssignmentEnd, a.IsDriver, a.Status)).ToList();

        return Ok(ApiResponse<PortalShiftsResponseDto>.Ok(
            new PortalShiftsResponseDto(shiftDtos, tripDtos)));
    }

    /// <summary>
    /// Full detail for one of the caller's own shifts: the shift, a participant summary, that
    /// participant's active routines, and an active-medications summary. Not linked, shift not
    /// found, and shift-belongs-to-someone-else all 404 identically — see class remarks on why
    /// this never distinguishes "doesn't exist" from "not yours".
    /// </summary>
    [HttpGet("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> GetShiftDetail(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        var shift = await _db.Shifts
            .Include(s => s.Participant)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        // INTAKE-08: same defence-in-depth draft exclusion as GetMyShifts above — treat it
        // identically to "no participant at all" rather than surfacing a draft's detail.
        if (shift?.Participant is null || shift.Participant.IsDraft)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    /// <summary>
    /// Shared shift-detail builder for GetShiftDetail/StartShift/FinishShift (shift-completion
    /// design spec §2) — all three need the same participant/routines/risk/medications/
    /// completion shape. Assumes shift.Participant is already loaded (every caller Includes it
    /// and null-checks first).
    /// </summary>
    private async Task<PortalShiftDetailDto> BuildShiftDetailDtoAsync(Shift shift, CancellationToken ct)
    {
        var participant = shift.Participant!;

        var routines = await _db.ParticipantRoutines
            .Where(r => r.ParticipantId == participant.Id && r.IsActive)
            .OrderByDescending(r => r.IsCritical).ThenBy(r => r.Days).ThenBy(r => r.StartTime)
            .ToListAsync(ct);

        // INTAKE-09: active risk entries only — same active-only scoping as routines/medications
        // above; a retired risk entry is no longer shift-relevant.
        var riskEntries = await _db.ParticipantRiskEntries
            .Where(r => r.ParticipantId == participant.Id && r.IsActive)
            .OrderBy(r => r.AtRiskParty).ThenByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        var medications = await _db.ParticipantMedications
            .Where(m => m.ParticipantId == participant.Id && m.Status == MedicationStatus.Active)
            .OrderBy(m => m.Name)
            .ToListAsync(ct);

        var activeCompletion = await _db.ShiftCompletions
            .Where(c => c.ShiftId == shift.Id && c.IsActive)
            .FirstOrDefaultAsync(ct);
        var completionDto = activeCompletion is null ? null : await ToShiftCompletionDtoAsync(activeCompletion, ct);

        return new PortalShiftDetailDto(
            shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.DurationHours,
            shift.Ratio, shift.NightType, shift.Status, shift.Notes,
            ToParticipantSummaryDto(participant),
            routines.Select(ToRoutineDto).ToList(),
            riskEntries.Select(ToRiskEntryDto).ToList(),
            medications.Select(ToMedicationSummaryDto).ToList(),
            completionDto,
            shift.ReturnCount);
    }

    /// <summary>Maps a ShiftCompletion to its DTO — thin wrapper so this and RosteringController's
    /// identical mapping need to stay in one place; see <see cref="ShiftCompletionMapper"/>.</summary>
    private Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, CancellationToken ct) =>
        ShiftCompletionMapper.ToDtoAsync(_db, c, VarianceReviewMinutes, ct);

    // ══════════════════════════════════════════════════════════════
    // SHIFT COMPLETION (design spec §2/§3)
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Worker taps Start on one of their own Published shifts. ActualStart/StartedAt are the
    /// server's own DateTime.UtcNow — the client never supplies the "real" timestamp, only an
    /// optional geolocation stamp and decline flag (spec ruling 1). Same 404-never-403
    /// ownership scoping as every other portal action.
    /// </summary>
    [HttpPost("shifts/{id:guid}/start")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> StartShift(
        Guid id, [FromBody] StartShiftDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        var shift = await _db.Shifts
            .Include(s => s.Participant)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (shift?.Participant is null || shift.Participant.IsDraft)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        if (shift.Status != ShiftStatus.Published)
        {
            // Idempotent replay: a worker's retry after a dropped response must read as success, not
            // as a repeat failure (critique P1). SHIFT_NOT_STARTABLE now means only "the database
            // rejected a racing double-Start" — see the DbUpdateException catch below.
            if (shift.Status == ShiftStatus.InProgress)
                return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

            if (shift.Status == ShiftStatus.PendingReview)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift has already been finished and is waiting for review.", "SHIFT_ALREADY_FINISHED"));

            if (shift.Status == ShiftStatus.Completed)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift has already been reviewed and completed.", "SHIFT_ALREADY_COMPLETED"));

            if (shift.Status == ShiftStatus.Cancelled)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift has been cancelled.", "SHIFT_CANCELLED"));

            // Draft
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been published yet.", "SHIFT_NOT_PUBLISHED"));
        }

        var providerSettings = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        var now = DateTime.UtcNow;
        var timeZoneId = StateTimeZoneMap.Resolve(providerSettings?.State);

        // F7: variance-at-start, computed once here so the coordinator queue can show it before
        // Finish. Finish still recomputes/overwrites VarianceMinutesStart from the final stored
        // ActualStart — unchanged behaviour there.
        var (rosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, timeZoneId);

        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(),
            ShiftId = shift.Id,
            ActualStart = now,
            TimeZoneId = timeZoneId,
            StartLatitude = dto.Latitude,
            StartLongitude = dto.Longitude,
            GeolocationDeclined = dto.GeolocationDeclined,
            StartWasManual = false,
            SubmittedByUserId = shift.UserId!.Value,
            StartedAt = now,
            VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(now, rosteredStartUtc),
            IsActive = true,
        };
        _db.ShiftCompletions.Add(completion);

        shift.Status = ShiftStatus.InProgress;
        shift.UpdatedAt = now;

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Partial unique index IX_ShiftCompletions_ShiftId_Active rejects a racing second Start.
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift can't be started right now.", "SHIFT_NOT_STARTABLE"));
        }
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    /// <summary>
    /// Worker taps Finish. 409 SHIFT_NOTE_REQUIRED if zero ShiftNote rows exist on the shift,
    /// checked first so the worker gets one clear reason. Supports the manual-start path
    /// (dto.ActualStart supplied while Shift.Status is still Published) per spec §3.
    /// </summary>
    [HttpPost("shifts/{id:guid}/finish")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> FinishShift(
        Guid id, [FromBody] FinishShiftDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        var shift = await _db.Shifts
            .Include(s => s.Participant)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (shift?.Participant is null || shift.Participant.IsDraft)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));

        // Idempotent replay / already-elsewhere guards, checked before the note-required gate — none
        // of these states can be fixed by adding a note, so the note gate would be a misleading error.
        if (shift.Status == ShiftStatus.PendingReview)
            return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

        if (shift.Status == ShiftStatus.Completed)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has already been reviewed and completed.", "SHIFT_ALREADY_COMPLETED"));

        if (shift.Status == ShiftStatus.Cancelled)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has been cancelled.", "SHIFT_CANCELLED"));

        if (shift.Status == ShiftStatus.Draft)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been published yet.", "SHIFT_NOT_PUBLISHED"));

        var hasNote = await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct);
        if (!hasNote)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "Add a shift note before finishing.", "SHIFT_NOTE_REQUIRED"));

        var now = DateTime.UtcNow;
        ShiftCompletion completion;

        if (shift.Status == ShiftStatus.Published)
        {
            if (dto.ActualStart is null)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift hasn't been started.", "SHIFT_NOT_IN_PROGRESS"));

            var providerSettings = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
            var timeZoneId = StateTimeZoneMap.Resolve(providerSettings?.State);

            // F4: Legacy Npgsql timestamp behaviour persists Kind verbatim; treat unsuffixed values as UTC.
            var actualStartUtc = dto.ActualStart.Value.Kind switch
            {
                DateTimeKind.Local => dto.ActualStart.Value.ToUniversalTime(),
                DateTimeKind.Unspecified => DateTime.SpecifyKind(dto.ActualStart.Value, DateTimeKind.Utc),
                _ => dto.ActualStart.Value,
            };

            // F3: reject an obviously-wrong client-supplied manual start before it's ever
            // persisted — can't be in the future, and can't predate the rostered start by more
            // than a day (generous slack for an overnight/sleepover shift's real start drifting
            // from its rostered start, without accepting garbage).
            var (manualRosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, timeZoneId);
            // F3, hardened: split into two distinct causes (critique P1 — "never says which bound
            // failed") plus a 5-minute grace on the future side for ordinary device clock skew.
            if (actualStartUtc > now.AddMinutes(5))
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Actual start time can't be in the future.", "SHIFT_ACTUAL_START_IN_FUTURE"));
            if (actualStartUtc < manualRosteredStartUtc.AddHours(-24))
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Actual start time can't be more than 24 hours before the rostered start.", "SHIFT_ACTUAL_START_TOO_EARLY"));

            completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(),
                ShiftId = shift.Id,
                ActualStart = actualStartUtc,
                TimeZoneId = timeZoneId,
                StartWasManual = true,
                SubmittedByUserId = shift.UserId!.Value,
                StartedAt = now,
                IsActive = true,
            };
            _db.ShiftCompletions.Add(completion);
        }
        else if (shift.Status == ShiftStatus.InProgress)
        {
            var existing = await _db.ShiftCompletions
                .FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive, ct);
            if (existing is null)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift hasn't been started.", "SHIFT_NOT_IN_PROGRESS"));
            completion = existing;
        }
        else
        {
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been started.", "SHIFT_NOT_IN_PROGRESS"));
        }

        completion.ActualEnd = now;
        completion.SubmittedAt = now;
        completion.EndLatitude = dto.Latitude;
        completion.EndLongitude = dto.Longitude;
        completion.GeolocationDeclined = completion.GeolocationDeclined || dto.GeolocationDeclined;

        var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
        completion.VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(completion.ActualStart, rosteredStartUtc);
        completion.VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(completion.ActualEnd.Value, rosteredEndUtc);
        completion.UpdatedAt = now;

        shift.Status = ShiftStatus.PendingReview;
        shift.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT NOTES (NOTES-01)
    // ══════════════════════════════════════════════════════════════
    //
    // Committed by owner instruction despite the backlog doc's "potential feature" label. There
    // is no shift-completion transition in this domain for the assigned worker to hang note
    // creation off — ShiftStatus.Completed exists as an enum value but nothing anywhere in
    // RosteringController or this controller ever sets it, so a note attaches to the shift
    // directly rather than gating on a completion event the product doesn't actually have.

    /// <summary>
    /// Notes on one of the caller's own shifts, newest first. Same 404-indistinguishable
    /// ownership scoping as <see cref="GetShiftDetail"/> — not linked, shift not found, and
    /// shift-belongs-to-someone-else all 404 identically.
    /// </summary>
    [HttpGet("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<List<ShiftNoteDto>>>> GetShiftNotes(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var ownsShift = await _db.Shifts.AnyAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (!ownsShift)
            return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var notes = await _db.ShiftNotes
            .Where(n => n.ShiftId == id)
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        return Ok(ApiResponse<List<ShiftNoteDto>>.Ok(notes.Select(ToShiftNoteDto).ToList()));
    }

    /// <summary>Creates a note on one of the caller's own shifts. Same ownership scoping as <see cref="GetShiftNotes"/>.</summary>
    [HttpPost("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> CreateShiftNote(
        Guid id, [FromBody] CreateShiftNoteDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Shift not found."));

        var owns = await _db.Shifts.AnyAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (!owns)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Shift not found."));

        var note = new ShiftNote
        {
            Id = Guid.NewGuid(),
            ShiftId = id,
            AuthorUserId = staffId.Value,
            AuthorName = GetCallerName(),
            Body = dto.Body.Trim(),
        };
        // NOTES-02: scan at save time — client-advisory + server-recorded, never blocking.
        note.FlaggedCategories = ShiftNoteKeywordScanner.Scan(note.Body);
        _db.ShiftNotes.Add(note);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note)));
    }

    /// <summary>
    /// Author-only edit of one of the caller's own shift notes — no delete anywhere (compliance-
    /// adjacent record). Not linked, note not found, and note authored by someone else all 404
    /// identically, per the class's ownership convention.
    /// </summary>
    [HttpPut("notes/{noteId:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> UpdateShiftNote(
        Guid noteId, [FromBody] UpdateShiftNoteDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var note = await _db.ShiftNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.AuthorUserId == staffId.Value, ct);
        if (note is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var newBody = dto.Body.Trim();
        // NOTES-02: re-scan on every edit. If the flagged-category set actually changes, clear
        // any prior dismissal — see ShiftNote.FlagsAcknowledgedAt remarks on why a stale dismissal
        // must not silently suppress the prompt for newly-introduced flagged content.
        var newFlags = ShiftNoteKeywordScanner.Scan(newBody);
        if (newFlags != note.FlaggedCategories)
            note.FlagsAcknowledgedAt = null;

        note.Body = newBody;
        note.FlaggedCategories = newFlags;
        note.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note)));
    }

    /// <summary>
    /// NOTES-02: dismisses the "consider filing an incident report?" prompt for one of the
    /// caller's own flagged notes. Persisted server-side (see <see cref="ShiftNote.FlagsAcknowledgedAt"/>
    /// remarks) rather than client-only, so the dismissal survives across devices/sessions. Same
    /// author-only, 404-indistinguishable ownership scoping as <see cref="UpdateShiftNote"/>.
    /// Idempotent — acknowledging an already-acknowledged (or never-flagged) note simply
    /// re-stamps the timestamp rather than erroring.
    /// </summary>
    [HttpPost("notes/{noteId:guid}/acknowledge-flags")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> AcknowledgeShiftNoteFlags(Guid noteId, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var note = await _db.ShiftNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.AuthorUserId == staffId.Value, ct);
        if (note is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        note.FlagsAcknowledgedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note)));
    }

    // ══════════════════════════════════════════════════════════════
    // WITNESS APPROVALS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The caller's own pending witness requests — medication administrations AND incident reports
    /// (IN-7) where they were selected as the staff witness and haven't yet approved/declined,
    /// merged into one list ordered by CreatedAt and discriminated by
    /// <see cref="PortalWitnessRequestDto.SourceType"/>. Always 200s; an unlinked account gets an
    /// empty list, matching <see cref="GetMyShifts"/>'s never-500 convention. Non-breaking for the
    /// two existing consumers (AppLayout's sidebar badge, PortalShiftsPage's badge) — both only
    /// ever read <c>.length</c> on the combined list.
    /// </summary>
    [HttpGet("witness-requests")]
    public async Task<ActionResult<ApiResponse<List<PortalWitnessRequestDto>>>> GetWitnessRequests(CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return Ok(ApiResponse<List<PortalWitnessRequestDto>>.Ok(new List<PortalWitnessRequestDto>()));

        var medicationRequests = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .Where(a => a.WitnessUserId == staffId.Value && a.WitnessStatus == WitnessStatus.Pending)
            .ToListAsync(ct);

        var incidentRequests = await _db.IncidentWitnesses
            .Include(w => w.IncidentReport).ThenInclude(i => i!.InvolvedParticipant)
            .Include(w => w.IncidentReport).ThenInclude(i => i!.ReportedByUser)
            .Where(w => w.WitnessUserId == staffId.Value && w.WitnessStatus == WitnessStatus.Pending)
            .ToListAsync(ct);

        var merged = medicationRequests.Select(ToWitnessRequestDto)
            .Concat(incidentRequests.Select(ToIncidentWitnessRequestDto))
            .OrderBy(r => r.CreatedAt)
            .ToList();

        return Ok(ApiResponse<List<PortalWitnessRequestDto>>.Ok(merged));
    }

    /// <summary>
    /// Approves or declines one of the caller's own pending MEDICATION witness requests. Only the
    /// named witness (matched on their own resolved StaffId, exactly like <see cref="GetShiftDetail"/>
    /// scopes shifts) may act on it — not linked, request not found, and request belongs to
    /// someone else all 404 identically for the same reason documented on the class. Unchanged by
    /// IN-7 — incident witness requests use the separate endpoints below.
    /// </summary>
    [HttpPost("witness-requests/{id:guid}/approve")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> ApproveWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Approved, ct);

    [HttpPost("witness-requests/{id:guid}/decline")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> DeclineWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Declined, ct);

    private async Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> RespondToWitnessRequestAsync(
        Guid id, WitnessStatus response, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        var admin = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .FirstOrDefaultAsync(a => a.Id == id && a.WitnessUserId == staffId.Value, ct);
        if (admin == null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        if (admin.WitnessStatus != WitnessStatus.Pending)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        admin.WitnessStatus = response;
        admin.WitnessRespondedAt = DateTime.UtcNow;
        admin.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<PortalWitnessRequestDto>.Ok(ToWitnessRequestDto(admin)));
    }

    /// <summary>
    /// IN-7: approves or declines one of the caller's own pending INCIDENT witness requests, with
    /// an optional witness statement. Same "only the named witness, 404 for anything not yours"
    /// anti-enumeration shape as <see cref="RespondToWitnessRequestAsync"/> — matched against
    /// <see cref="Entities.IncidentWitness.WitnessUserId"/> instead of the medication FK.
    /// </summary>
    [HttpPost("incident-witness-requests/{id:guid}/approve")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> ApproveIncidentWitnessRequest(
        Guid id, [FromBody] PortalRespondIncidentWitnessRequestDto? dto, CancellationToken ct) =>
        RespondToIncidentWitnessRequestAsync(id, WitnessStatus.Approved, dto, ct);

    [HttpPost("incident-witness-requests/{id:guid}/decline")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> DeclineIncidentWitnessRequest(
        Guid id, [FromBody] PortalRespondIncidentWitnessRequestDto? dto, CancellationToken ct) =>
        RespondToIncidentWitnessRequestAsync(id, WitnessStatus.Declined, dto, ct);

    private async Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> RespondToIncidentWitnessRequestAsync(
        Guid id, WitnessStatus response, PortalRespondIncidentWitnessRequestDto? dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        var witness = await _db.IncidentWitnesses
            .Include(w => w.IncidentReport).ThenInclude(i => i!.InvolvedParticipant)
            .Include(w => w.IncidentReport).ThenInclude(i => i!.ReportedByUser)
            .FirstOrDefaultAsync(w => w.Id == id && w.WitnessUserId == staffId.Value, ct);
        if (witness == null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        if (witness.WitnessStatus != WitnessStatus.Pending)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        witness.WitnessStatus = response;
        witness.WitnessRespondedAt = DateTime.UtcNow;
        // Never overwrite a previously-typed statement with null when the caller omits it.
        if (!string.IsNullOrWhiteSpace(dto?.StatementText))
            witness.StatementText = dto!.StatementText!.Trim();
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<PortalWitnessRequestDto>.Ok(ToIncidentWitnessRequestDto(witness)));
    }

    // ══════════════════════════════════════════════════════════════
    // LEAVE + RECURRING UNAVAILABILITY (staff self-service)
    // ══════════════════════════════════════════════════════════════

    /// <summary>The caller's own leave requests and recurring unavailability rules, every status — the staff member's submission history, not just pending ones.</summary>
    [HttpGet("leave")]
    public async Task<ActionResult<ApiResponse<PortalLeaveResponseDto>>> GetMyLeave(CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return Ok(ApiResponse<PortalLeaveResponseDto>.Ok(new PortalLeaveResponseDto()));

        var leave = await _db.LeaveRequests.Include(l => l.User)
            .Where(l => l.UserId == staffId.Value).OrderByDescending(l => l.RequestedAt).ToListAsync(ct);
        var unavailability = await _db.RecurringUnavailabilities.Include(r => r.User)
            .Where(r => r.UserId == staffId.Value).OrderByDescending(r => r.RequestedAt).ToListAsync(ct);

        return Ok(ApiResponse<PortalLeaveResponseDto>.Ok(new PortalLeaveResponseDto
        {
            Leave = leave.Select(ToLeaveDto).ToList(),
            Unavailability = unavailability.Select(ToUnavailabilityDto).ToList(),
        }));
    }

    /// <summary>Any supplied <see cref="CreateLeaveRequestDto.UserId"/> is ignored — always the caller's own id. Lands Pending — the initial state, not the on-behalf shortcut LeaveController's coordinator-side POST /leave uses.</summary>
    [HttpPost("leave")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CreateMyLeaveRequest([FromBody] CreateLeaveRequestDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Staff record not found."));

        // Minor #6: shares LeaveController's internal static validators (same assembly) instead of
        // duplicating the rules inline — keeps the message strings from drifting between the two
        // controllers' otherwise-identical validation.
        var validationError = LeaveController.ValidateLeaveDates(dto.StartDate, dto.EndDate);
        if (validationError != null) return BadRequest(ApiResponse<LeaveRequestDto>.Fail(validationError));

        var duplicate = await _db.LeaveRequests.AnyAsync(l =>
            l.UserId == staffId.Value && l.LeaveType == dto.LeaveType && l.StartDate == dto.StartDate
            && l.EndDate == dto.EndDate && l.Status != LeaveStatus.Cancelled && l.Status != LeaveStatus.Declined, ct);
        if (duplicate) return Conflict(ApiResponse<LeaveRequestDto>.Fail("An identical request already exists."));

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staffId.Value, LeaveType = dto.LeaveType,
            StartDate = dto.StartDate, EndDate = dto.EndDate, Reason = dto.Reason,
            Status = LeaveStatus.Pending, RequestedByUserId = staffId.Value, RequestedAt = DateTime.UtcNow,
        };
        _db.LeaveRequests.Add(leave);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(leave).Reference(l => l.User).LoadAsync(ct);
        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:171): POST /portal/leave is 201, not 200.
        return StatusCode(StatusCodes.Status201Created, ApiResponse<LeaveRequestDto>.Ok(ToLeaveDto(leave)));
    }

    /// <summary>Withdraw the caller's own leave request. 404 (never 403) if the id doesn't exist or belongs to someone else — same idiom as every other portal read/write.</summary>
    [HttpPost("leave/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<LeaveRequestDto>>> CancelMyLeaveRequest(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));

        var leave = await _db.LeaveRequests.Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == id && l.UserId == staffId.Value, ct);
        if (leave == null) return NotFound(ApiResponse<LeaveRequestDto>.Fail("Leave request not found."));
        if (leave.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<LeaveRequestDto>.Fail("Only pending requests can be withdrawn."));

        leave.Status = LeaveStatus.Cancelled;
        leave.DecidedByUserId = staffId.Value;
        leave.DecidedAt = DateTime.UtcNow;
        leave.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<LeaveRequestDto>.Ok(ToLeaveDto(leave)));
    }

    [HttpPost("unavailability")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CreateMyUnavailability(
        [FromBody] CreateRecurringUnavailabilityDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Staff record not found."));

        // Minor #6: shares LeaveController's internal static validator instead of duplicating it.
        var recurringValidationError = LeaveController.ValidateRecurringWindow(dto.StartTime, dto.EndTime, dto.EffectiveFrom, dto.EffectiveTo);
        if (recurringValidationError != null) return BadRequest(ApiResponse<RecurringUnavailabilityDto>.Fail(recurringValidationError));

        var duplicate = await _db.RecurringUnavailabilities.AnyAsync(r =>
            r.UserId == staffId.Value && r.DayOfWeek == dto.DayOfWeek && r.StartTime == dto.StartTime
            && r.EndTime == dto.EndTime && r.EffectiveFrom == dto.EffectiveFrom && r.EffectiveTo == dto.EffectiveTo
            && r.Status != LeaveStatus.Cancelled && r.Status != LeaveStatus.Declined, ct);
        if (duplicate) return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("An identical request already exists."));

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staffId.Value, DayOfWeek = dto.DayOfWeek,
            StartTime = dto.StartTime, EndTime = dto.EndTime, EffectiveFrom = dto.EffectiveFrom,
            EffectiveTo = dto.EffectiveTo, Notes = dto.Notes,
            Status = LeaveStatus.Pending, RequestedByUserId = staffId.Value, RequestedAt = DateTime.UtcNow,
        };
        _db.RecurringUnavailabilities.Add(rule);
        await _db.SaveChangesAsync(ct);
        await _db.Entry(rule).Reference(r => r.User).LoadAsync(ct);
        // Design spec (docs/specs/2026-09-07-staff-leave-unavailability-design.md:173): POST /portal/unavailability is 201, not 200.
        return StatusCode(StatusCodes.Status201Created, ApiResponse<RecurringUnavailabilityDto>.Ok(ToUnavailabilityDto(rule)));
    }

    [HttpPost("unavailability/{id:guid}/cancel")]
    public async Task<ActionResult<ApiResponse<RecurringUnavailabilityDto>>> CancelMyUnavailability(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));

        var rule = await _db.RecurringUnavailabilities.Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == id && r.UserId == staffId.Value, ct);
        if (rule == null) return NotFound(ApiResponse<RecurringUnavailabilityDto>.Fail("Unavailability request not found."));
        if (rule.Status != LeaveStatus.Pending)
            return Conflict(ApiResponse<RecurringUnavailabilityDto>.Fail("Only pending requests can be withdrawn."));

        rule.Status = LeaveStatus.Cancelled;
        rule.DecidedByUserId = staffId.Value;
        rule.DecidedAt = DateTime.UtcNow;
        rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<RecurringUnavailabilityDto>.Ok(ToUnavailabilityDto(rule)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Resolves the caller's own user id — post staff/user unification this IS the caller's
    /// linked "staff" identity, there being no separate Staff record any more.
    /// <see cref="ICurrentTenant.ViewAsUserId"/> takes priority over the JWT's own subject claim
    /// (see class remarks). Null covers every "no resolvable identity" case uniformly: no
    /// resolvable user id on the token, or the user row not found (or tenant-filtered out).
    /// </summary>
    private async Task<Guid?> ResolveCurrentStaffIdAsync(CancellationToken ct)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        Guid? ownUserId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        var userId = _currentTenant.ViewAsUserId ?? ownUserId;
        if (userId is null) return null;

        var exists = await _db.Users.AnyAsync(u => u.Id == userId.Value, ct);
        return exists ? userId : null;
    }

    private static PortalShiftSummaryDto ToSummaryDto(Shift s) => new(
        s.Id, s.ParticipantId, s.Participant?.FullName ?? string.Empty, s.ServiceDate, s.StartTime, s.EndTime,
        s.EndsNextDay, s.DurationHours, s.Ratio, s.NightType, s.Status, s.Notes);

    // These duplicate LeaveController's own ToDto overloads rather than sharing them — matches
    // the codebase's existing precedent of small per-controller mapping/validation helpers (e.g.
    // IsValidStaffRefAsync duplicated across StaffAvailabilityController/StaffAssignmentsController)
    // rather than introducing a shared service the spec doesn't call for.
    private static LeaveRequestDto ToLeaveDto(LeaveRequest l) => new()
    {
        Id = l.Id, UserId = l.UserId, UserFullName = l.User?.FullName ?? string.Empty, LeaveType = l.LeaveType,
        StartDate = l.StartDate, EndDate = l.EndDate, Status = l.Status, Reason = l.Reason,
        RequestedByUserId = l.RequestedByUserId, RequestedAt = l.RequestedAt,
        DecidedByUserId = l.DecidedByUserId, DecidedAt = l.DecidedAt, DecisionNote = l.DecisionNote,
    };

    private static RecurringUnavailabilityDto ToUnavailabilityDto(RecurringUnavailability r) => new()
    {
        Id = r.Id, UserId = r.UserId, UserFullName = r.User?.FullName ?? string.Empty, DayOfWeek = r.DayOfWeek,
        StartTime = r.StartTime, EndTime = r.EndTime, EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo,
        Notes = r.Notes, Status = r.Status, RequestedByUserId = r.RequestedByUserId, RequestedAt = r.RequestedAt,
        DecidedByUserId = r.DecidedByUserId, DecidedAt = r.DecidedAt, DecisionNote = r.DecisionNote,
    };

    private static PortalParticipantSummaryDto ToParticipantSummaryDto(Participant p) => new(
        p.Id, p.FullName, p.IsHighSupport, p.IsIntensiveSupport, p.HasRestrictivePracticeFlag,
        p.SupportRatio, p.OvernightSupport, p.MobilityAidWheelchair, p.MobilityAidWalker,
        p.MobilitySupportOptions, p.RequiresHiLoBed, p.RequiresHoist, p.RequiresShowerChair,
        p.RequiresCommode, p.RequiresStandingMachine, p.MobilityNotes, p.EquipmentRequirements,
        p.TransportRequirements, p.MedicalSummary, p.BehaviourRiskSummary);

    private static ParticipantRoutineDto ToRoutineDto(ParticipantRoutine r) => new()
    {
        Id = r.Id,
        ParticipantId = r.ParticipantId,
        Title = r.Title,
        Description = r.Description,
        Category = r.Category,
        Days = ParticipantRoutineDayMapper.ToDayList(r.Days),
        StartTime = r.StartTime,
        EndTime = r.EndTime,
        IsCritical = r.IsCritical,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt,
        UpdatedAt = r.UpdatedAt,
    };

    private static ParticipantRiskEntryDto ToRiskEntryDto(ParticipantRiskEntry r) => new()
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

    private static PortalMedicationSummaryDto ToMedicationSummaryDto(ParticipantMedication m) => new(
        m.Id, m.Name, m.Strength, m.DoseDescription, m.Type, m.TimesOfDay, m.IsHighRisk, m.IsPsychotropic,
        m.IsChemicalRestraint, m.DrugSchedule, m.SupportLevel, m.PrnIndication);

    private static ShiftNoteDto ToShiftNoteDto(ShiftNote n) => new(
        n.Id, n.ShiftId, n.AuthorUserId, n.AuthorName, n.Body, n.CreatedAt, n.UpdatedAt,
        ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories), n.FlagsAcknowledgedAt);

    /// <summary>Same "fullName claim, fall back to the Name claim" idiom as ParticipantNotesController.GetCreatedByName.</summary>
    private string GetCallerName() =>
        User?.FindFirst("fullName")?.Value
        ?? User?.FindFirst(ClaimTypes.Name)?.Value
        ?? "Unknown";

    private static PortalWitnessRequestDto ToWitnessRequestDto(MedicationAdministration a) => new(
        Id: a.Id,
        SourceType: "Medication",
        ParticipantId: a.ParticipantId,
        ParticipantName: a.Participant?.FullName ?? string.Empty,
        MedicationId: a.ParticipantMedicationId,
        MedicationName: a.ParticipantMedication?.Name ?? string.Empty,
        Strength: a.ParticipantMedication?.Strength,
        DoseDescription: a.ParticipantMedication?.DoseDescription ?? string.Empty,
        DoseGiven: a.DoseGiven,
        IncidentReportId: null,
        IncidentTitle: null,
        IncidentType: null,
        IncidentSeverity: null,
        RecordedByName: a.RecordedByName,
        AdministeredAt: a.AdministeredAt,
        AdministeredAtTimeZone: a.AdministeredAtTimeZone,
        IncidentDateTime: null,
        WitnessStatus: a.WitnessStatus,
        WitnessRespondedAt: a.WitnessRespondedAt,
        CreatedAt: a.CreatedAt);

    /// <summary>IN-7: incident-side counterpart to <see cref="ToWitnessRequestDto(MedicationAdministration)"/> —
    /// see the merge in <see cref="GetWitnessRequests"/>.</summary>
    private static PortalWitnessRequestDto ToIncidentWitnessRequestDto(IncidentWitness w) => new(
        Id: w.Id,
        SourceType: "Incident",
        ParticipantId: w.IncidentReport.InvolvedParticipantId ?? Guid.Empty,
        ParticipantName: w.IncidentReport.InvolvedParticipant?.FullName ?? string.Empty,
        MedicationId: null,
        MedicationName: null,
        Strength: null,
        DoseDescription: null,
        DoseGiven: null,
        IncidentReportId: w.IncidentReportId,
        IncidentTitle: w.IncidentReport.Title,
        IncidentType: w.IncidentReport.IncidentType,
        IncidentSeverity: w.IncidentReport.Severity,
        RecordedByName: w.IncidentReport.ReportedByUser?.FullName ?? string.Empty,
        AdministeredAt: null,
        AdministeredAtTimeZone: null,
        IncidentDateTime: w.IncidentReport.IncidentDateTime,
        WitnessStatus: w.WitnessStatus,
        WitnessRespondedAt: w.WitnessRespondedAt,
        CreatedAt: w.CreatedAt);
}
