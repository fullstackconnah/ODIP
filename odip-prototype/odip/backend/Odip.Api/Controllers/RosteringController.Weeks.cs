using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
    /// <summary>
    /// Publish week (roster drag and drop, 2026-10-14): every Draft shift of the organisation in the Monday-start week holding <paramref name="weekStart"/>, for every participant the board
    /// shows, that has someone on it, becomes Published, and each worker on one from the provider's today on is told (ShiftAssigned). A Draft nobody is on stays Draft (counted as unfilled, owner
    /// 2026-10-28: hold until staffed) and goes out at the first publish after someone is put on it. A staffed Draft whose worker now has a Blocking finding stays Draft and is counted as skipped,
    /// as a PUT publishing it alone would be refused. Under the organisation's roster lock: a second publish at the same time waits, finds nothing left, and
    /// tells nobody twice. An optional <c>shiftIds</c> body narrows the publish to those Drafts (R3, 2026-11-04); an empty list is refused so it can never mean the whole week. Group activities in the week follow the same Draft-to-Published rule (whole-week mode only) and their staff are told in the same notice, one per worker.
    /// </summary>
    [HttpPost("weeks/{weekStart}/publish")]
    public async Task<ActionResult<ApiResponse<PublishWeekResultDto>>> PublishWeek(DateOnly weekStart, CancellationToken ct, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] PublishShiftsRequest? body = null)
    {
        // A SuperAdmin who has not chosen an organisation has no tenant filter: a publish then would reach every organisation's week.
        if (_tenant?.TenantId is not { } tenantId) return BadRequest(ApiResponse<PublishWeekResultDto>.Fail("Choose an organisation to publish its week."));
        if (body?.ShiftIds is { Count: 0 }) return BadRequest(ApiResponse<PublishWeekResultDto>.Fail("Choose at least one shift to publish."));
        if (body?.ShiftIds is { Count: > 500 }) return BadRequest(ApiResponse<PublishWeekResultDto>.Fail("Choose 500 shifts or fewer."));
        var chosen = body?.ShiftIds?.ToHashSet();
        var start = WeekStart(weekStart);
        var end = start.AddDays(6);
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            // Hold the week's Draft rows until this commits, then read them. A PUT takes the board lock too, so it waits for the publish; any other writer of a draft row (a
            // completion endpoint, the generator) either waits here or committed first and is read below as it is, so a publish never writes Published over it.
            await LockShiftRowsAsync("\"TenantId\" = {0} AND \"Status\" = {1} AND \"ServiceDate\" >= {2} AND \"ServiceDate\" <= {3}",
                new object[] { tenantId, (int)ShiftStatus.Draft, start, end }, ct);
            var shown = _db.Participants.Where(Participant.CanReceiveServicesRule).Select(p => p.Id);
            var drafts = await _db.Shifts
                .Where(s => s.TenantId == tenantId && s.Status == ShiftStatus.Draft && s.ServiceDate >= start && s.ServiceDate <= end && shown.Contains(s.ParticipantId) && (chosen == null || chosen.Contains(s.Id)))
                .ToListAsync(ct);
            var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
            // Only a draft whose worker's screening has lapsed, who has not started by its day, or who is marked No for its participant can hit a Blocking finding, so only those need the full roster check: one query for every worker, one for the Nos.
            var workerIds = drafts.Where(s => s.UserId.HasValue).Select(s => s.UserId!.Value).Distinct().ToList();
            var gates = await _db.Users.Where(u => workerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => (Expiry: u.WorkerScreeningExpiryDate, Start: u.EmploymentStartDate, Active: u.IsActive), ct);
            var excluded = (await _db.StaffParticipantCompatibilities.Where(c => c.Level == CompatibilityLevel.Excluded && workerIds.Contains(c.UserId) && shown.Contains(c.ParticipantId)).Select(c => new { c.UserId, c.ParticipantId }).ToListAsync(ct))
                .Select(c => (c.UserId, c.ParticipantId)).ToHashSet();

            var published = new List<Shift>();
            var skipped = 0;
            foreach (var shift in drafts.Where(s => s.UserId.HasValue))
            {
                // An archived worker gets no notice, so their draft stays Draft and counts as skipped (H42B-1).
                if (shift.UserId is { } holder && gates.TryGetValue(holder, out var hg) && !hg.Active) { skipped++; continue; }
                // shortcut: only a lapsed screening, a start date ahead or a No is re-checked (the Blocking rules today); check every filled draft again if another Blocking rule is added.
                var mayBeBlocked = shift.UserId is { } worker && ((gates.TryGetValue(worker, out var g) && (g.Expiry < shift.ServiceDate || g.Start > shift.ServiceDate)) || excluded.Contains((worker, shift.ParticipantId)));
                if (mayBeBlocked && (await CheckAsync(shift, shift.Id, ct)).Any(f => f.Severity == RosterFindingSeverity.Blocking)) { skipped++; continue; }
                shift.Status = ShiftStatus.Published;
                shift.UpdatedAt = DateTime.UtcNow;
                published.Add(shift);
            }

            // Group activities (PR1): publishing the whole week publishes its Draft activities too, while the switch is on, and a published activity brings its Draft participant shifts out with it (they have no worker, so the loop above skips them). Publishing a chosen list leaves activities alone: publish those from the activity.
            var newlyPublished = new List<GroupActivity>();
            if (await GroupActivitiesController.FlagOnAsync(_db, tenantId, ct))
            {
                var weekActivities = await _db.GroupActivities.Where(a => a.TenantId == tenantId && a.ServiceDate >= start && a.ServiceDate <= end).ToListAsync(ct);
                if (chosen == null)
                    foreach (var activity in weekActivities.Where(a => a.Status == ShiftStatus.Draft))
                    {
                        (activity.Status, activity.UpdatedAt) = (ShiftStatus.Published, DateTime.UtcNow);
                        newlyPublished.Add(activity);
                    }
                var publishedActivityIds = weekActivities.Where(a => a.Status == ShiftStatus.Published).Select(a => a.Id).ToHashSet();
                foreach (var shift in drafts.Where(s => s.GroupActivityId is { } activityId && s.UserId is null && publishedActivityIds.Contains(activityId)))
                {
                    shift.Status = ShiftStatus.Published;
                    shift.UpdatedAt = DateTime.UtcNow;
                    published.Add(shift);
                }
            }

            // One notice per worker, listing every shift and activity of theirs this publish put out, earliest first (fix round 1). A line whose day has gone is published for the
            // record, but nobody is told about it now.
            var toTell = published.Where(s => s.UserId.HasValue && s.ServiceDate >= today).ToList();
            var participantIds = toTell.Select(s => s.ParticipantId).Distinct().ToList();
            var participantNames = await _db.Participants.Where(p => participantIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => (p.FirstName + " " + p.LastName).Trim(), ct);
            var lines = toTell.Select(s => new PublishNoticeLine(s.UserId!.Value, "Shift", s.Id, participantNames.GetValueOrDefault(s.ParticipantId) ?? "a participant", s.ServiceDate, s.StartTime, s.EndTime))
                .Concat(await PublishNotices.ActivityLinesAsync(_db, tenantId, newlyPublished, today, ct)).ToList();
            var notified = await PublishNotices.RaiseAsync(_db, _notificationRaiser, lines, ct);

            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            return Ok(ApiResponse<PublishWeekResultDto>.Ok(new PublishWeekResultDto
            {
                Published = published.Count,
                Notified = notified,
                Unfilled = drafts.Count(s => s.UserId is null && s.GroupActivityId is null),
                Skipped = skipped,
                Activities = newlyPublished.Count,
            }));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<PublishWeekResultDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    /// <summary>
    /// Start rostering (2026-10-16, L4): makes the scheduled shifts of the Monday-start week holding <paramref name="weekStart"/>, for every live agreement pattern of a participant who may be rostered,
    /// then applies the regular-away rule (L5) and marks the week started, in one transaction under the organisation's board lock. Each participant's generation lock is taken too (it joins the
    /// transaction), so an approval or a Generate for them waits and then sees the week as started. Any week may be started; a started one is 409 roster-week-started.
    /// </summary>
    [HttpPost("weeks/{weekStart}/start")]
    public async Task<ActionResult<ApiResponse<StartWeekResultDto>>> StartWeek(DateOnly weekStart, CancellationToken ct)
    {
        // As Publish week: a SuperAdmin with no organisation chosen has no tenant filter.
        if (_tenant?.TenantId is not { } tenantId) return BadRequest(ApiResponse<StartWeekResultDto>.Fail("Choose an organisation to start its week."));
        var start = WeekStart(weekStart);
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            var started = await _weekStarter.StartAsync(_db, tenantId, start, ResolveCurrentUserId(), _clock.GetUtcNow().UtcDateTime, ct);
            if (started is null) return WeekAlreadyStarted();
            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            return Ok(ApiResponse<StartWeekResultDto>.Ok(await StartWeekResultAsync(start, started.Made, started.Skipped, started.Away, ct)));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<StartWeekResultDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
        // A Generate (L10) or another Start marked the week started between the check and this save: the unique row decides, and nothing of this Start is kept.
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return WeekAlreadyStarted();
        }
    }

    /// <summary>
    /// Auto-roster (R7), read-only: a draft of who could take the open shifts of the Monday-start week holding <paramref name="weekStart"/>. Nothing is saved or sent, and no lock is taken;
    /// the draft says what the rules allow now, and anything applied later is checked again.
    /// </summary>
    [HttpPost("weeks/{weekStart}/auto-roster")]
    public async Task<ActionResult<ApiResponse<AutoRosterDraftDto>>> AutoRoster(DateOnly weekStart, CancellationToken ct)
    {
        // As Start rostering: a SuperAdmin with no organisation chosen has no tenant filter.
        if (_tenant?.TenantId is not { } tenantId) return BadRequest(ApiResponse<AutoRosterDraftDto>.Fail("Choose an organisation to auto-roster its week."));
        return Ok(ApiResponse<AutoRosterDraftDto>.Ok(await new AutoRosterDraftBuilder(_db, _availability).BuildAsync(tenantId, WeekStart(weekStart), _clock.GetUtcNow().UtcDateTime, ct)));
    }

    private const int AutoRosterApplyMaxRows = 500;

    /// <summary>
    /// Auto-roster (R7) apply: gives each kept row of a draft to its worker, in the request's order, through the same body as /assign (readiness, the gate, LeaveCoverage closing, notices). It runs under
    /// the board lock and the rows' locks, inside the lock's one transaction: a failure part-way rolls back every row. A row that is not placeable now (filled or changed since the draft, refused by the
    /// gate, in another organisation or week) is skipped with its message and the rest still apply; skipping is never an error.
    /// </summary>
    [HttpPost("weeks/{weekStart}/auto-roster/apply")]
    public async Task<ActionResult<ApiResponse<AutoRosterApplyResultDto>>> AutoRosterApply(DateOnly weekStart, [FromBody] AutoRosterApplyDto dto, CancellationToken ct)
    {
        if (_tenant?.TenantId is not { } tenantId) return BadRequest(ApiResponse<AutoRosterApplyResultDto>.Fail("Choose an organisation to auto-roster its week."));
        if (dto?.Rows is null) return BadRequest(ApiResponse<AutoRosterApplyResultDto>.Fail("Choose the shifts to apply."));
        var splits = dto.Splits ?? [];
        if (dto.Rows.Count + splits.Count > AutoRosterApplyMaxRows) return BadRequest(ApiResponse<AutoRosterApplyResultDto>.Fail($"Apply at most {AutoRosterApplyMaxRows} shifts at a time."));
        var start = WeekStart(weekStart);
        var end = start.AddDays(6);
        var shiftIds = dto.Rows.Select(r => r.ShiftId).Concat(splits.Select(x => x.ShiftId)).Distinct().ToList();
        var staffIds = dto.Rows.Select(r => r.StaffId).Concat(splits.SelectMany(x => new[] { x.FirstStaffId, x.SecondStaffId })).Distinct().ToList();
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = ANY({0})", new object[] { shiftIds.ToArray() }, ct);
            // The assign body reads through the query filter, which SuperAdmin and the tests lack: name the organisation (and the week) here so another organisation's row is never written.
            var shiftsHere = (await _db.Shifts.Where(s => shiftIds.Contains(s.Id) && s.TenantId == tenantId && s.ServiceDate >= start && s.ServiceDate <= end).Select(s => s.Id).ToListAsync(ct)).ToHashSet();
            var staffHere = (await _db.Users.Where(u => staffIds.Contains(u.Id) && u.TenantId == tenantId).Select(u => u.Id).ToListAsync(ct)).ToHashSet();

            var result = new AutoRosterApplyResultDto();
            var seen = new HashSet<Guid>();
            foreach (var row in dto.Rows)
            {
                if (!seen.Add(row.ShiftId)) { result.Skipped.Add(new() { ShiftId = row.ShiftId, Message = "Listed twice." }); continue; }
                if (!shiftsHere.Contains(row.ShiftId)) { result.Skipped.Add(new() { ShiftId = row.ShiftId, Message = "Shift not found." }); continue; }
                if (!staffHere.Contains(row.StaffId)) { result.Skipped.Add(new() { ShiftId = row.ShiftId, Message = "Staff member not found." }); continue; }
                // ExpectedStaffId null: the draft only fills open shifts, so a shift someone filled since is a 409 here, never a replacement.
                var assigned = await AssignShiftLockedAsync(row.ShiftId, new AssignShiftDto { StaffId = row.StaffId, ExpectedStaffId = null }, ct);
                if (assigned.Result is OkObjectResult) result.Applied.Add(row.ShiftId);
                else result.Skipped.Add(new() { ShiftId = row.ShiftId, Message = AssignRefusalMessage(assigned.Result) });
            }

            foreach (var split in splits)
            {
                if (!seen.Add(split.ShiftId)) { result.Skipped.Add(new() { ShiftId = split.ShiftId, Message = "Listed twice." }); continue; }
                if (!shiftsHere.Contains(split.ShiftId)) { result.Skipped.Add(new() { ShiftId = split.ShiftId, Message = "Shift not found." }); continue; }
                if (!staffHere.Contains(split.FirstStaffId) || !staffHere.Contains(split.SecondStaffId)) { result.Skipped.Add(new() { ShiftId = split.ShiftId, Message = "Staff member not found." }); continue; }
                if (await ApplySplitAsync(split, ct) is { } refused) result.Skipped.Add(new() { ShiftId = split.ShiftId, Message = refused });
                else result.Applied.Add(split.ShiftId);
            }
            await held.CommitAsync(ct);
            return Ok(ApiResponse<AutoRosterApplyResultDto>.Ok(result));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<AutoRosterApplyResultDto>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    /// <summary>
    /// Auto-roster (R7, D9) applies one split under the apply's locks: the shift is cut at <see cref="AutoRosterApplySplitDto.CutAt"/> through the locked update, its other half is created through the
    /// create path (so the budget and create gates run), then both halves are assigned through the assign body. Null when applied; otherwise the words of the refusal, with nothing left written for the shift.
    /// A refusal part-way rolls back to a savepoint taken before the cut, so nothing the halves saved (notices, the closed LeaveCoverage task, overrides) survives.
    /// </summary>
    private async Task<string?> ApplySplitAsync(AutoRosterApplySplitDto split, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == split.ShiftId, ct);
        if (shift is null) return "Shift not found.";
        if (shift.GroupActivityId is not null) return "This shift is part of a group activity.";   // ruling 1: the activity owns its workers
        if (shift.UserId is not null || shift.Status is not (ShiftStatus.Draft or ShiftStatus.Published) || shift.StartTime != split.StartTime || shift.EndTime != split.EndTime)
            return "This shift has changed since the draft.";
        if (shift.EndsNextDay || shift.NightType != SleepoverType.None || shift.Ratio != SupportRatio.OneToOne) return "This shift can't be split.";
        if (split.FirstStaffId == split.SecondStaffId || Shift.HoursBetween(split.StartTime, split.CutAt, false) < AutoRosterRules.MinSplitSegmentHours
            || Shift.HoursBetween(split.CutAt, split.EndTime, false) < AutoRosterRules.MinSplitSegmentHours)
            return "This split is not valid.";

        var (regularUserId, regularAwayReason) = (shift.RegularUserId, shift.RegularAwayReason);
        var tx = _db.Database.CurrentTransaction;
        if (tx is not null) await tx.CreateSavepointAsync("split", ct);
        Guid? halfId = null;
        async Task<string> UndoAsync(string why)
        {
            if (tx is not null)
            {
                await tx.RollbackToSavepointAsync("split", ct);
                _db.ChangeTracker.Clear();   // the loaded entities hold the rolled-back values; the apply loop only ever re-reads by id
                return why;
            }
            // No transaction (EF InMemory in the controller tests): put back by hand what the halves saved.
            if (halfId is { } id && await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct) is { } half) _db.Shifts.Remove(half);
            (shift.UserId, shift.EndTime, shift.RegularUserId, shift.RegularAwayReason, shift.UpdatedAt) = (null, split.EndTime, regularUserId, regularAwayReason, DateTime.UtcNow);
            await _db.SaveChangesAsync(ct);
            return why;
        }

        var shrunk = await UpdateShiftLockedAsync(shift.Id, new UpdateShiftDto
        {
            ParticipantId = shift.ParticipantId, StaffId = null, ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = split.CutAt, Ratio = shift.Ratio, NightType = shift.NightType,
            Notes = shift.Notes, Location = shift.Location, ServiceLocationId = shift.ServiceLocationId, SupportGroupCode = shift.SupportGroupCode, Status = shift.Status, CancellationReason = shift.CancellationReason,
        }, ct);
        if (shrunk.Result is not OkObjectResult) return await UndoAsync(AssignRefusalMessage(shrunk.Result));

        var created = await CreateShiftCoreAsync(new CreateShiftDto
        {
            ParticipantId = shift.ParticipantId, StaffId = null, ServiceDate = shift.ServiceDate, StartTime = split.CutAt, EndTime = split.EndTime, Ratio = shift.Ratio, NightType = shift.NightType,
            Notes = shift.Notes, Location = shift.Location, ServiceLocationId = shift.ServiceLocationId, SupportGroupCode = shift.SupportGroupCode,
        }, null, ct, copyFrom: shift);
        if ((created.Result as OkObjectResult)?.Value is not ApiResponse<ShiftDto> { Data: { } half2 }) return await UndoAsync(AssignRefusalMessage(created.Result));
        halfId = half2.Id;

        var first = await AssignShiftLockedAsync(shift.Id, new AssignShiftDto { StaffId = split.FirstStaffId, ExpectedStaffId = null }, ct);
        if (first.Result is not OkObjectResult) return await UndoAsync(AssignRefusalMessage(first.Result));
        var second = await AssignShiftLockedAsync(half2.Id, new AssignShiftDto { StaffId = split.SecondStaffId, ExpectedStaffId = null }, ct);
        if (second.Result is not OkObjectResult) return await UndoAsync(AssignRefusalMessage(second.Result));
        return null;
    }

    /// <summary>The words of a refused assign (404, 400, 409 or the gate's 422), for the apply's skip list.</summary>
    private static string AssignRefusalMessage(IActionResult? refused)
    {
        var (errors, message) = (refused as ObjectResult)?.Value switch
        {
            ApiResponse<ShiftDto> r => (r.Errors, r.Message),
            ApiResponse<List<RosterFindingDto>> r => (r.Errors, r.Message),
            _ => (null, null),
        };
        return errors?.FirstOrDefault() ?? message ?? "This shift could not be filled.";
    }

    /// <summary>The code of Start's 409 for a week already started (L4): not "busy", so the board and the e2e helper can tell them apart.</summary>
    public const string RosterWeekStartedCode = "roster-week-started";

    private ConflictObjectResult WeekAlreadyStarted() => Conflict(ApiResponse<StartWeekResultDto>.Fail("This week has already been started.", RosterWeekStartedCode));

    /// <summary>Start's answer, after its commit: the names of the participants it skipped, and the budget warnings of what it made (never a failure: BudgetWarningsAsync logs and drops one).</summary>
    private async Task<StartWeekResultDto> StartWeekResultAsync(DateOnly start, List<Shift> made, List<Guid> skipped, int away, CancellationToken ct)
    {
        var involved = skipped.Concat(made.Select(s => s.ParticipantId)).Distinct().ToList();
        var names = await _db.Participants.AsNoTracking().Where(p => involved.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => (p.FirstName + " " + p.LastName).Trim(), ct);
        var budget = new List<StartWeekParticipantDto>();
        foreach (var forParticipant in made.GroupBy(s => s.ParticipantId))
            if (await BudgetWarningsAsync(forParticipant.Key, forParticipant.ToList(), ct) is { } warnings)
                budget.Add(new StartWeekParticipantDto { ParticipantId = forParticipant.Key, FullName = names.GetValueOrDefault(forParticipant.Key) ?? string.Empty, Warnings = warnings });
        return new StartWeekResultDto
        {
            WeekStart = start, Created = made.Count, AssignedToRegulars = made.Count(s => s.UserId != null), RegularAway = away,
            Skipped = skipped.Select(id => new StartWeekParticipantDto { ParticipantId = id, FullName = names.GetValueOrDefault(id) ?? string.Empty }).ToList(),
            BudgetWarnings = budget.Count > 0 ? budget : null,
        };
    }
}
