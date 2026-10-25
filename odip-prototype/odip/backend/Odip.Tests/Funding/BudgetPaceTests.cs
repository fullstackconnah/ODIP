using Odip.Domain.Funding;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The pace warning's arithmetic (no database): at the rate so far, does the money run out before the period ends? Period 2026-10-01..2026-12-31 is 92 days; available is $8,000 unless stated.
/// </summary>
public class BudgetPaceTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);
    private static readonly DateOnly Start = D(2026, 10, 1);
    private static readonly DateOnly End = D(2026, 12, 31);

    private static PaceWarning? Pace(DateOnly today, decimal used, BudgetStatus status = BudgetStatus.OnTrack, decimal available = 8000m) =>
        BudgetLedgerCalculator.PaceOf(status, Start, End, today, available, used);

    [Fact]
    public void Pace_IsOffBeforeTwentyFivePercentOfThePeriod()
    {
        Assert.Null(Pace(D(2026, 10, 23), 4000m));                                  // elapsed 22: 88 < 92
        Assert.Equal(D(2026, 11, 16), Pace(D(2026, 10, 24), 4000m)?.RunsOutOn);     // elapsed 23: exactly 25% passes; floor(8000*23/4000) = 46 days
    }

    [Fact]
    public void Pace_IsOffOnTheFirstDay() => Assert.Null(Pace(Start, 4000m));

    [Fact]
    public void Pace_IsOffWhenExactlyOnPace() => Assert.Null(Pace(D(2026, 11, 16), 4000m));   // elapsed 46: projected 8000 = available

    [Fact]
    public void Pace_IgnoresAShortfallThatOnlyBitesOnTheLastDay()
    {
        Assert.Equal(D(2026, 12, 29), Pace(D(2026, 11, 16), 4100m)?.RunsOutOn);   // floor(8000*46/4100) = 89
        Assert.Null(Pace(D(2026, 11, 16), 4000.01m));                             // floor(91.99977) = 91 = the period end
    }

    [Theory]
    [InlineData(BudgetStatus.Over, false)]
    [InlineData(BudgetStatus.ForecastOver, false)]
    [InlineData(BudgetStatus.None, false)]
    [InlineData(BudgetStatus.Approaching, true)]
    [InlineData(BudgetStatus.OnTrack, true)]
    public void Pace_IsOnlyForOnTrackAndApproaching(BudgetStatus status, bool warns) =>
        Assert.Equal(warns, Pace(D(2026, 11, 4), 4000m, status) is not null);

    [Fact]
    public void Pace_IsOffWithNothingUsedOrNothingAvailable()
    {
        Assert.Null(Pace(D(2026, 11, 4), 0m));
        Assert.Null(Pace(D(2026, 11, 4), 4000m, available: 0m));
    }

    [Fact]
    public void Pace_ShowsWithNothingRosteredAhead()
    {
        // Owner rule (a): booked ahead plays no part, so the date is the same with or without it.
        var period = new FundingPeriod { PeriodStart = Start, PeriodEnd = End, PlanAmount = 8000m };
        PeriodLedger Ledger(decimal booked) =>
            new(period, true, 8000m, 0m, 4000m, 0m, booked, 0, 0, BudgetStatus.OnTrack, Array.Empty<LedgerItem>(), 0, 0);
        var today = D(2026, 11, 4);   // elapsed 34: floor(8000*34/4000) = 68 days
        Assert.Equal(D(2026, 12, 8), Ledger(0m).PaceAt(today)?.RunsOutOn);
        Assert.Equal(D(2026, 12, 8), Ledger(100m).PaceAt(today)?.RunsOutOn);
    }

    [Fact]
    public void Pace_IsOffOutsideThePeriod()
    {
        Assert.Null(Pace(D(2027, 1, 5), 4000m));
        Assert.Null(Pace(D(2026, 9, 20), 4000m));
    }

    [Fact]
    public void Pace_CountsCalendarDays_AcrossTheSpringClockChange()
    {
        // 2026-08-01..2026-10-31 spans 4 Oct, when daylight saving starts: a DateTime/TimeSpan count on Sydney midnights gets 69.96 days and truncates to 69.
        var warning = BudgetLedgerCalculator.PaceOf(BudgetStatus.OnTrack, D(2026, 8, 1), D(2026, 10, 31), D(2026, 10, 10), 6000m, 5000m);
        Assert.Equal(D(2026, 10, 24), warning?.RunsOutOn);   // floor(6000*70/5000) = 84
    }
}
