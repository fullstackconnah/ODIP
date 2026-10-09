using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The four budget alerts as rules over a computed ledger (budget phase 2b), with no database: a plan, the items that cost it and today go in; the alerts come out. Each rule and its message,
/// the worst-status-only rule, the quiet cases (nothing to compare with, no period running now) and the NDIA's own signal. Today is the funding tests' fixed 4 Oct 2026, in the Oct to Dec quarter.
/// </summary>
public class BudgetAlertRulesTests
{
    private static readonly DateOnly Today = new(2026, 10, 4);
    private static readonly DateOnly QuarterEnd = new(2026, 12, 31);

    /// <summary>The four quarters of 2026-27.</summary>
    private static PeriodSpec[] Year(decimal perQuarter) => new[] { LedgerKit.Q(1, perQuarter), LedgerKit.Q(2, perQuarter), LedgerKit.Q(3, perQuarter), LedgerKit.Q(4, perQuarter) };

    /// <summary>The quarters from 1 Oct 2026: a plan that begins in the current quarter, so nothing is carried into it and what is available is exactly the quarter's amount.</summary>
    private static PeriodSpec[] FromOctober(decimal perQuarter) => new[] { LedgerKit.Q(2, perQuarter), LedgerKit.Q(3, perQuarter), LedgerKit.Q(4, perQuarter) };

    private static readonly DateOnly OctoberStart = new(2026, 10, 1);
    private static readonly DateOnly JuneEnd = new(2027, 6, 30);

    private static FundingPlan PlanOf(DateOnly start, DateOnly end, params PoolSpec[] pools)
    {
        var plan = new FundingPlan { Id = Guid.NewGuid(), TenantId = LedgerKit.TenantA, ParticipantId = Guid.NewGuid(), PlanStart = start, PlanEnd = end, CreatedAt = FundingTestKit.Now.UtcDateTime };
        for (var position = 0; position < pools.Length; position++)
        {
            var spec = pools[position];
            var pool = new FundingPool
            {
                Id = Guid.NewGuid(), TenantId = plan.TenantId, FundingPlanId = plan.Id, Position = position, Kind = spec.Kind, PaceCategory = spec.PaceCategory, ManagementType = spec.Management,
                Name = spec.Kind == FundingPoolKind.CoreFlexible ? PaceCategories.CoreFlexibleName : PaceCategories.NameOf(spec.PaceCategory)!,
            };
            var order = 0;
            foreach (var period in spec.Periods)
                pool.Periods.Add(new FundingPeriod { Id = Guid.NewGuid(), TenantId = plan.TenantId, FundingPoolId = pool.Id, Position = order++, PeriodStart = period.Start, PeriodEnd = period.End, PlanAmount = period.Amount, SetAside = period.SetAside });
            plan.Pools.Add(pool);
        }
        return plan;
    }

    private static FundingPlan CorePlan(decimal perQuarter = 8000m, PlanType management = PlanType.PlanManaged) =>
        PlanOf(OctoberStart, JuneEnd, LedgerKit.Core(management, FromOctober(perQuarter)));

    private static LedgerItem Cost(LedgerGroup group, decimal amount, DateOnly? date = null, int category = 4) => new()
    {
        Kind = group == LedgerGroup.BookedAhead ? LedgerRowKind.FutureShift : LedgerRowKind.ClaimLine, Group = group, Date = date ?? new DateOnly(2026, 10, 10), Amount = amount, PaceCategory = category,
        PlanType = PlanType.PlanManaged,
    };

    private static ParticipantLedger LedgerOf(FundingPlan plan, params LedgerItem[] items) =>
        new(plan.ParticipantId, "Sophie Brown", Today, "Australia/Sydney", 80, BudgetLedgerCalculator.Compute(plan, Today, 80, items), items);

    private static IReadOnlyList<ParticipantAlertDto> AlertsOf(ParticipantLedger ledger, params PoolNdiaRejection[] rejections) =>
        BudgetAlertRules.For(ledger, rejections.ToDictionary(r => r.PoolId));

    // ── Approaching ─────────────────────────────────────────────────────────

    [Fact]
    public void Approaching_IsAWarning_AndSaysHowFarThroughThePeriodTheCostIs()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 6560m))));

        Assert.Equal("budget-approaching", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
        Assert.Equal("Core is at 82% of this period's $8,000 (to 31 Dec 2026)", alert.Message);
        Assert.Equal("funding", alert.DeepLinkTab);
        Assert.Null(alert.LinkTo);
    }

    [Fact]
    public void Approaching_BeginsExactlyAtTheOrganisationsPercentage()
    {
        Assert.Empty(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 6399.99m))));

        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 6400m))));
        Assert.Equal("Core is at 80% of this period's $8,000 (to 31 Dec 2026)", alert.Message);
    }

    [Fact]
    public void ThePercentageIsRoundedDown_SoItNeverClaimsMoreThanIsUsed()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Pending, 7999.99m))));

        Assert.Equal("Core is at 99% of this period's $8,000 (to 31 Dec 2026)", alert.Message);
    }

    // ── Forecast over ───────────────────────────────────────────────────────

    [Fact]
    public void ForecastOver_IsAWarning_AndSaysByHowMuchTheBookedShiftsWouldGoOver()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 5000m), Cost(LedgerGroup.BookedAhead, 3640m))));

        Assert.Equal("budget-forecast-over", alert.Type);
        Assert.Equal(AlertSeverity.Warning, alert.Severity);
        Assert.Equal("Booked shifts would take Core $640 over this period's $8,000 by 31 Dec 2026", alert.Message);
        Assert.Equal("funding", alert.DeepLinkTab);
    }

    [Fact]
    public void ForecastOver_WithNothingYetUsed_StillWarns()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.BookedAhead, 8100.5m))));

        Assert.Equal("budget-forecast-over", alert.Type);
        Assert.Equal("Booked shifts would take Core $100.50 over this period's $8,000 by 31 Dec 2026", alert.Message);
    }

    // ── Over ────────────────────────────────────────────────────────────────

    [Fact]
    public void Over_IsCritical_AndSaysByHowMuchTheUsedAmountPassesWhatIsAvailable()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 7000m), Cost(LedgerGroup.Pending, 1200m))));

        Assert.Equal("budget-over", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("Core is $200 over this period's $8,000 (to 31 Dec 2026)", alert.Message);
        Assert.Equal("funding", alert.DeepLinkTab);
    }

    [Fact]
    public void AvailableIncludesWhatEarlierPeriodsLeft_SoTheMessageNamesTheFigureTheStatusWasWorkedOutWith()
    {
        // 1 Jul to 30 Sep used nothing, so $8,000 rolls into this quarter: $16,000 are available, not $8,000.
        var plan = PlanOf(new DateOnly(2026, 7, 1), JuneEnd, LedgerKit.Core(PlanType.PlanManaged, Year(8000m)));
        var alert = Assert.Single(AlertsOf(LedgerOf(plan, Cost(LedgerGroup.Claimed, 16500m))));

        Assert.Equal("Core is $500 over this period's $16,000 (to 31 Dec 2026)", alert.Message);
    }

    // ── Only the worst, once for each pool ──────────────────────────────────

    [Fact]
    public void OverOutranksForecastOverAndApproaching_SoAPoolIsNeverToldTwice()
    {
        var alerts = AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 8200m), Cost(LedgerGroup.BookedAhead, 4000m)));

        Assert.Equal("budget-over", Assert.Single(alerts).Type);
    }

    [Fact]
    public void ForecastOverOutranksApproaching()
    {
        var alerts = AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 7000m), Cost(LedgerGroup.BookedAhead, 1500m)));

        Assert.Equal("budget-forecast-over", Assert.Single(alerts).Type);
    }

    [Fact]
    public void EachPoolHasItsOwnAlert_NamedAsThePlanPrintsIt()
    {
        var plan = PlanOf(OctoberStart, JuneEnd,
            LedgerKit.Core(PlanType.PlanManaged, FromOctober(8000m)), LedgerKit.Stated(15, PlanType.AgencyManaged, FromOctober(1000m)));
        var ledger = LedgerOf(plan, Cost(LedgerGroup.Claimed, 8200m, category: 4), Cost(LedgerGroup.Claimed, 850m, category: 15));

        var alerts = AlertsOf(ledger);

        Assert.Equal(2, alerts.Count);
        Assert.Contains(alerts, a => a.Type == "budget-over" && a.Message == "Core is $200 over this period's $8,000 (to 31 Dec 2026)");
        Assert.Contains(alerts, a => a.Type == "budget-approaching" && a.Message == "Improved Daily Living Skills is at 85% of this period's $1,000 (to 31 Dec 2026)");
    }

    [Fact]
    public void TwoCorePoolsOfDifferentManagementAreToldApart()
    {
        var plan = PlanOf(OctoberStart, JuneEnd,
            LedgerKit.Core(PlanType.PlanManaged, FromOctober(8000m)), LedgerKit.Core(PlanType.AgencyManaged, FromOctober(2000m)));
        var ledger = LedgerOf(plan, Cost(LedgerGroup.Claimed, 8200m));

        var alert = Assert.Single(AlertsOf(ledger));

        Assert.Equal("Core (plan managed) is $200 over this period's $8,000 (to 31 Dec 2026)", alert.Message);
    }

    // ── Nothing to say ──────────────────────────────────────────────────────

    [Fact]
    public void OnTrack_SaysNothing()
    {
        Assert.Empty(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 1000m), Cost(LedgerGroup.BookedAhead, 2000m))));
    }

    [Fact]
    public void WithNoPlanThatHasStarted_ThereIsNothingToCompareWith_AndNothingIsSaid()
    {
        var empty = new ParticipantLedger(Guid.NewGuid(), "Sophie Brown", Today, "Australia/Sydney", 80, null, Array.Empty<LedgerItem>());

        Assert.Empty(BudgetAlertRules.For(empty, new Dictionary<Guid, PoolNdiaRejection>()));
    }

    [Fact]
    public void AfterThePlanHasEnded_NoPeriodIsRunning_AndNothingIsSaid()
    {
        var ended = PlanOf(new DateOnly(2025, 7, 1), new DateOnly(2026, 6, 30), LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(1, 8000m, year: 2025), LedgerKit.Q(2, 8000m, year: 2025), LedgerKit.Q(3, 8000m, year: 2025), LedgerKit.Q(4, 8000m, year: 2025)));
        var ledger = LedgerOf(ended, Cost(LedgerGroup.Claimed, 99999m, date: new DateOnly(2026, 6, 1)));

        Assert.Empty(AlertsOf(ledger));
    }

    [Fact]
    public void OnlyThePeriodRunningNowIsSpokenOf_AnEarlierQuarterThatWentOverIsHistory()
    {
        var plan = PlanOf(new DateOnly(2026, 7, 1), JuneEnd, LedgerKit.Core(PlanType.PlanManaged, Year(8000m)));
        var ledger = LedgerOf(plan, Cost(LedgerGroup.Claimed, 9000m, date: new DateOnly(2026, 8, 5)), Cost(LedgerGroup.Claimed, 100m, date: new DateOnly(2026, 10, 3)));

        Assert.Empty(AlertsOf(ledger));
    }

    // ── The NDIA's own signal ───────────────────────────────────────────────

    [Fact]
    public void NdiaRefusedForWantOfFunds_IsCritical_AndSaysWhenAndWithWhichCode()
    {
        var plan = CorePlan();
        var rejection = new PoolNdiaRejection(plan.Pools.Single().Id, Guid.NewGuid(), "TC-0001", new DateOnly(2026, 10, 8), "V27");

        var alert = Assert.Single(AlertsOf(LedgerOf(plan, Cost(LedgerGroup.Claimed, 1000m)), rejection));

        Assert.Equal("budget-ndia-exhausted", alert.Type);
        Assert.Equal(AlertSeverity.Critical, alert.Severity);
        Assert.Equal("NDIA rejected a claim for Core on 8 Oct 2026: not enough funds in the funding period (V27)", alert.Message);
        Assert.Equal("funding", alert.DeepLinkTab);
    }

    // The dialog tells the plan (V17, V18) from the funding period (V27, V28), which changes what the coordinator does next, so the alert does too. One colon: the pool is named in the sentence.
    [Theory]
    [InlineData("V17", "in the plan")]
    [InlineData("V18", "in the plan")]
    [InlineData("V27", "in the funding period")]
    [InlineData("V28", "in the funding period")]
    public void TheNdiaAlertSaysWhetherThePlanOrTheFundingPeriodRanOut_WithOneColon(string code, string scope)
    {
        var plan = CorePlan();
        var rejection = new PoolNdiaRejection(plan.Pools.Single().Id, Guid.NewGuid(), "TC-0001", new DateOnly(2026, 10, 8), code);

        var alert = Assert.Single(AlertsOf(LedgerOf(plan, Cost(LedgerGroup.Claimed, 1000m)), rejection));

        Assert.Equal($"NDIA rejected a claim for Core on 8 Oct 2026: not enough funds {scope} ({code})", alert.Message);
        Assert.Equal(1, alert.Message.Count(c => c == ':'));
    }

    [Fact]
    public void TheNdiasSignalIsOneAlertForThePool_AndSitsBesideTheLedgersOwnStatus()
    {
        var plan = CorePlan();
        var rejection = new PoolNdiaRejection(plan.Pools.Single().Id, Guid.NewGuid(), "TC-0001", new DateOnly(2026, 10, 8), "V18");

        var alerts = AlertsOf(LedgerOf(plan, Cost(LedgerGroup.Claimed, 8200m)), rejection);

        Assert.Equal(new[] { "budget-ndia-exhausted", "budget-over" }, alerts.Select(a => a.Type).OrderBy(t => t, StringComparer.Ordinal));
    }

    [Fact]
    public void ARejectionOfAPoolThatIsNotThePlans_IsIgnored()
    {
        var plan = CorePlan();
        var rejection = new PoolNdiaRejection(Guid.NewGuid(), Guid.NewGuid(), "TC-0001", new DateOnly(2026, 10, 8), "V27");

        Assert.Empty(AlertsOf(LedgerOf(plan, Cost(LedgerGroup.Claimed, 1000m)), rejection));
    }

    [Fact]
    public void ThePlansAlertsAreInPoolOrder()
    {
        var plan = PlanOf(OctoberStart, JuneEnd,
            LedgerKit.Core(PlanType.PlanManaged, FromOctober(8000m)), LedgerKit.Stated(15, PlanType.AgencyManaged, FromOctober(1000m)));
        var ledger = LedgerOf(plan, Cost(LedgerGroup.Claimed, 850m, category: 15), Cost(LedgerGroup.Claimed, 8200m, category: 4));

        Assert.Equal(new[] { "budget-over", "budget-approaching" }, AlertsOf(ledger).Select(a => a.Type));
    }

    // ── Shifts the shift claim cannot price (the fix round's UnpricedShiftCount) ──────────────────────
    // A sleepover, a passive night or a group shift is $0 in every figure, so the figures an alert rests on leave it out. An alert says so rather than reading as the whole picture.

    private static LedgerItem Unpriced(DateOnly? date = null, string reason = "a sleepover") => new()
    {
        Kind = LedgerRowKind.FutureShift, Group = LedgerGroup.BookedAhead, Date = date ?? new DateOnly(2026, 10, 12), Amount = 0m, PaceCategory = 4, PlanType = PlanType.PlanManaged,
        NotPricedKinds = new[] { reason },
    };

    [Fact]
    public void AForecastOverAlert_SaysTheFiguresLeaveAShiftOut_InTheSingular()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 5000m), Cost(LedgerGroup.BookedAhead, 3640m), Unpriced())));

        Assert.Equal("budget-forecast-over", alert.Type);
        Assert.Equal("Booked shifts would take Core $640 over this period's $8,000 by 31 Dec 2026. 1 shift in this period is not priced yet, so this leaves it out", alert.Message);
    }

    [Theory]
    [InlineData(6560, 0, "budget-approaching", "Core is at 82% of this period's $8,000 (to 31 Dec 2026)")]
    [InlineData(5000, 3640, "budget-forecast-over", "Booked shifts would take Core $640 over this period's $8,000 by 31 Dec 2026")]
    [InlineData(8200, 0, "budget-over", "Core is $200 over this period's $8,000 (to 31 Dec 2026)")]
    public void EveryStatusAlert_SaysTheFiguresLeaveShiftsOut_InThePlural(int claimed, int booked, string type, string plain)
    {
        var items = new List<LedgerItem> { Cost(LedgerGroup.Claimed, claimed), Unpriced(), Unpriced(new DateOnly(2026, 11, 3), "a 1:3 group shift") };
        if (booked > 0) items.Add(Cost(LedgerGroup.BookedAhead, booked));

        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), items.ToArray())));

        Assert.Equal(type, alert.Type);
        Assert.Equal($"{plain}. 2 shifts in this period are not priced yet, so this leaves them out", alert.Message);
    }

    [Fact]
    public void APoolThatIsOnTrack_StillSaysNothing_HoweverManyShiftsAreUnpriced()
    {
        // The alerts speak of a status; the Funding tab and the Budgets list are where a gap in an otherwise comfortable pool shows.
        Assert.Empty(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 1000m), Unpriced(), Unpriced())));
    }

    [Fact]
    public void AnUnpricedShiftInAnotherPeriod_IsNotSaidOfTheOneRunningNow()
    {
        var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(), Cost(LedgerGroup.Claimed, 8200m), Unpriced(new DateOnly(2027, 1, 12)))));

        Assert.Equal("Core is $200 over this period's $8,000 (to 31 Dec 2026)", alert.Message);
    }

    [Fact]
    public void TheNdiasAlert_IsNotAnnotated_ItIsTheNdiasWordAndNotAFigure()
    {
        var plan = CorePlan();
        var pool = plan.Pools.Single();
        var ledger = LedgerOf(plan, Unpriced());

        var alert = Assert.Single(AlertsOf(ledger, new PoolNdiaRejection(pool.Id, Guid.NewGuid(), "TC-1", new DateOnly(2026, 10, 3), "V27")));

        Assert.Equal("budget-ndia-exhausted", alert.Type);
        Assert.DoesNotContain("priced", alert.Message);
    }

    [Fact]
    public void TheMessagesAreInvariant_WhateverCultureTheServerRunsIn()
    {
        var previous = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
            var alert = Assert.Single(AlertsOf(LedgerOf(CorePlan(12345.5m), Cost(LedgerGroup.Claimed, 12546m))));

            Assert.Equal("Core is $200.50 over this period's $12,345.50 (to 31 Dec 2026)", alert.Message);
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = previous; }
    }
}
