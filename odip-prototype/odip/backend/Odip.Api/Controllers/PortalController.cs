using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Odip.Api.Rostering;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

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
    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;
    private readonly Odip.Application.Interfaces.IObligationTaskService _obligationTasks;
    private readonly TimeProvider _clock;
    private readonly ShiftBreakService _breaks;
    private readonly ShiftHandoverService _handover;
    private readonly ShiftPackageService _package;
    private readonly MedicationAdministrationRecorder _recorder;
    private readonly ShiftRoutineCheckService _routineChecks;

    public PortalController(
        OdipDbContext db, ICurrentTenant currentTenant, IConfiguration? config = null,
        Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null,
        Odip.Application.Interfaces.IObligationTaskService? obligationTasks = null,
        TimeProvider? clock = null,
        ShiftBreakService? breaks = null,
        ShiftHandoverService? handover = null,
        ShiftPackageService? package = null,
        MedicationAdministrationRecorder? recorder = null,
        ShiftRoutineCheckService? routineChecks = null)
    {
        _db = db;
        _currentTenant = currentTenant;
        _config = config;
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
        _obligationTasks = obligationTasks ?? new Odip.Infrastructure.Tasks.ObligationTaskService(db);
        _clock = clock ?? TimeProvider.System;
        _breaks = breaks ?? new ShiftBreakService(db, _clock);
        _handover = handover ?? new ShiftHandoverService(db, _clock);
        _package = package ?? new ShiftPackageService(db, new MedicationSlotService(db, _clock));
        _recorder = recorder ?? new MedicationAdministrationRecorder(db, _notificationRaiser, _obligationTasks, _clock);
        _routineChecks = routineChecks ?? new ShiftRoutineCheckService(db, _clock);
    }

    private DateTime NowUtc => _clock.GetUtcNow().UtcDateTime;

    private int VarianceReviewMinutes => ShiftCompletionMapper.ClampVarianceReviewMinutes(_config?.GetValue<int>("Rostering:VarianceReviewMinutes", 15) ?? 15);

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
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift!, ct)));
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
        var completionDto = activeCompletion is null ? null : await ToShiftCompletionDtoAsync(activeCompletion, shift.ReturnCount, ct);
        var breakDtos = completionDto?.Breaks ?? Array.Empty<ShiftBreakDto>();

        // NEED-TO-KNOW BY SHIFT STATUS AND TIME: the handover, the emergency contacts and the address are for a worker who is doing the shift (InProgress) or
        // is about to (Published, from 48 hours before its rostered start). A worker whose shift is PendingReview, Completed, Cancelled or Draft - or a
        // Published shift further out than that - keeps seeing the shift itself but not the participant's phone numbers, address or the latest handover
        // through it. Withheld = explicit null, with the reason.
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var sensitiveWithheldReason = SensitiveInfoWithheld(shift, provider);
        var showSensitive = sensitiveWithheldReason is null;

        // Handover baton pass (D4): the latest handover from a PREVIOUS shift for this participant, with the caller's
        // own read state, and the last 3 holders. The caller is the shift's own worker (ownership was established).
        var handoverView = showSensitive
            ? await _handover.GetAsync(shift, shift.UserId!.Value, ct)
            : new HandoverView(null, Array.Empty<PortalHandoverTrailEntryDto>());

        // Need-to-know package data: the provider's zone, the critical care facts, emergency contacts, doses due in the
        // rostered window (overdue in provider-local time), routines matched to the window, and whether the caller may
        // record doses (Medication Competency).
        var providerToday = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(NowUtc, provider.Zone));
        var contacts = showSensitive ? await _package.GetEmergencyContactsAsync(participant.Id, providerToday, ct) : null;
        var doses = await _package.GetDosesAsync(shift, provider, includePrn: true, ct);
        var shiftRoutines = ShiftPackageService.MatchRoutines(shift, routines, await _package.GetRoutineChecksAsync(activeCompletion?.Id, ct));

        // The End checklist: what would stop Finish right now (only meaningful while the shift is in progress). Derived from the dose
        // slots already fetched above, so the detail never queries them twice. In ENFORCE mode a worker without a current Medication
        // Competency cannot record a dose, so no dose blocks them; in WARN mode (the default) they can record (flagged), so doses block
        // them like anyone (see ShiftPackageService). A dose whose time has not arrived yet never blocks either.
        var access = await _recorder.CheckRecordingAccessAsync(shift.UserId, ct);
        var finishBlockers = shift.Status == ShiftStatus.InProgress
            ? ShiftPackageService.BuildFinishBlockers(
                doses.Slots, breakRunning: breakDtos.Any(b => b.IsRunning), access.CanRecord, NowUtc, provider.Zone)
            : new List<PortalFinishBlockerDto>();

        // Return context (critique P2) — "return archives the completion and GET /portal/shifts/{id}
        // returns only the active one, so the resubmitting worker sees ReturnCount and nothing about
        // why". Most recent Returned row's reason, independent of the current active completion.
        var lastReturnReason = await _db.ShiftCompletions
            .Where(c => c.ShiftId == shift.Id && !c.IsActive && c.ReviewOutcome == ReviewOutcome.Returned)
            .OrderByDescending(c => c.ReviewedAt)
            .Select(c => c.ReturnReason)
            .FirstOrDefaultAsync(ct);

        return new PortalShiftDetailDto(
            shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.DurationHours,
            shift.Ratio, shift.NightType, shift.Status, shift.Notes,
            ToParticipantSummaryDto(participant),
            routines.Select(ToRoutineDto).ToList(),
            riskEntries.Select(ToRiskEntryDto).ToList(),
            medications.Select(ToMedicationSummaryDto).ToList(),
            completionDto,
            shift.ReturnCount,
            lastReturnReason,
            breakDtos,
            handoverView.Latest,
            handoverView.Trail,
            finishBlockers,
            provider.Id,
            showSensitive ? ShiftPackageService.BuildAtAGlance(participant) : ShiftPackageService.BuildAtAGlance(participant) with { Address = null },
            contacts,
            doses.Slots,
            doses.Prn,
            shiftRoutines,
            access.CanRecord,
            access.Reason,
            access.Code,
            sensitiveWithheldReason);
    }

    /// <summary>Why the participant's handover, emergency contacts and address are not shown for this shift right now (plain language), or null when they are:
    /// the shift's status and, for a Published shift, how far off its rostered start is (<see cref="ShiftPackageService.SensitiveInfoWithheldReason"/>).</summary>
    private string? SensitiveInfoWithheld(Shift shift, ProviderTimeZone provider)
    {
        var (rosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, provider.Id);
        return ShiftPackageService.SensitiveInfoWithheldReason(shift.Status, rosteredStartUtc, NowUtc, provider.Zone);
    }

    /// <summary>Maps a ShiftCompletion to its DTO — thin wrapper so this and RosteringController's
    /// identical mapping need to stay in one place; see <see cref="ShiftCompletionMapper"/>.</summary>
    private Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, int shiftReturnCount, CancellationToken ct) =>
        ShiftCompletionMapper.ToDtoAsync(_db, c, VarianceReviewMinutes, shiftReturnCount, ct, nowUtc: NowUtc);

    /// <summary>
    /// Resolves one of the caller's own shifts (Participant included, draft-excluded — same rule
    /// as every portal shift read), or the 404 ActionResult to short-circuit with. Extracted
    /// (critique P3) from the identical block previously duplicated across GetShiftDetail/
    /// StartShift/FinishShift.
    /// </summary>
    private async Task<(Shift? Shift, ActionResult<ApiResponse<PortalShiftDetailDto>>? Error)> ResolveOwnedShiftAsync(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return (null, NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found.")));

        var shift = await _db.Shifts
            .Include(s => s.Participant)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (shift?.Participant is null || shift.Participant.IsDraft)
            return (null, NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found.")));

        return (shift, null);
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT COMPLETION (design spec §2/§3)
    // ══════════════════════════════════════════════════════════════

    /// <summary>How long before the rostered start a worker may tap Start. Earlier taps get 409 SHIFT_START_TOO_EARLY.</summary>
    public const int EarliestStartLeadMinutes = 60;

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
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        if (shift!.Status != ShiftStatus.Published)
        {
            // Idempotent replay: a worker's retry after a dropped response must read as success, not
            // as a repeat failure (critique P1). SHIFT_NOT_STARTABLE now means only "the database
            // rejected a racing double-Start" — see the DbUpdateException catch below.
            if (shift.Status == ShiftStatus.InProgress)
                return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

            if (shift.Status == ShiftStatus.PendingReview)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift has already been finished and is waiting for review.", ShiftErrorCodes.ShiftAlreadyFinished));

            if (shift.Status == ShiftStatus.Completed)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift has already been reviewed and completed.", ShiftErrorCodes.ShiftAlreadyCompleted));

            if (shift.Status == ShiftStatus.Cancelled)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift has been cancelled.", ShiftErrorCodes.ShiftCancelled));

            // Draft
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been published yet.", ShiftErrorCodes.ShiftNotPublished));
        }

        var providerSettings = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        var now = DateTime.UtcNow;
        var timeZoneId = StateTimeZoneMap.Resolve(providerSettings?.State);

        // F7: variance-at-start, computed once here so the coordinator queue can show it before
        // Finish. Finish still recomputes/overwrites VarianceMinutesStart from the final stored
        // ActualStart — unchanged behaviour there.
        var (rosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, timeZoneId);

        // Early-start guard (PR1 review 4 N1): the manual-start path (Finish with an ActualStart) and
        // late starts are unaffected; only a tap on Start well before the rostered start is refused.
        var earliestStartUtc = rosteredStartUtc.AddMinutes(-EarliestStartLeadMinutes);
        if (now < earliestStartUtc)
        {
            var openLocal = TimeZoneInfo.ConvertTimeFromUtc(
                DateTime.SpecifyKind(earliestStartUtc, DateTimeKind.Utc), ProviderLocalTime.ResolveZone(timeZoneId));
            var openClock = openLocal.ToString("h:mm tt", System.Globalization.CultureInfo.InvariantCulture).ToLowerInvariant();
            var openDay = openLocal.ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture);
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                $"It's too early to start this shift. You can start from {openClock} on {openDay}.", ShiftErrorCodes.ShiftStartTooEarly));
        }

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
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg && pg.ConstraintName == ShiftCompletion.ActiveIndexName)
        {
            // Partial unique index IX_ShiftCompletions_ShiftId_Active rejects a racing second Start —
            // narrowed (critique P3) from catching every DbUpdateException, which mapped any
            // unrelated DB failure to the same misleading "can't be started" message.
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift can't be started right now.", ShiftErrorCodes.ShiftNotStartable));
        }
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    /// <summary>
    /// Worker taps Finish. 409 SHIFT_NOTE_REQUIRED if zero ShiftNote rows exist on the shift,
    /// checked first so the worker gets one clear reason. Supports the manual-start path
    /// (dto.ActualStart supplied while Shift.Status is still Published) per spec §3. On PostgreSQL the whole decision (the blocker check and the
    /// write) runs holding the shift row, the same lock Start Break takes, so the two cannot interleave (see <see cref="ShiftRowLock"/>).
    /// </summary>
    [HttpPost("shifts/{id:guid}/finish")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> FinishShift(
        Guid id, [FromBody] FinishShiftDto dto, CancellationToken ct)
    {
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        // Hold the shift row from here to the commit (PostgreSQL). Start Break takes the same lock, so a break cannot be started in the gap between the
        // blocker check below and the flip to PendingReview - that left a running break on a submitted completion that nobody can end - and two Finish
        // taps from two devices cannot both write. Whatever committed while this waited is visible: the shift is re-read, and every check below judges
        // that state (a Finish that lost the race is then the idempotent replay, a Start Break that won is a "break still running" blocker).
        await using var rowLock = await ShiftRowLock.AcquireAsync(_db, shift!.Id, ct);
        if (rowLock.Held)
        {
            var ownerBeforeWaiting = shift.UserId;
            await _db.Entry(shift).ReloadAsync(ct);
            if (_db.Entry(shift).State == EntityState.Detached || shift.UserId != ownerBeforeWaiting)
                return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));   // deleted or reassigned while this waited
        }

        // Idempotent replay / already-elsewhere guards, checked before the note-required gate — none
        // of these states can be fixed by adding a note, so the note gate would be a misleading error.
        if (shift!.Status == ShiftStatus.PendingReview)
            return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

        if (shift.Status == ShiftStatus.Completed)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has already been reviewed and completed.", ShiftErrorCodes.ShiftAlreadyCompleted));

        if (shift.Status == ShiftStatus.Cancelled)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has been cancelled.", ShiftErrorCodes.ShiftCancelled));

        if (shift.Status == ShiftStatus.Draft)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been published yet.", ShiftErrorCodes.ShiftNotPublished));

        // A shift note is required - or, since the shift package, an explicit "nothing to note" confirmation.
        var hasNote = await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct);
        if (!hasNote && !dto.NothingToNote)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "Add a shift note before finishing.", ShiftErrorCodes.ShiftNoteRequired));

        // Handover (D4): prompted at End but optional - blank is fine, and "nothing to hand over" is an explicit
        // confirmation, not the same as leaving it blank. Writing one AND saying there is nothing is contradictory.
        var handoverText = string.IsNullOrWhiteSpace(dto.HandoverText) ? null : dto.HandoverText.Trim();
        if (dto.NothingToHandOver && handoverText is not null)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Write a handover or confirm there is nothing to hand over, not both.", ShiftErrorCodes.ShiftHandoverConflict));

        // The End checklist, ENFORCED: every dose that has come due in the rostered window needs an outcome (or a "not given this
        // shift" reason, which is a Missed record) and no break may still be running. 422 carries the list, and the current
        // shift detail as data so the client can refresh what it shows. See ShiftPackageService for the two rules that keep the
        // checklist satisfiable (only doses already due, and only for a worker who can record them).
        //
        // Only an InProgress shift is checked. The manual-start path (Published with a supplied ActualStart) has no package route to
        // record a dose - recording needs an InProgress shift (D2) - and no completion for a break, so there is nothing the worker could
        // clear; the coordinator's completion review shows any unrecorded dose. A shift that was never started and supplies no start
        // keeps its existing 409 SHIFT_NOT_IN_PROGRESS below: the worker must be told it hasn't been started, not that doses are outstanding.
        if (shift.Status == ShiftStatus.InProgress)
        {
            var checkedCompletion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive, ct);
            var access = await _recorder.CheckRecordingAccessAsync(shift.UserId, ct);
            var blockers = await _package.GetFinishBlockersAsync(shift, checkedCompletion, access.CanRecord, ct);
            if (blockers.Count > 0)
            {
                var detail = (await BuildShiftDetailDtoAsync(shift, ct)) with { FinishBlockers = blockers };
                var blocked = ApiResponse<PortalShiftDetailDto>.Fail(detail, blockers.Select(b => b.Message).ToList());
                blocked.Code = ShiftErrorCodes.ShiftFinishBlocked;
                return UnprocessableEntity(blocked);
            }
        }

        var now = NowUtc;
        ShiftCompletion completion;

        if (shift.Status == ShiftStatus.Published)
        {
            if (dto.ActualStart is null)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress));

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
                    "Actual start time can't be in the future.", ShiftErrorCodes.ShiftActualStartInFuture));
            if (actualStartUtc < manualRosteredStartUtc.AddHours(-24))
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Actual start time can't be more than 24 hours before the rostered start.", ShiftErrorCodes.ShiftActualStartTooEarly));

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
                    "This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress));
            completion = existing;
        }
        else
        {
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress));
        }

        completion.ActualEnd = now;
        completion.SubmittedAt = now;
        completion.HandoverText = handoverText;
        completion.NothingToHandOver = dto.NothingToHandOver;
        completion.NothingToNoteConfirmed = dto.NothingToNote && !hasNote;
        completion.EndLatitude = dto.Latitude;
        completion.EndLongitude = dto.Longitude;
        completion.GeolocationDeclined = completion.GeolocationDeclined || dto.GeolocationDeclined;

        var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
        completion.VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(completion.ActualStart, rosteredStartUtc);
        completion.VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(completion.ActualEnd.Value, rosteredEndUtc);
        completion.UpdatedAt = now;

        shift.Status = ShiftStatus.PendingReview;
        shift.UpdatedAt = now;

        // NotificationEventType.ShiftCompletionPendingReview — reserved by the notifications
        // spec, wired here now the shift-completion feature exists (design spec §5, sibling
        // event). Recipients are the tenant's Admin/Coordinator users, same as
        // LeaveRequestSubmitted above.
        var workerName = await _db.Users.Where(u => u.Id == shift.UserId!.Value)
            .Select(u => u.FirstName + " " + u.LastName).FirstOrDefaultAsync(ct) ?? "A staff member";
        var reviewRecipients = await _db.Users
            .Where(u => u.IsActive && (u.Role == UserRole.Admin || u.Role == UserRole.Coordinator))
            .ToListAsync(ct);
        foreach (var recipient in reviewRecipients)
        {
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftCompletionPendingReview, "ShiftCompletion", completion.Id,
                new[] { recipient.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftCompletionPendingReviewPayload(
                    recipient.Email, workerName, shift.Participant!.FullName, shift.ServiceDate),
                ct);
        }

        await _db.SaveChangesAsync(ct);
        await rowLock.CommitAsync(ct);
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    // ══════════════════════════════════════════════════════════════
    // RECORD A DOSE FROM THE PACKAGE (shift package, D2/D3)
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Records a dose (any outcome, including "not given" = Missed with a reason) for one of the participant's
    /// medications, from the caller's OWN shift. Scoped tighter than the general
    /// <c>POST medications/{id}/administrations</c>, which stays as it is: the shift must be InProgress, the medication must
    /// belong to the shift's participant and be Active, and a scheduled dose's <c>scheduledAt</c> must be one of the shift
    /// window's due slots (a PRN dose has none). Then the same recorder as the general endpoint applies: Medication
    /// Competency (403 in the provider's Enforce mode; in Warn mode the record is accepted and flagged), idempotency key (200 replay),
    /// one record per slot (409 with the existing record), witness, PRN limits.
    /// </summary>
    [HttpPost("shifts/{id:guid}/medications/{medicationId:guid}/administrations")]
    public async Task<ActionResult<ApiResponse<AdministrationDto>>> RecordShiftDose(
        Guid id, Guid medicationId, [FromBody] CreateAdministrationDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<AdministrationDto>.Fail("Shift not found."));

        var shift = await _db.Shifts.Include(s => s.Participant)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (shift?.Participant is null || shift.Participant.IsDraft)
            return NotFound(ApiResponse<AdministrationDto>.Fail("Shift not found."));

        if (shift.Status != ShiftStatus.InProgress)
        {
            var (message, code) = shift.Status switch
            {
                ShiftStatus.Published => ("This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress),
                ShiftStatus.PendingReview => ("This shift has already been finished and is waiting for review.", ShiftErrorCodes.ShiftAlreadyFinished),
                ShiftStatus.Completed => ("This shift has already been reviewed and completed.", ShiftErrorCodes.ShiftAlreadyCompleted),
                ShiftStatus.Cancelled => ("This shift has been cancelled.", ShiftErrorCodes.ShiftCancelled),
                _ => ("This shift hasn't been published yet.", ShiftErrorCodes.ShiftNotPublished),
            };
            return Conflict(ApiResponse<AdministrationDto>.Fail(message, code));
        }

        var med = await _db.ParticipantMedications
            .FirstOrDefaultAsync(m => m.Id == medicationId && m.ParticipantId == shift.ParticipantId, ct);
        if (med is null)
            return NotFound(ApiResponse<AdministrationDto>.Fail("Medication not found"));
        if (med.Status != MedicationStatus.Active)
            return Conflict(ApiResponse<AdministrationDto>.Fail(
                "This medication isn't active, so it can't be recorded from the shift.", MedicationErrorCodes.MedicationNotActive));

        if (med.Type == MedicationType.Regular)
        {
            var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(shift);
            var dueSlots = Odip.Domain.Medications.MedicationSlotCalculator.EnumerateSlots(med, windowStart, windowEnd);
            if (dto.ScheduledAt is not { } scheduledAt || !dueSlots.Contains(scheduledAt))
                return UnprocessableEntity(ApiResponse<AdministrationDto>.Fail(
                    "This isn't a dose due in this shift. Choose one of the doses listed for the shift.", MedicationErrorCodes.DoseSlotNotDue));
        }
        else if (dto.ScheduledAt is not null)
        {
            return UnprocessableEntity(ApiResponse<AdministrationDto>.Fail(
                "An as-needed (PRN) dose has no scheduled time.", MedicationErrorCodes.DoseSlotNotDue));
        }

        // The slot is a zone-less provider-local wall-clock value; the trip link is irrelevant to a shift.
        dto = dto with
        {
            ScheduledAt = dto.ScheduledAt is { } s ? DateTime.SpecifyKind(s, DateTimeKind.Unspecified) : null,
            TripInstanceId = null,
        };

        var lowerBound = await EarliestDoseTimeAsync(shift, ct);
        var result = await _recorder.RecordAsync(
            new RecordAdministrationRequest(
                medicationId, dto, staffId, GetCallerName(), RequiredParticipantId: shift.ParticipantId, AdministeredAtLowerBoundUtc: lowerBound), ct);

        // Every instant this endpoint returns is UTC with a Z. The record a request just created carries Kind=Utc, but the one a replay
        // or a 409 hands back is read from PostgreSQL as Kind=Unspecified and would otherwise serialise without the Z - so the same field
        // would parse differently on the retry path. (scheduledAt stays a provider-local wall-clock value, as it always was.)
        if (result.Administration is { } administration)
            result = result with { Administration = WithUtcInstants(administration) };
        return result.ToActionResult(this);
    }

    /// <summary>
    /// The earliest instant a dose recorded from this shift can have been given: the EARLIER of the start of any of the shift's completions and an hour
    /// before the rostered start. The active completion's start is not enough on its own: a coordinator Return archives the completion and the worker's
    /// re-Start gives the shift a NEW one starting at that moment, and a worker who gives a dose on arrival and taps Start a few minutes later has a
    /// start after the dose; either way the true time of the dose would be refused (scenarios A and B of review 3, finding m2), leaving the worker to
    /// chart a false time. The rostered start less the early window (the same 60 minutes an Administered dose may be charted before its slot) covers
    /// both. The upper bound (now, within the device-clock tolerance) is unchanged.
    /// </summary>
    private async Task<DateTime> EarliestDoseTimeAsync(Shift shift, CancellationToken ct)
    {
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var (rosteredStartLocal, _) = ProviderLocalTime.RosteredWindowLocal(shift);
        var rosteredLimit = ProviderLocalTime.LocalToUtc(rosteredStartLocal, provider.Zone).AddMinutes(-MedicationAdministrationRecorder.EarlyAdministrationMinutes);

        // Every completion of the shift, the archived ones too (a Return archives the one the worker started).
        var earliestStart = await _db.ShiftCompletions
            .Where(c => c.ShiftId == shift.Id)
            .MinAsync(c => (DateTime?)c.ActualStart, ct);
        return earliestStart is { } start && ProviderLocalTime.AsUtc(start) < rosteredLimit ? ProviderLocalTime.AsUtc(start) : rosteredLimit;
    }

    private static AdministrationDto WithUtcInstants(AdministrationDto a) => a with
    {
        AdministeredAt = ProviderLocalTime.AsUtc(a.AdministeredAt),
        WitnessRequestedAt = ProviderLocalTime.AsUtc(a.WitnessRequestedAt),
        WitnessRespondedAt = ProviderLocalTime.AsUtc(a.WitnessRespondedAt),
        PrnOutcomeAt = ProviderLocalTime.AsUtc(a.PrnOutcomeAt),
        CreatedAt = ProviderLocalTime.AsUtc(a.CreatedAt),
    };

    // ══════════════════════════════════════════════════════════════
    // HANDOVER (shift package, D4)
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The next worker marks the participant's latest handover as READ - who and when are recorded and audited. Only
    /// for the caller's OWN shift, before it is finished (InProgress, or Published once the handover is shown: from 48 hours before the rostered
    /// start; earlier it is 404 SHIFT_HANDOVER_NOT_FOUND, there is nothing visible to read). Idempotent. The optional
    /// `completionId` names the handover the worker saw: if a newer one has arrived, 409 SHIFT_HANDOVER_CHANGED (with
    /// the refreshed shift as data) and nothing is recorded. 404 SHIFT_HANDOVER_NOT_FOUND when there is nothing to read.
    /// </summary>
    [HttpPost("shifts/{id:guid}/handover/ack")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> AcknowledgeHandover(
        Guid id, [FromBody] AcknowledgeHandoverDto? dto, CancellationToken ct)
    {
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        ActionResult? stateConflict = shift!.Status switch
        {
            ShiftStatus.Published or ShiftStatus.InProgress => null,
            ShiftStatus.PendingReview => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has already been finished and is waiting for review.", ShiftErrorCodes.ShiftAlreadyFinished)),
            ShiftStatus.Completed => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has already been reviewed and completed.", ShiftErrorCodes.ShiftAlreadyCompleted)),
            ShiftStatus.Cancelled => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift has been cancelled.", ShiftErrorCodes.ShiftCancelled)),
            _ => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been published yet.", ShiftErrorCodes.ShiftNotPublished)),
        };
        if (stateConflict is not null) return stateConflict;

        // A Published shift whose need-to-know window has not opened does not show the handover, so there is nothing the worker has seen to mark as read
        // (an acknowledge without a completionId would otherwise record the latest handover as read, unseen).
        var withheld = SensitiveInfoWithheld(shift, await ProviderTimeZoneResolver.ResolveAsync(_db, ct));
        if (withheld is not null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail(withheld, ShiftErrorCodes.ShiftHandoverNotFound));

        var outcome = await _handover.AcknowledgeAsync(shift, shift.UserId!.Value, dto?.CompletionId, ct);
        switch (outcome)
        {
            case HandoverAckOutcome.NothingToAcknowledge:
                return NotFound(ApiResponse<PortalShiftDetailDto>.Fail(
                    "There's no handover to mark as read.", ShiftErrorCodes.ShiftHandoverNotFound));

            case HandoverAckOutcome.Changed:
            {
                var current = await BuildShiftDetailDtoAsync(shift, ct);
                var changed = ApiResponse<PortalShiftDetailDto>.Fail(
                    current, new List<string> { "There is a newer handover. Read it before marking it as read." });
                changed.Code = ShiftErrorCodes.ShiftHandoverChanged;
                return Conflict(changed);
            }

            default:
                return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // BREAKS (shift package) - only while the shift is InProgress, on the caller's OWN shift
    // ══════════════════════════════════════════════════════════════
    //
    // A break hangs off the shift's active ShiftCompletion. Rules (ShiftBreakRules/ShiftBreakService): at most one
    // running; every break inside [actual start, now]; no overlaps; start/end stamp the SERVER clock, corrections
    // go through PUT. Billing is unaffected (rostered hours); net worked minutes ride on the completion DTO.
    // Every endpoint returns the refreshed shift detail so the client can replace its cache in one step.

    /// <summary>Starts a break now. 409 SHIFT_BREAK_ALREADY_RUNNING if one is already running.</summary>
    [HttpPost("shifts/{id:guid}/breaks/start")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> StartBreak(Guid id, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        var result = await _breaks.StartAsync(completion!, shift!.UserId!.Value, ct);
        return await ToBreakResponseAsync(shift, result, ct);
    }

    /// <summary>Ends the running break now. Idempotent: ending an already-ended break is a no-op success.</summary>
    [HttpPost("shifts/{id:guid}/breaks/{breakId:guid}/end")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> EndBreak(Guid id, Guid breakId, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        return await ToBreakResponseAsync(shift!, await _breaks.EndAsync(completion!, breakId, ct), ct);
    }

    /// <summary>Corrects a break's times (UTC) before Finish. `endedAt` null keeps a running break running.</summary>
    [HttpPut("shifts/{id:guid}/breaks/{breakId:guid}")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> EditBreak(
        Guid id, Guid breakId, [FromBody] EditShiftBreakDto dto, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        return await ToBreakResponseAsync(shift!, await _breaks.EditAsync(completion!, breakId, dto.StartedAt, dto.EndedAt, ct), ct);
    }

    /// <summary>Removes a break before Finish (the delete is audited).</summary>
    [HttpDelete("shifts/{id:guid}/breaks/{breakId:guid}")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> DeleteBreak(Guid id, Guid breakId, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        return await ToBreakResponseAsync(shift!, await _breaks.DeleteAsync(completion!, breakId, ct), ct);
    }

    // ══════════════════════════════════════════════════════════════
    // ROUTINE TICKS (persisted: a tick used to live only in the browser)
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// Ticks a routine done for the caller's OWN shift (InProgress only). The routine must be one of the routines matched to the shift's
    /// rostered window (the <c>shiftRoutines</c> list), else 404 SHIFT_ROUTINE_NOT_FOUND. Idempotent: ticking again keeps the first who and when.
    /// Returns the refreshed shift detail like every package write.
    /// </summary>
    [HttpPost("shifts/{id:guid}/routines/{routineId:guid}/check")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> CheckRoutine(Guid id, Guid routineId, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        var occurrence = await FindRoutineOccurrenceAsync(shift!, routineId, ct);
        if (occurrence is null) return RoutineNotInShift();

        await _routineChecks.CheckAsync(completion!, occurrence, shift!.UserId!.Value, ct);
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    /// <summary>Unticks a routine for the caller's OWN shift (InProgress only). Idempotent. The removal is audited.</summary>
    [HttpDelete("shifts/{id:guid}/routines/{routineId:guid}/check")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> UncheckRoutine(Guid id, Guid routineId, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        var occurrence = await FindRoutineOccurrenceAsync(shift!, routineId, ct);
        if (occurrence is null) return RoutineNotInShift();

        await _routineChecks.UncheckAsync(completion!.Id, routineId, ct);
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift!, ct)));
    }

    /// <summary>The matched occurrence of one of the participant's ACTIVE routines in the shift's rostered window, or null when it is not in the window.</summary>
    private async Task<Odip.Domain.Rostering.RoutineOccurrence?> FindRoutineOccurrenceAsync(Shift shift, Guid routineId, CancellationToken ct)
    {
        var routine = await _db.ParticipantRoutines.FirstOrDefaultAsync(r => r.Id == routineId && r.ParticipantId == shift.ParticipantId && r.IsActive, ct);
        if (routine is null) return null;
        var (windowStart, windowEnd) = ProviderLocalTime.RosteredWindowLocal(shift);
        return Odip.Domain.Rostering.RoutineWindowMatcher.Match(new[] { routine }, windowStart, windowEnd).FirstOrDefault();
    }

    private ActionResult<ApiResponse<PortalShiftDetailDto>> RoutineNotInShift() =>
        NotFound(ApiResponse<PortalShiftDetailDto>.Fail("This routine isn't part of this shift.", ShiftErrorCodes.ShiftRoutineNotFound));

    /// <summary>
    /// The caller's own shift, required to be InProgress with an active completion (the state every package write
    /// needs), or the 404/409 to short-circuit with. 404 for not-yours/not-found, same as every portal action; the
    /// 409 codes are the ones Start already uses for the other states.
    /// </summary>
    private async Task<(Shift? Shift, ShiftCompletion? Completion, ActionResult<ApiResponse<PortalShiftDetailDto>>? Error)> ResolveInProgressShiftAsync(
        Guid id, CancellationToken ct)
    {
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return (null, null, error);

        var conflict = NotInProgressConflict(shift!.Status);
        if (conflict is not null) return (null, null, conflict);

        var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive, ct);
        if (completion is null)
            return (null, null, Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress)));

        return (shift, completion, null);
    }

    /// <summary>
    /// The 409 a package write answers when the shift is not InProgress, by what state it is in; null for InProgress. An ActionResult (a class),
    /// NOT ActionResult&lt;T&gt; (a struct): null must stay null, not be converted into a wrapped null.
    /// </summary>
    private ActionResult? NotInProgressConflict(ShiftStatus status) => status switch
    {
        ShiftStatus.InProgress => null,
        ShiftStatus.Published => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
            "This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress)),
        ShiftStatus.PendingReview => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
            "This shift has already been finished and is waiting for review.", ShiftErrorCodes.ShiftAlreadyFinished)),
        ShiftStatus.Completed => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
            "This shift has already been reviewed and completed.", ShiftErrorCodes.ShiftAlreadyCompleted)),
        ShiftStatus.Cancelled => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
            "This shift has been cancelled.", ShiftErrorCodes.ShiftCancelled)),
        _ => Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
            "This shift hasn't been published yet.", ShiftErrorCodes.ShiftNotPublished)),
    };

    private async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> ToBreakResponseAsync(
        Shift shift, ShiftBreakResult result, CancellationToken ct)
    {
        switch (result.Outcome)
        {
            case ShiftBreakOutcome.Ok:
                return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));

            case ShiftBreakOutcome.ShiftNotInProgress:
            {
                // The shift changed state between this request resolving it and the break being written (a Finish on another device won the
                // race). Answer exactly as a request arriving a moment later would: by the state the shift is in now.
                await _db.Entry(shift).ReloadAsync(ct);
                return NotInProgressConflict(shift.Status) ?? Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift is no longer in progress.", ShiftErrorCodes.ShiftNotInProgress));
            }

            case ShiftBreakOutcome.NotFound:
                return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Break not found.", ShiftErrorCodes.ShiftBreakNotFound));

            case ShiftBreakOutcome.AlreadyRunning:
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "A break is already running. End it before starting another.", ShiftErrorCodes.ShiftBreakAlreadyRunning));

            default: // Invalid
                var (message, code) = result.Violation switch
                {
                    ShiftBreakViolation.BeforeShiftStart => ("A break can't start before the shift started.", ShiftErrorCodes.ShiftBreakBeforeShiftStart),
                    ShiftBreakViolation.InFuture => ("A break can't be in the future.", ShiftErrorCodes.ShiftBreakInFuture),
                    ShiftBreakViolation.EndNotAfterStart => ("A break must end after it starts.", ShiftErrorCodes.ShiftBreakEndNotAfterStart),
                    ShiftBreakViolation.EndRequired => ("A finished break needs an end time.", ShiftErrorCodes.ShiftBreakEndRequired),
                    _ => ("This break overlaps another break.", ShiftErrorCodes.ShiftBreakOverlap),
                };
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(message, code));
        }
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

        var incidentIds = await GetIncidentIdsByShiftNoteIdsAsync(notes.Select(n => n.Id).ToList(), ct);
        return Ok(ApiResponse<List<ShiftNoteDto>>.Ok(
            notes.Select(n => ToShiftNoteDto(n, LookupIncidentId(incidentIds, n.Id))).ToList()));
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

        // Item 9 of the connection map: a flagged note raises a FlaggedNoteFollowUp obligation
        // task — "decide whether an incident is needed".
        await RaiseOrCompleteFlaggedNoteTaskAsync(note, ct);

        await _db.SaveChangesAsync(ct);

        // A brand-new note can't already be referenced by an incident.
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note, incidentId: null)));
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

        // Item 9: an edit may introduce or change the flagged categories — raise/refresh the
        // FlaggedNoteFollowUp task. (If flags cleared to None, the existing task — if any — is
        // simply left for the incident-created/acknowledge-flags completion paths.)
        await RaiseOrCompleteFlaggedNoteTaskAsync(note, ct);

        await _db.SaveChangesAsync(ct);

        var incidentId = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId == note.Id)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => (Guid?)i.Id)
            .FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note, incidentId)));
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

        // Item 9: acknowledging the flags closes the FlaggedNoteFollowUp task — the coordinator
        // has now made the "does this need an incident?" call, even if the answer was no.
        await _obligationTasks.CompleteAsync($"flagged-note:{note.Id}", ct);

        await _db.SaveChangesAsync(ct);

        var incidentId = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId == note.Id)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => (Guid?)i.Id)
            .FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note, incidentId)));
    }

    /// <summary>
    /// Item 9 of the connection map: raises (or, if one already exists and is still open,
    /// refreshes) the FlaggedNoteFollowUp task when this note is currently flagged. Deliberately
    /// does NOT complete an existing task when the note's flags clear back to None on an edit —
    /// per spec, only an incident being filed against this note (IncidentsController.Create) or
    /// the coordinator acknowledging the flags closes it. Shared by CreateShiftNote/UpdateShiftNote.
    /// </summary>
    private async Task RaiseOrCompleteFlaggedNoteTaskAsync(ShiftNote note, CancellationToken ct)
    {
        if (note.FlaggedCategories != ShiftNoteFlagCategory.None)
        {
            var categories = string.Join(", ", ShiftNoteKeywordVocabulary.ToCategoryNames(note.FlaggedCategories));
            await _obligationTasks.EnsureAsync(new Odip.Application.Interfaces.ObligationTaskSpec(
                SourceKey: $"flagged-note:{note.Id}",
                Type: TaskType.FlaggedNoteFollowUp,
                Title: $"Flagged shift note ({categories}) — decide whether an incident is needed",
                DueDate: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)),
                LinkTo: "/incidents?view=flagged-notes",
                ShiftNoteId: note.Id, ShiftId: note.ShiftId), ct);
        }
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

        // Item 9: approving or declining closes the MedicationWitness obligation task either way
        // — the sign-off has happened, whichever way it went.
        await _obligationTasks.CompleteAsync($"med-witness:{admin.Id}", ct);

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

        // NotificationEventType.LeaveRequestSubmitted — recipients are the tenant's
        // Admin/Coordinator users (design spec §5). One RaiseAsync call per recipient so each
        // outbox row's payload carries that recipient's own email.
        var requesterName = await _db.Users.Where(u => u.Id == staffId.Value)
            .Select(u => u.FirstName + " " + u.LastName).FirstOrDefaultAsync(ct) ?? "A staff member";
        var leaveRecipients = await _db.Users
            .Where(u => u.IsActive && (u.Role == UserRole.Admin || u.Role == UserRole.Coordinator))
            .ToListAsync(ct);
        foreach (var recipient in leaveRecipients)
        {
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.LeaveRequestSubmitted, "LeaveRequest", leave.Id,
                new[] { recipient.Id },
                new Odip.Infrastructure.Notifications.Templates.LeaveRequestSubmittedPayload(
                    recipient.Email, requesterName, dto.LeaveType.ToString(), dto.StartDate, dto.EndDate),
                ct);
        }

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

    private static ShiftNoteDto ToShiftNoteDto(ShiftNote n, Guid? incidentId) => new(
        n.Id, n.ShiftId, n.AuthorUserId, n.AuthorName, n.Body, n.CreatedAt, n.UpdatedAt,
        ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories), n.FlagsAcknowledgedAt, incidentId);

    /// <summary>
    /// Connection-map reverse link (Deliverable 2): for the given shift-note ids, the newest
    /// active IncidentReport whose ShiftNoteId points back at each one — ONE query for the whole
    /// batch (never per-row), same idiom as MedicationsController's administration-id lookup.
    /// </summary>
    private async Task<Dictionary<Guid, Guid>> GetIncidentIdsByShiftNoteIdsAsync(IReadOnlyCollection<Guid> shiftNoteIds, CancellationToken ct)
    {
        if (shiftNoteIds.Count == 0) return new Dictionary<Guid, Guid>();
        var rows = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId != null && shiftNoteIds.Contains(i.ShiftNoteId.Value))
            .Select(i => new { NoteId = i.ShiftNoteId!.Value, i.Id, i.CreatedAt })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.NoteId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First().Id);
    }

    /// <summary>Dictionary&lt;Guid, Guid&gt;.GetValueOrDefault returns Guid.Empty (not null) for a
    /// missing key, which would wrongly stand in for "no incident" — this is the null-correct
    /// lookup every incident-id-map read in this class uses instead.</summary>
    private static Guid? LookupIncidentId(Dictionary<Guid, Guid> map, Guid key) =>
        map.TryGetValue(key, out var incidentId) ? incidentId : null;

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
