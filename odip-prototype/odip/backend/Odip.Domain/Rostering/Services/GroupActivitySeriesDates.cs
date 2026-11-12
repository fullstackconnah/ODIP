namespace Odip.Domain.Rostering.Services;

/// <summary>The dates of a recurring group activity (series). Weekly and fortnightly step by days; monthly keeps the start's weekday and its ordinal in the month (a 5th weekday means the last one).</summary>
public static class GroupActivitySeriesDates
{
    public static IReadOnlyList<DateOnly> Occurrences(GroupActivityInterval interval, DateOnly start, DateOnly end)
    {
        var dates = new List<DateOnly>();
        if (end < start) return dates;
        if (interval != GroupActivityInterval.Monthly)
        {
            var step = interval == GroupActivityInterval.Weekly ? 7 : 14;
            for (var d = start; d <= end; d = d.AddDays(step)) dates.Add(d);
            return dates;
        }

        var nth = (start.Day - 1) / 7 + 1;
        for (var month = new DateOnly(start.Year, start.Month, 1); month <= end; month = month.AddMonths(1))
        {
            var first = month.AddDays(((int)start.DayOfWeek - (int)month.DayOfWeek + 7) % 7);
            var d = nth == 5 ? LastOf(first, month) : first.AddDays(7 * (nth - 1));
            if (d >= start && d <= end) dates.Add(d);
        }
        return dates;
    }

    private static DateOnly LastOf(DateOnly first, DateOnly month)
    {
        var d = first;
        while (d.AddDays(7).Month == month.Month) d = d.AddDays(7);
        return d;
    }
}
