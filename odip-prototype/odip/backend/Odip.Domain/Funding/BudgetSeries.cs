namespace Odip.Domain.Funding;

/// <summary>An amount on a day: a ledger item's or a priced agreement line's.</summary>
public readonly record struct DatedAmount(DateOnly Date, decimal Amount);

/// <summary>A run of days, both ends included.</summary>
public readonly record struct DayRange(DateOnly Start, DateOnly End);

/// <summary>What one scope of the budget graph is drawn from: the plan's dates and limit, and the scope's items already placed by the ledger.</summary>
public sealed record BudgetSeriesInput
{
    public required DateOnly PlanStart { get; init; }
    public required DateOnly PlanEnd { get; init; }
    /// <summary>The provider's today.</summary>
    public required DateOnly Today { get; init; }
    public required bool PlanIsCurrent { get; init; }
    public required decimal Limit { get; init; }
    /// <summary>Claimed and pending items: the ledger's Used.</summary>
    public IReadOnlyList<DatedAmount> Used { get; init; } = [];
    /// <summary>Booked-ahead items.</summary>
    public IReadOnlyList<DatedAmount> Booked { get; init; } = [];
    /// <summary>The days the approved agreement covers, clipped to the plan; null when there is no expected line.</summary>
    public IReadOnlyList<DayRange>? Covered { get; init; }
    /// <summary>The agreement's priced lines in this scope, inside the covered days.</summary>
    public IReadOnlyList<DatedAmount> Expected { get; init; } = [];
}

/// <summary>One point of the graph. Every figure is cumulative to the end of <see cref="Date"/>, except the plan-start point, which is the start of that day (all zero).</summary>
public sealed record BudgetSeriesPoint(DateOnly Date, decimal Budget, decimal? Used, decimal? UsedAndBooked, decimal? Expected, bool IsEdge);

public sealed record BudgetSeriesSummary(
    decimal Used, decimal EvenToDate, decimal AheadOfEven, decimal? Pace, decimal? PaceGapAtEnd, decimal? BookedEnd, decimal? ExpectedEnd, DateOnly? ExpectedEndDate, decimal? LeftAtEnd);

public sealed record BudgetSeriesLine(IReadOnlyList<BudgetSeriesPoint> Points, BudgetSeriesSummary Summary);

/// <summary>
/// The budget graph's arithmetic (pure: no database, no clock). The points are the plan start (a $0 opening), the end of every week counted from the plan start, the plan end, today for a
/// current plan, and an opening and a closing point for each run of days the agreement covers (<see cref="BudgetSeriesPoint.IsEdge"/>: they only shape the expected line).
/// <list type="bullet">
/// <item><b>Budget</b> is the limit spread evenly over the plan's days.</item>
/// <item><b>Used</b> is cumulative up to today; the today point carries all of it, so a pending line dated ahead counts there and the point equals the ledger's Used.</item>
/// <item><b>Used and booked</b> starts at today's used and adds the booked-ahead items, a booked item dated today or earlier counting at the first point after today, so the plan end equals the ledger's Forecast.</item>
/// <item><b>Expected</b> is cumulative over the covered days and null outside them, so a gap is never bridged.</item>
/// </list>
/// </summary>
public static class BudgetSeries
{
    public static BudgetSeriesLine Build(BudgetSeriesInput input)
    {
        var (start, end, today, current) = (input.PlanStart, input.PlanEnd, input.Today, input.PlanIsCurrent);
        var planDays = end.DayNumber - start.DayNumber + 1;
        var asOf = current ? today : end;
        var runs = Runs(input.Covered);

        decimal BudgetAt(DateOnly d) => d == end ? input.Limit : Math.Round(input.Limit * (d.DayNumber - start.DayNumber + 1) / planDays, 2, MidpointRounding.AwayFromZero);
        static decimal SumTo(IEnumerable<DatedAmount> items, DateOnly d) => items.Where(i => i.Date <= d).Sum(i => i.Amount);

        // The end-of-day dates, each once: week ends, the plan end, today, then the edges that fall on no other point.
        var dates = new SortedDictionary<DateOnly, bool>();
        for (var weekEnd = start.AddDays(6); weekEnd <= end; weekEnd = weekEnd.AddDays(7)) dates[weekEnd] = false;
        dates[end] = false;
        if (current) dates[today] = false;
        foreach (var run in runs)
        {
            var opening = run.Start.AddDays(-1);
            if (opening >= start) dates.TryAdd(opening, true);   // a run from the plan start opens on the start point
            dates.TryAdd(run.End, true);
        }

        var totalUsed = input.Used.Sum(i => i.Amount);
        var totalBooked = input.Booked.Sum(i => i.Amount);
        var points = new List<BudgetSeriesPoint>(dates.Count + 1)
        {
            new(start, 0m, 0m, null, runs.Any(r => r.Start.AddDays(-1) <= start && start <= r.End) ? 0m : null, false),
        };
        foreach (var (date, isEdge) in dates)
        {
            decimal? used = date < asOf ? SumTo(input.Used, date) : date == asOf ? totalUsed : null;
            decimal? usedAndBooked = !current || date < today ? null
                : date == today ? (date == end ? totalUsed + totalBooked : totalUsed)   // the last day has no later point to take what is booked from today
                : totalUsed + input.Booked.Where(b => b.Date <= date || b.Date <= today).Sum(b => b.Amount);
            decimal? expected = runs.Any(r => r.Start.AddDays(-1) <= date && date <= r.End) ? SumTo(input.Expected, date) : null;
            points.Add(new BudgetSeriesPoint(date, BudgetAt(date), used, usedAndBooked, expected, isEdge));
        }

        // Pace as the ledger counts it (BudgetLedgerCalculator.PaceOf): whole days elapsed, today not counted, and nothing until a quarter of the plan has passed.
        var evenToDate = BudgetAt(asOf);
        var elapsed = asOf.DayNumber - start.DayNumber;
        decimal? pace = current && elapsed * 100 >= planDays * BudgetLedgerCalculator.PaceMinimumElapsedPercent
            ? Math.Round(totalUsed * planDays / elapsed, 2, MidpointRounding.AwayFromZero)
            : null;
        var lastExpected = points.LastOrDefault(p => p.Expected is not null);

        return new BudgetSeriesLine(points, new BudgetSeriesSummary(
            Used: totalUsed,
            EvenToDate: evenToDate,
            AheadOfEven: totalUsed - evenToDate,
            Pace: pace,
            PaceGapAtEnd: pace - input.Limit,
            BookedEnd: current && totalBooked > 0m ? totalUsed + totalBooked : null,
            ExpectedEnd: lastExpected?.Expected,
            ExpectedEndDate: runs.Count > 0 ? runs[^1].End : null,
            LeftAtEnd: current ? null : input.Limit - totalUsed));
    }

    /// <summary>The covered days as runs in date order: segments that overlap or touch are one run.</summary>
    public static IReadOnlyList<DayRange> Runs(IReadOnlyList<DayRange>? segments)
    {
        var runs = new List<DayRange>();
        foreach (var s in (segments ?? []).Where(s => s.Start <= s.End).OrderBy(s => s.Start))
        {
            if (runs.Count > 0 && s.Start.DayNumber <= runs[^1].End.DayNumber + 1)
                runs[^1] = runs[^1] with { End = s.End > runs[^1].End ? s.End : runs[^1].End };
            else
                runs.Add(s);
        }
        return runs;
    }
}
