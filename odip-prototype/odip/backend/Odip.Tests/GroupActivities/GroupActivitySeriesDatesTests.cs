using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.GroupActivities;

public class GroupActivitySeriesDatesTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    private static string[] Run(GroupActivityInterval interval, string start, string end) =>
        GroupActivitySeriesDates.Occurrences(interval, D(start), D(end)).Select(d => d.ToString("yyyy-MM-dd")).ToArray();

    [Fact]
    public void Weekly_CountAndLast()
    {
        var days = Run(GroupActivityInterval.Weekly, "2026-11-17", "2027-03-09");
        Assert.Equal(17, days.Length);
        Assert.Equal("2027-03-09", days[^1]);
    }

    [Fact]
    public void Fortnightly_CountAndLast()
    {
        var days = Run(GroupActivityInterval.Fortnightly, "2026-11-17", "2027-03-09");
        Assert.Equal(9, days.Length);
        Assert.Equal("2027-03-09", days[^1]);
    }

    [Theory]
    [InlineData("2026-11-17", "2027-03-09", "2026-11-17,2026-12-15,2027-01-19,2027-02-16")]   // 3rd Tuesday across a year end
    [InlineData("2026-12-08", "2027-02-28", "2026-12-08,2027-01-12,2027-02-09")]               // 2nd Tuesday
    [InlineData("2026-10-30", "2027-02-28", "2026-10-30,2026-11-27,2026-12-25,2027-01-29,2027-02-26")]   // 5th Friday -> last Friday
    [InlineData("2027-01-28", "2027-03-31", "2027-01-28,2027-02-25,2027-03-25")]               // 4th Thursday through February
    [InlineData("2026-11-17", "2026-12-01", "2026-11-17")]                                     // one occurrence
    public void Monthly_KeepsTheOrdinalWeekday(string start, string end, string expected) =>
        Assert.Equal(expected.Split(','), Run(GroupActivityInterval.Monthly, start, end));

    [Fact]
    public void EndOnAnOccurrenceDay_IsIncluded()
    {
        var days = Run(GroupActivityInterval.Weekly, "2026-11-17", "2026-12-01");
        Assert.Equal(3, days.Length);
        Assert.Equal("2026-12-01", days[^1]);
    }

    [Fact]
    public void EndOneDayBefore_IsExcluded() => Assert.Equal(2, Run(GroupActivityInterval.Weekly, "2026-11-17", "2026-11-30").Length);

    [Fact]
    public void Cap_Is58WeeklyOver400Days() => Assert.Equal(58, GroupActivitySeriesDates.Occurrences(GroupActivityInterval.Weekly, D("2026-11-17"), D("2026-11-17").AddDays(400)).Count);

    [Fact]
    public void EndBeforeStart_IsEmpty() => Assert.Empty(Run(GroupActivityInterval.Weekly, "2026-11-17", "2026-11-16"));
}
