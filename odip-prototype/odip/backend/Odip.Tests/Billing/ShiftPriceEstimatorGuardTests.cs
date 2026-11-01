using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// The interim guard in the shared <see cref="ShiftPriceEstimator"/> (the 2026-10-08 review, L3-02). The shift claim engine prices a shift as its hours at the community access one-to-one rate, so
/// a shift from an approved plan that is a sleepover, a passive night or a group shift (1:2 to 1:5, shared, other) was claimed at up to three times what the agreement quoted. Until the engine
/// prices group shifts properly, the estimator says they have no price and why; two-to-one is still priced (two one-to-one shifts are the quote). Sleepovers, passive nights and the evening and night
/// bands are priced since shift billing PR3 (see ShiftBandClaimTests). The claim preview, the generated claim and the budget ledger all use this one estimator.
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

    private static ShiftPriceOutcome PriceOf(SupportRatio ratio, SleepoverType night, IReadOnlyList<SupportCatalogueItem>? items = null, DateOnly? date = null,
        TimeOnly? start = null, TimeOnly? end = null, bool endsNextDay = false) =>
        ShiftPriceEstimator.Price(new ShiftRateRows(items ?? Catalogue(), Array.Empty<SupportCatalogueItem>(), Array.Empty<SupportCatalogueItem>()), null, date ?? Wednesday,
            start ?? new TimeOnly(9, 0), end ?? new TimeOnly(17, 0), endsNextDay, ratio, night, isIntensive: false, "NSW", new HashSet<DateOnly>(), TimeZoneInfo.Utc);

    [Fact]
    public void AShiftOf20Minutes_CarriesHoursRoundedTo2dp_AndTheAmountOfThoseHours()
    {
        var price = PriceOf(SupportRatio.OneToOne, SleepoverType.None, end: new TimeOnly(9, 20)).Lines.Single();

        Assert.Equal(0.33m, price.Hours);
        Assert.Equal(19.80m, price.TotalAmount);   // 0.33 h x $60; the unrounded 0.3333 h would give $20.00
    }

    [Theory]
    [InlineData(SupportRatio.OneToOne)]
    [InlineData(SupportRatio.TwoToOne)]
    public void OneToOneAndTwoToOneArePriced_BecauseTwoShiftsAtTheOneToOneRateAreTheQuote(SupportRatio ratio)
    {
        var outcome = PriceOf(ratio, SleepoverType.None);

        Assert.True(outcome.IsPriced);
        Assert.Equal(480m, outcome.Total);
        Assert.Null(outcome.NotPricedBecause);
        Assert.Null(outcome.NotPricedSentence);
        Assert.Null(outcome.Caveat);
        Assert.Empty(outcome.NotPricedKinds);
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
        Assert.Empty(outcome.Lines);
        Assert.Equal($"it is {phrase}, which shift claims do not price yet", outcome.NotPricedBecause);
        Assert.Equal($"It is {phrase}, which shift claims do not price yet.", outcome.NotPricedSentence);
        Assert.Equal(new[] { phrase }, outcome.NotPricedKinds);   // the reason in a few words, for a figure that counts such shifts
    }

    [Theory]
    [InlineData(SleepoverType.Sleepover, "a sleepover")]
    [InlineData(SleepoverType.PassiveNight, "a passive night")]
    public void ASleepoverOrAPassiveNightThatIsNotAnOvernightOf8HoursHasNoPriceAndSaysWhy(SleepoverType night, string phrase)
    {
        var outcome = PriceOf(SupportRatio.OneToOne, night);   // 09:00-17:00: does not cross midnight

        Assert.False(outcome.IsPriced);
        Assert.Equal($"it is {phrase} but is not 8 hours or more across midnight", outcome.NotPricedBecause);
        Assert.Equal(new[] { ShiftPriceEstimator.SleepoverTooShortKind }, outcome.NotPricedKinds);
    }

    [Fact]
    public void ASleepoverWithNoCatalogueSleepoverItemHasNoPriceAndSaysSo()
    {
        var outcome = PriceOf(SupportRatio.OneToOne, SleepoverType.Sleepover, start: new TimeOnly(22, 0), end: new TimeOnly(6, 0), endsNextDay: true);

        Assert.False(outcome.IsPriced);
        Assert.Equal(ShiftPriceEstimator.NoSleepoverItemBecause, outcome.NotPricedBecause);
    }

    [Fact]
    public void AnActiveNightIsPricedWithNoCaveat_BecauseItIsSplitByBandLikeAnyOtherShift()
    {
        var outcome = PriceOf(SupportRatio.OneToOne, SleepoverType.ActiveNight);

        Assert.True(outcome.IsPriced);
        Assert.Equal(480m, outcome.Total);
        Assert.Null(outcome.NotPricedBecause);
        Assert.Null(outcome.Caveat);
    }

    [Fact]
    public void AGroupShiftIsRefusedForItsRatioEvenWhenItIsASleepover()
    {
        var outcome = PriceOf(SupportRatio.OneToThree, SleepoverType.Sleepover);

        Assert.False(outcome.IsPriced);
        Assert.Equal("it is a 1:3 group shift, which shift claims do not price yet", outcome.NotPricedBecause);
        Assert.Equal(new[] { "a 1:3 group shift" }, outcome.NotPricedKinds);
    }

    [Fact]
    public void TwoToOneOnAnActiveNightIsPriced_AndAGroupActiveNightIsNot()
    {
        var twoToOne = PriceOf(SupportRatio.TwoToOne, SleepoverType.ActiveNight);
        var group = PriceOf(SupportRatio.OneToTwo, SleepoverType.ActiveNight);

        Assert.True(twoToOne.IsPriced);
        Assert.Null(twoToOne.Caveat);
        Assert.False(group.IsPriced);
        Assert.Null(group.Caveat);
    }

    [Fact]
    public void AShiftNoCatalogueRateCoversStillHasNoPriceAndSaysSo()
    {
        var outcome = PriceOf(SupportRatio.OneToOne, SleepoverType.None, date: new DateOnly(2020, 1, 1));   // before every row of the test catalogue

        Assert.False(outcome.IsPriced);
        Assert.Equal(ShiftPriceEstimator.NoCatalogueRateBecause, outcome.NotPricedBecause);
        Assert.Equal("No catalogue rate covers this date.", outcome.NotPricedSentence);
        Assert.Equal(new[] { "no catalogue rate for the date" }, outcome.NotPricedKinds);
    }

    [Fact]
    public void ARatioThatCannotBePricedIsSaidEvenWhenNoCatalogueRateCoversTheDateEither()
    {
        // The shift's own kind is the more useful thing to say: it would not be claimable if the catalogue covered the date.
        var outcome = PriceOf(SupportRatio.OneToThree, SleepoverType.None, date: new DateOnly(2020, 1, 1));

        Assert.Equal("it is a 1:3 group shift, which shift claims do not price yet", outcome.NotPricedBecause);
    }

    // The phase 3 review (C1, 2026-10-09): a shift that ends before it starts (an overnight shift saved without "Ends the next day") has a length of zero or less. Priced as hours x rate it was a NEGATIVE
    // item, which the ledger summed with the real ones, wiping the forecast. A shift with no length has no price, whatever its kind.
    [Theory]
    [InlineData(9)]    // ends when it starts
    [InlineData(1)]    // ends before it starts
    public void AShiftWithNoLengthHasNoPrice_NotAZeroOrNegativeOne(int endHour)
    {
        var outcome = PriceOf(SupportRatio.OneToOne, SleepoverType.None, end: new TimeOnly(endHour, 0));

        Assert.False(outcome.IsPriced);
        Assert.Empty(outcome.Lines);
        Assert.Contains("no length", outcome.NotPricedBecause);
        Assert.Equal(new[] { "no length" }, outcome.NotPricedKinds);
    }

    [Fact]
    public void AShiftWithNoLengthSaysSoBeforeItsKind()
    {
        var outcome = PriceOf(SupportRatio.OneToThree, SleepoverType.Sleepover, start: new TimeOnly(17, 0), end: new TimeOnly(13, 0));

        Assert.Equal(new[] { "no length" }, outcome.NotPricedKinds);   // the data is wrong first; its kind is not what to say
    }
}
