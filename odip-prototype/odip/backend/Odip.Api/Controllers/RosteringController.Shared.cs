using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Api.Rostering;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Api.Services;

namespace Odip.Api.Controllers;

public partial class RosteringController
{
    /// <summary>The typed location of a shift: trimmed, blank is null. The caller refuses one over <see cref="LocationMaxLength"/>.</summary>
    private static string? TidyLocation(string? raw) => string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
    private const int LocationMaxLength = 200;
    private const string LocationTooLongMessage = "Keep the location to 200 characters or fewer.";
    private const string ServiceLocationRefusedMessage = "Pick one of your service locations.";

    /// <summary>A saved place a shift may point at: an active one of the SHIFT's own organisation (a SuperAdmin has no query filter, so the tenant is named here), or the one the shift already has, which may since have been archived.</summary>
    private async Task<bool> ServiceLocationUsableAsync(Guid placeId, Guid tenantId, Guid? alreadyOnShift, CancellationToken ct) =>
        placeId == alreadyOnShift || await _db.ServiceLocations.AnyAsync(l => l.Id == placeId && l.TenantId == tenantId && l.IsActive, ct);

    /// <summary>The body of <see cref="CreateShift"/>. With <paramref name="movingFrom"/> (already locked and checked) the person leaves it in the same save.</summary>
    private async Task<ActionResult<ApiResponse<ShiftDto>>> CreateShiftCoreAsync(CreateShiftDto dto, Shift? movingFrom, CancellationToken ct, Shift? copyFrom = null)
    {
        var location = TidyLocation(dto.Location);
        if (location?.Length > LocationMaxLength) return BadRequest(ApiResponse<ShiftDto>.Fail(LocationTooLongMessage));
        if (Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<ShiftDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));
        var supportCode = SupportTypeCheck.Tidy(dto.SupportGroupCode);
        if (await SupportTypeCheck.RefusalAsync(_db, supportCode, dto.ServiceDate, ct) is { } supportRefusal) return BadRequest(ApiResponse<ShiftDto>.Fail(supportRefusal));

        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refError));

        var participantTenantId = await _db.Participants.Where(p => p.Id == dto.ParticipantId).Select(p => p.TenantId).FirstOrDefaultAsync(ct);
        if (dto.ServiceLocationId is { } placeId
            && !await ServiceLocationUsableAsync(placeId, participantTenantId, copyFrom?.ServiceLocationId, ct))
            return BadRequest(ApiResponse<ShiftDto>.Fail(ServiceLocationRefusedMessage));

        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = participantTenantId, ParticipantId = dto.ParticipantId, UserId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            // No ShiftPatternId from the request: a pattern link is the server's (the generator sets it). One a request names is dropped, or a hand-made shift could call itself routine and walk round the hard limit (C3).
            // Only the server's own split of a shift (copyFrom, R7 auto-roster) carries the link and requirements of the shift it was cut from.
            ShiftPatternId = copyFrom?.ShiftPatternId, RequirementsJson = copyFrom?.RequirementsJson,
            Ratio = dto.Ratio, NightType = dto.NightType, Notes = dto.Notes, Location = location, ServiceLocationId = dto.ServiceLocationId, SupportGroupCode = supportCode,
            Status = copyFrom?.Status ?? ShiftStatus.Draft   // a split's other half keeps the shift's status, so a Published week tells the second worker too
        };

        // A person moving here is judged without the shift they leave (no false DOUBLE_BOOKED_SHIFT against it).
        var findings = await CheckAsync(shift, null, ct, leavingShiftId: movingFrom?.Id, callerIsAdmin: CallerIsAdmin);
        findings.AddRange((await CheckBudgetAsync(shift, null, ShiftStatus.Draft, ct)).Findings);

        var budgetGate = ShiftBudgetGate.Resolve(findings, dto.Emergency, dto.OverrideReason);
        if (budgetGate.Error != null) return BadRequest(ApiResponse<ShiftDto>.Fail(budgetGate.Error));
        var rejection = EvaluateFindings(budgetGate.GateFindings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        ApplyOverride(shift, findings, budgetGate, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        if (budgetGate.EmergencyAccepted) await RaiseEmergencyReviewAsync(shift, ct);

        _db.Shifts.Add(shift);
        if (movingFrom is not null)
        {
            var mover = movingFrom.UserId;
            ApplyStaff(movingFrom, null, new List<RosterFinding>(), null, null);
            // Item 9 of the connection map: the shift they left no longer waits to be re-covered for leave.
            await _obligationTasks.CompleteByShiftAsync(movingFrom.Id, TaskType.LeaveCoverage, ct);
            await NotifyStaffChangeAsync(movingFrom, mover, wasPublished: movingFrom.Status == ShiftStatus.Published, ct);
        }
        await _db.SaveChangesAsync(ct);

        // No GET /shifts/{id} route exists in the spec's API table (the board and shift-list
        // reads all go through GET /board) — an Ok response is the correct shape here rather
        // than CreatedAtAction pointing at a nonexistent action.
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>The body of <see cref="UpdateShift"/>, run under its locks.</summary>
    private async Task<ActionResult<ApiResponse<ShiftDto>>> UpdateShiftLockedAsync(Guid id, UpdateShiftDto dto, CancellationToken ct)
    {
        // A PUT that leaves the location out keeps the stored one; null or blank clears it.
        var location = TidyLocation(dto.Location);
        if (dto.HasLocation && location?.Length > LocationMaxLength) return BadRequest(ApiResponse<ShiftDto>.Fail(LocationTooLongMessage));
        // The JSON converter refuses an unknown name but binds a bare number, so a value outside the enum is refused here, before anything is saved.
        if (dto.CancellationReason is { } reason && !Enum.IsDefined(reason)) return BadRequest(ApiResponse<ShiftDto>.Fail("Choose one of the listed cancellation reasons.", ShiftErrorCodes.ShiftCancellationReasonInvalid));
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
        // Ruling 2: what the activity owns (who, which participant, ratio, day and times) cannot change here; notes, location and cancelling still save.
        if (shift.GroupActivityId is not null && (dto.Ratio != shift.Ratio || dto.ParticipantId != shift.ParticipantId || dto.StaffId != shift.UserId || dto.ServiceDate != shift.ServiceDate
                || dto.StartTime != shift.StartTime || dto.EndTime != shift.EndTime || dto.EndsNextDay != shift.EndsNextDay))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftOnGroupActivityMessage, GroupActivityOnShiftCode));
        // Attendance is final once the activity is Completed or Cancelled: a status change here would reopen or cancel a shift the activity has settled.
        if (shift.GroupActivityId is { } ownerId && dto.Status != shift.Status
            && await _db.GroupActivities.AsNoTracking().Where(a => a.Id == ownerId).Select(a => a.Status).FirstOrDefaultAsync(ct) is ShiftStatus.Completed or ShiftStatus.Cancelled)
            return Conflict(ApiResponse<ShiftDto>.Fail(AttendanceClosedMessage, GroupActivityOnShiftCode));
        if (dto.HasServiceLocationId && dto.ServiceLocationId is { } newPlaceId && !await ServiceLocationUsableAsync(newPlaceId, shift.TenantId, shift.ServiceLocationId, ct))
            return BadRequest(ApiResponse<ShiftDto>.Fail(ServiceLocationRefusedMessage));
        if (dto.ExpectsStaff && dto.ExpectedStaffId != shift.UserId)
            return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
        // A started, finished or cancelled shift keeps its worker here too, as /assign and a drop do (decision 8; post-merge review S2): its completion and timesheet
        // belong to that worker. Every other edit the rules below allow still saves.
        if (dto.StaffId != shift.UserId && IsLockedForStaffChange(shift.Status) && !(shift.Status == ShiftStatus.Cancelled && dto.Status != ShiftStatus.Cancelled))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
        // Its participant too: a claim bills a Completed shift to Shift.ParticipantId (ShiftClaimGenerationService), so moving it would charge another participant's budget.
        if (dto.ParticipantId != shift.ParticipantId && IsLockedForStaffChange(shift.Status) && !(shift.Status == ShiftStatus.Cancelled && dto.Status != ShiftStatus.Cancelled))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForParticipantMessage, ShiftErrorCodes.ShiftStatusLocked));

        // A shift has to end after it starts. The rule is for times somebody is setting now: an edit that leaves the shift's times alone, or cancels it, never trips it, because rows saved before this rule
        // may already be wrong and the panel must still be able to annotate, assign and cancel them (a started shift's times are locked and could not be mended at all).
        // Reopening a cancelled shift is somebody setting it live again: the same times must not bring a shift with no length back to life (phase 3 review, N1).
        var timesChanged = dto.StartTime != shift.StartTime || dto.EndTime != shift.EndTime || dto.EndsNextDay != shift.EndsNextDay;
        var reopening = shift.Status == ShiftStatus.Cancelled && dto.Status != ShiftStatus.Cancelled;
        // A cancelled shift can be on a short-notice cancellation claim. Reopening or moving it would change what that claim bills, so it waits for a claim being made (the same per-participant lock the claim takes,
        // so a claim made at this moment is either seen here or waits for this save) and is then refused while the claim still counts.
        await using var claimLock = shift.Status == ShiftStatus.Cancelled && (reopening || timesChanged || dto.ServiceDate != shift.ServiceDate || dto.ParticipantId != shift.ParticipantId)
            ? await RosterGenerationLock.AcquireAsync(_db, shift.ParticipantId, ct, scope: "claim-generate") : null;
        if (claimLock is not null && (await ClaimReferencesAsync(new[] { shift.Id }, ct)).TryGetValue(shift.Id, out var cancelClaim))
            return Conflict(ApiResponse<ShiftDto>.Fail($"This shift is on claim {cancelClaim}, so it can't be reopened or moved. Delete that claim first.", ShiftErrorCodes.ShiftClaimLocked));
        if ((timesChanged || reopening) && dto.Status != ShiftStatus.Cancelled && Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m)
            return BadRequest(ApiResponse<ShiftDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));

        // An existing legacy shift can still be status-managed after readiness is lost. Moving
        // it to another participant or assigning/reassigning staff is a new placement and must
        // remain fail-closed.
        var changesPlacement = dto.ParticipantId != shift.ParticipantId || dto.StaffId != shift.UserId;
        if (changesPlacement)
        {
            var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
            if (refError != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refError));
        }

        // Un-cancelling is allowed (critique P2 — pre-PR this was reachable and the spec's own
        // matrix left it a product-ruling gap): Cancelled -> Draft/Published passes, alongside the
        // existing Draft<->Published toggle and either status -> Cancelled. Every transition
        // into/out of InProgress/PendingReview/Completed stays locked to the completion endpoints.
        var fromAllowed = shift.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled;
        var toAllowed = dto.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled;
        if (dto.Status != shift.Status && !(fromAllowed && toAllowed))
            return Conflict(ApiResponse<ShiftDto>.Fail(
                "This shift's status can only be changed by starting, finishing, approving or returning it.",
                ShiftErrorCodes.ShiftStatusLocked));

        // Publish week holds a shift nobody is on until someone is; the single-shift path agrees, for every client. A shift already Published is untouched.
        if (shift.Status != ShiftStatus.Published && dto.Status == ShiftStatus.Published && dto.StaffId is null)
            return Conflict(ApiResponse<ShiftDto>.Fail("Put someone on this shift before publishing it."));

        // F6: once a shift has moved past Published (worker has started it), its rostered
        // ServiceDate/StartTime/EndTime/EndsNextDay are locked — the active ShiftCompletion's
        // variance is computed against those values, so editing them out from under an
        // in-flight or already-reviewed completion would silently invalidate it. Every other
        // field (Notes, Ratio, NightType, etc.) remains editable on these statuses unless the shift is on a claim (Ratio and NightType, below); the worker is refused above.
        if (shift.Status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed
            && (dto.ServiceDate != shift.ServiceDate || dto.StartTime != shift.StartTime
                || dto.EndTime != shift.EndTime || dto.EndsNextDay != shift.EndsNextDay))
            return Conflict(ApiResponse<ShiftDto>.Fail(
                "Shift times cannot be changed after the shift has started. Return the completion to the worker first.",
                ShiftErrorCodes.ShiftTimesLocked));

        // A PUT that leaves the support type out keeps the stored one. It is checked when it changes (or the date moves under a code), and it is locked while the shift is on a claim that still counts. So are Ratio and NightType: the claim priced them, and the shift must keep saying what was billed.
        var supportCode = dto.HasSupportGroupCode ? SupportTypeCheck.Tidy(dto.SupportGroupCode) : shift.SupportGroupCode;
        var supportChanged = supportCode != shift.SupportGroupCode;
        var pricingChanged = dto.Ratio != shift.Ratio || dto.NightType != shift.NightType;
        if ((supportChanged || pricingChanged) && (await ClaimReferencesAsync(new[] { shift.Id }, ct)).TryGetValue(shift.Id, out var claimedOn))
            return Conflict(ApiResponse<ShiftDto>.Fail(supportChanged
                ? $"This shift is on claim {claimedOn}, so its support type can't change. Delete that claim to change it."
                : $"This shift is on claim {claimedOn}, so its ratio and night type can't change. Delete that claim to change them.", ShiftErrorCodes.ShiftSupportTypeLocked));
        if ((supportChanged || (supportCode is not null && dto.ServiceDate != shift.ServiceDate)) && await SupportTypeCheck.RefusalAsync(_db, supportCode, dto.ServiceDate, ct) is { } supportRefusal)
            return BadRequest(ApiResponse<ShiftDto>.Fail(supportRefusal));

        var candidate = new Shift
        {
            Id = shift.Id, ParticipantId = dto.ParticipantId, UserId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType, SupportGroupCode = supportCode
        };

        var findings = await CheckAsync(candidate, shift.Id, ct, callerIsAdmin: CallerIsAdmin);
        // Like the length rule above: rows saved before the double-booking block may already clash, and cancelling one, or editing only its notes, must still work. Only an edit that sets the worker or the times can clash.
        if (ClashIsInherited(shift, dto.Status, dto.StaffId, dto.ServiceDate, dto.StartTime, dto.EndTime, dto.EndsNextDay))
            findings.RemoveAll(f => f.Code == RosterConflictService.DoubleBookedShift);
        // A start date that moved later, or a No marked afterwards, must not trap the shift: cancelling it always works. Only Cancelled is exempt, so a publish or a notes edit of it is still refused.
        if (dto.Status == ShiftStatus.Cancelled)
            findings.RemoveAll(f => f.Code == RosterConflictService.StaffNotStarted || (f.Code == RosterConflictService.CompatibilityExcluded && dto.StaffId == shift.UserId));   // a No only frees a worker who already holds it, never a new one
        findings.AddRange((await CheckBudgetAsync(candidate, shift.Id, dto.Status, ct)).Findings);

        var budgetGate = ShiftBudgetGate.Resolve(findings, dto.Emergency, dto.OverrideReason);
        if (budgetGate.Error != null) return BadRequest(ApiResponse<ShiftDto>.Fail(budgetGate.Error));
        var rejection = EvaluateFindings(budgetGate.GateFindings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        var previousUserId = shift.UserId;
        var previousStatus = shift.Status;
        var was = new ShiftWas(shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.ParticipantId);
        // What the shift holds now, for the budget rules: a save that does not decide the budget again keeps the over-budget acknowledgement it already has.
        var previousReason = shift.OverrideReason;
        var previousCodes = shift.AcknowledgedFindingCodes;
        shift.ParticipantId = dto.ParticipantId; shift.UserId = dto.StaffId;
        if (shift.UserId is not null) { shift.RegularUserId = null; shift.RegularAwayReason = null; }   // assigning anyone ends "regular away" (L5)
        shift.ServiceDate = dto.ServiceDate; shift.StartTime = dto.StartTime; shift.EndTime = dto.EndTime;
        shift.EndsNextDay = dto.EndsNextDay; shift.Ratio = dto.Ratio; shift.NightType = dto.NightType;
        // The saved pattern link stays as the server set it: an edit never cuts a pattern shift loose from its pattern, and a link a request names is never stored (C3).
        shift.Notes = dto.Notes;
        // The cancel time is the notice a short-notice cancellation claim measures. Only a shift that was Published had been promised to anyone; a Draft cancel stays null, and an edit of a cancelled shift keeps its time.
        ApplyStatus(shift, dto.Status, _clock.GetUtcNow().UtcDateTime, dto.CancellationReason);
        if (dto.HasLocation) shift.Location = location;
        if (dto.HasServiceLocationId) shift.ServiceLocationId = dto.ServiceLocationId;
        shift.SupportGroupCode = supportCode;
        shift.UpdatedAt = DateTime.UtcNow;
        ApplyOverride(shift, findings, budgetGate, dto.OverrideReason, dto.AcknowledgedFindingCodes, previousReason, previousCodes);
        if (budgetGate.EmergencyAccepted) await RaiseEmergencyReviewAsync(shift, ct);

        // Item 9 of the connection map: reassigning the shift away from the on-leave staff
        // member (or clearing it) — or cancelling it outright — closes the LeaveCoverage
        // obligation it was raised against. Re-assigning it back to the SAME staff member (no
        // UserId change) while it stays Published leaves the task open.
        if (previousUserId != shift.UserId || shift.Status == ShiftStatus.Cancelled)
            await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);

        // The slide-over's Staff field is the menus' way to assign (the brief, section 7), so a PUT tells people exactly as a drop does; becoming Published tells the worker, and a Published shift that is cancelled tells the worker it was cancelled (decision 9, reversed for Cancelled on 2026-10-28).
        // shortcut: two coordinators editing ONE shift in the slide-over is still last-write-wins on the worker (the PUT carries no ExpectedStaffId as the board's drops do), though the
        // locks above keep it from writing over a publish or a move; add one if that ever collides.
        await NotifyStaffChangeAsync(shift, previousUserId, wasPublished: previousStatus == ShiftStatus.Published, ct, was);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>The body of <see cref="AssignShift"/>, run under its locks.</summary>
    private async Task<ActionResult<ApiResponse<ShiftDto>>> AssignShiftLockedAsync(Guid id, AssignShiftDto dto, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
        if (shift.GroupActivityId is not null) return Conflict(ApiResponse<ShiftDto>.Fail(WorkerOnGroupActivityMessage, GroupActivityOnShiftCode));
        if (IsLockedForStaffChange(shift.Status))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
        // A drop names who the board showed (nobody, or the person the prompt offered to replace): someone changed the shift since, so say so rather than replace them by surprise.
        if (dto.ExpectsStaff && dto.ExpectedStaffId != shift.UserId)
            return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));

        if (dto.StaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.StaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftDto>.Fail("Staff member not found."));

        // Clearing an old assignment is safe management, but assigning or reassigning staff
        // is a new operational placement and goes through the readiness check: Warn lets it
        // proceed (the response carries what is missing), Enforce refuses it as it always did.
        if (dto.StaffId != shift.UserId && dto.StaffId.HasValue
            && !(await ParticipantReadiness.CheckAsync(_db, shift.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<ShiftDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        var candidate = WithWorker(shift, dto.StaffId);

        var findings = await CheckAsync(candidate, shift.Id, ct, callerIsAdmin: CallerIsAdmin);
        var rejection = EvaluateFindings(findings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        var previousUserId = shift.UserId;
        ApplyStaff(shift, dto.StaffId, findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);

        // Item 9 of the connection map: reassigning away from (or clearing) the on-leave staff
        // member closes the LeaveCoverage obligation raised against this shift.
        if (previousUserId != shift.UserId)
            await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);

        // An assignment leaves the status as it was: only a Published shift tells anybody (decision 9).
        await NotifyStaffChangeAsync(shift, previousUserId, wasPublished: shift.Status == ShiftStatus.Published, ct);

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>A worker marked No for the participant cannot be a pattern's Regular worker; the sentence naming them, or null. Tenant-scoped by the context's filter, like the user check beside it.</summary>
    private async Task<string?> MarkedNoRefusalAsync(Guid participantId, Guid staffId, CancellationToken ct)
    {
        var no = await _db.StaffParticipantCompatibilities.Include(c => c.User).Include(c => c.Participant)
            .FirstOrDefaultAsync(c => c.UserId == staffId && c.ParticipantId == participantId && c.Level == CompatibilityLevel.Excluded, ct);
        return no is null ? null : $"{no.User!.FullName} is marked No for {no.Participant!.FullName}, so they can't be this pattern's Regular worker.";
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>Monday of the week containing <paramref name="date"/>.</summary>
    private static DateOnly WeekStart(DateOnly date) => RosterWeek.MondayOf(date);

    private static RosterFindingDto ToFindingDto(RosterFinding f) => RosterGate.ToFindingDto(f);

    private static ShiftPatternDto ToPatternDto(ShiftPattern p, IReadOnlyDictionary<Guid, int>? sourceVersions = null) => new()
    {
        Id = p.Id, ParticipantId = p.ParticipantId, ParticipantName = p.Participant?.FullName ?? string.Empty,
        DefaultStaffId = p.DefaultUserId, DefaultStaffName = p.DefaultUser?.FullName,
        DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay,
        Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo,
        IsActive = p.IsActive, Notes = p.Notes, SupportGroupCode = p.SupportGroupCode,
        SourceDraftId = p.SourceDraftId, SourceBlockKey = p.SourceBlockKey, WorkerSlot = p.WorkerSlot,
        SourceDraftVersion = p.SourceDraftId is { } source && sourceVersions is not null && sourceVersions.TryGetValue(source, out var version) ? version : null,
        Requirements = RequirementsOf(p.RequirementsJson),
    };

    /// <summary>What a pattern or a shift asks of a worker, read from its stored JSON; none when it was never given any.</summary>
    private static DraftBlockRequirementsDto? RequirementsOf(string? json) => string.IsNullOrWhiteSpace(json) ? null : DraftJson.ReadRequirements(json);

    /// <summary>The versions of the agreement revisions the given patterns were made from (one query), for the "From agreement v2" badge.</summary>
    private async Task<Dictionary<Guid, int>> SourceVersionsAsync(IEnumerable<ShiftPattern> patterns, CancellationToken ct)
    {
        var ids = patterns.Where(p => p.SourceDraftId is not null).Select(p => p.SourceDraftId!.Value).Distinct().ToList();
        return ids.Count == 0 ? new() : await _db.ServiceAgreementDrafts.AsNoTracking().Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Version, ct);
    }

    /// <summary>
    /// For shifts generated from an agreement's patterns: by pattern id, the version of the revision the pattern was made from (null if that cannot be read). A pattern that is not in it is hand-made, so its
    /// shifts say nothing about an agreement. Two small queries for the whole set of shifts.
    /// </summary>
    private async Task<Dictionary<Guid, int?>> ShiftSourcesAsync(IEnumerable<Guid?> patternIds, CancellationToken ct)
    {
        var ids = patternIds.Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return new();
        var made = await _db.ShiftPatterns.AsNoTracking().Where(p => ids.Contains(p.Id) && p.SourceDraftId != null).Select(p => new { p.Id, DraftId = p.SourceDraftId!.Value }).ToListAsync(ct);
        if (made.Count == 0) return new();
        var draftIds = made.Select(p => p.DraftId).Distinct().ToList();
        var versions = await _db.ServiceAgreementDrafts.AsNoTracking().Where(d => draftIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Version, ct);
        return made.ToDictionary(p => p.Id, p => versions.TryGetValue(p.DraftId, out var version) ? (int?)version : null);
    }

    /// <summary>
    /// Resolves a PendingReview shift and its active ShiftCompletion for Approve/Return, or the
    /// ActionResult to short-circuit with. Preserves the existing check order: shift-404 ->
    /// status-409 -> completion-404. Extracted (critique P3) from the identical block previously
    /// duplicated across ApproveCompletion/ReturnCompletion.
    /// </summary>
    private async Task<(Shift? Shift, ShiftCompletion? Completion, ActionResult<ApiResponse<ShiftCompletionDto>>? Error)> ResolvePendingReviewCompletionAsync(Guid shiftId, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == shiftId, ct);
        var completion = shift is not null && shift.Status == ShiftStatus.PendingReview
            ? await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shiftId && c.IsActive, ct)
            : null;
        return ResolvePendingReviewCompletion(shift, completion);
    }

    /// <summary>
    /// The pure classification rules ResolvePendingReviewCompletionAsync applies, extracted
    /// (critique M3) so ApproveBatch can run them in memory over shift/completion dictionaries it
    /// loaded with two bulk queries instead of calling the async, per-id version 2N times. Same
    /// check order as before: shift-404 -&gt; status-409 -&gt; completion-404.
    /// </summary>
    private (Shift? Shift, ShiftCompletion? Completion, ActionResult<ApiResponse<ShiftCompletionDto>>? Error) ResolvePendingReviewCompletion(Shift? shift, ShiftCompletion? completion)
    {
        if (shift is null)
            return (null, null, NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found.")));

        if (shift.Status != ShiftStatus.PendingReview)
            return (null, null, Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                "This shift isn't awaiting review.", ShiftErrorCodes.ShiftNotPendingReview)));

        if (completion is null)
            return (null, null, NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound)));

        return (shift, completion, null);
    }

    /// <summary>Unwraps the Code/Message a single-approve rejection would have returned, for the batch's per-item report.</summary>
    private static (string? Code, string? Message) ExtractBatchFailure(ActionResult<ApiResponse<ShiftCompletionDto>> error)
    {
        var value = error.Result switch
        {
            ConflictObjectResult conflict => conflict.Value as ApiResponse<ShiftCompletionDto>,
            NotFoundObjectResult notFound => notFound.Value as ApiResponse<ShiftCompletionDto>,
            _ => null,
        };
        return (value?.Code, value?.Errors?.FirstOrDefault());
    }

    /// <summary>
    /// Null when the caller's JWT has no resolvable NameIdentifier claim — previously silently
    /// fell back to Guid.Empty, which the audit trail would then record as the reviewer (critique
    /// P3). Callers must check for null and 401 rather than proceed.
    /// </summary>
    private Guid? ResolveCurrentUserId()
    {
        var claim = User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(claim, out var id) ? id : null;
    }

    private static Guid? LiveRegular(Shift shift, Dictionary<Guid, Guid> regulars) =>
        shift.ShiftPatternId is { } patternId && regulars.TryGetValue(patternId, out var regular) ? regular : null;

    /// <summary>DEEP-S3: the stored reason only while it still describes the slot's live regular; once someone else is the regular, or nobody, it is stale.</summary>
    private static string? AwayReason(Shift shift, Dictionary<Guid, Guid> regulars) =>
        shift.RegularUserId is { } was && was == LiveRegular(shift, regulars) ? shift.RegularAwayReason : null;

    private static bool? IsRegular(Shift shift, Dictionary<Guid, Guid> regulars) =>
        shift.UserId is { } worker && LiveRegular(shift, regulars) == worker ? true : null;

    private async Task<ShiftPatternDto> LoadPatternDtoAsync(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultUser)
            .FirstAsync(p => p.Id == id, ct);
        return ToPatternDto(pattern, await SourceVersionsAsync(new[] { pattern }, ct));
    }

    /// <summary>The claim reference of each of these shifts that is on a claim that still counts (<see cref="BudgetLedgerService.ClaimLineStillCounts"/>); one query. A shift on none is absent.</summary>
    private async Task<Dictionary<Guid, string>> ClaimReferencesAsync(IEnumerable<Guid> shiftIds, CancellationToken ct)
    {
        var ids = shiftIds.ToList();
        if (ids.Count == 0) return new Dictionary<Guid, string>();
        var rows = await _db.ClaimLineItems.AsNoTracking().Where(BudgetLedgerService.ClaimLineStillCounts)
            .Where(l => l.ShiftId != null && ids.Contains(l.ShiftId.Value))
            .Select(l => new { ShiftId = l.ShiftId!.Value, l.TripClaim.ClaimReference }).ToListAsync(ct);
        return rows.GroupBy(r => r.ShiftId).ToDictionary(g => g.Key, g => g.First().ClaimReference);
    }

    private async Task<ShiftDto> ToShiftDtoAsync(Shift shift, List<RosterFinding> findings, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == shift.ParticipantId, ct);
        var staff = shift.UserId.HasValue
            ? await _db.Users.FirstOrDefaultAsync(s => s.Id == shift.UserId.Value, ct)
            : null;
        var readinessIssues = await ParticipantReadiness.IssuesAsync(_db, new[] { shift.ParticipantId }, ct);
        int? sourceVersion = null;
        var fromAgreement = shift.ShiftPatternId is { } patternId && (await ShiftSourcesAsync(new[] { shift.ShiftPatternId }, ct)).TryGetValue(patternId, out sourceVersion);
        var regulars = await RosterRegulars.ByPatternAsync(_db, new[] { shift.ShiftPatternId }, ct);

        var orgZone = (await ProviderTimeZoneResolver.ResolveAsync(_db, ct)).Zone; // shortcut: the organisation zone, like the board
        return new ShiftDto
        {
            Id = shift.Id, ParticipantId = shift.ParticipantId, ParticipantName = participant?.FullName ?? string.Empty,
            StaffId = shift.UserId, StaffName = staff?.FullName,
            ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
            DurationHours = ProviderLocalTime.RosteredHours(shift, orgZone), Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status, CancellationReason = shift.CancellationReason,
            ShiftPatternId = shift.ShiftPatternId, Notes = shift.Notes, Location = shift.Location, ServiceLocationId = shift.ServiceLocationId, SupportGroupCode = shift.SupportGroupCode, ClaimReference = (await ClaimReferencesAsync(new[] { shift.Id }, ct)).GetValueOrDefault(shift.Id), OverrideReason = shift.OverrideReason, Requirements = RequirementsOf(shift.RequirementsJson),
            GroupActivityId = shift.GroupActivityId, IsGroupLine = shift.GroupActivityId is null ? null : true,
            AcknowledgedFindingCodes = AcknowledgedCodesOf(shift), BudgetReview = (await BudgetReviewsAsync(new[] { shift }, ct)).GetValueOrDefault(shift.Id),
            FromAgreement = fromAgreement ? true : null, SourceDraftVersion = sourceVersion,
            Findings = findings.Select(ToFindingDto).ToList(),
            RegularUserId = LiveRegular(shift, regulars), RegularAwayReason = AwayReason(shift, regulars), IsRegular = IsRegular(shift, regulars),
            ReadinessIssues = ParticipantReadiness.IssuesOrNull(readinessIssues, shift.ParticipantId)
        };
    }

    /// <summary>The finding codes stored with the shift, for the over-budget marker; null (omitted from the JSON) when it holds none.</summary>
    private static List<string>? AcknowledgedCodesOf(Shift shift) => ShiftBudgetGate.SplitCodes(shift.AcknowledgedFindingCodes) is { Count: > 0 } codes ? codes : null;

    /// <summary>
    /// Where the Admin's review of each emergency or safety booking stands, for the shifts that carry the emergency code: the review task raised with the booking (pending until it is completed). One query, and none when
    /// no shift holds the code. There is no "approved": a booking saves at once and is reviewed afterwards.
    /// </summary>
    private async Task<Dictionary<Guid, BudgetReviewDto>> BudgetReviewsAsync(IEnumerable<Shift> shifts, CancellationToken ct)
    {
        var ids = shifts.Where(s => ShiftBudgetGate.SplitCodes(s.AcknowledgedFindingCodes).Contains(BudgetFindingCodes.Emergency)).Select(s => s.Id).ToList();
        if (ids.Count == 0) return new Dictionary<Guid, BudgetReviewDto>();

        var tasks = await _db.BookingTasks.AsNoTracking()
            .Where(t => t.TaskType == TaskType.BudgetEmergencyReview && t.ShiftId != null && ids.Contains(t.ShiftId.Value))
            .Select(t => new { ShiftId = t.ShiftId!.Value, t.Title, t.Status, t.SourceKey, t.CreatedAt, t.CompletedDate, OwnerName = t.Owner != null ? (t.Owner.FirstName + " " + t.Owner.LastName).Trim() : null })
            .ToListAsync(ct);
        return tasks.GroupBy(t => t.ShiftId).ToDictionary(g => g.Key, g =>
        {
            var task = g.OrderByDescending(t => t.SourceKey!.Length).ThenByDescending(t => t.SourceKey).First();   // the newest review of the shift: :2 and :3 follow the first
            var reviewed = task.Status == TaskItemStatus.Completed;
            return new BudgetReviewDto
            {
                State = reviewed ? BudgetReviewState.Reviewed : BudgetReviewState.Pending, RecordedAt = task.CreatedAt, ReviewTaskTitle = task.Title, ReviewedOn = reviewed ? task.CompletedDate : null,
                ReviewedBy = reviewed ? task.OwnerName : null,
            };
        });
    }

    /// <summary>
    /// Participant must exist; staff, when supplied, must exist and be active (§4.4). Same-tenant
    /// scoping comes for free from _db.Users' ambient OdipDbContext query filter. Returns a
    /// user-facing error string, or null when both refs are valid.
    /// </summary>
    private async Task<string?> ValidateRefsAsync(Guid participantId, Guid? staffId, CancellationToken ct)
    {
        // Every one-off creation/update/assignment validation funnels through this readiness
        // check. A participant who does not exist, is a draft, or is inactive is refused in either
        // mode; beyond that, Enforce refuses incomplete intake, a missing/incomplete onboarding
        // record and missing signed-agreement evidence, while Warn lets the write proceed and
        // reports what is missing on the response (ShiftDto.ReadinessIssues).
        if (!(await ParticipantReadiness.CheckAsync(_db, participantId, ct)).Allowed)
            return ParticipantReadinessGate.NotReadyMessage;
        if (staffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == staffId.Value && s.IsActive, ct))
            return "Staff member not found.";
        return null;
    }

    /// <summary>
    /// Builds the <see cref="RosterCheckContext"/> for <paramref name="candidate"/> and runs
    /// <see cref="RosterConflictService.Check"/>. Unfilled shifts (<see cref="Shift.UserId"/>
    /// null) skip every staff-dependent rule entirely, per the M4 design brief, rather than
    /// attempting to load a staff member that doesn't exist. <paramref name="excludeId"/> is
    /// the shift's own prior Id on an update/assign (falls back to <paramref name="candidate"/>'s
    /// own Id), so a shift never conflicts with itself. <paramref name="callerIsAdmin"/> is passed only by the writes that place a worker (null for Publish week): it decides whether a double-booking blocks.
    /// </summary>
    private async Task<List<RosterFinding>> CheckAsync(Shift candidate, Guid? excludeId, CancellationToken ct, Guid? leavingShiftId = null, bool? callerIsAdmin = null)
    {
        if (candidate.UserId is not { } userId) return new List<RosterFinding>();
        var weekStart = WeekStart(candidate.ServiceDate);
        // A person being moved or swapped off leavingShiftId is judged without it: no DOUBLE_BOOKED_SHIFT or OVER_HOURS against the shift they are leaving (roster drag and drop, 2026-10-14).
        // shortcut: participantShiftsOnDate still counts them on the shift they leave, so a swap inside one 2:1 pair can warn RATIO_SHORTFALL falsely; filter it there too if pairs get swapped often.
        // The week and the day either side (RosterAvailability.LoadAsync), as before: an overnight shift across the week edge is double-booking checked; OVER_HOURS still counts the candidate's own week.
        var snapshot = await _availability.LoadAsync([userId], [candidate.ParticipantId], weekStart, weekStart.AddDays(6), ct);
        return snapshot.Check(candidate, excludeId ?? candidate.Id, leavingShiftId, callerIsAdmin);
    }

    /// <summary>
    /// The Blocking/RequiresReason/override gate every roster write runs through: any Blocking
    /// finding rejects the write regardless of <paramref name="overrideReason"/>; any finding
    /// with RequiresReason true needs a non-empty reason; a write whose findings are all
    /// RequiresReason == false may proceed with no reason at all (ApplyOverride still records
    /// their codes in AcknowledgedFindingCodes — see that method — so the board can show why a
    /// cell looks tentative without ever having asked for input). Returns the 422 response body
    /// to return, or null when the write may proceed.
    /// </summary>
    private ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason) =>
        RosterGate.EvaluateFindings(findings, overrideReason);

    /// <summary>
    /// Persists (or clears) the override fields to match the outcome <see cref="EvaluateFindings"/> already approved, with the budget rules of <see cref="ShiftBudgetGate"/> on top: the over-budget
    /// acknowledgements are the server's alone, and a save that does not decide the budget again keeps the one the shift already has (<paramref name="previousReason"/>, <paramref name="previousCodes"/>).
    /// </summary>
    private static void ApplyOverride(
        Shift shift, List<RosterFinding> findings, ShiftBudgetGate.Decision budgetGate, string? overrideReason, List<string>? acknowledgedCodes, string? previousReason = null, string? previousCodes = null)
    {
        var (reason, codes) = ShiftBudgetGate.ToStore(findings, budgetGate, overrideReason, acknowledgedCodes, previousReason, previousCodes);
        shift.OverrideReason = reason;
        shift.AcknowledgedFindingCodes = codes;
    }

    /// <summary>Roster drag and drop (2026-10-14), decision 8: a shift that has started, waits for review, is finished or is cancelled keeps its worker; only its completion endpoints move it on.</summary>
    internal static bool IsLockedForStaffChange(ShiftStatus status) =>
        status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed or ShiftStatus.Cancelled;

    /// <summary>Sets a shift's status and keeps the cancel-notice clock: only a shift that was Published had been promised to anyone, so only it gets a CancelledAt, and leaving Cancelled clears it. The shift PUT and the group attendance mark both use it.</summary>
    internal static void ApplyStatus(Shift shift, ShiftStatus next, DateTime utcNow, ShiftCancellationReason? reason = null)
    {
        var previous = shift.Status;
        shift.Status = next;
        if (next != ShiftStatus.Cancelled) shift.CancelledAt = null;
        else if (previous == ShiftStatus.Published) shift.CancelledAt = utcNow;
        // The reason lives and dies with the cancellation: stored on a cancel, kept when an already cancelled shift is saved without one, cleared on any other status.
        shift.CancellationReason = next != ShiftStatus.Cancelled ? null : reason ?? (previous == ShiftStatus.Cancelled ? shift.CancellationReason : null);
    }

    internal const string AttendanceClosedMessage = "Attendance is final once every staff shift is approved.";
    private const string ShiftLockedForStaffMessage = "This shift has started, finished or been cancelled, so its worker can't be changed here.";
    // Group activities (PR1): a shift on an activity is changed from the activity, so the board's writes refuse the fields the activity owns.
    private const string GroupActivityOnShiftCode = "GA_ON_ACTIVITY";
    private const string ShiftOnGroupActivityMessage = "This shift is part of a group activity. Change it on the activity.";
    private const string WorkerOnGroupActivityMessage = "This shift is part of a group activity. Change who works it on the activity.";
    private const string ShiftLockedForParticipantMessage = "This shift has started, finished or been cancelled, so its participant can't be changed here.";

    /// <summary>What a drop made on an out-of-date board is refused with (409): /assign with ExpectedStaffId, and move-staff.</summary>
    private const string BoardChangedMessage = "This shift changed after the board was loaded. Refresh the board and try again.";

    /// <summary>The shift as it would be with <paramref name="userId"/> on it: the candidate the roster check judges.</summary>
    private static Shift WithWorker(Shift shift, Guid? userId) => new()
    {
        Id = shift.Id, ParticipantId = shift.ParticipantId, UserId = userId,
        ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime,
        EndsNextDay = shift.EndsNextDay, Ratio = shift.Ratio, NightType = shift.NightType
    };

    /// <summary>Puts <paramref name="userId"/> on the shift (null clears it) with the override fields the findings just approved. Assigning a worker is not a budget moment: the shift keeps the over-budget acknowledgement it already has.</summary>
    private static void ApplyStaff(Shift shift, Guid? userId, List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        var previousReason = shift.OverrideReason;
        var previousCodes = shift.AcknowledgedFindingCodes;
        shift.UserId = userId;
        if (userId is not null) { shift.RegularUserId = null; shift.RegularAwayReason = null; }   // assigning anyone ends "regular away" (L5)
        shift.UpdatedAt = DateTime.UtcNow;
        ApplyOverride(shift, findings, ShiftBudgetGate.Decision.NoEmergency(findings), overrideReason, acknowledgedCodes, previousReason, previousCodes);
    }

    /// <summary>What a shift held before a PUT changed it: the one input <see cref="NotifyStaffChangeAsync"/> needs to tell the worker what moved.</summary>
    private readonly record struct ShiftWas(DateOnly Date, TimeOnly Start, TimeOnly End, bool EndsNextDay, Guid ParticipantId);

    private async Task<DateOnly> ShiftTodayAsync(Shift shift, CancellationToken ct) =>
        ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, (await ProviderTimeZoneResolver.ForShiftAsync(_db, shift, ct)).Zone);

    /// <summary>
    /// Roster drag and drop (2026-10-14), decision 9: a worker hears about a shift only once it is Published. Call it once the shift holds its new worker and status, before the
    /// caller's one save, so the outbox rows commit with the change (a refused write sends nothing). The worker on a Published shift gets ShiftAssigned when it is newly theirs or
    /// has just become Published; whoever came off a shift that was already Published gets ShiftUnassigned, even when the same save takes it off Published (deep review S2). Draft changes, and a
    /// Published shift going back to Draft with its worker kept, stay silent. A Published shift that is Cancelled (2026-10-28, reverses decision 9 for Cancelled only) tells its previous worker with
    /// ShiftUnassigned { Cancelled = true } unless its date is before the provider's today; that one notice replaces "taken off", so a worker changed in the same save still hears only "cancelled".
    /// Do not make a cancel silent again: the worker would learn of it only by opening the app.
    /// </summary>
    private async Task NotifyStaffChangeAsync(Shift shift, Guid? previousUserId, bool wasPublished, CancellationToken ct, ShiftWas? was = null)
    {
        Task<DateOnly> TodayHereAsync() => ShiftTodayAsync(shift, ct);   // the date at the shift's place, which can be in another zone
        var assignedTo = shift.Status == ShiftStatus.Published && shift.UserId is { } now && (now != previousUserId || !wasPublished) ? now : (Guid?)null;
        var cancelled = wasPublished && shift.Status == ShiftStatus.Cancelled && previousUserId is not null
            && shift.ServiceDate >= await TodayHereAsync();
        var takenOff = wasPublished && previousUserId is { } before && (cancelled || before != shift.UserId) ? before : (Guid?)null;
        // shift-change-notice (2026-10-29): the worker who stays on a Published shift hears when its time, day or participant changed, unless the shift is wholly in the past. Only the PUT passes `was`.
        var changed = was is { } w && wasPublished && shift.Status == ShiftStatus.Published && shift.UserId is not null && shift.UserId == previousUserId
            && (w.Date != shift.ServiceDate || w.Start != shift.StartTime || w.End != shift.EndTime || w.EndsNextDay != shift.EndsNextDay || w.ParticipantId != shift.ParticipantId)
            && (w.Date > shift.ServiceDate ? w.Date : shift.ServiceDate) >= await TodayHereAsync();
        if (assignedTo is null && takenOff is null && !changed) return;

        async Task<string?> NameOf(Guid id) => await _db.Participants.Where(p => p.Id == id)
            .Select(p => (p.FirstName + " " + p.LastName).Trim()).FirstOrDefaultAsync(ct);
        var participantName = await NameOf(shift.ParticipantId) ?? "a participant";
        if (changed && was is { } before2 && await _db.Users.FirstOrDefaultAsync(u => u.Id == shift.UserId, ct) is { } staying)
        {
            var participantMoved = before2.ParticipantId != shift.ParticipantId;
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftChanged, "Shift", shift.Id, new[] { staying.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftChangedPayload(staying.Email, participantMoved ? await NameOf(before2.ParticipantId) ?? "a participant" : participantName,
                    before2.Date, shift.ServiceDate, shift.StartTime, shift.EndTime, participantMoved ? participantName : null,
                    TimeChanged: !participantMoved || before2.Start != shift.StartTime || before2.End != shift.EndTime || before2.EndsNextDay != shift.EndsNextDay),
                ct, dedupe: false);   // each edit says its own change: a second edit inside five minutes must not be dropped
        }
        if (assignedTo is { } a && await _db.Users.FirstOrDefaultAsync(u => u.Id == a, ct) is { } assigned)
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftAssigned, "Shift", shift.Id, new[] { assigned.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftAssignedPayload(assigned.Email, participantName, shift.ServiceDate, shift.StartTime, shift.EndTime), ct);
        if (takenOff is { } t && await _db.Users.FirstOrDefaultAsync(u => u.Id == t, ct) is { } removed)
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftUnassigned, "Shift", shift.Id, new[] { removed.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftUnassignedPayload(removed.Email, participantName, shift.ServiceDate, shift.StartTime, shift.EndTime, cancelled, StillTheirs: shift.UserId == removed.Id), ct);
    }

    /// <summary>
    /// The organisation's lock for the board's own writes (roster drag and drop, 2026-10-14): move-staff and Publish week hold it, so two drops, or a drop and a publish, never interleave,
    /// even across participants (one person dropped onto two overlapping shifts at once). It is the generator's <see cref="RosterGenerationLock"/>, keyed on the tenant under a scope of its
    /// own: a move only changes who works a shift, so it has nothing to wait for in a generation. A no-op off PostgreSQL. Read what you change AFTER taking it.
    /// </summary>
    // shortcut: an unscoped SuperAdmin holds their own home organisation's key (every token carries tenant_id), so their writes to another organisation's roster do not exclude its
    // coordinators; key the lock on the shift's TenantId if SuperAdmins edit rosters unscoped.
    private Task<RosterGenerationLock> RosterBoardLockAsync(CancellationToken ct) =>
        RosterGenerationLock.AcquireAsync(_db, _tenant?.TenantId ?? Guid.Empty, ct, _generator.LockWait, scope: "roster-board");

    /// <summary>
    /// Locks the shift rows <paramref name="where"/> picks (a fixed predicate; values only as parameters) FOR UPDATE, in Id order: the order the agreement approval locks its participant's rows in,
    /// so two lockers never take the same rows in opposite orders. Call it after the board lock. The wait is bounded like the advisory lock's, and a wait that runs out, or a deadlock PostgreSQL
    /// breaks, is a <see cref="RosterBusyException"/> (409 busy), never a raw 500. A no-op off PostgreSQL.
    /// </summary>
    private async Task LockShiftRowsAsync(string where, object[] parameters, CancellationToken ct)
    {
        if (!_db.Database.IsNpgsql()) return;
        // Raw SQL skips the tenant query filter, so name the caller's organisation (post-merge review N5): another organisation's row is never locked, and a guessed id answers
        // 404 at once from the filtered read rather than waiting on, and so revealing, a row someone else is writing.
        if (_tenant is { IsSuperAdmin: false, TenantId: { } tenantId })
        {
            where = string.Create(CultureInfo.InvariantCulture, $"({where}) AND \"TenantId\" = {{{parameters.Length}}}");
            parameters = [.. parameters, tenantId];
        }
        var sql = string.Create(CultureInfo.InvariantCulture,
            $"SET LOCAL lock_timeout = {(int)_generator.LockWait.TotalMilliseconds}; SELECT 1 FROM \"Shifts\" WHERE {where} ORDER BY \"Id\" FOR UPDATE; SET LOCAL lock_timeout TO DEFAULT");
        try
        {
            await _db.Database.ExecuteSqlRawAsync(sql, parameters, ct);
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.LockNotAvailable or PostgresErrorCodes.DeadlockDetected)
        {
            throw new RosterBusyException();
        }
    }

    /// <summary>
    /// Where the shifts just made take a pool past its funding for a period (budget phase 3), as warnings; null when there are none to say. A warning only, in every mode: the shifts exist, and a budget that could
    /// not be worked out must never turn a successful Generate into a failure, so a failure here is logged and the result goes out without warnings.
    /// </summary>
    private async Task<List<BudgetWarningDto>?> BudgetWarningsAsync(Guid participantId, IReadOnlyList<Shift> made, CancellationToken ct)
    {
        if (_budgetEffect is null || _tenant?.TenantId is not { } tenantId || made.Count == 0) return null;
        try
        {
            var warnings = await _budgetEffect.ForShiftsAsync(tenantId, participantId, made.Select(PlannedShift.Of).ToList(), ct);
            return warnings.Count > 0 ? warnings : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger?.LogWarning(ex, "The budget warnings for the shifts just generated for participant {ParticipantId} could not be worked out; the result is returned without them", participantId);
            return null;
        }
    }

    /// <summary>
    /// True when an edit cannot have made its shift clash with the worker's other shifts: it cancels the shift, or edits a live shift keeping the same worker, date and times it already has (reopening a cancelled one makes it live, so it is checked). Rows saved before the
    /// double-booking block may clash, and cancelling or annotating one must still work (2026-10-27).
    /// </summary>
    private static bool ClashIsInherited(Shift? saved, ShiftStatus? status, Guid? staffId, DateOnly date, TimeOnly start, TimeOnly end, bool endsNextDay) =>
        status == ShiftStatus.Cancelled
        || (saved is not null && saved.Status != ShiftStatus.Cancelled && saved.UserId == staffId && saved.ServiceDate == date && saved.StartTime == start && saved.EndTime == end && saved.EndsNextDay == endsNextDay);

    private bool CallerIsAdmin => User?.IsInRole("Admin") == true || User?.IsInRole("SuperAdmin") == true;

    /// <summary>What a shift whose end is not after its start is refused with: an overnight shift is one that "ends the next day" (the phase 3 review, C1: without it the shift had a negative length and a negative price).</summary>
    private const string ShiftEndsBeforeItStartsMessage = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift.";

    /// <summary>The machine-readable code of that refusal (the dry run, a create and an update of a shift, a pattern's create and update). The screens answer it under End time and recognise it by this code, with the sentence only as their fallback, so the wording can change without breaking them.</summary>
    private const string ShiftNoLengthCode = "shift-no-length";

    /// <summary>
    /// The budget check of the candidate shift (budget phase 3), quiet when the request has no organisation to show money for. <paramref name="existingId"/> is the saved shift an edit replaces, <paramref name="status"/>
    /// the status it would be saved with. Whether the shift is routine is read from the saved shift's own pattern link, never from the request (C3).
    /// </summary>
    private async Task<ShiftBudgetOutcome> CheckBudgetAsync(Shift candidate, Guid? existingId, ShiftStatus? status, CancellationToken ct)
    {
        if (_budget is null || _tenant?.TenantId is not { } tenantId) return ShiftBudgetOutcome.Quiet;
        return await _budget.CheckAsync(new ShiftBudgetRequest(
            tenantId, candidate.ParticipantId, existingId == Guid.Empty ? null : existingId, candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay,
            candidate.Ratio, candidate.NightType, status, CallerIsAdmin, candidate.SupportGroupCode), ct);
    }

    /// <summary>
    /// Raises the Admin's review of a shift just accepted as an emergency or safety booking over budget: one open task for the shift at a time (idempotent on its source key, so a retry or a second save of
    /// the same shift never doubles it), due the provider's tomorrow, owned by the shift's organisation, and committed with the shift in the caller's own save. The first review is
    /// <c>budget-emergency:{shiftId}</c>. A review an Admin has closed is never reopened, so a further emergency on the same shift (a bigger overrun nobody has looked at) gets its own,
    /// <c>budget-emergency:{shiftId}:2</c>, then <c>:3</c>, so the shift's marker never reads "Reviewed" over an overrun that was never reviewed (the phase 3 review, C4).
    /// </summary>
    private async Task RaiseEmergencyReviewAsync(Shift shift, CancellationToken ct)
    {
        var participant = await _db.Participants.AsNoTracking().FirstAsync(p => p.Id == shift.ParticipantId, ct);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, participant.TenantId, _clock, ct);
        var date = shift.ServiceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var earlier = await _db.BookingTasks.AsNoTracking()
            .Where(t => t.ShiftId == shift.Id && t.TaskType == TaskType.BudgetEmergencyReview)
            .OrderBy(t => t.SourceKey!.Length).ThenBy(t => t.SourceKey)   // the keys run :2, :3 after the first, so the last is the newest
            .Select(t => new { t.SourceKey, t.Status })
            .ToListAsync(ct);
        var newest = earlier.LastOrDefault();
        var sourceKey = newest == null ? $"budget-emergency:{shift.Id}"
            : newest.Status is TaskItemStatus.Completed or TaskItemStatus.Cancelled ? $"budget-emergency:{shift.Id}:{earlier.Count + 1}"
            : newest.SourceKey!;
        await _obligationTasks.EnsureAsync(new Odip.Application.Interfaces.ObligationTaskSpec(
            SourceKey: sourceKey,
            Type: TaskType.BudgetEmergencyReview,
            Title: string.Create(CultureInfo.InvariantCulture, $"Review emergency shift over budget: {participant.FullName} on {shift.ServiceDate:d MMM yyyy}"),
            DueDate: today.AddDays(1),
            LinkTo: $"/rostering?date={date}&participant={participant.Id}",
            ShiftId: shift.Id,
            TenantId: participant.TenantId), ct);
    }

    /// <summary>Staff-level compliance for the board row, evaluated once at the week's Monday — independent of any specific shift's findings.</summary>
    private static (RosterComplianceLevel Level, List<string> Notes) ComputeCompliance(User staff, DateOnly weekStart)
    {
        // Blocked only for a screening that has genuinely lapsed — a verified regulatory
        // prohibition. A screening that simply hasn't been recorded yet is a records gap, not
        // a verdict on the worker, and only downgrades to Warning below (mirrors WSC_EXPIRED
        // vs WSC_MISSING in RosterConflictService).
        if (staff.WorkerScreeningExpiryDate is { } expiry && expiry < weekStart)
        {
            return (RosterComplianceLevel.Blocked, new List<string>
            {
                $"{staff.FullName}'s worker screening expired {expiry.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}."
            });
        }

        var notes = new List<string>();
        if (staff.WorkerScreeningExpiryDate is null)
            notes.Add($"{staff.FullName} has no worker screening recorded — confirm it before the shift.");
        if (staff.IsFirstAidQualified && staff.FirstAidExpiryDate is { } firstAid && firstAid < weekStart)
            notes.Add($"{staff.FullName}'s first aid certificate expired {firstAid.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsCprQualified && staff.CprExpiryDate is { } cpr && cpr < weekStart)
            notes.Add($"{staff.FullName}'s CPR certificate expired {cpr.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsDriverEligible && staff.DriverLicenceExpiryDate is { } licence && licence < weekStart)
            notes.Add($"{staff.FullName}'s driver licence expired {licence.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsManualHandlingCompetent && staff.ManualHandlingExpiryDate is { } manualHandling && manualHandling < weekStart)
            notes.Add($"{staff.FullName}'s manual handling competency expired {manualHandling.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsMedicationCompetent && staff.MedicationCompetencyExpiryDate is { } medication && medication < weekStart)
            notes.Add($"{staff.FullName}'s medication competency expired {medication.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");

        return notes.Count > 0 ? (RosterComplianceLevel.Warning, notes) : (RosterComplianceLevel.Ok, notes);
    }
}
