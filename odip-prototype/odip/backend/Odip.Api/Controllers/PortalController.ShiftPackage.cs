using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

public partial class PortalController
{
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
            .Where(Shift.VisibleToWorker)
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == staffId.Value, ct);
        if (shift?.Participant is null || !Participant.ServicesBegun(shift.Participant))
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
        var provider = await ProviderTimeZoneResolver.ForShiftAsync(_db, shift, ct);
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
        AmendedAt = ProviderLocalTime.AsUtc(a.AmendedAt),
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
        var withheld = SensitiveInfoWithheld(shift, await ProviderTimeZoneResolver.ForShiftAsync(_db, shift, ct));
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
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> StartBreak(
        Guid id, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] StartBreakDto? dto, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        var result = await _breaks.StartAsync(completion!, shift!.UserId!.Value, ct, dto?.BreakId, dto?.StartedAt);
        return await ToBreakResponseAsync(shift, result, ct);
    }

    /// <summary>Ends the running break now. Idempotent: ending an already-ended break is a no-op success.</summary>
    [HttpPost("shifts/{id:guid}/breaks/{breakId:guid}/end")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> EndBreak(
        Guid id, Guid breakId, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] EndBreakDto? dto, CancellationToken ct)
    {
        var (shift, completion, error) = await ResolveInProgressShiftAsync(id, ct);
        if (error is not null) return error;

        return await ToBreakResponseAsync(shift!, await _breaks.EndAsync(completion!, breakId, ct, dto?.EndedAt), ct);
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

    private static readonly (string Message, string Code) TooOld =
        ("That time is more than 48 hours ago, so it can't be sent.", ShiftErrorCodes.ShiftClientTimeTooOld);

    /// <summary>The 400 for a client-recorded time outside <see cref="ClientTimeRules"/>' bounds, or null when it is inside them.</summary>
    private static (string Message, string Code)? ClientTimeError(ClientTimeViolation v) => v switch
    {
        ClientTimeViolation.InFuture => ("That time is in the future.", ShiftErrorCodes.ShiftClientTimeInFuture),
        ClientTimeViolation.TooOld => TooOld,
        ClientTimeViolation.BeforeStart => ("That time is before the shift started.", ShiftErrorCodes.ShiftClientTimeBeforeStart),
        _ => null,
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

            case ShiftBreakOutcome.IdConflict:
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail("This break can't be saved.", ShiftErrorCodes.ShiftBreakIdConflict));

            case ShiftBreakOutcome.AlreadyRunning:
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "A break is already running. End it before starting another.", ShiftErrorCodes.ShiftBreakAlreadyRunning));

            default: // Invalid
                var (message, code) = result.Violation switch
                {
                    ShiftBreakViolation.BeforeShiftStart => ("A break can't start before the shift started.", ShiftErrorCodes.ShiftBreakBeforeShiftStart),
                    ShiftBreakViolation.InFuture => ("A break can't be in the future.", ShiftErrorCodes.ShiftBreakInFuture),
                    ShiftBreakViolation.EndNotAfterStart => ("A break must end after it starts.", ShiftErrorCodes.ShiftBreakEndNotAfterStart),
                    ShiftBreakViolation.ClientTimeTooOld => TooOld,
                    _ => ("This break overlaps another break.", ShiftErrorCodes.ShiftBreakOverlap),
                };
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(message, code));
        }
    }
}
