using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Incidents;

// Pure month arithmetic for the monthly restrictive practice report: which months are owed, when each is due, and where it stands.
public class RestrictivePracticeMonthlyReportingTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);
    private static RestrictivePractice Practice(DateOnly? auth, DateOnly? end = null, string? by = "Dr Lee") =>
        new() { AuthorisedBy = by, AuthorisationDate = auth, AuthorisationEndDate = end };

    private static IReadOnlyList<DateOnly> Owed(RestrictivePractice p, DateOnly start, DateOnly today, DateOnly? stop = null) =>
        RestrictivePracticeMonthlyReporting.MonthsOwed(p, start, RestrictivePracticeMonthlyReporting.LastEndedMonth(today), stop);

    [Fact]
    public void CutOver_ReportsFromReportingFromMonth_NotAuthorisationDate()
    {
        var start = RestrictivePracticeMonthlyReporting.StartMonth(D(2026, 11, 1), DateTime.UtcNow, ProviderLocalTime.ResolveZone("Australia/Sydney"));
        Assert.Equal(new[] { D(2026, 11, 1), D(2026, 12, 1) }, Owed(Practice(D(2025, 3, 1)), start, D(2027, 1, 10)));
    }

    [Fact]
    public void NullReportingFrom_UsesCreatedMonthInProviderZone()
    {
        // 14:30Z on 30 Sep is 00:30 on 1 Oct in Sydney.
        var start = RestrictivePracticeMonthlyReporting.StartMonth(null, new DateTime(2026, 9, 30, 14, 30, 0, DateTimeKind.Utc), ProviderLocalTime.ResolveZone("Australia/Sydney"));
        Assert.Equal(D(2026, 10, 1), start);
    }

    [Fact]
    public void PartialMonth_AuthorisedMidMonth_IsOwed() =>
        Assert.Equal(new[] { D(2026, 10, 1) }, Owed(Practice(D(2026, 10, 20)), D(2026, 10, 1), D(2026, 11, 2)));

    [Fact]
    public void AuthorisationEndsMidMonth_ThatMonthOwed_NextNot() =>
        Assert.Equal(new[] { D(2026, 10, 1), D(2026, 11, 1) }, Owed(Practice(D(2026, 1, 1), D(2026, 11, 10)), D(2026, 10, 1), D(2027, 1, 5)));

    [Fact]
    public void AuthorisationEndedBeforeStartMonth_NothingOwed() =>
        Assert.Empty(Owed(Practice(D(2026, 1, 1), D(2026, 10, 31)), D(2026, 11, 1), D(2027, 1, 5)));

    [Fact]
    public void CurrentMonth_NotListedUntilItEnds()
    {
        var p = Practice(D(2026, 1, 1));
        Assert.Empty(Owed(p, D(2026, 11, 1), D(2026, 11, 30)));
        Assert.Equal(new[] { D(2026, 11, 1) }, Owed(p, D(2026, 11, 1), D(2026, 12, 1)));
    }

    [Fact]
    public void BlankAuthorisedBy_OrNoAuthorisationDate_NothingOwed()
    {
        Assert.Empty(Owed(Practice(D(2026, 1, 1), by: "  "), D(2026, 10, 1), D(2026, 12, 5)));
        Assert.Empty(Owed(Practice(null), D(2026, 10, 1), D(2026, 12, 5)));
    }

    [Fact]
    public void FutureAuthorisationDate_NothingOwed() =>
        Assert.Empty(Owed(Practice(D(2027, 2, 1)), D(2026, 10, 1), D(2027, 1, 15)));

    [Fact]
    public void StopMonth_Eliminated_EndsLaterMonths() =>
        Assert.Equal(new[] { D(2026, 10, 1), D(2026, 11, 1) }, Owed(Practice(D(2026, 1, 1)), D(2026, 10, 1), D(2027, 2, 1), D(2026, 11, 1)));

    [Fact]
    public void DueOn_June_FeedCoversYear_NotWeekendsOnly()
    {
        var cal = new HolidayCalendar(new[] { new HolidayEntry(D(2027, 1, 1), null, "NY"), new HolidayEntry(D(2027, 4, 2), null, "GF"), new HolidayEntry(D(2027, 12, 25), null, "Xmas") });
        var due = RestrictivePracticeMonthlyReporting.DueOn(D(2027, 6, 1), cal, new HashSet<int> { 2027 });
        Assert.False(due.WeekendsOnly);
        Assert.Equal(D(2027, 7, 7), due.DueOn);
    }

    [Fact]
    public void DueOn_October2026_Is6Nov_AndDecemberIs8Jan()
    {
        var cal = new HolidayCalendar(new[] { new HolidayEntry(D(2026, 11, 3), "VIC", "Cup"), new HolidayEntry(D(2027, 1, 1), null, "NY") });
        var years = new HashSet<int> { 2026, 2027 };
        Assert.Equal(D(2026, 11, 6), RestrictivePracticeMonthlyReporting.DueOn(D(2026, 10, 1), cal, years).DueOn);
        Assert.Equal(D(2027, 1, 8), RestrictivePracticeMonthlyReporting.DueOn(D(2026, 12, 1), cal, years).DueOn);
    }

    [Fact]
    public void State_DueOnDueDate_OverdueNextDay_LodgedWins()
    {
        var due = D(2026, 11, 6);
        Assert.Equal(MonthlyReportState.Due, RestrictivePracticeMonthlyReporting.State(due, false, D(2026, 11, 6)));
        Assert.Equal(MonthlyReportState.Overdue, RestrictivePracticeMonthlyReporting.State(due, false, D(2026, 11, 7)));
        Assert.Equal(MonthlyReportState.Lodged, RestrictivePracticeMonthlyReporting.State(due, true, D(2027, 1, 1)));
    }
}
