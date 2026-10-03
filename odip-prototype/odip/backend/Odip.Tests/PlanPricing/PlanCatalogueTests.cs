using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// How the engine finds an item: the classification map read the other way (a family, an intensity and a band give the code keys), then the rows
/// of those keys that are valid on the service date, then the date-effective lookup for the zone price. The map is the only place a code lives.
/// </summary>
public class PlanCatalogueTests
{
    private static readonly DateOnly Oct12 = new(2026, 10, 12);

    // ── The classifier read the other way ─────────────────────────────────────────

    [Fact]
    public void Every_key_the_map_names_is_found_again_by_its_own_classification()
    {
        foreach (var key in CatalogueClassifier.ClassifiedKeys)
        {
            var classification = CatalogueClassifier.Classify(key + "_1_1");
            var keys = CatalogueClassifier.KeysFor(classification.Family, classification.Intensity, classification.DayType);

            Assert.Contains(key, keys);
        }
    }

    [Theory]
    [InlineData(SupportFamily.PersonalCare, SupportIntensity.Standard, ClaimDayType.Weekday, "0107", "01_011_0107")]
    [InlineData(SupportFamily.PersonalCare, SupportIntensity.HighIntensity, ClaimDayType.Saturday, "0104", "01_402_0104")]
    [InlineData(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.PublicHoliday, "0125", "04_102_0125")]
    [InlineData(SupportFamily.GroupActivity, SupportIntensity.Standard, ClaimDayType.Weekday, "0136", "04_102_0136")]
    [InlineData(SupportFamily.StaSupport, SupportIntensity.Standard, ClaimDayType.WeekdayNight, "0115", "01_205_0115")]
    public void The_keys_for_a_need_are_the_ones_of_NDIS_CODES_11_1(SupportFamily family, SupportIntensity intensity, ClaimDayType day, string group, string expected)
    {
        Assert.Equal(new[] { expected }, CatalogueClassifier.KeysFor(family, intensity, day, group));
    }

    [Theory]
    [InlineData(SupportFamily.CommunityAccess, ClaimDayType.WeekdayNight)]
    [InlineData(SupportFamily.GroupActivity, ClaimDayType.WeekdayNight)]
    public void The_map_names_no_weekday_night_item_for_community_access_or_group_activities(SupportFamily family, ClaimDayType day)
    {
        foreach (var intensity in new[] { SupportIntensity.Standard, SupportIntensity.HighIntensity, SupportIntensity.Icbs })
            Assert.Empty(CatalogueClassifier.KeysFor(family, intensity, day));
    }

    [Fact]
    public void The_same_sequence_digits_in_two_registration_groups_are_two_different_needs()
    {
        // 04_102 is the Public Holiday item in RG 0125 and the Weekday Daytime item in RG 0136.
        Assert.Equal(new[] { "04_102_0125" }, CatalogueClassifier.KeysFor(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.PublicHoliday));
        Assert.Equal(new[] { "04_102_0136" }, CatalogueClassifier.KeysFor(SupportFamily.GroupActivity, SupportIntensity.Standard, ClaimDayType.Weekday));
    }

    // ── Finding the row and the price in the real 2026-27 catalogue ───────────────

    private static readonly PlanCatalogue Real = new(RealCatalogue);

    [Theory]
    [InlineData(SupportFamily.CommunityAccess, ClaimDayType.Weekday, "0125", PriceZone.National, "04_104_0125_6_1", 73.58)]
    [InlineData(SupportFamily.CommunityAccess, ClaimDayType.Weekday, "0125", PriceZone.Remote, "04_104_0125_6_1", 103.01)]
    [InlineData(SupportFamily.CommunityAccess, ClaimDayType.Weekday, "0125", PriceZone.VeryRemote, "04_104_0125_6_1", 110.37)]
    [InlineData(SupportFamily.CommunityAccess, ClaimDayType.PublicHoliday, "0125", PriceZone.National, "04_102_0125_6_1", 163.46)]
    [InlineData(SupportFamily.GroupActivity, ClaimDayType.Saturday, "0136", PriceZone.National, "04_104_0136_6_1", 103.54)]
    [InlineData(SupportFamily.PersonalCare, ClaimDayType.WeekdayNight, "0107", PriceZone.National, "01_002_0107_1_1", 82.57)]
    [InlineData(SupportFamily.StaSupport, ClaimDayType.Sunday, "0115", PriceZone.National, "01_203_0115_1_1", 133.50)]
    public void An_hourly_need_finds_its_row_and_the_price_of_the_zone(SupportFamily family, ClaimDayType day, string group, PriceZone zone, string code, double price)
    {
        var choice = Real.Find(new ItemNeed(family, SupportIntensity.Standard, day, group), Oct12, zone);

        Assert.True(choice.Found, choice.Message);
        Assert.Equal((code, (decimal)price), (choice.Row!.ItemNumber, choice.Price));
    }

    [Theory]
    [InlineData(SupportFamily.Sleepover, "0107", "01_010_0107_1_1", 311.79)]
    [InlineData(SupportFamily.Sleepover, "0115", "01_206_0115_1_1", 311.79)]
    public void A_sleepover_is_told_apart_by_its_registration_group(SupportFamily family, string group, string code, double price)
    {
        var choice = Real.Find(new ItemNeed(family, SupportIntensity.Standard, null, group), Oct12, PriceZone.National);

        Assert.Equal((code, (decimal)price, "E"), (choice.Row!.ItemNumber, choice.Price, choice.Row.Unit));
    }

    [Fact]
    public void The_two_STA_accommodation_items_are_told_apart_by_their_sequence_and_one_registration_group_holds_two_travel_items_told_apart_by_category()
    {
        var participant = Real.Find(new ItemNeed(SupportFamily.StaAccommodation, null, null, "0115", Sequence: "250"), Oct12, PriceZone.National);
        var worker = Real.Find(new ItemNeed(SupportFamily.StaAccommodation, null, null, "0115", Sequence: "251"), Oct12, PriceZone.National);
        var both = Real.Find(new ItemNeed(SupportFamily.StaAccommodation, null, null, "0115"), Oct12, PriceZone.National);
        var personalCareTravel = Real.Find(new ItemNeed(SupportFamily.ProviderTravel, null, null, "0104", CategoryPrefix: "01"), Oct12, PriceZone.National);
        var communityTravel = Real.Find(new ItemNeed(SupportFamily.ProviderTravel, null, null, "0104", CategoryPrefix: "04"), Oct12, PriceZone.National);
        var ambiguous = Real.Find(new ItemNeed(SupportFamily.ProviderTravel, null, null, "0104"), Oct12, PriceZone.National);

        Assert.Equal(("01_250_0115_1_1", 162.85m, "D"), (participant.Row!.ItemNumber, participant.Price, participant.Row.Unit));
        Assert.Equal("01_251_0115_1_1", worker.Row!.ItemNumber);
        Assert.Equal(PlanFailureReason.CatalogueAmbiguous, both.Failure);
        Assert.Equal(("01_799_0104_1_1", 1.00m), (personalCareTravel.Row!.ItemNumber, personalCareTravel.Price));
        Assert.Equal("04_799_0104_6_1", communityTravel.Row!.ItemNumber);
        Assert.Equal(PlanFailureReason.CatalogueAmbiguous, ambiguous.Failure);
    }

    // ── The typed failures ────────────────────────────────────────────────────────

    [Fact]
    public void An_item_the_map_does_not_name_is_NoItem_and_is_never_mapped_to_another_family()
    {
        var choice = Real.Find(new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.WeekdayNight, "0125"), Oct12, PriceZone.National);

        Assert.False(choice.Found);
        Assert.Equal(PlanFailureReason.NoItem, choice.Failure);
        Assert.Contains("Weekday Night", choice.Message);
        Assert.Null(choice.Row);
    }

    [Theory]
    [InlineData(2026, 6, 30)]
    [InlineData(2025, 7, 1)]
    public void A_date_before_every_row_is_CatalogueNotFound_with_the_date_in_the_message(int year, int month, int day)
    {
        var choice = Real.Find(new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.Weekday, "0125"), new DateOnly(year, month, day), PriceZone.National);

        Assert.Equal(PlanFailureReason.CatalogueNotFound, choice.Failure);
        Assert.Contains($"{year:0000}-{month:00}-{day:00}", choice.Message);
    }

    [Fact]
    public void An_empty_catalogue_finds_nothing_for_any_need()
    {
        var choice = new PlanCatalogue(Array.Empty<SupportCatalogueItem>()).Find(new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.Weekday, "0125"), Oct12, PriceZone.National);

        Assert.Equal(PlanFailureReason.CatalogueNotFound, choice.Failure);
    }

    [Fact]
    public void An_item_with_no_remote_price_is_ZoneNotEligible_and_a_quotable_one_is_NotPriced()
    {
        var weekday = RealCatalogue.Single(r => r.ItemNumber == "04_104_0125_6_1");
        var noRemote = new PlanCatalogue(new[] { Copy(weekday, r => r.PriceRemote = null) });
        var quotable = new PlanCatalogue(new[] { Copy(weekday, r => r.PriceNational = null) });
        var need = new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.Weekday, "0125");

        Assert.Equal(PlanFailureReason.ZoneNotEligible, noRemote.Find(need, Oct12, PriceZone.Remote).Failure);
        Assert.True(noRemote.Find(need, Oct12, PriceZone.National).Found);
        Assert.Equal(PlanFailureReason.CatalogueNotPriced, quotable.Find(need, Oct12, PriceZone.National).Failure);
    }

    [Fact]
    public void Two_different_codes_for_one_need_are_CatalogueAmbiguous_and_the_registration_group_column_wins_over_the_code()
    {
        var weekday = RealCatalogue.Single(r => r.ItemNumber == "04_104_0125_6_1");
        // Two codes, both in the community access weekday slot of RG 0125 (the second says RG 0125 in its column although its code says 0136).
        var twin = Copy(weekday, r => { r.Id = Guid.NewGuid(); r.ItemNumber = "04_104_0125_9_9"; });
        var need = new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.Weekday, "0125");

        Assert.Equal(PlanFailureReason.CatalogueAmbiguous, new PlanCatalogue(new[] { weekday, twin }).Find(need, Oct12, PriceZone.National).Failure);

        var misfiled = Copy(weekday, r => { r.ItemNumber = "04_104_0136_6_1"; r.RegistrationGroup = "0125"; });
        Assert.Equal("04_104_0136_6_1", new PlanCatalogue(new[] { misfiled }).Find(need, Oct12, PriceZone.National).Row!.ItemNumber);
    }

    [Fact]
    public void The_rows_are_never_changed_by_a_lookup()
    {
        var before = Json(RealCatalogue.Select(r => new { r.ItemNumber, r.EffectiveFrom, r.EffectiveTo, r.PriceNational, r.IsActive }).ToList());

        Real.Find(new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.Weekday, "0125"), Oct12, PriceZone.National);

        Assert.Equal(before, Json(RealCatalogue.Select(r => new { r.ItemNumber, r.EffectiveFrom, r.EffectiveTo, r.PriceNational, r.IsActive }).ToList()));
    }

    // ── By service date ───────────────────────────────────────────────────────────

    [Fact]
    public async Task A_December_price_set_prices_services_from_1_December_and_leaves_November_on_the_July_row()
    {
        var december = await WithDecemberPriceSetAsync(code => code == "04_104_0125_6_1");
        var catalogue = new PlanCatalogue(december);
        var need = new ItemNeed(SupportFamily.CommunityAccess, SupportIntensity.Standard, ClaimDayType.Weekday, "0125");

        var november = catalogue.Find(need, new DateOnly(2026, 11, 30), PriceZone.National);
        var first = catalogue.Find(need, new DateOnly(2026, 12, 1), PriceZone.National);

        Assert.Equal((73.58m, new DateOnly(2026, 7, 1)), (november.Price, november.Row!.EffectiveFrom));
        Assert.Equal((74.58m, new DateOnly(2026, 12, 1)), (first.Price, first.Row!.EffectiveFrom));
    }

    private static SupportCatalogueItem Copy(SupportCatalogueItem row, Action<SupportCatalogueItem> change)
    {
        var copy = new SupportCatalogueItem
        {
            Id = row.Id, ActivityGroupId = row.ActivityGroupId, ItemNumber = row.ItemNumber, Description = row.Description, Unit = row.Unit, DayType = row.DayType,
            IsIntensive = row.IsIntensive, CatalogueVersion = row.CatalogueVersion, EffectiveFrom = row.EffectiveFrom, EffectiveTo = row.EffectiveTo, IsActive = row.IsActive,
            RegistrationGroup = row.RegistrationGroup, SupportCategoryNumber = row.SupportCategoryNumber, PaceSupportCategoryNumber = row.PaceSupportCategoryNumber,
            CatalogueType = row.CatalogueType, ProviderTravel = row.ProviderTravel, ShortNoticeCancellation = row.ShortNoticeCancellation,
            PriceNational = row.PriceNational, PriceRemote = row.PriceRemote, PriceVeryRemote = row.PriceVeryRemote,
        };
        change(copy);
        return copy;
    }
}
