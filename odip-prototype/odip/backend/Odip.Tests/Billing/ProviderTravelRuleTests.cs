using Odip.Domain.Billing.Pricing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// The shared provider travel rule (travel plan D2, D2i, D7; amend C2-3): one TRAN time line and one _799_ kilometre line per shift, each leg capped first, the sharing divisor, the trip-back gate,
/// and a claim line whose TotalAmount is exactly Hours (2 dp, as written to the file) x unit price.
/// </summary>
public class ProviderTravelRuleTests
{
    private static readonly DateOnly Day = new(2026, 11, 3);
    private const decimal Price = 60.40m;   // x 0.05 h (3 minutes) is cent-exact, so the claim rule and the quote's floor agree

    private static SupportCatalogueItem Basis(CatalogueClaimFlag? travel = CatalogueClaimFlag.Yes, string number = "04_104_0125_6_1") => new()
    {
        Id = Guid.NewGuid(), ItemNumber = number, Unit = "H", RegistrationGroup = "0125", ProviderTravel = travel,
        PriceLimit_VIC = Price, PriceLimit_NSW = Price, EffectiveFrom = new DateOnly(2025, 7, 1), IsActive = true,
    };

    private static SupportCatalogueItem KmRow(string number = "04_799_0125_6_1", decimal price = 1.00m, DateOnly? from = null) => new()
    {
        Id = Guid.NewGuid(), ItemNumber = number, Unit = "E", RegistrationGroup = "0125",
        PriceLimit_VIC = price, PriceLimit_NSW = price, EffectiveFrom = from ?? new DateOnly(2025, 7, 1), IsActive = true,
    };

    private static ShiftPriceOutcome Outcome(SupportCatalogueItem basis, string? caveat = null) =>
        new(new[] { new ShiftPrice(basis, ClaimDayType.Weekday, 2m, Price, 120.80m, Day) }, null, caveat);

    private static ShiftTravelInput Input(int preMin = 0, decimal preKm = 0m, int postMin = 0, decimal postKm = 0m, PlanLocation? location = null, int sharing = 1, bool block = true, bool back = true) =>
        new(new TravelLeg(preMin, preKm), new TravelLeg(postMin, postKm), location, sharing, block, back);

    private static ShiftPriceOutcome Apply(ShiftPriceOutcome o, ShiftTravelInput? i, SupportCatalogueItem basis, params SupportCatalogueItem[] km) =>
        ShiftTravelPricer.Apply(o, i, Day, "VIC", 0.99m, new[] { basis }, km);

    [Theory]
    [InlineData(3)]
    [InlineData(12)]
    [InlineData(30)]
    public void T2_TimeLine_AtSharingOne_EqualsTheQuote_AndTotalIsHoursTimesPrice(int minutes)
    {
        var basis = Basis();
        var result = Apply(Outcome(basis), Input(preMin: minutes), basis);
        var line = Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel);
        // The agreement quote's rule (OccurrencePricer: FloorToCent(price x minutes / 60)); equal here because the price makes every 3 minutes cent-exact.
        var quote = Math.Floor(Price * minutes / 60m * 100m) / 100m;
        Assert.Equal(quote, line.TotalAmount);
        Assert.Equal(line.Hours * line.UnitPrice, line.TotalAmount);
        Assert.Equal(decimal.Round(line.Hours, 2), line.Hours);
        Assert.Equal(basis.ItemNumber, line.CatalogueItem.ItemNumber);
        Assert.Equal(Day, line.Date);
    }

    [Fact]
    public void T2_SharingTwo_FollowsTheFileRule_AndDiffersFromTheQuoteByDesign()
    {
        var basis = Basis();
        var result = Apply(Outcome(basis), Input(preMin: 25, postMin: 20, sharing: 2), basis);
        var line = Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel);
        // 45 minutes shared by 2 is 22 whole minutes -> 0.37 h written to the file, and the line total is that Hours x the price. The agreement quote keeps 22.5 minutes (0.375 h) and floors
        // the dollars instead, so it differs from the claim by up to a cent per line: a known, accepted difference (amend C2-3).
        Assert.Equal(0.37m, line.Hours);
        Assert.Equal(ClaimPricing.LineAmount(0.37m, Price), line.TotalAmount);   // 22.348 rounded to the cent, the way every claim line is
    }

    [Fact]
    public void EachLegIsCappedFirst_AndEachCappedLegIsFlagged()
    {
        var basis = Basis();
        var result = Apply(Outcome(basis), Input(preMin: 45, postMin: 50), basis);   // a hand-made shift (no location) takes the strict 30-minute cap
        var line = Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel);
        Assert.Equal(1.00m, line.Hours);   // 30 + 30
        Assert.Contains("Travel before the shift capped at 30 minutes: 45 minutes were recorded.", result.Caveat);
        Assert.Contains("Travel after the shift capped at 30 minutes: 50 minutes were recorded.", result.Caveat);
    }

    [Fact]
    public void AMmFourLocation_HasTheSixtyMinuteCap()
    {
        var basis = Basis();
        var location = new PlanLocation { State = "VIC", Zone = PriceZone.National, Mm = 4 };
        var result = Apply(Outcome(basis), Input(preMin: 45, location: location), basis);
        Assert.Equal(0.75m, Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel).Hours);
        Assert.Null(result.Caveat);
    }

    [Fact]
    public void KmLine_IsOneLineOfTheSummedLegs_OnThe799Item_AtTheKmRate_SharedBySharing()
    {
        var basis = Basis(); var km = KmRow();
        var result = Apply(Outcome(basis), Input(preMin: 10, preKm: 5m, postMin: 10, postKm: 7.5m, sharing: 2), basis, km);
        var kmLine = Assert.Single(result.Lines, l => l.CatalogueItem.ItemNumber == km.ItemNumber);
        Assert.Equal(ClaimType.Standard, kmLine.ClaimType);   // the kilometre line is a Standard claim type, blank in the file; only the time line is TRAN
        Assert.Equal(6.18m, kmLine.Hours);                  // floor(12.5 km x 0.99 / 2) = 6.18 dollars at $1.00 an item
        Assert.Equal(6.18m, kmLine.TotalAmount);
        Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel && l.CatalogueItem.Unit == "H");   // one time line, one km line
    }

    [Fact]
    public void NoKmRowValidOnTheDate_NotesItInFlagged_AndKeepsTheTimeLine()
    {
        var basis = Basis();
        var result = Apply(Outcome(basis), Input(preMin: 10, preKm: 5m), basis, KmRow(from: new DateOnly(2027, 1, 1)));
        Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel);
        Assert.Contains("Travel kilometres not claimed: no 04_799 item is in the catalogue for 03/11/2026.", result.Caveat);
    }

    [Fact]
    public void BasisRowThatDoesNotAllowProviderTravel_ClaimsNothing_AndSaysSo()
    {
        var basis = Basis(CatalogueClaimFlag.No);
        var result = Apply(Outcome(basis), Input(preMin: 10, preKm: 5m), basis, KmRow());
        Assert.DoesNotContain(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel);
        Assert.Equal("Travel not claimed: 04_104_0125_6_1 does not allow provider travel.", result.Caveat);
    }

    [Fact]
    public void NoHourLine_ClaimsNothing_AndSaysThereIsNoSupportHour()
    {
        var sleepover = Basis(number: "04_103_0125_6_1"); sleepover.Unit = "E";
        var o = new ShiftPriceOutcome(new[] { new ShiftPrice(sleepover, ClaimDayType.Weekday, 1m, Price, Price, Day) }, null, null);
        var result = Apply(o, Input(preMin: 10), sleepover);
        Assert.Single(result.Lines);
        Assert.Equal("Travel not claimed: there is no support hour to claim it against.", result.Caveat);
    }

    [Fact]
    public void BlockOff_ClaimsNothing_AndSaysTheAgreementDoesNotInclude()
    {
        var basis = Basis();
        var result = Apply(Outcome(basis), Input(preMin: 10, block: false), basis);
        Assert.Single(result.Lines);
        Assert.Equal("Travel not claimed: the agreement doesn't include provider travel.", result.Caveat);
    }

    [Fact]
    public void ReturnBoxOff_DropsThePostLeg_WithTheCaveat_AndKeepsThePreLeg()
    {
        var basis = Basis();
        var result = Apply(Outcome(basis), Input(preMin: 15, postMin: 15, back: false), basis);
        Assert.Equal(0.25m, Assert.Single(result.Lines, l => l.ClaimType == ClaimType.ProviderTravel).Hours);
        Assert.Equal("Travel after the shift not claimed: the agreement doesn't include the trip back.", result.Caveat);
    }

    [Fact]
    public void AllLegsZero_AddsNothing_AndNoCaveat()
    {
        var basis = Basis();
        var outcome = Outcome(basis, caveat: "kept");
        var result = Apply(outcome, Input(), basis, KmRow());
        Assert.Single(result.Lines);
        Assert.Equal("kept", result.Caveat);
        Assert.Same(outcome, Apply(outcome, null, basis));
    }

    [Fact]
    public void AnUnpricedShift_StaysUnpriced()
    {
        var unpriced = ShiftPriceOutcome.Unpriced("it is a 1:3 group shift");
        Assert.Same(unpriced, Apply(unpriced, Input(preMin: 10), Basis()));
    }

    [Fact]
    public void ThePartsOfAShift_CountTheTravelDollars_ButNotTheTravelAsHours()
    {
        var basis = Basis(); var km = KmRow();
        var result = Apply(Outcome(basis), Input(preMin: 30, preKm: 10m), basis, km);
        var part = Assert.Single(ShiftPriceEstimator.PartsOf(result));
        Assert.Equal(result.Total, part.Amount);          // the travel money sits in the shift's pool
        Assert.Equal(2m, part.Hours);                     // F-5 / T17: neither the travel time nor the km counts as support hours
        Assert.Equal(0m, part.Nights);
    }
}
