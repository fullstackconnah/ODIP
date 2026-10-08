using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// The interim guard in the shared <see cref="ShiftPriceEstimator"/> (the 2026-10-08 review, L3-02). The shift claim engine prices a shift as its hours at the community access one-to-one rate, so
/// a shift from an approved plan that is a sleepover, a passive night or a group shift (1:2 to 1:5, shared, other) was claimed at up to three times what the agreement quoted. Until the engine
/// prices those properly, the estimator says they have no price and why; two-to-one is still priced (two one-to-one shifts are the quote), and an active night is priced and flagged, because the
/// engine does not apply evening and night rates yet. The claim preview, the generated claim and the budget ledger all use this one estimator.
/// </summary>
public class ShiftPriceEstimatorGuardTests
{
    private static readonly DateOnly Wednesday = new(2026, 10, 7);   // an ordinary weekday: $60 an hour in NSW with the test catalogue, so eight hours is $480

    private static IReadOnlyList<SupportCatalogueItem> Catalogue()
    {
        using var kit = LedgerKit.Create();
        kit.SeedCommunityAccessCatalogue();
        return kit.Db.SupportCatalogueItems.ToList();
    }

    private static ShiftPriceOutcome PriceOf(SupportRatio ratio, SleepoverType night, IReadOnlyList<SupportCatalogueItem>? items = null, DateOnly? date = null) =>
        ShiftPriceEstimator.Price(items ?? Catalogue(), date ?? Wednesday, 8m, ratio, night, isIntensive: false, "NSW", new HashSet<DateOnly>());

    [Theory]
    [InlineData(SupportRatio.OneToOne)]
    [InlineData(SupportRatio.TwoToOne)]
    public void OneToOneAndTwoToOneArePriced_BecauseTwoShiftsAtTheOneToOneRateAreTheQuote(SupportRatio ratio)
    {
        var outcome = PriceOf(ratio, SleepoverType.None);

        Assert.True(outcome.IsPriced);
        Assert.Equal(480m, outcome.Price!.TotalAmount);
        Assert.Null(outcome.NotPricedBecause);
        Assert.Null(outcome.NotPricedSentence);
        Assert.Null(outcome.Caveat);
    }

    [Theory]
    [InlineData(SupportRatio.OneToTwo, "a 1:2 group shift")]
    [InlineData(SupportRatio.OneToThree, "a 1:3 group shift")]
    [InlineData(SupportRatio.OneToFour, "a 1:4 group shift")]
    [InlineData(SupportRatio.OneToFive, "a 1:5 group shift")]
    [InlineData(SupportRatio.SharedSupport, "a shared-support shift")]
    [InlineData(SupportRatio.Other, "a shift with another support ratio")]
    public void AGroupSharedOrOtherRatioHasNoPriceAndSaysWhy(SupportRatio ratio, string phrase)
    {
        var outcome = PriceOf(ratio, SleepoverType.None);

        Assert.False(outcome.IsPriced);
        Assert.Null(outcome.Price);
        Assert.Equal($"it is {phrase}, which shift claims do not price yet", outcome.NotPricedBecause);
        Assert.Equal($"It is {phrase}, which shift claims do not price yet.", outcome.NotPricedSentence);
    }

    [Theory]
    [InlineData(SleepoverType.Sleepover, "a sleepover")]
    [InlineData(SleepoverType.PassiveNight, "a passive night")]
    public void ASleepoverOrAPassiveNightHasNoPriceAndSaysWhy(SleepoverType night, string phrase)
    {
        var outcome = PriceOf(SupportRatio.OneToOne, night);

        Assert.False(outcome.IsPriced);
        Assert.Equal($"it is {phrase}, which shift claims do not price yet", outcome.NotPricedBecause);
    }

    [Fact]
    public void AnActiveNightIsPricedAtTheDayRateAndFlagged_BecauseEveningAndNightRatesAreNotAppliedYet()
    {
        var outcome = PriceOf(SupportRatio.OneToOne, SleepoverType.ActiveNight);

        Assert.True(outcome.IsPriced);
        Assert.Equal(480m, outcome.Price!.TotalAmount);
        Assert.Null(outcome.NotPricedBecause);
        Assert.Equal("Evening and night rates are not applied yet.", outcome.Caveat);
    }

    [Fact]
    public void ARatioAndANightTypeThatAreBothUnsupportedAreBothNamed()
    {
        var outcome = PriceOf(SupportRatio.OneToThree, SleepoverType.Sleepover);

        Assert.False(outcome.IsPriced);
        Assert.Equal("it is a 1:3 group shift and a sleepover, which shift claims do not price yet", outcome.NotPricedBecause);
    }

    [Fact]
    public void TwoToOneOnAnActiveNightIsPricedAndFlagged_AndAGroupActiveNightIsNotPricedAndNotFlagged()
    {
        var twoToOne = PriceOf(SupportRatio.TwoToOne, SleepoverType.ActiveNight);
        var group = PriceOf(SupportRatio.OneToTwo, SleepoverType.ActiveNight);

        Assert.True(twoToOne.IsPriced);
        Assert.NotNull(twoToOne.Caveat);
        Assert.False(group.IsPriced);
        Assert.Null(group.Caveat);   // nothing is priced, so there is no price to qualify
    }

    [Fact]
    public void AShiftNoCatalogueRateCoversStillHasNoPriceAndSaysSo()
    {
        var outcome = PriceOf(SupportRatio.OneToOne, SleepoverType.None, date: new DateOnly(2020, 1, 1));   // before every row of the test catalogue

        Assert.False(outcome.IsPriced);
        Assert.Equal(ShiftPriceEstimator.NoCatalogueRateBecause, outcome.NotPricedBecause);
        Assert.Equal("No catalogue rate covers this date.", outcome.NotPricedSentence);
    }

    [Fact]
    public void ARatioThatCannotBePricedIsSaidEvenWhenNoCatalogueRateCoversTheDateEither()
    {
        // The shift's own kind is the more useful thing to say: it would not be claimable if the catalogue covered the date.
        var outcome = PriceOf(SupportRatio.OneToThree, SleepoverType.None, date: new DateOnly(2020, 1, 1));

        Assert.Equal("it is a 1:3 group shift, which shift claims do not price yet", outcome.NotPricedBecause);
    }
}
