using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

// GA PR3: the coordinator's review of group activity staff work. C1 lists the rows to review, C2 approves a batch, C3 records the times of one row.
public partial class GroupActivitiesController
{
    private const int ReviewCap = 200;
    private const int ApproveBatchMax = 100;
    private static readonly TimeSpan MaxShift = TimeSpan.FromHours(24);

    private Guid CurrentUserId => Guid.TryParse(User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : Guid.Empty;

    /// <summary>
    /// After the board and participant locks: <see cref="ShiftRowLock"/> on each attached shift, ascending (as the agreement approval does), then the shifts read fresh. The
    /// completion trigger acts on what this returns, so a participant shift cancelled a moment ago is seen as Cancelled and left alone.
    /// </summary>
    private async Task<List<Shift>> AttachedLockedAsync(GroupActivity activity, CancellationToken ct)
    {
        var ids = await _db.Shifts.AsNoTracking().Where(s => s.GroupActivityId == activity.Id && s.TenantId == activity.TenantId).Select(s => s.Id).OrderBy(i => i).ToListAsync(ct);
        foreach (var id in ids) await ShiftRowLock.AcquireAsync(_db, id, ct);   // joins the board lock's transaction
        var shifts = await _db.Shifts.Where(s => s.GroupActivityId == activity.Id && s.TenantId == activity.TenantId).ToListAsync(ct);
        foreach (var shift in shifts) await _db.Entry(shift).ReloadAsync(ct);
        return shifts;
    }

    /// <summary>A transient shift with the row's planned times, for the zone and the rostered window. Never attached to the context.</summary>
    private static Shift RowShift(GroupActivity a, GroupActivityStaff r) => new()
    {
        Id = r.Id, TenantId = r.TenantId, ServiceDate = a.ServiceDate, StartTime = r.StartTime, EndTime = r.EndTime, EndsNextDay = r.EndsNextDay, ServiceLocationId = a.ServiceLocationId,
    };

    private static GroupStaffReviewDto ToReview(GroupActivity a, GroupActivityStaff r, string staffName, string? payrollId, int participants, string rowZoneId)
    {
        var offRoster = false;
        if (r.ActualStart is { } start && r.ActualEnd is { } end)
        {
            var (rosteredStart, rosteredEnd) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(RowShift(a, r), r.TimeZoneId ?? rowZoneId);
            offRoster = ShiftTimeRules.IsOffRoster(ShiftVarianceCalculator.VarianceMinutes(start, rosteredStart)) || ShiftTimeRules.IsOffRoster(ShiftVarianceCalculator.VarianceMinutes(end, rosteredEnd));
        }
        return new GroupStaffReviewDto(
            r.Id, a.Id, a.Title, a.ServiceDate, r.UserId, staffName, r.Role, r.StartTime, r.EndTime, r.EndsNextDay,
            r.ActualStart, r.ActualEnd, r.BreakStartedAt, r.BreakEndedAt, r.TimeZoneId ?? rowZoneId,
            r.State.ToString(), r.LocationCheck, offRoster, r.AdjustmentReason, !string.IsNullOrWhiteSpace(payrollId), participants);
    }

    private async Task<GroupStaffReviewDto> ReviewOneAsync(GroupActivity a, GroupActivityStaff r, CancellationToken ct)
    {
        var user = await _db.Users.AsNoTracking().Where(u => u.Id == r.UserId).Select(u => new { u.FirstName, u.LastName, u.ExternalPayrollId }).FirstOrDefaultAsync(ct);
        var participants = await _db.Shifts.AsNoTracking().CountAsync(s => s.GroupActivityId == a.Id && s.Status != ShiftStatus.Cancelled, ct);
        var zone = await ProviderTimeZoneResolver.ForShiftAsync(_db, RowShift(a, r), ct);   // the zone the row is stamped with when it starts
        return ToReview(a, r, $"{user?.FirstName} {user?.LastName}".Trim(), user?.ExternalPayrollId, participants, zone.Id);
    }

    // ── C1 the review list ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every unapproved row on a started-or-finished day up to today (provider zone), whatever its age: <c>from</c> and <c>to</c> only narrow it. Capped at 200 with the total beside it. An
    /// unscoped SuperAdmin has no organisation, so gets an empty list.
    /// </summary>
    [HttpGet("staff-reviews")]
    public async Task<ActionResult<ApiResponse<GroupStaffReviewListDto>>> StaffReviews([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return Ok(ApiResponse<GroupStaffReviewListDto>.Ok(new GroupStaffReviewListDto([], 0)));
        var zone = await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct);
        var today = ProviderLocalTime.TodayIn(DateTime.UtcNow, zone.Zone);
        var upper = to is { } t && t < today ? t : today;
        var query = _db.GroupActivityStaff.AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.ReviewOutcome != ReviewOutcome.Approved
                && r.GroupActivity!.Status != ShiftStatus.Draft && r.GroupActivity.Status != ShiftStatus.Cancelled
                && r.GroupActivity.ServiceDate <= upper && (from == null || r.GroupActivity.ServiceDate >= from));
        var total = await query.CountAsync(ct);
        var rows = await query.Include(r => r.GroupActivity).Include(r => r.User)
            .OrderBy(r => r.GroupActivity!.ServiceDate).ThenBy(r => r.GroupActivity!.StartTime).ThenBy(r => r.User!.FirstName).ThenBy(r => r.User!.LastName).ThenBy(r => r.Id)
            .Take(ReviewCap).ToListAsync(ct);
        var activityIds = rows.Select(r => r.GroupActivityId).Distinct().ToList();
        var counts = (await _db.Shifts.AsNoTracking().Where(s => s.GroupActivityId != null && activityIds.Contains(s.GroupActivityId.Value) && s.Status != ShiftStatus.Cancelled)
            .GroupBy(s => s.GroupActivityId!.Value).Select(g => new { Id = g.Key, N = g.Count() }).ToListAsync(ct)).ToDictionary(g => g.Id, g => g.N);
        var byLocation = await ProviderTimeZoneResolver.ZonesOfLocationsAsync(_db, tenantId, rows.Select(r => r.GroupActivity!.ServiceLocationId), ct);
        var dtos = rows.Select(r => ToReview(r.GroupActivity!, r, $"{r.User?.FirstName} {r.User?.LastName}".Trim(), r.User?.ExternalPayrollId, counts.GetValueOrDefault(r.GroupActivityId),
            ProviderTimeZoneResolver.ZoneOf(r.GroupActivity!.ServiceLocationId, byLocation, zone.Zone).Id)).ToList();
        return Ok(ApiResponse<GroupStaffReviewListDto>.Ok(new GroupStaffReviewListDto(dtos, total)));
    }

    // ── C2 approve ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Approves 1-100 finished rows in one save: each row's approval, its pay row, and (when its activity's last row is approved) the activity's completion. A row that can't be approved reports
    /// its code and does not stop the others. Locks: board, then participants of every touched activity (ascending, in the pipeline), then the staff rows, then each attached shift, all ascending.
    /// </summary>
    [HttpPost("staff-reviews/approve")]
    public Task<ActionResult<ApiResponse<List<GroupStaffApproveResultDto>>>> ApproveStaffRows([FromBody] GroupStaffApproveDto dto, CancellationToken ct)
    {
        var ids = (dto.RowIds ?? []).Distinct().ToList();
        return WriteAsync<List<GroupStaffApproveResultDto>>(
            async (tenantId, token) =>
            {
                if (ids.Count is 0 or > ApproveBatchMax) return [];
                var activityIds = await _db.GroupActivityStaff.AsNoTracking().Where(r => ids.Contains(r.Id) && r.TenantId == tenantId).Select(r => r.GroupActivityId).Distinct().ToListAsync(token);
                return await _db.Shifts.AsNoTracking().Where(s => s.GroupActivityId != null && activityIds.Contains(s.GroupActivityId.Value) && s.TenantId == tenantId).Select(s => s.ParticipantId).ToListAsync(token);
            },
            async (tenantId, token) =>
            {
                if (ids.Count is 0 or > ApproveBatchMax) throw Deny("GA_BATCH_SIZE");
                var rows = await _db.GroupActivityStaff.Include(r => r.GroupActivity).Where(r => ids.Contains(r.Id) && r.TenantId == tenantId).ToListAsync(token);
                foreach (var row in rows.OrderBy(r => r.Id)) await GroupStaffRowLock.AcquireAsync(_db, row.Id, token);
                var activities = rows.Select(r => r.GroupActivity!).DistinctBy(a => a.Id).OrderBy(a => a.Id).ToList();
                var attachedByActivity = new Dictionary<Guid, List<Shift>>();
                foreach (var activity in activities)
                {
                    await _db.Entry(activity).ReloadAsync(token);
                    attachedByActivity[activity.Id] = await AttachedLockedAsync(activity, token);
                }
                foreach (var row in rows) await _db.Entry(row).ReloadAsync(token);   // the state to judge is the one under the locks

                var now = DateTime.UtcNow;
                var coordinator = CurrentUserId;
                var results = new List<GroupStaffApproveResultDto>();
                var approved = new List<(GroupActivity Activity, GroupActivityStaff Row)>();
                foreach (var id in ids)
                {
                    var row = rows.FirstOrDefault(r => r.Id == id);
                    string? code = null;
                    if (row is null) code = "GA_STAFF_ROW_NOT_FOUND";
                    else if (row.GroupActivity!.Status == ShiftStatus.Cancelled) code = "GA_CANCELLED";
                    else if (row.State == GroupStaffRowState.Approved) { results.Add(new(id, true, null, null)); continue; }   // replay: nothing changes
                    else if (row.GroupActivity.Status == ShiftStatus.Draft || row.State != GroupStaffRowState.Finished) code = "GA_STAFF_NOT_FINISHED";
                    else if (row.ActualEnd - row.ActualStart > MaxShift) code = "GA_ACTUALS_LONG";
                    if (code is not null)
                    {
                        var (_, message) = Refusals[code];
                        results.Add(new(id, false, code, message));
                        continue;
                    }
                    row!.ReviewOutcome = ReviewOutcome.Approved;
                    row.ReviewedByUserId = coordinator;
                    row.ReviewedAt = now;
                    approved.Add((row.GroupActivity!, row));
                    results.Add(new(id, true, null, null));
                }
                await EmploymentHeroTimesheets.EnqueueGroupStaffAsync(_db, tenantId, approved, now, token);
                foreach (var activity in activities.Where(a => approved.Any(p => p.Activity.Id == a.Id)))
                {
                    var all = await _db.GroupActivityStaff.Where(r => r.GroupActivityId == activity.Id).ToListAsync(token);
                    await GroupActivityCompletion.CompleteIfAllApprovedAsync(_db, activity, all, attachedByActivity[activity.Id], coordinator, now, token);
                }
                await _db.SaveChangesAsync(token);
                return Ok(ApiResponse<List<GroupStaffApproveResultDto>>.Ok(results));
            }, ct);
    }

    // ── C3 record times ─────────────────────────────────────────────────────────────────────────────

    /// <summary>The coordinator records a row's actual times with a reason: a wrong time, a forgotten Start or Finish, or a row that never finished. An approved row is frozen.</summary>
    [HttpPut("{id:guid}/staff/{rowId:guid}/actuals")]
    public Task<ActionResult<ApiResponse<GroupStaffReviewDto>>> SetStaffActuals(Guid id, Guid rowId, [FromBody] SetGroupStaffActualsDto dto, CancellationToken ct) =>
        WriteAsync<GroupStaffReviewDto>(Attached(id), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: false, token);
            if (activity.Status == ShiftStatus.Cancelled) throw Deny("GA_CANCELLED");
            if (activity.Status == ShiftStatus.Draft) throw Deny("GA_NOT_PUBLISHED");
            var row = activity.Staff.FirstOrDefault(r => r.Id == rowId) ?? throw Deny("GA_STAFF_ROW_NOT_FOUND");
            await using var rowLock = await GroupStaffRowLock.AcquireAsync(_db, row.Id, token);
            await _db.Entry(row).ReloadAsync(token);
            await _db.Entry(activity).ReloadAsync(token);
            if (activity.Status == ShiftStatus.Cancelled) throw Deny("GA_CANCELLED");
            if (row.State == GroupStaffRowState.Approved) throw Deny("GA_STAFF_APPROVED");

            var reason = dto.Reason?.Trim() ?? string.Empty;
            if (reason.Length == 0) throw Deny("GA_REASON");
            if (reason.Length > ShiftTimeRules.MaxReasonLength) throw Deny("GA_TOO_LONG", "The reason can be up to 500 characters.");
            var start = ShiftBreakRules.ToUtc(dto.ActualStart);
            var end = ShiftBreakRules.ToUtc(dto.ActualEnd);
            var now = DateTime.UtcNow;
            if (end <= start) throw Deny("GA_TIMES", "The finish must be after the start.");
            if (end - start > MaxShift) throw Deny("GA_ACTUALS_LONG", "A shift can't be longer than 24 hours.");
            if (end > now) throw Deny("GA_ACTUALS_FUTURE");
            if ((dto.BreakStart is null) != (dto.BreakEnd is null)) throw Deny("GA_BREAK");
            DateTime? breakStart = dto.BreakStart is { } b0 ? ShiftBreakRules.ToUtc(b0) : null;
            DateTime? breakEnd = dto.BreakEnd is { } b1 ? ShiftBreakRules.ToUtc(b1) : null;
            if (breakStart is { } bs && breakEnd is { } be && (bs < start || be > end || be <= bs)) throw Deny("GA_BREAK_RANGE");

            row.ActualStart = start;
            row.ActualEnd = end;
            row.BreakStartedAt = breakStart;
            row.BreakEndedAt = breakEnd;
            row.TimeZoneId ??= (await ProviderTimeZoneResolver.ForShiftAsync(_db, RowShift(activity, row), token)).Id;
            row.AdjustedByUserId = CurrentUserId;
            row.AdjustmentReason = reason;
            row.StartedAt ??= now;
            row.SubmittedAt ??= now;
            if (activity.Status == ShiftStatus.Published) { activity.Status = ShiftStatus.InProgress; activity.UpdatedAt = now; }
            await _db.SaveChangesAsync(token);
            return Ok(ApiResponse<GroupStaffReviewDto>.Ok(await ReviewOneAsync(activity, row, token)));
        }, ct);
}
