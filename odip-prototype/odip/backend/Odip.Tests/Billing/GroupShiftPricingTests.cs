using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// GA PR4: a shift on a group activity at 1:N is priced at its agreement's own share, <c>floor(rate x 1 / N)</c> to the cent (<c>PlanMoney.GroupPrice</c>), and claimed as hours x that unit price. Pure: the
/// catalogue rows are built here, and <c>groupOf</c> is what <c>AgreementPatternMapper.GroupSizeOf</c> gives an attached shift.
/// </summary>
public class GroupShiftPricingTests
{
    private static readonly DateOnly Monday = new(2026, 10, 12);
    private static readonly DateOnly Tuesday = new(2026, 10, 13);
    private static readonly DateOnly From = new(2026, 7, 1);
    private static readonly SupportRatio[] Ratios = { SupportRatio.OneToOne, SupportRatio.OneToTwo, SupportRatio.OneToThree, SupportRatio.OneToFour, SupportRatio.OneToFive };

    private static SupportCatalogueItem Row(ClaimDayType day, decimal price, string number = "04_102_0136_6_1", bool intensive = false, DateOnly? from = null, DateOnly? to = null) => new()
    {
        Id = Guid.NewGuid(), ItemNumber = number, DayType = day, IsIntensive = intensive, PriceLimit_NSW = price, PriceLimit_VIC = price, EffectiveFrom = from ?? From, EffectiveTo = to, IsActive = to is null,
    };

    private static ShiftPriceOutcome Price(IReadOnlyList<SupportCatalogueItem> group, DateOnly date, TimeOnly start, TimeOnly end, SupportRatio ratio, int? groupOf, SleepoverType night = SleepoverType.None,
        bool endsNextDay = false, bool intensive = false, IReadOnlyList<SupportCatalogueItem>? personalCare = null, bool headcountChanged = false, bool onGroupActivity = false) =>
        ShiftPriceEstimator.Price(new ShiftRateRows(group, personalCare ?? Array.Empty<SupportCatalogueItem>(), Array.Empty<SupportCatalogueItem>()), null, date, start, end, endsNextDay, ratio, night, intensive, "NSW",
            new HashSet<DateOnly>(), TimeZoneInfo.Utc, null, groupOf, headcountChanged, onGroupActivity);

    private static ShiftPriceOutcome Weekday(decimal rate, SupportRatio ratio, int? groupOf, int startHour, int minutes) =>
        Price(new[] { Row(ClaimDayType.Weekday, rate) }, Monday, new TimeOnly(startHour, 0), new TimeOnly(startHour, 0).AddMinutes(minutes), ratio, groupOf);

    [Theory]
    [InlineData(SupportRatio.OneToTwo, 2, 120, 35.00, 2.0, 70.00)]       // 70.01 / 2 = 35.005, floored (not 35.01)
    [InlineData(SupportRatio.OneToThree, 3, 180, 23.33, 3.0, 69.99)]     // 23.336.. floored (not 23.34)
    [InlineData(SupportRatio.OneToFour, 4, 120, 17.50, 2.0, 35.00)]      // 17.5025 floored (not 17.51)
    [InlineData(SupportRatio.OneToFive, 5, 90, 14.00, 1.5, 21.00)]       // 14.002 floored
    public void OneToN_FloorsTheShareOfTheRate(SupportRatio ratio, int n, int minutes, double unit, double hours, double total)
    {
        var line = Weekday(70.01m, ratio, n, 9, minutes).Lines.Single();

        Assert.Equal((decimal)unit, line.UnitPrice);
        Assert.Equal((decimal)hours, line.Hours);
        Assert.Equal((decimal)total, line.TotalAmount);
    }

    [Fact]
    public void HalfAwayAmount_OnTheExactShare_DocumentsTheClaimRoundingRule()
    {
        var line = Weekday(70.23m, SupportRatio.OneToThree, 3, 10, 90).Lines.Single();

        Assert.Equal(23.41m, line.UnitPrice);
        Assert.Equal(1.5m, line.Hours);
        Assert.Equal(35.12m, line.TotalAmount);   // 35.115 rounds half away from zero, as the NDIA recomputes it from hours x unit price
    }

    [Fact]
    public void TwoToOneSibling_IsFullRatePerRow()
    {
        var outcome = Weekday(70.01m, SupportRatio.TwoToOne, null, 10, 120);

        Assert.Equal(70.01m, outcome.Lines.Single().UnitPrice);
        Assert.Equal(140.02m, outcome.Total);
    }

    [Theory]
    [InlineData(SupportRatio.SharedSupport, "a shared-support shift")]
    [InlineData(SupportRatio.Other, "a shift with another support ratio")]
    public void SharedAndOther_OnAnActivity_StayRefused(SupportRatio ratio, string kind)
    {
        var outcome = Weekday(70.01m, ratio, null, 10, 120);

        Assert.False(outcome.IsPriced);
        Assert.Equal(new[] { kind }, outcome.NotPricedKinds);
    }

    [Fact]
    public void SharedSupport_OnAGroupActivityWithNoHeadcount_SaysSo()
    {
        var outcome = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Monday, new TimeOnly(10, 0), new TimeOnly(12, 0), SupportRatio.SharedSupport, null, onGroupActivity: true);

        Assert.False(outcome.IsPriced);
        Assert.Equal(new[] { "a shared-support shift with no agreement headcount" }, outcome.NotPricedKinds);
    }

    [Fact]
    public void SharedSupport_BlockOfSix_FloorsSixthRate()
    {
        var line = Price(new[] { Row(ClaimDayType.Weekday, 70.23m) }, Monday, new TimeOnly(10, 0), new TimeOnly(11, 30), SupportRatio.SharedSupport, 6, onGroupActivity: true).Lines.Single();

        Assert.Equal(11.70m, line.UnitPrice);   // 70.23 / 6 = 11.705, floored (not 11.71)
        Assert.Equal(1.5m, line.Hours);
        Assert.Equal(17.55m, line.TotalAmount);
        Assert.True(6 * line.UnitPrice <= 70.23m);
        Assert.True(6 * line.TotalAmount <= 70.23m * 1.5m + 0.005m * 6);
    }

    [Fact]
    public void SharedSupport_GroupSleepover_Refused()
    {
        var outcome = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Monday, new TimeOnly(22, 0), new TimeOnly(7, 0), SupportRatio.SharedSupport, 6, SleepoverType.Sleepover, endsNextDay: true, onGroupActivity: true);

        Assert.False(outcome.IsPriced);
        Assert.Contains("a group sleepover", outcome.NotPricedKinds);
    }

    [Fact]
    public void SharedSupport_NightBand_NoPersonalCareFallback()
    {
        var personalCare = new[] { Row(ClaimDayType.WeekdayNight, 80m, "01_011_0107_1_1") };

        var outcome = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Tuesday, new TimeOnly(1, 0), new TimeOnly(3, 0), SupportRatio.SharedSupport, 6, personalCare: personalCare, onGroupActivity: true);

        Assert.False(outcome.IsPriced);
        Assert.Equal(new[] { ShiftPriceEstimator.NoCatalogueRateKind }, outcome.NotPricedKinds);
    }

    [Fact]
    public void SharedSupport_HeadcountChanged_Refused()
    {
        var outcome = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Monday, new TimeOnly(9, 0), new TimeOnly(11, 0), SupportRatio.SharedSupport, 6, headcountChanged: true, onGroupActivity: true);

        Assert.Equal("the group size changed during this support; claim it by hand", outcome.NotPricedBecause);
    }

    [Fact]
    public void AnUnattachedGroupShift_StaysRefused()
    {
        var outcome = Weekday(70.01m, SupportRatio.OneToThree, null, 10, 120);

        Assert.Equal(new[] { "a 1:3 group shift" }, outcome.NotPricedKinds);
    }

    [Fact]
    public void ARateChangeAtMidnight_UsesTheRowOfEachStretchsOwnDate()
    {
        var friday = new DateOnly(2026, 7, 3);
        var rows = new[]
        {
            Row(ClaimDayType.WeekdayEvening, 77.38m, "04_103"),
            Row(ClaimDayType.Saturday, 90.00m, "04_104", to: new DateOnly(2026, 7, 3)),
            Row(ClaimDayType.Saturday, 98.83m, "04_104", from: new DateOnly(2026, 7, 4)),
        };

        var lines = Price(rows, friday, new TimeOnly(21, 0), new TimeOnly(1, 0), SupportRatio.OneToTwo, 2, endsNextDay: true).Lines;

        Assert.Equal(2, lines.Count);
        Assert.Equal((38.69m, 3m, 116.07m), (lines[0].UnitPrice, lines[0].Hours, lines[0].TotalAmount));
        Assert.Equal((49.41m, 1m, 49.41m), (lines[1].UnitPrice, lines[1].Hours, lines[1].TotalAmount));   // 98.83 / 2 = 49.415, floored
    }

    [Fact]
    public void NoRowForTheDate_IsUnpriced()
    {
        var outcome = Price(new[] { Row(ClaimDayType.Weekday, 70.01m, from: new DateOnly(2027, 1, 1)) }, Monday, new TimeOnly(9, 0), new TimeOnly(12, 0), SupportRatio.OneToThree, 3);

        Assert.False(outcome.IsPriced);
        Assert.Equal(new[] { ShiftPriceEstimator.NoCatalogueRateKind }, outcome.NotPricedKinds);
    }

    [Fact]
    public void NightHours_OnAGroupLine_DoNotFallBackToPersonalCare()
    {
        var group = new[] { Row(ClaimDayType.Weekday, 70.01m) };
        var personalCare = new[] { Row(ClaimDayType.WeekdayNight, 80m, "01_103") };

        var outcome = Price(group, Tuesday, new TimeOnly(1, 0), new TimeOnly(3, 0), SupportRatio.OneToThree, 3, personalCare: personalCare);

        Assert.False(outcome.IsPriced);
        Assert.Equal(new[] { ShiftPriceEstimator.NoCatalogueRateKind }, outcome.NotPricedKinds);
    }

    [Fact]
    public void NightHours_OneToOne_KeepTheFallback()
    {
        var group = new[] { Row(ClaimDayType.Weekday, 70.01m) };
        var personalCare = new[] { Row(ClaimDayType.WeekdayNight, 80m, "01_103") };

        var line = Price(group, Tuesday, new TimeOnly(1, 0), new TimeOnly(3, 0), SupportRatio.OneToOne, null, personalCare: personalCare).Lines.Single();

        Assert.Equal(80m, line.UnitPrice);
    }

    [Theory]
    [InlineData(SleepoverType.Sleepover)]
    [InlineData(SleepoverType.PassiveNight)]
    public void AGroupSleepover_IsRefused(SleepoverType night)
    {
        var outcome = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Monday, new TimeOnly(22, 0), new TimeOnly(7, 0), SupportRatio.OneToThree, 3, night, endsNextDay: true);

        Assert.False(outcome.IsPriced);
        Assert.Contains("a group sleepover", outcome.NotPricedKinds);
    }

    [Fact]
    public void Intensive_PicksTheIntensiveRowThenDivides()
    {
        var rows = new[] { Row(ClaimDayType.Weekday, 70.01m), Row(ClaimDayType.Weekday, 74.86m, "04_600_0104_6_1", intensive: true) };

        var line = Price(rows, Monday, new TimeOnly(9, 0), new TimeOnly(12, 0), SupportRatio.OneToThree, 3, intensive: true).Lines.Single();

        Assert.Equal(24.95m, line.UnitPrice);   // 74.86 / 3 = 24.953
        Assert.Equal("04_600_0104_6_1", line.CatalogueItem.ItemNumber);
    }

    [Theory]
    [InlineData(SupportRatio.OneToTwo, 2)]
    [InlineData(SupportRatio.OneToFour, 4)]
    public void AHeadcountChange_RefusesTheGroupShift_OnlyWhenItIsAGroupLine(SupportRatio ratio, int n)
    {
        var plain = Weekday(70.01m, ratio, n, 9, 120);
        var changed = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Monday, new TimeOnly(9, 0), new TimeOnly(11, 0), ratio, n, headcountChanged: true);
        var oneToOne = Price(new[] { Row(ClaimDayType.Weekday, 70.01m) }, Monday, new TimeOnly(9, 0), new TimeOnly(11, 0), SupportRatio.OneToOne, null, headcountChanged: true);

        Assert.True(plain.IsPriced);
        Assert.False(changed.IsPriced);
        Assert.Equal("the group size changed during this support; claim it by hand", changed.NotPricedBecause);
        Assert.True(oneToOne.IsPriced);
    }

    [Fact]
    public void Invariants_HoldAcrossRatesAndHours()
    {
        foreach (var rate in new[] { 70.01m, 70.23m, 65.47m, 100.00m, 193.99m })
            foreach (var n in new[] { 2, 3, 4, 5, 6, 7, 8, 12, 40 })
                foreach (var minutes in new[] { 15, 30, 90, 165, 200 })
                {
                    var line = Weekday(rate, n <= 5 ? Ratios[n - 1] : SupportRatio.SharedSupport, n, 9, minutes).Lines.Single();
                    var hours = minutes / 60m;
                    var label = $"{rate} 1:{n} {minutes} min";

                    Assert.True(line.UnitPrice * n <= rate, label);
                    Assert.True(line.UnitPrice > rate / n - 0.01m, label);
                    Assert.Equal(Math.Floor(rate * 100m / n) / 100m, line.UnitPrice);
                    Assert.Equal(ClaimPricing.LineAmount(hours, line.UnitPrice), line.TotalAmount);
                    Assert.True(n * line.TotalAmount <= rate * ClaimPricing.LineHours(hours) + 0.005m * n, label);
                }
    }
}
