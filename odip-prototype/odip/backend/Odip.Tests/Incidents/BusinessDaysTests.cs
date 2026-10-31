using Odip.Domain.Billing.Pricing;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.Incidents;

// Pure arithmetic: the zone is passed in, so none of these depend on the machine's zone.
public class BusinessDaysTests
{
    private static readonly TimeZoneInfo Sydney = ProviderLocalTime.ResolveZone("Australia/Sydney");
    private static readonly TimeZoneInfo Perth = ProviderLocalTime.ResolveZone("Australia/Perth");
    private static readonly IReadOnlySet<int> Covered = new HashSet<int> { 2026, 2027 };

    private static DateTime Utc(int y, int m, int d, int h, int min = 0) => new(y, m, d, h, min, 0, DateTimeKind.Utc);
    private static HolidayCalendar Cal(params HolidayEntry[] rows) => new(rows);
    private static HolidayEntry Hol(int y, int m, int d, string? state, TimeOnly? from = null) => new(new DateOnly(y, m, d), state, "Test day", from);

    [Fact]
    public void Weekend_IsSkipped()
    {
        // Fri 30 Oct 2026 10:00 AEDT = 23:00Z Thu. Five business days later is Fri 6 Nov.
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 10, 29, 23), 5, "NSW", Sydney, Cal(), Covered);
        Assert.Equal(Utc(2026, 11, 6, 12, 59).AddSeconds(59), due.DueUtc);
        Assert.False(due.WeekendsOnly);
    }

    [Fact]
    public void FridayEvening_CountsTheLocalDate()
    {
        // Fri 30 Oct 20:30 AEDT = 09:30Z the same UTC date.
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 10, 30, 9, 30), 5, "NSW", Sydney, Cal(), Covered);
        Assert.Equal(Utc(2026, 11, 6, 12, 59).AddSeconds(59), due.DueUtc);
    }

    [Fact]
    public void UtcDateTrap_StartsFromTheLocalMonday()
    {
        // Mon 2 Nov 08:00 AEDT = Sun 1 Nov 21:00Z. The UTC date is a Sunday; the local date is the Monday.
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 11, 1, 21), 5, "NSW", Sydney, Cal(), Covered);
        Assert.Equal(Utc(2026, 11, 9, 12, 59).AddSeconds(59), due.DueUtc);
    }

    [Fact]
    public void NationalHoliday_IsSkipped()
    {
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 10, 29, 23), 5, "NSW", Sydney, Cal(Hol(2026, 11, 4, null)), Covered);
        Assert.Equal(Utc(2026, 11, 9, 12, 59).AddSeconds(59), due.DueUtc);
    }

    [Fact]
    public void StateHoliday_SkippedOnlyInItsState()
    {
        var cal = Cal(Hol(2026, 11, 3, "VIC"));
        var vic = BusinessDays.EndOfNthAfter(Utc(2026, 10, 29, 23), 5, "VIC", Sydney, cal, Covered);
        var nsw = BusinessDays.EndOfNthAfter(Utc(2026, 10, 29, 23), 5, "NSW", Sydney, cal, Covered);
        Assert.Equal(Utc(2026, 11, 9, 12, 59).AddSeconds(59), vic.DueUtc);
        Assert.Equal(Utc(2026, 11, 6, 12, 59).AddSeconds(59), nsw.DueUtc);
    }

    [Fact]
    public void PartDayHoliday_IsStillABusinessDay()
    {
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 10, 29, 23), 5, "NSW", Sydney, Cal(Hol(2026, 11, 4, "NSW", new TimeOnly(19, 0))), Covered);
        Assert.Equal(Utc(2026, 11, 6, 12, 59).AddSeconds(59), due.DueUtc);
    }

    [Fact]
    public void YearWithNoRows_IgnoresHolidays_AndSaysSo()
    {
        var cal = Cal(Hol(2026, 11, 4, null));
        var none = BusinessDays.EndOfNthAfter(Utc(2026, 10, 29, 23), 5, "NSW", Sydney, cal, new HashSet<int>());
        Assert.Equal(Utc(2026, 11, 6, 12, 59).AddSeconds(59), none.DueUtc);
        Assert.True(none.WeekendsOnly);
    }

    [Fact]
    public void LateDecember_CrossingIntoAnUncoveredYear_SaysSo()
    {
        // Tue 29 Dec 2026 10:00 AEDT: the count runs into 2027, which has no rows.
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 12, 28, 23), 5, "NSW", Sydney, Cal(), new HashSet<int> { 2026 });
        Assert.True(due.WeekendsOnly);
        var covered = BusinessDays.EndOfNthAfter(Utc(2026, 12, 28, 23), 5, "NSW", Sydney, Cal(), new HashSet<int> { 2026, 2027 });
        Assert.False(covered.WeekendsOnly);
    }

    [Fact]
    public void SydneyDst_DueIsEndOfDayInAedt()
    {
        // Thu 1 Oct 2026; Mon 5 Oct is Labour Day in NSW; the due is Fri 9 Oct 23:59:59 AEDT = 12:59:59Z (not 13:59:59Z).
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 10, 1, 0), 5, "NSW", Sydney, Cal(Hol(2026, 10, 5, "NSW")), Covered);
        Assert.Equal(Utc(2026, 10, 9, 12, 59).AddSeconds(59), due.DueUtc);
    }

    [Fact]
    public void Perth_UsesItsOwnZone()
    {
        // Fri 30 Oct 10:00 AWST = 02:00Z. Due Fri 6 Nov 23:59:59 AWST = 15:59:59Z.
        var due = BusinessDays.EndOfNthAfter(Utc(2026, 10, 30, 2), 5, "WA", Perth, Cal(), Covered);
        Assert.Equal(Utc(2026, 11, 6, 15, 59).AddSeconds(59), due.DueUtc);
    }

    [Fact]
    public void LocalToUtc_DstGap_TakesTheFirstValidInstant()
    {
        // 02:30 on Sun 4 Oct 2026 does not exist in Sydney (clocks go 02:00 to 03:00): it is read as 03:30 AEDT = 16:30Z the day before.
        Assert.Equal(Utc(2026, 10, 3, 16, 30), ProviderLocalTime.LocalToUtc(new DateTime(2026, 10, 4, 2, 30, 0), Sydney));
    }
}
