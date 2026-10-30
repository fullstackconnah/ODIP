using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Read-only reports for the office (Reports page): hours by worker, shift fulfilment by week, leave taken. Same roles as Completions.
/// Every query names the tenant itself: an unscoped SuperAdmin context has no query filter, so the filter alone cannot be relied on.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/reports")]
public class ReportsController : ControllerBase
{
    public const int MaxDays = 366;
    public const string RangeMessage = "Choose a range of 366 days or fewer, with the start before the end.";
    public const string ChooseOrganisation = "Choose an organisation to view as first: reports belong to one organisation.";
    private const string FormerStaff = "Former staff member";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;

    public ReportsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
    }

    private Guid? TenantId => !_tenant.IsSuperAdmin && _tenant.TenantId is { } id ? id : null;

    private static bool RangeRefused(DateOnly? from, DateOnly? to) =>
        from is not { } f || to is not { } t || t < f || t.DayNumber - f.DayNumber + 1 > MaxDays;

    private ActionResult<ApiResponse<List<T>>> Refuse<T>(string message) => BadRequest(ApiResponse<List<T>>.Fail(message));

    private static decimal Hours(int minutes) => Math.Round(minutes / 60m, 2, MidpointRounding.AwayFromZero);

    private async Task<Dictionary<Guid, string>> NamesAsync(Guid tid, IEnumerable<Guid> ids, CancellationToken ct)
    {
        var wanted = ids.Distinct().ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => u.TenantId == tid && wanted.Contains(u.Id))
            .Select(u => new { u.Id, u.FirstName, u.LastName })
            .ToListAsync(ct);
        return users.ToDictionary(u => u.Id, u => $"{u.FirstName} {u.LastName}".Trim());
    }

    [HttpGet("hours-by-worker")]
    public async Task<ActionResult<ApiResponse<List<HoursByWorkerRowDto>>>> HoursByWorker([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (TenantId is not { } tid) return Refuse<HoursByWorkerRowDto>(ChooseOrganisation);
        if (RangeRefused(from, to)) return Refuse<HoursByWorkerRowDto>(RangeMessage);
        var (f, t) = (from!.Value, to!.Value);

        // Approved: reviewed and completed. Awaiting: finished by the worker, not yet reviewed (InProgress has no finish, so it is left out).
        var completions = await _db.ShiftCompletions.AsNoTracking()
            .Where(c => c.TenantId == tid && c.IsActive && c.Shift!.ServiceDate >= f && c.Shift.ServiceDate <= t
                && ((c.ReviewOutcome == ReviewOutcome.Approved && c.Shift.Status == ShiftStatus.Completed) || c.Shift.Status == ShiftStatus.PendingReview))
            .Select(c => new
            {
                c.Id, c.SubmittedByUserId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.StartedAt, c.ReviewOutcome,
                Awaiting = c.Shift!.Status == ShiftStatus.PendingReview,
                c.Shift.StartTime, c.Shift.EndTime, c.Shift.EndsNextDay, c.Shift.NightType,
            })
            .ToListAsync(ct);

        var ids = completions.Select(c => c.Id).ToList();
        var breaks = (await _db.ShiftBreaks.AsNoTracking()
            .Where(b => b.TenantId == tid && ids.Contains(b.ShiftCompletionId))
            .Select(b => new { b.ShiftCompletionId, b.StartedAt, b.EndedAt })
            .ToListAsync(ct))
            .ToLookup(b => b.ShiftCompletionId);

        var now = _clock.GetUtcNow().UtcDateTime;
        var perWorker = new Dictionary<Guid, (int Shifts, int Approved, int Awaiting)>();
        foreach (var c in completions)
        {
            var shift = new Shift { StartTime = c.StartTime, EndTime = c.EndTime, EndsNextDay = c.EndsNextDay, NightType = c.NightType };
            var completion = new ShiftCompletion { ActualStart = c.ActualStart, ActualEnd = c.ActualEnd };
            var shiftBreaks = breaks[c.Id].Select(b => new ShiftBreak { StartedAt = b.StartedAt, EndedAt = b.EndedAt });
            var paid = ShiftBreakRules.PaidMinutes(shift, completion, now, shiftBreaks).PaidMinutes;
            var cur = perWorker.GetValueOrDefault(c.SubmittedByUserId);
            perWorker[c.SubmittedByUserId] = c.Awaiting
                ? (cur.Shifts, cur.Approved, cur.Awaiting + paid)
                : (cur.Shifts + 1, cur.Approved + paid, cur.Awaiting);
        }

        var names = await NamesAsync(tid, perWorker.Keys, ct);
        var rows = perWorker
            .Select(kv => new HoursByWorkerRowDto(kv.Key, names.GetValueOrDefault(kv.Key, FormerStaff), kv.Value.Shifts, Hours(kv.Value.Approved), Hours(kv.Value.Awaiting)))
            .OrderBy(r => r.WorkerName, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.WorkerId)
            .ToList();
        return Ok(ApiResponse<List<HoursByWorkerRowDto>>.Ok(rows));
    }

    [HttpGet("shift-fulfilment")]
    public async Task<ActionResult<ApiResponse<List<ShiftFulfilmentWeekDto>>>> ShiftFulfilment([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (TenantId is not { } tid) return Refuse<ShiftFulfilmentWeekDto>(ChooseOrganisation);
        if (RangeRefused(from, to)) return Refuse<ShiftFulfilmentWeekDto>(RangeMessage);
        var (f, t) = (from!.Value, to!.Value);

        var shifts = await _db.Shifts.AsNoTracking()
            .Where(s => s.TenantId == tid && s.Status != ShiftStatus.Draft && s.ServiceDate >= f && s.ServiceDate <= t)
            .Select(s => new { s.ServiceDate, s.Status, Staffed = s.UserId != null })
            .ToListAsync(ct);

        static DateOnly Monday(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
        var byWeek = shifts.GroupBy(s => Monday(s.ServiceDate)).ToDictionary(g => g.Key, g => g.ToList());

        var rows = new List<ShiftFulfilmentWeekDto>();
        for (var monday = Monday(f); monday <= t; monday = monday.AddDays(7))
        {
            var week = byWeek.GetValueOrDefault(monday) ?? [];
            var cancelled = week.Count(s => s.Status == ShiftStatus.Cancelled);
            var filled = week.Count(s => s.Status != ShiftStatus.Cancelled && s.Staffed);
            var unstaffed = week.Count(s => s.Status != ShiftStatus.Cancelled && !s.Staffed);
            int? rate = filled + unstaffed == 0 ? null : (int)Math.Round(100m * filled / (filled + unstaffed), MidpointRounding.AwayFromZero);
            rows.Add(new ShiftFulfilmentWeekDto(monday, week.Count, filled, unstaffed, cancelled, rate, monday < f || monday.AddDays(6) > t));
        }
        return Ok(ApiResponse<List<ShiftFulfilmentWeekDto>>.Ok(rows));
    }

    [HttpGet("leave-taken")]
    public async Task<ActionResult<ApiResponse<List<LeaveTakenRowDto>>>> LeaveTaken([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (TenantId is not { } tid) return Refuse<LeaveTakenRowDto>(ChooseOrganisation);
        if (RangeRefused(from, to)) return Refuse<LeaveTakenRowDto>(RangeMessage);
        var (f, t) = (from!.Value, to!.Value);

        var leave = await _db.LeaveRequests.AsNoTracking()
            .Where(l => l.TenantId == tid && l.Status == LeaveStatus.Approved && l.StartDate <= t && l.EndDate >= f)
            .Select(l => new { l.Id, l.UserId, l.LeaveType, l.StartDate, l.EndDate })
            .ToListAsync(ct);

        var names = await NamesAsync(tid, leave.Select(l => l.UserId), ct);
        var rows = leave
            .Select(l =>
            {
                var start = l.StartDate > f ? l.StartDate : f;
                var end = l.EndDate < t ? l.EndDate : t;
                return new LeaveTakenRowDto(l.Id, l.UserId, names.GetValueOrDefault(l.UserId, FormerStaff), l.LeaveType, l.StartDate, l.EndDate, end.DayNumber - start.DayNumber + 1);
            })
            .OrderBy(r => r.From).ThenBy(r => r.WorkerName, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.LeaveId)
            .ToList();
        return Ok(ApiResponse<List<LeaveTakenRowDto>>.Ok(rows));
    }
}
