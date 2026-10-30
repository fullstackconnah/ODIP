using Odip.Domain.Billing.Pricing;
using Odip.Domain.Rostering;

namespace Odip.Domain.Incidents;

/// <param name="DueUtc">The end of the due day (23:59:59 provider-local) as a UTC instant.</param>
/// <param name="WeekendsOnly">True when a year the count touched has no holiday rows, so only weekends were skipped.</param>
public sealed record BusinessDayDue(DateTime DueUtc, bool WeekendsOnly);

/// <summary>Business-day arithmetic for the NDIS Commission reporting deadlines, over the synced public holiday calendar.</summary>
public static class BusinessDays
{
    /// <summary>
    /// The end (23:59:59 provider-local, returned as UTC) of the <paramref name="n"/>th business day AFTER the provider-local date of <paramref name="fromUtc"/>.
    /// A business day is not a Saturday or Sunday and, in a year the feed covers (<paramref name="yearsWithHolidayRows"/>), has no whole-day public
    /// holiday for <paramref name="state"/> (national rows included). A part-day holiday is a business day.
    /// </summary>
    public static BusinessDayDue EndOfNthAfter(DateTime fromUtc, int n, string? state, TimeZoneInfo zone,
        HolidayCalendar holidays, IReadOnlySet<int> yearsWithHolidayRows)
    {
        var day = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(fromUtc, zone));
        var weekendsOnly = false;
        for (var counted = 0; counted < n;)
        {
            day = day.AddDays(1);
            var covered = yearsWithHolidayRows.Contains(day.Year);
            if (!covered) weekendsOnly = true;
            if (day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) continue;
            if (covered && holidays.On(day, state ?? "").Any(h => h.IsWholeDay)) continue;
            counted++;
        }
        return new BusinessDayDue(ProviderLocalTime.LocalToUtc(day.ToDateTime(new TimeOnly(23, 59, 59)), zone), weekendsOnly);
    }
}
