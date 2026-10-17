using Odip.Infrastructure.BackgroundServices;
using Xunit;

namespace Odip.Tests.EarlyAccess;

/// <summary>
/// The purge cutoff must be the inverse of <c>CreatedAtUtc.AddMonths(12)</c>: AddMonths clamps, so a plain AddMonths(-12) on the
/// way back is not (29 Feb 2024 is due 28 Feb 2025, which a 28 Feb 2024 cutoff would miss). Pure date maths, so no database.
/// </summary>
public class EarlyAccessRetentionCutoffTests
{
    private static readonly TimeSpan Interval = EarlyAccessPurgeBackgroundService.Interval;

    private static DateTime Utc(int y, int m, int d, int h = 0, int min = 0) => new(y, m, d, h, min, 0, DateTimeKind.Utc);

    [Fact]
    public void A29Feb2024SignUp_IsDueByTheRunAt28Feb2025Noon()
    {
        var created = Utc(2024, 2, 29, 12);
        Assert.True(created <= EarlyAccessPurgeBackgroundService.RetentionCutoff(Utc(2025, 2, 28, 12)));
        // The run an hour earlier is the first whose bound reaches it (the cutoff is one interval early).
        Assert.True(created <= EarlyAccessPurgeBackgroundService.RetentionCutoff(Utc(2025, 2, 28, 12) - Interval));
    }

    [Theory]
    [InlineData(2025, 1, 31)]
    [InlineData(2025, 3, 30)]
    [InlineData(2025, 3, 31)]
    [InlineData(2025, 12, 31)]
    [InlineData(2025, 4, 30)]
    public void MonthEndSignUps_AreDueAtTheirAnniversary_AndNotMoreThanADayEarly(int y, int m, int d)
    {
        var created = Utc(y, m, d, 9, 30);
        var due = created.AddMonths(12);
        Assert.True(created <= EarlyAccessPurgeBackgroundService.RetentionCutoff(due - Interval));
        Assert.True(created > EarlyAccessPurgeBackgroundService.RetentionCutoff(due - Interval - TimeSpan.FromDays(1) - TimeSpan.FromMinutes(1)));
    }

    // 2023 and 2027 are the years before a leap year (their 28 Feb is due on a bound that lands on 29 Feb); 2024 holds the 29 Feb rows.
    [Theory]
    [InlineData(2023)]
    [InlineData(2024)]
    [InlineData(2027)]
    public void EveryDayOfTheYearAtSeveralTimes_IsNeverKeptPastItsAnniversary_AndNeverDeletedMoreThanADayEarly(int year)
    {
        foreach (var day in Enumerable.Range(0, DateTime.IsLeapYear(year) ? 366 : 365))
            foreach (var time in new[] { TimeSpan.Zero, TimeSpan.FromHours(12), new TimeSpan(23, 30, 0), new TimeSpan(23, 59, 59) })
            {
                var created = Utc(year, 1, 1).AddDays(day) + time;
                var due = created.AddMonths(12);
                // The run that lands on the due instant, and any later one, has it in range.
                Assert.True(created <= EarlyAccessPurgeBackgroundService.RetentionCutoff(due), $"{created:u} survived its anniversary");
                // A run more than a day plus the interval before the due instant must not reach it.
                var tooEarly = due - Interval - TimeSpan.FromDays(1) - TimeSpan.FromSeconds(1);
                Assert.True(created > EarlyAccessPurgeBackgroundService.RetentionCutoff(tooEarly), $"{created:u} deleted more than a day early");
            }
    }

    [Fact]
    public void ARunOn29FebInALeapYear_TakesEveryPreviousYear28Feb_AndNothingFrom1Mar()
    {
        // The start-up run after the API was down over the evening of 28 Feb 2028: no run saw the 23:00 bound that reaches 29 Feb.
        foreach (var run in new[] { Utc(2028, 2, 29, 0), Utc(2028, 2, 29, 12), Utc(2028, 2, 29, 22, 59) })
        {
            var cutoff = EarlyAccessPurgeBackgroundService.RetentionCutoff(run);
            Assert.True(Utc(2027, 2, 28, 23, 59) <= cutoff, $"run {run:u} missed 28 Feb 2027 23:59");
            Assert.True(Utc(2027, 3, 1) > cutoff, $"run {run:u} took 1 Mar 2027");
        }
    }
}
