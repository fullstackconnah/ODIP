using Odip.Application.DTOs;
using Odip.Application.Funding;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The server's rules for a plan budget, each with its message: the plan's dates and length, the pool's category, a duplicate pool, the periods (contiguous, from the
/// plan's first day to its last, none longer than 12 months, exactly one when the plan has no funding periods), and the money (zero or more, cents, the set-aside on
/// every period or none and never above the plan amount). The server checks these invariants and never proposes periods: that is the screen's job.
/// </summary>
public class FundingPlanValidatorTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    private static SaveFundingPeriodDto P(DateOnly start, DateOnly end, decimal amount, decimal? setAside = null) =>
        new() { PeriodStart = start, PeriodEnd = end, PlanAmount = amount, SetAside = setAside };

    /// <summary>The four 3-month periods of a plan that runs 1 Jul 2026 to 30 Jun 2027.</summary>
    private static List<SaveFundingPeriodDto> Quarters(decimal each = 2000m, decimal? setAside = null) => new()
    {
        P(D(2026, 7, 1), D(2026, 9, 30), each, setAside),
        P(D(2026, 10, 1), D(2026, 12, 31), each, setAside),
        P(D(2027, 1, 1), D(2027, 3, 31), each, setAside),
        P(D(2027, 4, 1), D(2027, 6, 30), each, setAside),
    };

    private static SaveFundingPoolDto Core(PlanType management = PlanType.PlanManaged, List<SaveFundingPeriodDto>? periods = null, string? name = null) => new()
    {
        Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = management, Name = name, Periods = periods ?? Quarters(),
    };

    private static SaveFundingPoolDto Stated(int category, PlanType management = PlanType.AgencyManaged, List<SaveFundingPeriodDto>? periods = null) => new()
    {
        Kind = FundingPoolKind.Stated, PaceCategory = category, ManagementType = management, Periods = periods ?? Quarters(500m),
    };

    private static SaveFundingPlanDto Plan(params SaveFundingPoolDto[] pools) => new()
    {
        PlanStart = D(2026, 7, 1), PlanEnd = D(2027, 6, 30), PeriodLengthMonths = 3, Evidence = BudgetEvidenceSource.PlanCopy,
        Pools = pools.Length == 0 ? new List<SaveFundingPoolDto> { Core() } : pools.ToList(),
    };

    private static List<SaveFundingPeriodDto> Whole(decimal amount, decimal? setAside = null) => new() { P(D(2026, 7, 1), D(2027, 6, 30), amount, setAside) };

    private static void AssertRefused(List<string> errors, string phrase) =>
        Assert.True(errors.Any(e => e.Contains(phrase, StringComparison.OrdinalIgnoreCase)), $"Expected an error containing \"{phrase}\" but got:\n  " + string.Join("\n  ", errors));

    // ── A good plan ─────────────────────────────────────────────────────────

    [Fact]
    public void AThreeMonthlyPlanWithACoreAndAStatedPool_IsAccepted()
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(), Stated(15))));
    }

    [Fact]
    public void APlanWithNoFundingPeriods_HasOnePeriodEqualToThePlanDates_AndIsAccepted()
    {
        var plan = Plan(Core(periods: Whole(8000m, 6000m)), Stated(9, periods: Whole(1200m))) with { PeriodLengthMonths = null };

        Assert.Empty(FundingPlanValidator.Validate(plan));
    }

    [Fact]
    public void TheServerKeepsNoPoolTotal_SoPeriodsThatAddUpToAnythingAreAccepted()
    {
        // The editor tells the user when edited periods no longer add up to the total they typed, and sends periods only: the plan's release schedule is what it is.
        var uneven = new List<SaveFundingPeriodDto>
        {
            P(D(2026, 7, 1), D(2026, 9, 30), 5000m), P(D(2026, 10, 1), D(2026, 12, 31), 0m),
            P(D(2027, 1, 1), D(2027, 3, 31), 123.45m), P(D(2027, 4, 1), D(2027, 6, 30), 9999.99m),
        };

        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(periods: uneven))));
    }

    // ── The plan ────────────────────────────────────────────────────────────

    [Fact]
    public void ThePlanNeedsBothDates()
    {
        var errors = FundingPlanValidator.Validate(Plan() with { PlanStart = null, PlanEnd = null });

        AssertRefused(errors, "day the plan starts");
        AssertRefused(errors, "day the plan ends");
    }

    [Fact]
    public void APlanThatEndsBeforeItStarts_IsRefused()
    {
        var errors = FundingPlanValidator.Validate(Plan() with { PlanStart = D(2027, 6, 30), PlanEnd = D(2026, 7, 1) });

        AssertRefused(errors, "plan ends before it starts");
    }

    [Fact]
    public void APlanOfExactly800DaysIsAccepted_AndOf801DaysIsRefused()
    {
        var start = D(2026, 7, 1);
        var end800 = start.AddDays(799);
        var ok = Plan(Core(periods: new() { P(start, end800, 100m) })) with { PlanEnd = end800, PeriodLengthMonths = null };
        Assert.Empty(FundingPlanValidator.Validate(ok));

        var end801 = start.AddDays(800);
        var tooLong = Plan(Core(periods: new() { P(start, D(2027, 6, 30), 100m) })) with { PlanEnd = end801, PeriodLengthMonths = null };
        AssertRefused(FundingPlanValidator.Validate(tooLong), "at most 800 days");
    }

    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    [InlineData(6)]
    [InlineData(12)]
    public void FundingPeriodsOfOneThreeSixOrTwelveMonths_AreAllowedLengths(int months)
    {
        // Only the length is under test here: the periods are one whole-plan period, which is within 12 months of the plan's start.
        var plan = Plan(Core(periods: Whole(100m))) with { PlanEnd = D(2027, 6, 30), PeriodLengthMonths = months };

        Assert.DoesNotContain(FundingPlanValidator.Validate(plan), e => e.Contains("months long", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(24)]
    public void AnyOtherPeriodLength_IsRefused(int months)
    {
        AssertRefused(FundingPlanValidator.Validate(Plan() with { PeriodLengthMonths = months }), "1, 3, 6 or 12 months");
    }

    [Fact]
    public void TheSourceOfTheFiguresMustBeOneOfTheKnownOnes()
    {
        AssertRefused(FundingPlanValidator.Validate(Plan() with { Evidence = null }), "where the figures came from");
        AssertRefused(FundingPlanValidator.Validate(Plan() with { Evidence = (BudgetEvidenceSource)99 }), "where the figures came from");
    }

    [Fact]
    public void AnOverlongConfirmedByNameOrNotes_AreRefused()
    {
        var errors = FundingPlanValidator.Validate(Plan() with { ConfirmedByName = new string('a', 201), Notes = new string('b', 2001) });

        AssertRefused(errors, "Confirmed by can be at most 200 characters");
        AssertRefused(errors, "Notes can be at most 2000 characters");
    }

    [Fact]
    public void APlanNeedsAtLeastOnePool()
    {
        AssertRefused(FundingPlanValidator.Validate(Plan() with { Pools = new List<SaveFundingPoolDto>() }), "at least one pool");
        AssertRefused(FundingPlanValidator.Validate(Plan() with { Pools = null }), "at least one pool");
    }

    // ── The pools ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData(5)] [InlineData(6)] [InlineData(7)] [InlineData(8)] [InlineData(9)] [InlineData(10)] [InlineData(11)] [InlineData(12)]
    [InlineData(13)] [InlineData(14)] [InlineData(15)] [InlineData(16)] [InlineData(17)] [InlineData(19)] [InlineData(20)] [InlineData(21)]
    public void EveryStatedCategoryThePlanCanHold_IsAccepted(int category)
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Stated(category))));
    }

    [Theory]
    [InlineData(1)] [InlineData(2)] [InlineData(3)] [InlineData(4)]
    public void Categories01To04_AreCoreFlexible_AndCannotBeAStatedPool(int category)
    {
        AssertRefused(FundingPlanValidator.Validate(Plan(Stated(category))), "Core (flexible)");
    }

    [Fact]
    public void RecurringTransport18_IsPaidToTheParticipantAndCannotBeAPool()
    {
        AssertRefused(FundingPlanValidator.Validate(Plan(Stated(18))), "Recurring Transport (18) is paid to the participant");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(22)]
    [InlineData(-3)]
    public void AStatedPoolNeedsARealCategory(int category)
    {
        Assert.NotEmpty(FundingPlanValidator.Validate(Plan(Stated(category))));
    }

    [Fact]
    public void ACoreFlexiblePoolHasNoCategoryOfItsOwn()
    {
        var core = Core() with { PaceCategory = 4 };

        AssertRefused(FundingPlanValidator.Validate(Plan(core)), "covers categories 01 to 04");
    }

    [Fact]
    public void ThePoolNeedsAKindAndAManagementType()
    {
        var errors = FundingPlanValidator.Validate(Plan(Core() with { Kind = null }, Core() with { ManagementType = null }));

        AssertRefused(errors, "Core (flexible) or a stated support");
        AssertRefused(errors, "who manages the money");
    }

    [Fact]
    public void TwoPoolsForTheSameCategoryAndManagementType_AreRefused()
    {
        var errors = FundingPlanValidator.Validate(Plan(Core(PlanType.PlanManaged), Core(PlanType.PlanManaged)));

        AssertRefused(errors, "twice");
    }

    [Fact]
    public void TwoCoreFlexiblePoolsWithDifferentManagementTypes_AreAccepted_AsPaceSplitsCoreByManagementType()
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(PlanType.PlanManaged), Core(PlanType.AgencyManaged))));
    }

    [Fact]
    public void TheSameStatedCategoryUnderTwoManagementTypes_IsAccepted()
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Stated(15, PlanType.AgencyManaged), Stated(15, PlanType.PlanManaged))));
    }

    [Fact]
    public void APoolNameOrNotesThatAreTooLong_AreRefused()
    {
        var errors = FundingPlanValidator.Validate(Plan(Core(name: new string('n', 201)) with { Notes = new string('x', 1001) }));

        AssertRefused(errors, "pool name can be at most 200 characters");
        AssertRefused(errors, "pool notes can be at most 1000 characters");
    }

    // ── The periods ─────────────────────────────────────────────────────────

    [Fact]
    public void APoolNeedsAtLeastOnePeriod()
    {
        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: new()))), "at least one funding period");
    }

    [Fact]
    public void APeriodWithNoDatesOrNoAmount_IsRefused()
    {
        var errors = FundingPlanValidator.Validate(Plan(Core(periods: new() { new SaveFundingPeriodDto { PlanAmount = 10m }, new SaveFundingPeriodDto { PeriodStart = D(2026, 7, 1), PeriodEnd = D(2027, 6, 30) } })));

        AssertRefused(errors, "both dates");
        AssertRefused(errors, "plan amount");
    }

    [Fact]
    public void APeriodThatEndsBeforeItStarts_IsRefused()
    {
        var periods = Quarters();
        periods[1] = P(D(2026, 12, 31), D(2026, 10, 1), 2000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "ends (1 Oct 2026) before it starts (31 Dec 2026)");
    }

    [Fact]
    public void AGapBetweenTwoPeriods_IsRefused_NamingBothDays()
    {
        var periods = Quarters();
        periods[2] = P(D(2027, 1, 15), D(2027, 3, 31), 2000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "gap");
    }

    [Fact]
    public void TwoPeriodsThatOverlap_AreRefused()
    {
        var periods = Quarters();
        periods[1] = P(D(2026, 9, 1), D(2026, 12, 31), 2000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "overlap");
    }

    [Fact]
    public void ThePeriodsAreCheckedInDateOrder_NotInTheOrderTheyWereSent()
    {
        var periods = Quarters();
        periods.Reverse();

        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(periods: periods))));
    }

    [Fact]
    public void TheFirstPeriodMustStartOnThePlansFirstDay()
    {
        var periods = Quarters();
        periods[0] = P(D(2026, 7, 8), D(2026, 9, 30), 2000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "should start on the plan's first day, 1 Jul 2026");
    }

    [Fact]
    public void TheLastPeriodMustEndOnThePlansLastDay()
    {
        var periods = Quarters();
        periods[3] = P(D(2027, 4, 1), D(2027, 6, 29), 2000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "should end on the plan's last day, 30 Jun 2027");
    }

    [Fact]
    public void APeriodLongerThanTwelveMonths_IsRefused_AndOneOfExactlyTwelveMonthsIsNot()
    {
        var twelve = new List<SaveFundingPeriodDto> { P(D(2026, 7, 1), D(2027, 6, 30), 100m) };
        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(periods: twelve)) with { PeriodLengthMonths = 12 }));

        var thirteen = new List<SaveFundingPeriodDto> { P(D(2026, 7, 1), D(2027, 7, 31), 100m) };
        var plan = Plan(Core(periods: thirteen)) with { PlanEnd = D(2027, 7, 31), PeriodLengthMonths = 12 };
        AssertRefused(FundingPlanValidator.Validate(plan), "longer than 12 months");
    }

    [Fact]
    public void ThePlanMayHaveAThirteenthMonthAsAShortLastPeriod()
    {
        // A 13-month plan on 12-month periods: the last period is the short remainder.
        var periods = new List<SaveFundingPeriodDto> { P(D(2026, 7, 1), D(2027, 6, 30), 1200m), P(D(2027, 7, 1), D(2027, 7, 31), 100m) };
        var plan = Plan(Core(periods: periods)) with { PlanEnd = D(2027, 7, 31), PeriodLengthMonths = 12 };

        Assert.Empty(FundingPlanValidator.Validate(plan));
    }

    [Theory]
    [InlineData(2026, 7, 1, 2027, 6, 30)]
    [InlineData(2024, 2, 29, 2025, 2, 28)]   // started on a leap day: twelve months later is 1 Mar 2025, so the 28th is the last day
    [InlineData(2025, 1, 31, 2026, 1, 30)]
    public void MaxPeriodEnd_IsTheLastDayOfTwelveMonthsFromTheStart(int sy, int sm, int sd, int ey, int em, int ed)
    {
        Assert.Equal(D(ey, em, ed), FundingPlanValidator.MaxPeriodEnd(D(sy, sm, sd)));
    }

    [Fact]
    public void APlanWithNoFundingPeriods_MustHoldExactlyOnePeriodEqualToThePlanDates()
    {
        var two = Plan(Core(periods: Quarters())) with { PeriodLengthMonths = null };
        AssertRefused(FundingPlanValidator.Validate(two), "no funding periods, so it has one period, from 1 Jul 2026 to 30 Jun 2027");

        var shorter = Plan(Core(periods: new() { P(D(2026, 7, 1), D(2027, 3, 31), 100m) })) with { PeriodLengthMonths = null };
        AssertRefused(FundingPlanValidator.Validate(shorter), "no funding periods, so it has one period, from 1 Jul 2026 to 30 Jun 2027");
    }

    // ── The money ───────────────────────────────────────────────────────────

    [Fact]
    public void ANegativePlanAmount_IsRefused()
    {
        var periods = Quarters();
        periods[0] = P(D(2026, 7, 1), D(2026, 9, 30), -1m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "cannot be negative");
    }

    [Fact]
    public void AZeroPlanAmount_IsAccepted_APoolRecordedButNotUsedByOassist()
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(periods: Quarters(0m)))));
    }

    [Fact]
    public void AmountsAreInDollarsAndCents()
    {
        var periods = Quarters();
        periods[0] = P(D(2026, 7, 1), D(2026, 9, 30), 100.005m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "dollars and cents");
    }

    [Fact]
    public void AnAmountAboveNinetyNineMillion_IsRefused_AsASlippedDecimalPoint()
    {
        var periods = Quarters();
        periods[0] = P(D(2026, 7, 1), D(2026, 9, 30), 100_000_000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "at most $99,999,999.99");
    }

    [Fact]
    public void ASetAsideOnEveryPeriod_AtOrBelowThePlanAmount_IsAccepted()
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(periods: Quarters(2000m, setAside: 2000m)), Stated(15, periods: Quarters(500m, setAside: 0m)))));
    }

    [Fact]
    public void ASetAsideOnSomePeriodsOfAPoolButNotAll_IsRefused()
    {
        var periods = Quarters(2000m);
        periods[1] = P(D(2026, 10, 1), D(2026, 12, 31), 2000m, 1000m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "set-aside is given for some periods but not all");
    }

    [Fact]
    public void ASetAsideAboveThePlanAmount_IsRefused()
    {
        var periods = Quarters(2000m, setAside: 100m);
        periods[2] = P(D(2027, 1, 1), D(2027, 3, 31), 2000m, 2000.01m);

        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: periods))), "more than the plan amount");
    }

    [Fact]
    public void ANegativeSetAside_IsRefused()
    {
        AssertRefused(FundingPlanValidator.Validate(Plan(Core(periods: Quarters(2000m, setAside: -1m)))), "set-aside cannot be negative");
    }

    [Fact]
    public void TheSetAsideRuleIsPerPool_OnePoolWithoutAndAnotherWithIsAccepted()
    {
        Assert.Empty(FundingPlanValidator.Validate(Plan(Core(periods: Quarters(2000m, setAside: 500m)), Stated(15, periods: Quarters(500m)))));
    }

    [Fact]
    public void EveryReasonIsReported_NotJustTheFirst()
    {
        var errors = FundingPlanValidator.Validate(Plan(Stated(2), Stated(18)) with { PeriodLengthMonths = 2, Evidence = null });

        Assert.True(errors.Count >= 4, string.Join("\n", errors));
    }

    [Fact]
    public void TooManyPoolsOrPeriods_AreRefused_SoABodyCannotHoldThousandsOfRows()
    {
        var manyPools = Enumerable.Range(0, 41).Select(i => Core((PlanType)(i % 3), name: "p" + i)).ToArray();
        AssertRefused(FundingPlanValidator.Validate(Plan(manyPools)), "at most 40 pools");

        var days = Enumerable.Range(0, 365).Select(i => P(D(2026, 7, 1).AddDays(i), D(2026, 7, 1).AddDays(i), 1m)).ToList();
        var plan = Plan(Core(periods: days)) with { PlanEnd = D(2027, 6, 30), PeriodLengthMonths = 1 };
        AssertRefused(FundingPlanValidator.Validate(plan), "at most 60 periods");
    }
}
