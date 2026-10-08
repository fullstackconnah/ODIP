using Odip.Domain.Funding;
using Xunit;
using static Odip.Domain.Funding.AgreementCarry;

namespace Odip.Tests.Funding;

/// <summary>
/// The agreement check's carry (budget phase 2b, fix round 1), pure: a pool's periods in date order, each with its limit, what is used and what the agreement costs in it. The agreement spends
/// the money it uses, so a later period never counts what an earlier one has left that the same agreement has used up.
/// </summary>
public class AgreementCarryTests
{
    private static PeriodInput Period(decimal limit, decimal used, decimal cost) => new(limit, used, cost);

    private static (decimal CarriedIn, decimal Available, decimal Remaining, decimal OverBy) Of(PeriodOutcome o) => (o.CarriedIn, o.Available, o.Remaining, o.OverBy);

    [Fact]
    public void AnAgreementThatOverspendsThePoolAsAWholeIsOverInTheLaterPeriod_NotWithinInBoth()
    {
        // The reviewer's case: October $600 and November $1,000 with nothing used; the agreement costs $600 in October and $1,400 in November, $2,000 against the pool's $1,600.
        var walk = Walk(0m, new[] { Period(600m, 0m, 600m), Period(1000m, 0m, 1400m) });

        Assert.Equal((0m, 600m, 600m, 0m), Of(walk[0]));        // October fits exactly
        Assert.Equal((0m, 1000m, 1000m, 400m), Of(walk[1]));    // November has its own $1,000 only: October's $600 is spent, and the agreement is $400 over
    }

    [Fact]
    public void WithNoAgreementCostAnywhere_ItIsTheLedgersOwnChain()
    {
        // Used $100 of October's $600: $500 carries; November's $1,000 makes $1,500 and all of it carries; December's $1,000 makes $2,500.
        var walk = Walk(0m, new[] { Period(600m, 100m, 0m), Period(1000m, 0m, 0m), Period(1000m, 0m, 0m) });

        Assert.Equal(new[] { 600m, 1500m, 2500m }, walk.Select(w => w.Available));
        Assert.Equal(new[] { 500m, 1500m, 2500m }, walk.Select(w => w.Remaining));
        Assert.All(walk, w => Assert.Equal(0m, w.OverBy));
    }

    [Fact]
    public void WhatTheAgreementLeavesUnspentStillRollsForward()
    {
        // October has $600 and the agreement uses $100 of it: $500 carries into November, which has $1,500 against the agreement's $1,400.
        var walk = Walk(0m, new[] { Period(600m, 0m, 100m), Period(1000m, 0m, 1400m) });

        Assert.Equal((500m, 1500m, 1500m, 0m), Of(walk[1]));
    }

    [Fact]
    public void AnOverspentPeriodLeavesNothingToCarry_AndItsOverspendIsNotChargedToTheNext()
    {
        var walk = Walk(0m, new[] { Period(600m, 0m, 900m), Period(1000m, 0m, 500m) });

        Assert.Equal((0m, 600m, 600m, 300m), Of(walk[0]));
        Assert.Equal((0m, 1000m, 1000m, 0m), Of(walk[1]));
    }

    [Fact]
    public void APeriodTheAgreementDoesNotTouchStillCarries()
    {
        // October's $600 is all spent; November has no agreement cost and its $1,000 carries; December has $2,000 against an agreement of $2,100.
        var walk = Walk(0m, new[] { Period(600m, 0m, 600m), Period(1000m, 0m, 0m), Period(1000m, 0m, 2100m) });

        Assert.Equal((1000m, 2000m, 2000m, 100m), Of(walk[2]));
    }

    [Fact]
    public void WhatIsUsedAlreadyComesOffFirst_AndAPeriodAlreadyOverHasNegativeRemaining()
    {
        // $700 used of $600: $100 over before the agreement, so $100 more makes it $200 over the pool, and nothing carries.
        var walk = Walk(0m, new[] { Period(600m, 700m, 100m), Period(1000m, 0m, 0m) });

        Assert.Equal((0m, 600m, -100m, 200m), Of(walk[0]));
        Assert.Equal(0m, walk[1].CarriedIn);
    }

    [Fact]
    public void TheWalkStartsFromWhatTheLedgerCarriesIntoItsFirstPeriod_AndNeverFromLessThanNothing()
    {
        Assert.Equal((250m, 850m, 850m, 0m), Of(Walk(250m, new[] { Period(600m, 0m, 100m) })[0]));
        Assert.Equal(0m, Walk(-5m, new[] { Period(600m, 0m, 0m) })[0].CarriedIn);
        Assert.Empty(Walk(0m, Array.Empty<PeriodInput>()));
    }
}
