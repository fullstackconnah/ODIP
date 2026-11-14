using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Rostering;
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
    // SHIFT COMPLETION (design spec §2/§3)
    // ══════════════════════════════════════════════════════════════

    /// <summary>How long before the rostered start a worker may tap Start. Earlier taps get 409 SHIFT_START_TOO_EARLY.</summary>
    public const int EarliestStartLeadMinutes = 60;

    /// <summary>The refusal text for a Start before the window opens (a shift, or a group activity row), in the shift's own zone.</summary>
    public static string TooEarlyMessage(DateTime earliestStartUtc, string timeZoneId)
    {
        var openLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(earliestStartUtc, DateTimeKind.Utc), ProviderLocalTime.ResolveZone(timeZoneId));
        var openClock = openLocal.ToString("h:mm tt", System.Globalization.CultureInfo.InvariantCulture).ToLowerInvariant();
        var openDay = openLocal.ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture);
        return $"It's too early to start this shift. You can start from {openClock} on {openDay}.";
    }

    /// <summary>How far either actual time may move at Finish (owner decision 3, 2026-10-14). The portal's finish flow mirrors it.</summary>
    public const int MaxTimeAdjustmentMinutes = 15;
    /// <summary>How old an online re-sent finish tap (<c>EndTappedAt</c>) may be.</summary>
    private static readonly TimeSpan EndTapMaxAge = TimeSpan.FromMinutes(30);

    /// <summary>The longest reason for a moved time; the finish flow's counter mirrors it.</summary>
    public const int MaxTimeAdjustmentReasonLength = 500;

    /// <summary>Kilometres driven with the participant: 0 to this (owner decision 4).</summary>
    public const decimal MaxKilometres = 2000m;

    /// <summary>Provider travel (travel PR-A1): minutes per leg, whole, 0 to this.</summary>
    public const int MaxTravelMinutes = 480;

    /// <summary>The coded refusal for the four travel legs, or null when they are all fine. One rule for Finish and the staff edit; each value is checked on its own.</summary>
    public static (string Message, string Code)? CheckTravel(double? preMinutes, double? preKm, double? postMinutes, double? postKm)
    {
        if (new[] { preMinutes, postMinutes }.Any(m => m is { } v && (v < 0d || v > MaxTravelMinutes || v != Math.Floor(v))))
            return ("Enter whole minutes from 0 to 480.", ShiftErrorCodes.ShiftTravelMinutesOutOfRange);
        if (new[] { preKm, postKm }.Any(k => k is < 0d or > (double)MaxKilometres))
            return ("Enter kilometres from 0 to 2,000.", ShiftErrorCodes.ShiftTravelKilometresOutOfRange);
        return null;
    }

    public static decimal? TravelKm(double? km) => km is { } v ? Math.Round((decimal)v, 1, MidpointRounding.AwayFromZero) : null;
    public static int? TravelMinutes(double? minutes) => minutes is { } v ? (int)v : null;

    private static DateTime TruncateToMinute(DateTime t) => new(t.Ticks - t.Ticks % TimeSpan.TicksPerMinute, DateTimeKind.Utc);

    /// <summary>
    /// Worker taps Start on one of their own Published shifts. ActualStart/StartedAt are the
    /// server's own clock (<see cref="NowUtc"/>) — the client never supplies the "real" timestamp, only an
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

        var now = NowUtc;
        var startStamp = dto.StartedAt is { } startedIn ? ShiftBreakRules.ToUtc(startedIn) : now;   // a queued tap: the phone's time, inside ClientTimeRules' bounds
        if (dto.StartedAt is not null && ClientTimeError(ClientTimeRules.Check(startStamp, now, null)) is { } lateStart)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(lateStart.Message, lateStart.Code));
        var timeZoneId = (await ProviderTimeZoneResolver.ForShiftAsync(_db, shift, ct)).Id;   // the shift's place can have its own zone; the completion saves it

        // F7: variance-at-start, computed once here so the coordinator queue can show it before
        // Finish. Finish still recomputes/overwrites VarianceMinutesStart from the final stored
        // ActualStart — unchanged behaviour there.
        var (rosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, timeZoneId);

        // Early-start guard (PR1 review 4 N1): the manual-start path (Finish with an ActualStart) and
        // late starts are unaffected; only a tap on Start well before the rostered start is refused.
        var earliestStartUtc = rosteredStartUtc.AddMinutes(-EarliestStartLeadMinutes);
        if (startStamp < earliestStartUtc)
        {
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(TooEarlyMessage(earliestStartUtc, timeZoneId), ShiftErrorCodes.ShiftStartTooEarly));
        }

        // The location check (location PR2): the coordinates live only in `dto` here. They go into Evaluate by value and nothing keeps them - the
        // completion gets the answer, the distance and the accuracy, never a latitude or longitude. It runs after every guard above and cannot fail the Start.
        var place = shift.ServiceLocationId is { } placeId
            ? await _db.ServiceLocations.AsNoTracking().FirstOrDefaultAsync(l => l.Id == placeId && l.TenantId == shift.TenantId, ct)
            : null;
        var check = LocationCheck.Evaluate(place, dto.Latitude, dto.Longitude, dto.AccuracyMetres, dto.GeolocationDeclined, queued: dto.StartedAt is not null);
        var typedReason = check.Status is (LocationCheckStatus.Unavailable or LocationCheckStatus.NotAtLocation) ? LocationCheck.CleanReason(dto.LocationReason) : null;

        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(),
            TenantId = shift.TenantId,
            ShiftId = shift.Id,
            ActualStart = startStamp,
            TimeZoneId = timeZoneId,
            GeolocationDeclined = dto.GeolocationDeclined,
            LocationCheck = check.Status,
            LocationDistanceMetres = check.DistanceMetres,
            LocationAccuracyMetres = check.AccuracyMetres,
            LocationReason = dto.StartedAt is not null   // a queued Start keeps both facts in the one column
                ? LocationCheck.CleanReason(typedReason is null ? LocationCheck.StartedOfflineReason : $"{LocationCheck.StartedOfflineReason}: {typedReason}")
                : typedReason ?? check.DefaultReason,
            LocationCheckedAt = startStamp,
            StartTimeReason = ShiftTimeRules.CleanReason(dto.StartTimeReason),
            StartWasManual = false,
            SubmittedByUserId = shift.UserId!.Value,
            StartedAt = now,
            VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(startStamp, rosteredStartUtc),
            SentFromOffline = dto.StartedAt is not null,
            StartSentFromOffline = dto.StartedAt is not null,
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
    /// The worker's reason for starting away from the place, asked AFTER Start because only the server knows the distance. Text only, never a coordinate.
    /// The shift's own worker (the same 404 ownership check as Start); it saves on the active completion while the shift is InProgress and the check was
    /// NotAtLocation or Unavailable. Saving again overwrites.
    /// </summary>
    [HttpPost("shifts/{id:guid}/location-reason")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> SaveLocationReason(
        Guid id, [FromBody] LocationReasonDto dto, CancellationToken ct)
    {
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        if (shift!.Status != ShiftStatus.InProgress)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail("This shift isn't in progress.", ShiftErrorCodes.ShiftNotInProgress));

        var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive, ct);
        if (completion is null || completion.LocationCheck is not (LocationCheckStatus.NotAtLocation or LocationCheckStatus.Unavailable)
            || completion.StartSentFromOffline)   // a queued Start's reason is not the worker's to replace or clear
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail("There's nothing to explain for this start.", ShiftErrorCodes.ShiftLocationReasonNotNeeded));

        completion.LocationReason = LocationCheck.CleanReason(dto.Reason);
        completion.UpdatedAt = NowUtc;
        await _db.SaveChangesAsync(ct);
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

        // A queued Finish carries the phone's time. Its future/age bounds run before the blockers, so an over-age time is a 400, not a 422.
        var now = NowUtc;
        // EndTappedAt is the tap an online re-send carries: it is the end like FinishedAt, but the phone is online, so it is not marked offline, it is
        // at most EndTapMaxAge old, and the dose blockers below are judged at the server's now.
        var endStamp = dto.FinishedAt is { } finishedIn ? ShiftBreakRules.ToUtc(finishedIn) : dto.EndTappedAt is { } tappedIn ? ShiftBreakRules.ToUtc(tappedIn) : now;
        var clientEnd = dto.FinishedAt is not null || dto.EndTappedAt is not null;
        if (clientEnd && ClientTimeError(ClientTimeRules.Check(endStamp, now, null)) is { } lateEnd)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(lateEnd.Message, lateEnd.Code));
        if (dto.FinishedAt is null && dto.EndTappedAt is not null && endStamp < now - EndTapMaxAge)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "That finish time is too old to send. Finish the shift again.", ShiftErrorCodes.ShiftClientTimeTooOld));

        // A shift note is required - or, since the shift package, an explicit "nothing to note" confirmation - unless the worker is adding the details later.
        var hasNote = await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct);
        if (!hasNote && !dto.NothingToNote && !dto.DetailsLater)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "Add a shift note before finishing.", ShiftErrorCodes.ShiftNoteRequired));

        // Handover (D4): prompted at End but optional - blank is fine, and "nothing to hand over" is an explicit
        // confirmation, not the same as leaving it blank. Writing one AND saying there is nothing is contradictory.
        var handoverText = string.IsNullOrWhiteSpace(dto.HandoverText) ? null : dto.HandoverText.Trim();
        if (dto.NothingToHandOver && handoverText is not null)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Write a handover or confirm there is nothing to hand over, not both.", ShiftErrorCodes.ShiftHandoverConflict));

        // The finish flow's inputs are checked here, each with its own code, not by model validation: a framework 400 has no code for the
        // portal to land on its times step (the ReturnCompletionDto F2 precedent).
        if (dto.TimeAdjustmentReason?.Trim().Length > MaxTimeAdjustmentReasonLength)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                $"Keep the reason to {MaxTimeAdjustmentReasonLength} characters.", ShiftErrorCodes.ShiftTimeAdjustmentReasonTooLong));
        if (dto.Kilometres is < 0d or > (double)MaxKilometres)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Enter kilometres from 0 to 2,000.", ShiftErrorCodes.ShiftKilometresOutOfRange));
        if (CheckTravel(dto.PreShiftTravelMinutes, dto.PreShiftTravelKilometres, dto.PostShiftTravelMinutes, dto.PostShiftTravelKilometres) is { } badTravel)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(badTravel.Message, badTravel.Code));

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
            var access = await _recorder.CheckRecordingAccessAsync(shift.UserId, shift.TenantId, ct);
            var blockers = await _package.GetFinishBlockersAsync(shift, checkedCompletion, access.CanRecord, ct, asOfUtc: dto.FinishedAt is not null ? endStamp : now);
            if (blockers.Count > 0)
            {
                var detail = (await BuildShiftDetailDtoAsync(shift, ct)) with { FinishBlockers = blockers };
                var blocked = ApiResponse<PortalShiftDetailDto>.Fail(detail, blockers.Select(b => b.Message).ToList());
                blocked.Code = ShiftErrorCodes.ShiftFinishBlocked;
                return UnprocessableEntity(blocked);
            }
        }

        ShiftCompletion completion;

        if (shift.Status == ShiftStatus.Published)
        {
            if (dto.ActualStart is null)
                return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                    "This shift hasn't been started.", ShiftErrorCodes.ShiftNotInProgress));

            var timeZoneId = (await ProviderTimeZoneResolver.ForShiftAsync(_db, shift, ct)).Id;   // the shift's place can have its own zone; the completion saves it

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
                TenantId = shift.TenantId,
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

        // Only now is there an actual start to judge the phone's finish time against.
        if (clientEnd && ClientTimeError(ClientTimeRules.Check(endStamp, now, completion.ActualStart)) is { } beforeStart)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(beforeStart.Message, beforeStart.Code));

        // Owner decision 3: either actual time may move up to MaxTimeAdjustmentMinutes from the server's stamp, with a reason. The worker picks
        // whole minutes, so both stamps are compared truncated to the minute, and picking the stamp's own minute is no change. The manual-start
        // path has no start stamp (its ActualStart keeps the F3 bounds above), so only the end rule applies to it.
        var limit = TimeSpan.FromMinutes(MaxTimeAdjustmentMinutes);
        var nowMinute = TruncateToMinute(endStamp);
        var stampMinute = TruncateToMinute(completion.ActualStart);
        DateTime? askedStart = shift.Status == ShiftStatus.InProgress && dto.ActualStart is { } startIn ? TruncateToMinute(ShiftBreakRules.ToUtc(startIn)) : null;
        DateTime? askedEnd = dto.ActualEnd is { } endIn ? TruncateToMinute(ShiftBreakRules.ToUtc(endIn)) : null;   // whole minutes, as the worker picks them
        if (askedEnd > now + ShiftBreakRules.ClockSkewAllowance)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Your finish time can't be in the future.", ShiftErrorCodes.ShiftActualEndInFuture));
        var startMoved = askedStart is not null && askedStart != stampMinute;
        var endMoved = askedEnd < nowMinute;   // this minute, or a fast phone's few minutes ahead, is the Finish instant itself
        if ((startMoved && (askedStart!.Value - stampMinute).Duration() > limit) || (endMoved && nowMinute - askedEnd!.Value > limit))
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                $"You can change your times by up to {MaxTimeAdjustmentMinutes} minutes.", ShiftErrorCodes.ShiftTimeAdjustmentTooLarge));

        var actualStart = startMoved ? askedStart!.Value : completion.ActualStart;
        var actualEnd = endMoved ? askedEnd!.Value : endStamp;
        // A manual start may be up to 5 minutes ahead of the server clock (device skew). The worker is finishing now, so refusing would strand them: end at the start instead.
        if (!startMoved && !endMoved && actualStart > actualEnd) actualEnd = actualStart;
        var reason = string.IsNullOrWhiteSpace(dto.TimeAdjustmentReason) ? null : dto.TimeAdjustmentReason.Trim();
        if (startMoved || endMoved)
        {
            if (actualStart >= actualEnd)
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Your start must be before your finish.", ShiftErrorCodes.ShiftStartNotBeforeEnd));
            if (reason is null)
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Say why your times changed.", ShiftErrorCodes.ShiftTimeAdjustmentReasonRequired));
        }
        // A queued Finish can carry a phone time that lands before a break the server stamped, so FinishedAt is checked too.
        if (startMoved || endMoved || clientEnd)
        {
            // NetWorked would clamp a break to the new span, but the coordinator would still see a break outside the shift.
            var breaks = await _db.ShiftBreaks.Where(b => b.ShiftCompletionId == completion.Id).ToListAsync(ct);
            if (breaks.Any(b => b.StartedAt < actualStart || (b.EndedAt ?? actualEnd) > actualEnd))
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Your times must include your breaks. Change the break first, or your times.", ShiftErrorCodes.ShiftBreakOutsideTimes));
        }
        if (startMoved || endMoved)
        {
            completion.OriginalActualStart = startMoved ? completion.ActualStart : null;
            completion.OriginalActualEnd = endMoved ? endStamp : null;
        }

        completion.ActualStart = actualStart;
        completion.ActualEnd = actualEnd;
        completion.TimeAdjustmentReason = startMoved || endMoved ? reason : null;
        // Optional notes on a start or finish more than 5 minutes off the roster: never a 400, and a re-Finish replaces the finish note.
        completion.FinishTimeReason = ShiftTimeRules.CleanReason(dto.FinishTimeReason);
        completion.StartTimeReason ??= ShiftTimeRules.CleanReason(dto.StartTimeReason);
        completion.Kilometres = dto.Kilometres is { } kmIn ? Math.Round((decimal)kmIn, 1, MidpointRounding.AwayFromZero) : null;
        completion.PreShiftTravelMinutes = TravelMinutes(dto.PreShiftTravelMinutes);
        completion.PreShiftTravelKilometres = TravelKm(dto.PreShiftTravelKilometres);
        completion.PostShiftTravelMinutes = TravelMinutes(dto.PostShiftTravelMinutes);
        completion.PostShiftTravelKilometres = TravelKm(dto.PostShiftTravelKilometres);
        completion.AnythingToReport = dto.AnythingToReport;
        completion.SubmittedAt = now;
        completion.SentFromOffline |= dto.FinishedAt is not null;
        completion.HandoverText = handoverText;
        completion.NothingToHandOver = dto.NothingToHandOver;
        completion.NothingToNoteConfirmed = dto.NothingToNote && !hasNote;
        completion.DetailsRequired = dto.DetailsLater;
        // Finish no longer asks for the phone's location, and any latitude or longitude an older client still sends is ignored (owner, 2026-11-04).
        completion.GeolocationDeclined = completion.GeolocationDeclined || dto.GeolocationDeclined;

        var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
        completion.VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(completion.ActualStart, rosteredStartUtc);
        completion.VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(completion.ActualEnd.Value, rosteredEndUtc);
        // Extra time is what the worker added to the paid span; a coordinator decides it. A sleepover has none (its pay ignores the clock times). A re-Finish after a Return starts the decision over.
        completion.ExtraTime = shift.NightType != SleepoverType.Sleepover && ShiftTimeRules.HasExtraTime(completion.VarianceMinutesStart, completion.VarianceMinutesEnd) ? ExtraTimeDecision.Pending : null;
        completion.UpdatedAt = now;

        shift.Status = ShiftStatus.PendingReview;
        shift.UpdatedAt = now;

        // NotificationEventType.ShiftCompletionPendingReview — reserved by the notifications
        // spec, wired here now the shift-completion feature exists (design spec §5, sibling
        // event). Recipients are the tenant's Admin/Coordinator users, same as
        // LeaveRequestSubmitted above.
        var workerName = await _db.Users.Where(u => u.Id == shift.UserId!.Value)
            .Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefaultAsync(ct) ?? "A staff member";
        var reviewRecipients = await _db.Users
            .Where(u => u.TenantId == shift.TenantId && u.IsActive && (u.Role == UserRole.Admin || u.Role == UserRole.Coordinator))
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

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg && pg.ConstraintName == ShiftCompletion.ActiveIndexName)
        {
            // A Start (which takes no row lock) inserted the active completion first; the lock's transaction rolls back as this returns.
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail(
                "This shift can't be finished right now.", ShiftErrorCodes.ShiftNotInProgress));
        }
        await rowLock.CommitAsync(ct);
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }

    /// <summary>
    /// The answers a "details later" finish left out, added after the shift (finish-later). Only the assigned worker, only while the shift awaits review and
    /// was finished "details later". The end can only move earlier than the tap, with a reason; every deferrable field is written as sent (an edit, not a merge).
    /// shortcut: stays open until approval even once nothing is missing, and approve checks no version (the same limit as RosteringController's approve); upgrade if a worker's late edit must be refused.
    /// </summary>
    [HttpPut("shifts/{id:guid}/finish-details")]
    public async Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> FinishDetails(Guid id, [FromBody] FinishDetailsDto dto, CancellationToken ct)
    {
        var (shift, error) = await ResolveOwnedShiftAsync(id, ct);
        if (error is not null) return error;

        // The same row lock approve takes, so an approval and a late save cannot interleave.
        await using var rowLock = await ShiftRowLock.AcquireAsync(_db, shift!.Id, ct);
        if (rowLock.Held)
        {
            var ownerBeforeWaiting = shift.UserId;
            await _db.Entry(shift).ReloadAsync(ct);
            if (_db.Entry(shift).State == EntityState.Detached || shift.UserId != ownerBeforeWaiting)
                return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift not found."));
        }

        if (shift.Status != ShiftStatus.PendingReview)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail("This shift is no longer waiting for review.", ShiftErrorCodes.ShiftNotPendingReview));
        var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shift.Id && c.IsActive, ct);
        if (completion is null)
            return NotFound(ApiResponse<PortalShiftDetailDto>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));
        if (!completion.DetailsRequired)
            return Conflict(ApiResponse<PortalShiftDetailDto>.Fail("This shift was finished with its details, so there is nothing to add.", ShiftErrorCodes.ShiftNotPendingReview));

        var handoverText = string.IsNullOrWhiteSpace(dto.HandoverText) ? null : dto.HandoverText.Trim();
        if (dto.NothingToHandOver && handoverText is not null)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Write a handover or confirm there is nothing to hand over, not both.", ShiftErrorCodes.ShiftHandoverConflict));
        if (dto.TimeAdjustmentReason?.Trim().Length > MaxTimeAdjustmentReasonLength)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                $"Keep the reason to {MaxTimeAdjustmentReasonLength} characters.", ShiftErrorCodes.ShiftTimeAdjustmentReasonTooLong));
        if (dto.Kilometres is < 0d or > (double)MaxKilometres)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Enter kilometres from 0 to 2,000.", ShiftErrorCodes.ShiftKilometresOutOfRange));
        if (CheckTravel(dto.PreShiftTravelMinutes, dto.PreShiftTravelKilometres, dto.PostShiftTravelMinutes, dto.PostShiftTravelKilometres) is { } badTravel)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(badTravel.Message, badTravel.Code));

        // Times are judged against the stamps Finish kept (the originals when a time was already moved): the start within 15 minutes of the stamp, the end only earlier than the tap.
        var now = NowUtc;
        var startStamp = TruncateToMinute(completion.OriginalActualStart ?? completion.ActualStart);
        var tapStamp = completion.OriginalActualEnd ?? completion.ActualEnd ?? completion.ActualStart;
        var tapMinute = TruncateToMinute(tapStamp);
        DateTime? askedStart = dto.ActualStart is { } startIn ? TruncateToMinute(ShiftBreakRules.ToUtc(startIn)) : null;
        DateTime? askedEnd = dto.ActualEnd is { } endIn ? TruncateToMinute(ShiftBreakRules.ToUtc(endIn)) : null;
        if (askedEnd > tapMinute + ShiftBreakRules.ClockSkewAllowance)
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                "Your finish time can't be later than when you ended the shift.", ShiftErrorCodes.ShiftActualEndAfterTap));
        var startMoved = askedStart is not null && askedStart != startStamp;
        var endMoved = askedEnd < tapMinute;
        if (startMoved && (askedStart!.Value - startStamp).Duration() > TimeSpan.FromMinutes(MaxTimeAdjustmentMinutes))
            return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                $"You can change your start by up to {MaxTimeAdjustmentMinutes} minutes.", ShiftErrorCodes.ShiftTimeAdjustmentTooLarge));

        var originalStart = completion.OriginalActualStart ?? completion.ActualStart;
        var actualStart = startMoved ? askedStart!.Value : originalStart;
        var actualEnd = endMoved ? askedEnd!.Value : tapStamp;
        var reason = string.IsNullOrWhiteSpace(dto.TimeAdjustmentReason) ? null : dto.TimeAdjustmentReason.Trim();
        if (startMoved || endMoved)
        {
            if (actualStart >= actualEnd)
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail("Your start must be before your finish.", ShiftErrorCodes.ShiftStartNotBeforeEnd));
            if (reason is null)
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail("Say why your times changed.", ShiftErrorCodes.ShiftTimeAdjustmentReasonRequired));
            var breaks = await _db.ShiftBreaks.Where(b => b.ShiftCompletionId == completion.Id).ToListAsync(ct);
            if (breaks.Any(b => b.StartedAt < actualStart || (b.EndedAt ?? actualEnd) > actualEnd))
                return BadRequest(ApiResponse<PortalShiftDetailDto>.Fail(
                    "Your times must include your breaks. Change the break first, or your times.", ShiftErrorCodes.ShiftBreakOutsideTimes));
        }

        var timesChanged = actualStart != completion.ActualStart || actualEnd != completion.ActualEnd;
        completion.OriginalActualStart = startMoved ? originalStart : null;
        completion.OriginalActualEnd = endMoved ? tapStamp : null;
        completion.ActualStart = actualStart;
        completion.ActualEnd = actualEnd;
        completion.TimeAdjustmentReason = startMoved || endMoved ? reason : null;
        completion.FinishTimeReason = ShiftTimeRules.CleanReason(dto.FinishTimeReason);
        completion.StartTimeReason = ShiftTimeRules.CleanReason(dto.StartTimeReason);

        var hasNote = await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct);
        completion.Kilometres = dto.Kilometres is { } kmIn ? Math.Round((decimal)kmIn, 1, MidpointRounding.AwayFromZero) : null;
        // "No trip" clears that leg whatever was sent.
        completion.PreTravelNone = dto.PreTravelNone;
        completion.PostTravelNone = dto.PostTravelNone;
        completion.PreShiftTravelMinutes = dto.PreTravelNone ? null : TravelMinutes(dto.PreShiftTravelMinutes);
        completion.PreShiftTravelKilometres = dto.PreTravelNone ? null : TravelKm(dto.PreShiftTravelKilometres);
        completion.PostShiftTravelMinutes = dto.PostTravelNone ? null : TravelMinutes(dto.PostShiftTravelMinutes);
        completion.PostShiftTravelKilometres = dto.PostTravelNone ? null : TravelKm(dto.PostShiftTravelKilometres);
        completion.AnythingToReport = dto.AnythingToReport;
        completion.HandoverText = handoverText;
        completion.NothingToHandOver = dto.NothingToHandOver;
        completion.NothingToNoteConfirmed = dto.NothingToNote && !hasNote;

        var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
        completion.VarianceMinutesStart = ShiftVarianceCalculator.VarianceMinutes(completion.ActualStart, rosteredStartUtc);
        completion.VarianceMinutesEnd = ShiftVarianceCalculator.VarianceMinutes(completion.ActualEnd.Value, rosteredEndUtc);
        // A coordinator's extra-time decision stands unless the times themselves changed in this save.
        if (timesChanged)
            completion.ExtraTime = shift.NightType != SleepoverType.Sleepover && ShiftTimeRules.HasExtraTime(completion.VarianceMinutesStart, completion.VarianceMinutesEnd) ? ExtraTimeDecision.Pending : null;
        completion.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        await rowLock.CommitAsync(ct);
        return Ok(ApiResponse<PortalShiftDetailDto>.Ok(await BuildShiftDetailDtoAsync(shift, ct)));
    }
}
