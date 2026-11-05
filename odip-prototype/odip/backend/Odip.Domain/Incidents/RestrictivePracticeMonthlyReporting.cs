using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Domain.Incidents;

/// <summary>
/// The monthly restrictive practice report's month arithmetic: which months a practice owes, when each is due, and where it stands. Pure, so the worklist,
/// the CSV, lodge validation, the alerts and the dashboard all read one rule. <see cref="MonthsOwed"/> is <see cref="RestrictivePracticeAuthorisation.IsAuthorised"/>
/// widened from one day to a month: a partial month at either end of the authorisation counts, as the Commission portal does.
/// </summary>
public static class RestrictivePracticeMonthlyReporting
{
    /// <summary>The first month a practice reports: its ReportingFromMonth, else the month it was created in the provider zone.</summary>
    public static DateOnly StartMonth(DateOnly? reportingFromMonth, DateTime createdAtUtc, TimeZoneInfo zone)
    {
        var d = reportingFromMonth ?? ProviderLocalTime.TodayIn(ProviderLocalTime.AsUtc(createdAtUtc), zone);
        return new DateOnly(d.Year, d.Month, 1);
    }

    /// <summary>The latest month that has finished. The current month is never owed.</summary>
    public static DateOnly LastEndedMonth(DateOnly today) => new DateOnly(today.Year, today.Month, 1).AddMonths(-1);

    /// <summary>
    /// The months this practice owes a report for, oldest first. Nothing is owed without who authorised it and the date. The range runs from the later of
    /// <paramref name="startMonth"/> and the authorisation month to the earliest of <paramref name="lastEndedMonth"/>, the authorisation end month and
    /// <paramref name="stopMonth"/> (the month of a lodged Eliminated or ServiceCeased report). IsActive is the caller's concern.
    /// </summary>
    public static IReadOnlyList<DateOnly> MonthsOwed(RestrictivePractice p, DateOnly startMonth, DateOnly lastEndedMonth, DateOnly? stopMonth)
    {
        if (string.IsNullOrWhiteSpace(p.AuthorisedBy) || p.AuthorisationDate is not { } auth) return Array.Empty<DateOnly>();
        var first = Max(startMonth, FirstOfMonth(auth));
        var last = lastEndedMonth;
        if (p.AuthorisationEndDate is { } end) last = Min(last, FirstOfMonth(end));
        if (stopMonth is { } stop) last = Min(last, stop);
        var months = new List<DateOnly>();
        for (var m = first; m <= last; m = m.AddMonths(1)) months.Add(m);
        return months;
    }

    /// <summary>
    /// Five business days after the month ends. Weekends and national holidays are skipped; state holidays are not (owner Q14). <paramref name="nationalYears"/>
    /// are the years whose national rows the feed covers; <c>WeekendsOnly</c> is true when the count crossed a year outside them.
    /// </summary>
    public static (DateOnly DueOn, bool WeekendsOnly) DueOn(DateOnly month, HolidayCalendar national, IReadOnlySet<int> nationalYears)
    {
        var (day, weekendsOnly) = BusinessDays.NthAfter(new DateOnly(month.Year, month.Month, DateTime.DaysInMonth(month.Year, month.Month)), 5, null, national, nationalYears);
        return (day, weekendsOnly);
    }

    public static MonthlyReportState State(DateOnly dueOn, bool lodged, DateOnly today) =>
        lodged ? MonthlyReportState.Lodged : today > dueOn ? MonthlyReportState.Overdue : MonthlyReportState.Due;

    private static DateOnly FirstOfMonth(DateOnly d) => new(d.Year, d.Month, 1);
    private static DateOnly Max(DateOnly a, DateOnly b) => a >= b ? a : b;
    private static DateOnly Min(DateOnly a, DateOnly b) => a <= b ? a : b;
}
