using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Rostering;

/// <summary>
/// The start and finish shown on a trip's roster bar for each day. They come from the day's
/// non-cancelled activities, plus the trip's DepartureTime on its first day and ReturnTime on its
/// last. They are the trip's itinerary, not any worker's own hours.
/// </summary>
public static class TripDayTimes
{
    public readonly record struct ActivityTime(DateOnly Date, TimeOnly? Start, TimeOnly? End, ScheduledActivityStatus Status);

    public readonly record struct Day(DateOnly Date, TimeOnly? Start, TimeOnly? Finish);

    /// <summary>Days in <paramref name="from"/>..<paramref name="to"/> that have at least one time; a day with none is absent.</summary>
    public static List<Day> For(TripInstance trip, IEnumerable<ActivityTime> activities, DateOnly from, DateOnly to)
    {
        var live = activities.Where(a => a.Status != ScheduledActivityStatus.Cancelled).ToList();
        var result = new List<Day>();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            var starts = live.Where(a => a.Date == date && a.Start != null).Select(a => a.Start!.Value).ToList();
            var finishes = live.Where(a => a.Date == date).Select(a => a.End ?? a.Start).Where(t => t != null).Select(t => t!.Value).ToList();
            if (date == trip.StartDate && trip.DepartureTime is { } dep) starts.Add(dep);
            if (date == trip.EndDate && trip.ReturnTime is { } ret) finishes.Add(ret);

            TimeOnly? start = starts.Count > 0 ? starts.Min() : null;
            TimeOnly? finish = finishes.Count > 0 ? finishes.Max() : null;
            // A finish that does not come after the start (a start-only activity, or an early return) shows the start alone.
            if (start is { } s && finish is { } f && f <= s) finish = null;
            if (start != null || finish != null) result.Add(new Day(date, start, finish));
        }
        return result;
    }
}
