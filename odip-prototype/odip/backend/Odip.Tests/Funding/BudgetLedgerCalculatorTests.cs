using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The ledger's arithmetic on its own (no database): the status rules, what a period's limit is, how unspent money rolls forward and chains, which pool and period an item belongs to, and
/// the plan total line. Money is whole dollars so a figure can be read off a test; the loading of the records is in <see cref="BudgetLedgerServiceTests"/>.
/// </summary>
public class BudgetLedgerCalculatorTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);
    private static readonly DateOnly Today = new(2026, 10, 4);

    private static FundingPeriod Period(DateOnly start, DateOnly end, decimal amount, decimal? setAside = null, int position = 0) =>
        new() { Id = Guid.NewGuid(), Position = position, PeriodStart = start, PeriodEnd = end, PlanAmount = amount, SetAside = setAside };

    /// <summary>The four quarters of 1 Jul 2026 to 30 Jun 2027, each holding <paramref name="each"/> and <paramref name="setAside"/> when given.</summary>
    private static List<FundingPeriod> Quarters(decimal each = 2000m, decimal? setAside = null) => new()
    {
        Period(D(2026, 7, 1), D(2026, 9, 30), each, setAside, 0), Period(D(2026, 10, 1), D(2026, 12, 31), each, setAside, 1),
        Period(D(2027, 1, 1), D(2027, 3, 31), each, setAside, 2), Period(D(2027, 4, 1), D(2027, 6, 30), each, setAside, 3),
    };

    private static FundingPool Core(PlanType management, List<FundingPeriod> periods, int position = 0) =>
        new() { Id = Guid.NewGuid(), Position = position, Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = management, Name = "Core (flexible)", Periods = periods };

    private static FundingPool Stated(int category, PlanType management, List<FundingPeriod> periods, int position = 1) =>
        new() { Id = Guid.NewGuid(), Position = position, Kind = FundingPoolKind.Stated, PaceCategory = category, ManagementType = management, Name = PaceCategories.NameOf(category)!, Periods = periods };

    private static FundingPlan Plan(params FundingPool[] pools) =>
        new() { Id = Guid.NewGuid(), PlanStart = D(2026, 7, 1), PlanEnd = D(2027, 6, 30), Pools = pools.ToList() };

    private static LedgerItem Item(decimal amount, DateOnly date, LedgerGroup group = LedgerGroup.Pending, LedgerRowKind? kind = null, int? category = 4, PlanType planType = PlanType.PlanManaged) => new()
    {
        Kind = kind ?? group switch { LedgerGroup.BookedAhead => LedgerRowKind.FutureShift, _ => LedgerRowKind.ClaimLine }, Group = group, Date = date, Amount = amount, PaceCategory = category, PlanType = planType,
        Id = Guid.NewGuid(), Description = $"item {amount}",
    };

    private static PeriodLedger CurrentPeriod(PlanLedger ledger) => ledger.Pools[0].Periods.Single(p => p.IsCurrent);

    // ── Status ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(1000, 0, 0, 80, BudgetStatus.OnTrack)]
    [InlineData(1000, 799.99, 799.99, 80, BudgetStatus.OnTrack)]        // just under 80%
    [InlineData(1000, 800, 800, 80, BudgetStatus.Approaching)]          // exactly 80% is approaching: at or above
    [InlineData(1000, 1000, 1000, 80, BudgetStatus.Approaching)]        // fully used but not over
    [InlineData(1000, 1000.01, 1000.01, 80, BudgetStatus.Over)]
    [InlineData(1000, 500, 1000.01, 80, BudgetStatus.ForecastOver)]     // nothing over yet, the booked shifts take it over
    [InlineData(1000, 500, 1000, 80, BudgetStatus.OnTrack)]             // booked up to the limit exactly is not over
    [InlineData(1000, 850, 1200, 80, BudgetStatus.ForecastOver)]        // approaching AND forecast over: the worse one shows
    [InlineData(1000, 1200, 1500, 80, BudgetStatus.Over)]               // over AND forecast over: the worst shows
    [InlineData(0, 10, 10, 80, BudgetStatus.Over)]                      // nothing available and anything used is over
    [InlineData(0, 0, 0, 80, BudgetStatus.OnTrack)]                     // nothing available, nothing used: not approaching a limit of nothing
    [InlineData(0, 0, 50, 80, BudgetStatus.ForecastOver)]               // ...until something is booked against it
    [InlineData(1000, 500, 500, 50, BudgetStatus.Approaching)]          // the percentage is the organisation's setting
    [InlineData(1000, 940, 940, 95, BudgetStatus.OnTrack)]
    [InlineData(1000, 950, 950, 95, BudgetStatus.Approaching)]
    public void StatusOf_IsTheWorstThatApplies(double available, double used, double forecast, int percent, BudgetStatus expected)
    {
        Assert.Equal(expected, BudgetLedgerCalculator.StatusOf((decimal)available, (decimal)used, (decimal)forecast, percent));
    }

    [Fact]
    public void StatusOf_ComparesMoneyExactly_SoANonBinaryPercentageDoesNotTipTheStatus()
    {
        // 80% of 8,125.15 is 6,500.12 to the cent: used 6,500.12 is approaching, 6,500.11 is not (a double would round one of these wrong).
        Assert.Equal(BudgetStatus.Approaching, BudgetLedgerCalculator.StatusOf(8125.15m, 6500.12m, 6500.12m, 80));
        Assert.Equal(BudgetStatus.OnTrack, BudgetLedgerCalculator.StatusOf(8125.15m, 6500.11m, 6500.11m, 80));
    }

    // ── Limit, carry and the figures ────────────────────────────────────────

    [Fact]
    public void TheLimitIsTheSetAside_WhenThePoolHasSetAsides_AndThePlanAmountOtherwise()
    {
        var withSetAside = BudgetLedgerCalculator.Compute(Plan(Core(PlanType.PlanManaged, Quarters(2000m, 800m))), Today, 80, Array.Empty<LedgerItem>());
        var without = BudgetLedgerCalculator.Compute(Plan(Core(PlanType.PlanManaged, Quarters(2000m))), Today, 80, Array.Empty<LedgerItem>());

        Assert.True(withSetAside.Pools[0].HasSetAside);
        Assert.All(withSetAside.Pools[0].Periods, p => Assert.Equal(800m, p.Limit));
        Assert.False(without.Pools[0].HasSetAside);
        Assert.All(without.Pools[0].Periods, p => Assert.Equal(2000m, p.Limit));
    }

    [Fact]
    public void UnspentLimitRollsForwardAndChainsAcrossThreePeriods_AndAnOverspentPeriodCarriesNothing()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters(2000m)));
        var items = new[]
        {
            Item(500m, D(2026, 8, 1)),                                   // Q1 used 500 of 2000: 1500 rolls
            Item(1000m, D(2026, 11, 1)),                                 // Q2 used 1000 of 2000 + 1500 = 3500: 2500 rolls
            Item(300m, D(2026, 11, 2), LedgerGroup.BookedAhead),         // booked ahead is NOT used: it does not reduce what rolls
            Item(7000m, D(2027, 2, 1)),                                  // Q3 used 7000 of 2000 + 2500 = 4500: over, so nothing rolls into Q4
        };

        var ledger = BudgetLedgerCalculator.Compute(plan, Today, 80, items);

        var periods = ledger.Pools[0].Periods;
        Assert.Equal(new[] { 0m, 1500m, 2500m, 0m }, periods.Select(p => p.Carried));
        Assert.Equal(new[] { 2000m, 3500m, 4500m, 2000m }, periods.Select(p => p.Available));
        Assert.Equal(new[] { BudgetStatus.OnTrack, BudgetStatus.OnTrack, BudgetStatus.Over, BudgetStatus.OnTrack }, periods.Select(p => p.Status));
        Assert.Equal(1000m + 0m, periods[1].Used);
        Assert.Equal(1300m, periods[1].Forecast);
    }

    [Fact]
    public void WhatIsCarriedIsTheSetAsideLeftOver_NotThePlanAmount()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters(2000m, 800m)));

        var ledger = BudgetLedgerCalculator.Compute(plan, Today, 80, new[] { Item(300m, D(2026, 8, 1)) });

        Assert.Equal(500m, ledger.Pools[0].Periods[1].Carried);     // 800 limit - 300 used
        Assert.Equal(1300m, ledger.Pools[0].Periods[1].Available);  // 800 + 500
    }

    [Fact]
    public void ClaimedPendingAndBookedAheadAreSeparateAndAddUp_AndThePastUnresolvedAreCounted()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters(2000m)));
        var items = new[]
        {
            Item(100m, D(2026, 10, 1), LedgerGroup.Claimed), Item(50m, D(2026, 10, 2), LedgerGroup.Pending),
            Item(200m, D(2026, 10, 3), LedgerGroup.Pending, LedgerRowKind.PastShift), Item(30m, D(2026, 10, 3), LedgerGroup.Pending, LedgerRowKind.PastShift),
            Item(400m, D(2026, 10, 20), LedgerGroup.BookedAhead),
        };

        var period = CurrentPeriod(BudgetLedgerCalculator.Compute(plan, Today, 80, items));

        Assert.Equal(100m, period.Claimed);
        Assert.Equal(280m, period.Pending);
        Assert.Equal(380m, period.Used);
        Assert.Equal(400m, period.BookedAhead);
        Assert.Equal(780m, period.Forecast);
        Assert.Equal(2, period.PastUnresolvedCount);
        Assert.Equal(5, period.Items.Count);
    }

    [Fact]
    public void ThePeriodHoldingTodayIsMarkedCurrent_AndNoneIsOnceThePlanHasEnded()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters()));

        var running = BudgetLedgerCalculator.Compute(plan, Today, 80, Array.Empty<LedgerItem>());
        var ended = BudgetLedgerCalculator.Compute(plan, D(2027, 8, 1), 80, Array.Empty<LedgerItem>());

        Assert.True(running.PlanIsCurrent);
        Assert.Equal(new[] { false, true, false, false }, running.Pools[0].Periods.Select(p => p.IsCurrent));
        Assert.False(ended.PlanIsCurrent);
        Assert.DoesNotContain(ended.Pools[0].Periods, p => p.IsCurrent);
    }

    [Fact]
    public void ThePlanTotalIsTheSameSumsOverTheWholePlanAgainstTheSumOfTheLimits_WithNothingCarried()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters(2000m, 1000m)));
        var items = new[] { Item(3500m, D(2026, 8, 1), LedgerGroup.Claimed), Item(200m, D(2026, 11, 1)), Item(900m, D(2027, 5, 1), LedgerGroup.BookedAhead) };

        var total = BudgetLedgerCalculator.Compute(plan, Today, 80, items).Pools[0].Total;

        Assert.Equal(4000m, total.Limit);
        Assert.Equal(4000m, total.Available);                       // carry moves money inside the pool: it adds nothing to the total
        Assert.Equal(3500m, total.Claimed);
        Assert.Equal(200m, total.Pending);
        Assert.Equal(3700m, total.Used);
        Assert.Equal(4600m, total.Forecast);
        Assert.Equal(BudgetStatus.ForecastOver, total.Status);
    }

    // ── Which pool and period ───────────────────────────────────────────────

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public void Categories1To4GoToTheCoreFlexiblePool(int category)
    {
        var core = Core(PlanType.PlanManaged, Quarters());
        var plan = Plan(core, Stated(15, PlanType.PlanManaged, Quarters(500m)));

        var place = BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), category: category));

        Assert.Equal(LedgerPlacement.InPeriod, place.Placement);
        Assert.Same(core, place.Pool);
    }

    [Fact]
    public void WhenThePlanHoldsTwoCorePoolsTheOneUnderTheItemsManagementTypeIsChosen_ElseTheFirst()
    {
        var agency = Core(PlanType.AgencyManaged, Quarters(), position: 0);
        var managed = Core(PlanType.PlanManaged, Quarters(), position: 1);
        var plan = Plan(agency, managed);

        Assert.Same(managed, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), planType: PlanType.PlanManaged)).Pool);
        Assert.Same(agency, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), planType: PlanType.AgencyManaged)).Pool);
        Assert.Same(agency, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), planType: PlanType.SelfManaged)).Pool);   // none matches: the first
    }

    [Fact]
    public void AStatedCategoryGoesToTheStatedPoolOfThatCategory_AndToNoPoolWhenThePlanRecordsNone()
    {
        var stated = Stated(15, PlanType.PlanManaged, Quarters(500m));
        var plan = Plan(Core(PlanType.PlanManaged, Quarters()), stated);

        Assert.Same(stated, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), category: 15)).Pool);
        Assert.Equal(LedgerPlacement.NotInAPool, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), category: 9)).Placement);
        Assert.Equal(LedgerPlacement.NotInAPool, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 10, 5), category: null)).Placement);
        Assert.Equal(LedgerPlacement.NotInAPool, BudgetLedgerCalculator.Place(Plan(Stated(15, PlanType.PlanManaged, Quarters())), Item(10m, D(2026, 10, 5), category: 4)).Placement);   // no Core pool in the plan
    }

    [Fact]
    public void ADateOutsideThePlanIsOutsideThePlanDates_BeforeAnythingElseIsAsked()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters()));

        Assert.Equal(LedgerPlacement.OutsideThePlan, BudgetLedgerCalculator.Place(plan, Item(10m, D(2027, 7, 1))).Placement);
        Assert.Equal(LedgerPlacement.OutsideThePlan, BudgetLedgerCalculator.Place(plan, Item(10m, D(2026, 6, 30))).Placement);
        Assert.Equal(LedgerPlacement.OutsideThePlan, BudgetLedgerCalculator.Place(plan, Item(10m, D(2027, 7, 1), category: 9)).Placement);   // and a category no pool covers is still "outside" first
    }

    [Theory]
    [InlineData(2026, 10, 1, 1)]    // the first day of Q2 is Q2's
    [InlineData(2026, 9, 30, 0)]    // the last day of Q1 is Q1's
    [InlineData(2026, 12, 31, 1)]
    [InlineData(2027, 1, 1, 2)]
    [InlineData(2026, 7, 1, 0)]     // the plan's own first and last day
    [InlineData(2027, 6, 30, 3)]
    public void ThePeriodIsFoundByTheServiceDate_EndsIncluded(int y, int m, int d, int expectedPeriod)
    {
        var core = Core(PlanType.PlanManaged, Quarters());
        var plan = Plan(core);

        var place = BudgetLedgerCalculator.Place(plan, Item(10m, D(y, m, d)));

        Assert.Equal(LedgerPlacement.InPeriod, place.Placement);
        Assert.Same(core.Periods.OrderBy(p => p.PeriodStart).ElementAt(expectedPeriod), place.Period);
    }

    [Fact]
    public void ItemsThatFitNoPoolOrNoPeriodAreKeptInTheirBuckets_NeverDropped()
    {
        var plan = Plan(Core(PlanType.PlanManaged, Quarters()));
        var items = new[] { Item(10m, D(2026, 10, 5), category: 9), Item(20m, D(2027, 9, 1)), Item(30m, D(2026, 10, 5)) };

        var ledger = BudgetLedgerCalculator.Compute(plan, Today, 80, items);

        Assert.Equal(new[] { 10m }, ledger.NotInAPool.Select(i => i.Amount));
        Assert.Equal(new[] { 20m }, ledger.OutsideThePlan.Select(i => i.Amount));
        Assert.Equal(30m, CurrentPeriod(ledger).Used);   // and neither bucket is in a pool's figures
    }

    // ── Which plan ──────────────────────────────────────────────────────────

    [Fact]
    public void TheCurrentPlanIsTheOneWhoseDatesIncludeToday_ElseTheLatestThatHasStarted_ElseNone()
    {
        var earlier = new FundingPlan { Id = Guid.NewGuid(), PlanStart = D(2025, 7, 1), PlanEnd = D(2026, 6, 30) };
        var running = new FundingPlan { Id = Guid.NewGuid(), PlanStart = D(2026, 7, 1), PlanEnd = D(2027, 6, 30) };
        var upcoming = new FundingPlan { Id = Guid.NewGuid(), PlanStart = D(2027, 7, 1), PlanEnd = D(2028, 6, 30) };

        Assert.Same(running, BudgetLedgerCalculator.CurrentPlanOf(new[] { earlier, running, upcoming }, Today));
        Assert.Same(running, BudgetLedgerCalculator.CurrentPlanOf(new[] { upcoming, running, earlier }, D(2027, 6, 30)));       // its last day is still in it
        Assert.Same(running, BudgetLedgerCalculator.CurrentPlanOf(new[] { earlier, running }, D(2027, 8, 1)));                   // ended, no successor: the latest started
        Assert.Same(earlier, BudgetLedgerCalculator.CurrentPlanOf(new[] { earlier, upcoming }, D(2026, 9, 1)));                  // a gap between plans: the one that started last
        Assert.Null(BudgetLedgerCalculator.CurrentPlanOf(new[] { upcoming }, Today));                                           // nothing has started: no figures at all
        Assert.Null(BudgetLedgerCalculator.CurrentPlanOf(Array.Empty<FundingPlan>(), Today));
    }

    [Fact]
    public void RowsAreOrderedClaimedThenPendingThenBookedAheadByDate_WhateverOrderTheyWereLoadedIn()
    {
        var a = Item(1m, D(2026, 10, 9), LedgerGroup.BookedAhead);
        var b = Item(2m, D(2026, 10, 7), LedgerGroup.Pending);
        var c = Item(3m, D(2026, 10, 8), LedgerGroup.Claimed);
        var d = Item(4m, D(2026, 10, 6), LedgerGroup.Pending);

        var ordered = BudgetLedgerCalculator.Ordered(new[] { a, b, c, d });

        Assert.Equal(new[] { c, d, b, a }, ordered);
    }
}
