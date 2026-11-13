using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
    // ══════════════════════════════════════════════════════════════
    // SHIFTS
    // ══════════════════════════════════════════════════════════════

    /// <summary>Dry-run findings for a candidate shift. Never writes — the same check every gated write runs, exposed for live validation as the coordinator edits.</summary>
    [HttpPost("shifts/check")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> CheckShift(
        [FromBody] CheckShiftDto dto, CancellationToken ct)
    {
        if (Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));

        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail(refError));

        var candidate = new Shift
        {
            Id = dto.Id ?? Guid.Empty, ParticipantId = dto.ParticipantId, UserId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType, SupportGroupCode = SupportTypeCheck.Tidy(dto.SupportGroupCode)
        };

        var findings = await CheckAsync(candidate, dto.Id, ct, callerIsAdmin: CallerIsAdmin);
        // The live check of an edit says what the save will say, so an existing clash is not shown as blocking either.
        var saved = dto.Id is { } savedId ? await _db.Shifts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == savedId, ct) : null;
        if (ClashIsInherited(saved, dto.Status, dto.StaffId, dto.ServiceDate, dto.StartTime, dto.EndTime, dto.EndsNextDay))
            findings.RemoveAll(f => f.Code == RosterConflictService.DoubleBookedShift);
        // Cancelling a shift the worker already holds is always allowed, so the live check does not show their No as blocking (UpdateShift says the same).
        if (dto.Status == ShiftStatus.Cancelled && saved?.UserId == dto.StaffId)
            findings.RemoveAll(f => f.Code == RosterConflictService.CompatibilityExcluded);

        // Budget phase 3: after the domain check and OUTSIDE its early return for an unfilled shift (a budget is about the participant, not the worker). The envelope's message carries the one
        // informational line a shift the estimator cannot price gets; it is not a finding and never blocks.
        var budget = await CheckBudgetAsync(candidate, dto.Id, dto.Status, ct);
        findings.AddRange(budget.Findings);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(ToFindingDto).ToList(), budget.Note));
    }

    /// <summary>Create a shift. Runs the roster check before saving — see <see cref="EvaluateFindings"/>.</summary>
    [HttpPost("shifts")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> CreateShift(
        [FromBody] CreateShiftDto dto, CancellationToken ct)
    {
        if (dto.MoveFromShiftId is not null && dto.StaffId is null) return BadRequest(ApiResponse<ShiftDto>.Fail("Name the person who is moving."));
        // An open shift names nobody, so there is no double-booking for a second create to miss: only a named worker takes the board's lock.
        if (dto.StaffId is null) return await CreateShiftCoreAsync(dto, null, ct);
        try
        {
            // The board's lock order: two creates for one worker, or a create and a move, are taken in turn, so the later one reads the earlier one's shift (DOUBLE_BOOKED_SHIFT).
            // An empty-day move (deep review S6) then locks the source row and reads it, as move-staff does.
            await using var held = await RosterBoardLockAsync(ct);
            Shift? from = null;
            if (dto.MoveFromShiftId is { } fromId)
            {
                await LockShiftRowsAsync("\"Id\" = {0}", new object[] { fromId }, ct);
                from = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == fromId, ct);
                if (from is null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
                if (IsLockedForStaffChange(from.Status))
                    return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
                // The person the page carried is no longer on the shift they left: never clear somebody else by surprise.
                if (from.UserId != dto.StaffId) return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
            }
            var result = await CreateShiftCoreAsync(dto, from, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    /// <summary>Update a shift. Re-runs the roster check against the edited candidate (excluding the shift's own prior row) before saving.</summary>
    [HttpPut("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> UpdateShift(
        Guid id, [FromBody] UpdateShiftDto dto, CancellationToken ct)
    {
        try
        {
            // The board's lock order (deep review S1), as /assign and move-staff take it: a PUT that changes the worker or the status waits for a Publish week or a move
            // of the same organisation, then reads the shift as it is now, so it never writes over a publish or a move from a stale read and its notices tell the truth.
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = {0}", new object[] { id }, ct);
            var result = await UpdateShiftLockedAsync(id, dto, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    /// <summary>
    /// Delete a shift outright. Not roster-checked — removing a shift can never itself create a conflict. The shift's OWN handover
    /// acknowledgements (a worker marking the previous handover as read, recorded against the shift they read it from) go with it: they only
    /// say that a reader saw a handover from that shift, they mean nothing without it, and they are restricted by a foreign key, so without
    /// this a Published shift whose worker had opened the handover could not be deleted (500, a foreign-key violation) - the everyday case
    /// of a sick call or a re-roster by delete. They are removed in the same save (one transaction) and the removal is audited. The
    /// acknowledgements OTHER shifts made of THIS shift's handover are not touched: the shift has none while it has no completion, and a
    /// shift with a completion is still refused by the completion's own foreign key, as before.
    /// </summary>
    [HttpDelete("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteShift(Guid id, CancellationToken ct)
    {
        try
        {
            // The board's lock order, as /assign, move-staff and PUT take it: a Delete is ordered with a Publish week or a move of the organisation and reads the shift as it is now.
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = {0}", new object[] { id }, ct);
            var result = await DeleteShiftLockedAsync(id, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<bool>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    /// <summary>The body of <see cref="DeleteShift"/>, run under its locks.</summary>
    private async Task<ActionResult<ApiResponse<bool>>> DeleteShiftLockedAsync(Guid id, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<bool>.Fail("Shift not found."));
        if (shift.GroupActivityId is not null) return Conflict(ApiResponse<bool>.Fail(DeleteOnGroupActivityMessage, GroupActivityOnShiftCode));
        // A started or finished shift has a completion (and notes) behind it, held by a Restrict foreign key: refuse it as the other writes do, never a 500.
        if (shift.Status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed)
            return Conflict(ApiResponse<bool>.Fail(ShiftNotDeletableMessage, ShiftErrorCodes.ShiftStatusLocked));
        // The Restrict keys are on ROWS, not statuses: a returned shift is Published again with its inactive completion, and a worker can note any non-Draft shift of their own. Under the row lock, so a
        // note or completion cannot slip in between the check and the delete.
        if (await _db.ShiftCompletions.AnyAsync(c => c.ShiftId == id, ct) || await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct))
            return Conflict(ApiResponse<bool>.Fail(ShiftHasRecordsMessage, ShiftErrorCodes.ShiftStatusLocked));

        // Item 9: deleting the shift removes whatever coverage gap it represented.
        await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);

        // A Published shift's worker is told it is gone: the shift ends with no worker, as an unassign would.
        var worker = shift.UserId;
        shift.UserId = null;
        await NotifyStaffChangeAsync(shift, worker, wasPublished: shift.Status == ShiftStatus.Published, ct);

        _db.HandoverAcknowledgements.RemoveRange(await _db.HandoverAcknowledgements.Where(a => a.ShiftId == shift.Id).ToListAsync(ct));
        _db.Shifts.Remove(shift);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>Set or clear a shift's staff member. Clearing (StaffId null) always succeeds — an unfilled shift skips every staff-dependent rule.</summary>
    [HttpPost("shifts/{id:guid}/assign")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> AssignShift(
        Guid id, [FromBody] AssignShiftDto dto, CancellationToken ct)
    {
        try
        {
            // The board's lock order (deep review M1): the organisation's board lock, then the row, then the read, so the ExpectedStaffId check and the write cannot be split by
            // another drop, a move-staff or a PUT on this shift.
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = {0}", new object[] { id }, ct);
            var result = await AssignShiftLockedAsync(id, dto, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    /// <summary>
    /// Roster drag and drop (2026-10-14): carries the person on FromShiftId to ToShiftId in one all-or-nothing write. Move: onto an unfilled shift; the source becomes unfilled.
    /// Replace: the target's worker comes off; the source becomes unfilled. Swap: the two change places. Each person is judged against the shift they land on, with the shift they leave
    /// ignored (no false DOUBLE_BOOKED). A swap's two checks go through one gate (Blocking refuses, a warning needs the reason), and nothing is written unless all of it passes: one save,
    /// with its notices. Runs under the organisation's roster lock and reads both shifts after taking it, so a target filled or emptied since the board was drawn is refused (409).
    /// </summary>
    [HttpPost("shifts/move-staff")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> MoveStaff([FromBody] MoveStaffDto dto, CancellationToken ct)
    {
        if (dto.FromShiftId == dto.ToShiftId) return BadRequest(ApiResponse<ShiftDto>.Fail("Pick a different shift to move them to."));
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            // Lock order (shared with the agreement approval): the organisation's board lock, then the shift rows by Id, as /assign, the PUT and the moving create take them; both rows are held until the save.
            await LockShiftRowsAsync("\"Id\" IN ({0}, {1})", new object[] { dto.FromShiftId, dto.ToShiftId }, ct);
            var from = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == dto.FromShiftId, ct);
            var to = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == dto.ToShiftId, ct);
            // The query filter keeps both in the caller's organisation; a SuperAdmin with no tenant sees all of them, so they must also share one.
            if (from is null || to is null || from.TenantId != to.TenantId) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
            if (from.GroupActivityId is not null || to.GroupActivityId is not null) return Conflict(ApiResponse<ShiftDto>.Fail(WorkerOnGroupActivityMessage, GroupActivityOnShiftCode));
            if (IsLockedForStaffChange(from.Status) || IsLockedForStaffChange(to.Status))
                return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
            // The person the page carried is no longer on the source (or nobody is): never move somebody else by surprise.
            if (from.UserId is not { } mover || (dto.StaffId is { } carried && carried != mover)) return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
            if (to.UserId == mover) return BadRequest(ApiResponse<ShiftDto>.Fail("They are already on that shift."));
            // Drawn as Needs staff but filled since (Move), drawn filled but emptied since (Swap), or someone other than the person drawn there is on it now (Replace, Swap):
            // never take somebody off, or swap with somebody, by surprise.
            if ((dto.Mode == MoveStaffMode.Move && to.UserId is not null) || (dto.Mode == MoveStaffMode.Swap && to.UserId is null)
                || (dto.Mode != MoveStaffMode.Move && dto.ExpectedToStaffId is { } shown && shown != to.UserId))
                return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));

            var displaced = to.UserId;
            var back = dto.Mode == MoveStaffMode.Swap ? displaced : null;   // who lands on the source
            var refusal = await PlacementRefusalAsync(mover, to.ParticipantId, ct)
                ?? (back is { } b ? await PlacementRefusalAsync(b, from.ParticipantId, ct) : null);
            if (refusal != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refusal));

            var toFindings = await CheckAsync(WithWorker(to, mover), to.Id, ct, leavingShiftId: from.Id, callerIsAdmin: CallerIsAdmin);
            var fromFindings = back is { } swapped ? await CheckAsync(WithWorker(from, swapped), from.Id, ct, leavingShiftId: to.Id, callerIsAdmin: CallerIsAdmin) : new List<RosterFinding>();
            var rejection = EvaluateFindings(toFindings.Concat(fromFindings).ToList(), dto.OverrideReason);
            if (rejection != null) return UnprocessableEntity(rejection);

            ApplyStaff(to, mover, toFindings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
            // The source takes the swapped person, or nobody (and then no reason of its own, as a clear on /assign).
            ApplyStaff(from, back, fromFindings, back is null ? null : dto.OverrideReason, back is null ? null : dto.AcknowledgedFindingCodes);
            // Item 9 of the connection map: both shifts changed hands, so neither still waits to be re-covered for leave.
            await _obligationTasks.CompleteByShiftAsync(to.Id, TaskType.LeaveCoverage, ct);
            await _obligationTasks.CompleteByShiftAsync(from.Id, TaskType.LeaveCoverage, ct);
            await NotifyStaffChangeAsync(to, displaced, wasPublished: to.Status == ShiftStatus.Published, ct);
            await NotifyStaffChangeAsync(from, mover, wasPublished: from.Status == ShiftStatus.Published, ct);

            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(to, toFindings, ct)));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }
    private const string DeleteOnGroupActivityMessage = "This shift is part of a group activity. Remove them from the activity first.";

    private const string ShiftNotDeletableMessage = "This shift has been started or finished, so it can't be deleted.";
    private const string ShiftHasRecordsMessage = "This shift has notes or a timesheet behind it, so it can't be deleted. Cancel it instead.";

    /// <summary>The placement rules of /assign for one person landing on one participant's shift: an active worker and a participant ready for a new placement. Null when both hold.</summary>
    private async Task<string?> PlacementRefusalAsync(Guid userId, Guid participantId, CancellationToken ct)
    {
        if (!await _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct)) return "Staff member not found.";
        return (await ParticipantReadiness.CheckAsync(_db, participantId, ct)).Allowed ? null : ParticipantReadinessGate.NotReadyMessage;
    }
}
