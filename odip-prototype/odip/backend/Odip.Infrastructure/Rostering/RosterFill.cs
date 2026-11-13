using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>How full the coming weeks are (spec 2026-10-31). Open = no worker and not Cancelled: the board's unfilled lane minus its struck-through Cancelled chips.</summary>
public static class RosterFill
{
    /// <summary>
    /// Monday-start weeks from <paramref name="firstMonday"/>; every week is emitted, empty ones as zeros. Tenant scoping is the Shift query filter, as on the board.
    /// </summary>
    public static async Task<List<RosterFillWeekDto>> WeeksAsync(OdipDbContext db, DateOnly firstMonday, int weeks, CancellationToken ct)
    {
        var last = firstMonday.AddDays(7 * weeks - 1);
        // DurationHours is Ignore()d in the model: project the columns and sum in memory.
        var rows = await db.Shifts
            .Where(s => s.ServiceDate >= firstMonday && s.ServiceDate <= last && s.Status != ShiftStatus.Cancelled)
            .Select(s => new { s.ServiceDate, s.UserId, s.Status, s.StartTime, s.EndTime, s.EndsNextDay, s.GroupActivityId })
            .ToListAsync(ct);
        // A shift on a group activity has no worker of its own: it is covered when its activity has a worker, and never Open (the activity warns when it is short instead).
        var staffed = (await db.GroupActivityStaff.Select(r => r.GroupActivityId).Distinct().ToListAsync(ct)).ToHashSet();
        var byWeek = rows.ToLookup(r => RosterWeek.MondayOf(r.ServiceDate));
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, ct)).Zone; // shortcut: the organisation zone, as the board
        // Real hours: the board and the portal show the same length, so the outlook agrees with them on the nights the clocks change.
        decimal Hours(DateOnly serviceDate, TimeOnly start, TimeOnly end, bool endsNextDay) =>
            ProviderLocalTime.RosteredHours(new Shift { ServiceDate = serviceDate, StartTime = start, EndTime = end, EndsNextDay = endsNextDay }, zone);

        return Enumerable.Range(0, weeks).Select(i => firstMonday.AddDays(7 * i)).Select(w =>
        {
            var week = byWeek[w].ToList();
            var open = week.Where(r => r.UserId is null && r.GroupActivityId is null).ToList();
            var filled = week.Where(r => r.UserId is not null || (r.GroupActivityId is { } activityId && staffed.Contains(activityId))).ToList();
            return new RosterFillWeekDto
            {
                WeekStart = w,
                Shifts = week.Count,
                Filled = filled.Count,
                Open = open.Count,
                HoursFilled = filled.Sum(r => Hours(r.ServiceDate, r.StartTime, r.EndTime, r.EndsNextDay)),
                HoursOpen = open.Sum(r => Hours(r.ServiceDate, r.StartTime, r.EndTime, r.EndsNextDay)),
                Draft = week.Count(r => r.Status == ShiftStatus.Draft)
            };
        }).ToList();
    }
}
