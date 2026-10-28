using Odip.Domain.Funding;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget graph's weekly series (no database): the plan 1 Jul 2026 to 30 Jun 2027 is 365 days, the limit $10,000 and today 4 Oct 2026 unless stated. Week k ends on plan start + 7k - 1,
/// so the week ends are 7 Jul, 14 Jul ... 29 Jun 2027 (52 of them).
/// </summary>
public class BudgetSeriesTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);
    private static readonly DateOnly Start = D(2026, 7, 1);
    private static readonly DateOnly End = D(2027, 6, 30);
    private static readonly DateOnly Today = D(2026, 10, 4);

    private static BudgetSeriesLine Build(
        DateOnly? today = null, bool current = true, DatedAmount[]? used = null, DatedAmount[]? booked = null, DayRange[]? covered = null, DatedAmount[]? expected = null) =>
        BudgetSeries.Build(new BudgetSeriesInput
        {
            PlanStart = Start, PlanEnd = End, Today = today ?? Today, PlanIsCurrent = current, Limit = 10000m,
            Used = used ?? [], Booked = booked ?? [], Covered = covered, Expected = expected ?? [],
        });

    private static BudgetSeriesPoint At(BudgetSeriesLine line, DateOnly date) => line.Points.Single(p => p.Date == date);

    [Fact]
    public void Points_AreThePlanStartEveryWeekEndThePlanEndAndToday_SortedAndDistinct()
    {
        var line = Build();
        Assert.Equal(55, line.Points.Count);
        Assert.Equal(Start, line.Points[0].Date);
        Assert.Equal(0m, line.Points[0].Budget);
        Assert.Equal(D(2026, 7, 7), line.Points[1].Date);
        Assert.Contains(line.Points, p => p.Date == D(2026, 7, 14));
        Assert.Contains(line.Points, p => p.Date == D(2027, 6, 29));
        Assert.Contains(line.Points, p => p.Date == Today);
        Assert.Equal(End, line.Points[^1].Date);
        Assert.Equal(line.Points.OrderBy(p => p.Date).Select(p => p.Date), line.Points.Select(p => p.Date));
        Assert.All(line.Points, p => Assert.False(p.IsEdge));

        // Today on a week end (6 Oct = start + 97) is one point, not two.
        var onWeekEnd = Build(today: D(2026, 10, 6));
        Assert.Equal(54, onWeekEnd.Points.Count);
        Assert.Single(onWeekEnd.Points, p => p.Date == D(2026, 10, 6));
    }

    [Fact]
    public void TodayOnThePlanStart_HasBothTheZeroStartPointAndTheTodayPoint_StartFirst()
    {
        var line = Build(today: Start, used: [new(Start, 50m)]);
        Assert.Equal(2, line.Points.Count(p => p.Date == Start));
        Assert.Equal(0m, line.Points[0].Used);
        Assert.Equal(50m, line.Points[1].Used);
        Assert.Equal(50m, line.Points[1].UsedAndBooked);
    }

    [Fact]
    public void TheBudgetLineIsStraight_ZeroAtStart_LimitAtEnd_RoundedToTheCent()
    {
        var line = Build(used: [new(Start, 100m)]);
        Assert.Equal(0m, line.Points[0].Budget);
        Assert.Equal(0m, line.Points[0].Used);              // start-of-day: a shift on 1 Jul shows at 7 Jul
        Assert.Equal(191.78m, line.Points[1].Budget);       // 10000 x 7 / 365 = 191.7808
        Assert.Equal(100m, line.Points[1].Used);
        Assert.Equal(10000m, line.Points[^1].Budget);
    }

    [Fact]
    public void UsedIsCumulativeToTheWeekEnd_AndTheTodayPointIsTheWholeUsed_EvenForAnItemDatedAhead()
    {
        var line = Build(used: [new(D(2026, 7, 1), 100m), new(D(2026, 7, 10), 50m), new(Today, 20m), new(D(2026, 10, 10), 30m)]);
        Assert.Equal(100m, At(line, D(2026, 7, 7)).Used);
        Assert.Equal(150m, At(line, D(2026, 7, 14)).Used);
        Assert.Equal(150m, At(line, D(2026, 9, 29)).Used);
        Assert.Equal(200m, At(line, Today).Used);           // the pending line dated 10 Oct folds into today
        Assert.Null(At(line, D(2026, 10, 13)).Used);
        Assert.Equal(200m, line.Summary.Used);
        Assert.All(line.Points.Where(p => p.Date < Today), p => Assert.Null(p.UsedAndBooked));
    }

    [Fact]
    public void BookedStartsAtTodaysUsed_AndEndsAtTheForecast()
    {
        var line = Build(used: [new(D(2026, 8, 1), 200m)], booked: [new(Today, 40m), new(D(2026, 10, 20), 60m)]);
        Assert.Equal(200m, At(line, Today).UsedAndBooked);
        Assert.Equal(At(line, Today).Used, At(line, Today).UsedAndBooked);
        Assert.Equal(240m, At(line, D(2026, 10, 6)).UsedAndBooked);   // booked on today lands on the next point
        Assert.Equal(240m, At(line, D(2026, 10, 13)).UsedAndBooked);
        Assert.Equal(300m, At(line, D(2026, 10, 20)).UsedAndBooked);
        Assert.Equal(300m, line.Points[^1].UsedAndBooked);
        Assert.Equal(300m, line.Summary.BookedEnd);
        Assert.Null(Build(used: [new(D(2026, 8, 1), 200m)]).Summary.BookedEnd);
    }

    [Fact]
    public void AnEndedPlan_HasNoBookedLine_NoTodayPoint_AndItsLastUsedIsAtPlanEnd()
    {
        var line = Build(today: D(2027, 8, 1), current: false, used: [new(D(2026, 8, 1), 4000m), new(D(2027, 6, 30), 1000m)], booked: [new(D(2027, 6, 1), 70m)]);
        Assert.Equal(54, line.Points.Count);
        Assert.Equal(End, line.Points[^1].Date);
        Assert.Equal(5000m, line.Points[^1].Used);
        Assert.Equal(4000m, At(line, D(2027, 6, 29)).Used);
        Assert.All(line.Points, p => Assert.Null(p.UsedAndBooked));
        Assert.Equal(5000m, line.Summary.LeftAtEnd);
        Assert.Null(line.Summary.Pace);
        Assert.Null(line.Summary.BookedEnd);
        Assert.Equal(10000m, line.Summary.EvenToDate);

        var over = Build(today: D(2027, 8, 1), current: false, used: [new(D(2026, 8, 1), 12000m)]);
        Assert.Equal(-2000m, over.Summary.LeftAtEnd);
        Assert.Null(Build().Summary.LeftAtEnd);
    }

    [Fact]
    public void PaceIsHeldBackUntilAQuarterOfThePlanHasPassed()
    {
        // elapsed = today - plan start, today not counted (BudgetLedger.cs PaceOf). 25% of 365 = 91.25 days, so elapsed 91 (30 Sep) is held back and elapsed 92 (1 Oct) shows.
        Assert.Null(Build(today: D(2026, 9, 30), used: [new(D(2026, 8, 1), 3000m)]).Summary.Pace);
        var at = Build(today: D(2026, 10, 1), used: [new(D(2026, 8, 1), 3000m)]).Summary;
        Assert.Equal(11902.17m, at.Pace);                   // 3000 x 365 / 92
        Assert.Equal(1902.17m, at.PaceGapAtEnd);
        var under = Build(today: D(2026, 10, 1), used: [new(D(2026, 8, 1), 1000m)]).Summary;
        Assert.Equal(3967.39m, under.Pace);
        Assert.Equal(-6032.61m, under.PaceGapAtEnd);
        Assert.Null(Build(today: D(2026, 9, 30)).Summary.PaceGapAtEnd);
    }

    [Fact]
    public void AheadOfEvenIsSigned()
    {
        // budget(4 Oct) = 10000 x 96 / 365 = 2630.14
        var over = Build(used: [new(D(2026, 8, 1), 3000m)]).Summary;
        Assert.Equal(2630.14m, over.EvenToDate);
        Assert.Equal(369.86m, over.AheadOfEven);
        Assert.Equal(-630.14m, Build(used: [new(D(2026, 8, 1), 2000m)]).Summary.AheadOfEven);
    }

    [Fact]
    public void ExpectedOpensAtZeroTheDayBeforeTheFirstCoveredDay_ClosesOnTheLastCoveredDay_AndIsNullAcrossAGap()
    {
        var line = Build(
            covered: [new(D(2026, 8, 1), D(2026, 8, 31)), new(D(2026, 9, 22), End)],
            expected: [new(D(2026, 8, 5), 100m), new(D(2026, 8, 26), 100m), new(D(2026, 9, 25), 50m)]);

        Assert.Null(line.Points[0].Expected);
        Assert.Null(At(line, D(2026, 7, 28)).Expected);
        var opening = At(line, D(2026, 7, 31));
        Assert.True(opening.IsEdge);
        Assert.Equal(0m, opening.Expected);
        Assert.Equal(0m, At(line, D(2026, 8, 4)).Expected);
        var closing = At(line, D(2026, 8, 31));
        Assert.True(closing.IsEdge);
        Assert.Equal(200m, closing.Expected);
        Assert.Null(At(line, D(2026, 9, 1)).Expected);       // week ends inside the gap
        Assert.Null(At(line, D(2026, 9, 8)).Expected);
        Assert.Null(At(line, D(2026, 9, 15)).Expected);
        var reopening = At(line, D(2026, 9, 21));
        Assert.True(reopening.IsEdge);
        Assert.Equal(200m, reopening.Expected);              // cumulative: the second run opens at the first one's total
        Assert.Equal(200m, At(line, D(2026, 9, 22)).Expected);
        Assert.Equal(250m, At(line, D(2026, 9, 29)).Expected);
        Assert.Equal(250m, line.Points[^1].Expected);
        Assert.Equal(250m, line.Summary.ExpectedEnd);
        Assert.Equal(End, line.Summary.ExpectedEndDate);
        Assert.Equal(55 + 3, line.Points.Count);

        // Edge points carry the other lines like any point.
        Assert.Equal(Math.Round(10000m * 31 / 365, 2, MidpointRounding.AwayFromZero), opening.Budget);
    }

    [Fact]
    public void TouchingSegmentsAreOneRun_AndARunFromPlanStartOpensOnTheStartPoint()
    {
        var line = Build(covered: [new(Start, D(2026, 11, 30)), new(D(2026, 12, 1), End)], expected: [new(D(2026, 12, 3), 80m)]);
        Assert.All(line.Points, p => Assert.False(p.IsEdge));
        Assert.Equal(0m, line.Points[0].Expected);
        Assert.All(line.Points, p => Assert.NotNull(p.Expected));
        Assert.Equal(80m, line.Summary.ExpectedEnd);
    }

    [Fact]
    public void NoExpectedLine_LeavesEveryExpectedNull()
    {
        var line = Build();
        Assert.All(line.Points, p => Assert.Null(p.Expected));
        Assert.Null(line.Summary.ExpectedEnd);
        Assert.Null(line.Summary.ExpectedEndDate);
    }

    [Fact]
    public void NoSpend_UsedIsZeroThroughout_NotNull()
    {
        var line = Build();
        Assert.All(line.Points.Where(p => p.Date <= Today), p => Assert.Equal(0m, p.Used));
        Assert.Equal(0m, line.Summary.Used);
        Assert.Equal(0m, At(line, Today).UsedAndBooked);
        Assert.All(line.Points.Where(p => p.Date > Today), p => Assert.Equal(0m, p.UsedAndBooked));
    }
}
