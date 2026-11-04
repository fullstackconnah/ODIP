using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>A whole day a person marked Available or Preferred, with no leave or unavailability on it: the staff picker's "Available that day".</summary>
public sealed record StaffAvailableDay(Guid UserId, DateOnly Date, bool Preferred);

public static class AvailableDays
{
    /// <summary>
    /// Wall clock to wall clock, no zone: the records are zone-less whole days. A day counts when one Available or Preferred row covers all of it and no window touches it
    /// (windows end exclusive, so leave ending Sunday leaves Monday). Preferred when a covering row is Preferred. Ordered by user, then date.
    /// </summary>
    // shortcut: one row must cover the whole day; two part-day rows are not joined. Upgrade if an editor ever writes times.
    public static IReadOnlyList<StaffAvailableDay> For(IEnumerable<StaffAvailability> rows, IEnumerable<UnavailabilityWindow> windows, DateOnly from, DateOnly to)
    {
        var marked = rows.Where(r => r.AvailabilityType is AvailabilityType.Available or AvailabilityType.Preferred).ToList();
        var blocked = windows.ToLookup(w => w.UserId);
        var result = new List<StaffAvailableDay>();
        foreach (var user in marked.Select(r => r.UserId).Distinct().OrderBy(id => id))
            for (var day = from; day <= to; day = day.AddDays(1))
            {
                var start = day.ToDateTime(TimeOnly.MinValue);
                var end = start.AddDays(1);
                var covering = marked.Where(r => r.UserId == user && r.StartDateTime <= start && r.EndDateTime >= end.AddSeconds(-1)).ToList();
                if (covering.Count == 0 || blocked[user].Any(w => w.Start < end && w.End > start)) continue;
                result.Add(new StaffAvailableDay(user, day, covering.Any(r => r.AvailabilityType == AvailabilityType.Preferred)));
            }
        return result;
    }
}
