using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The companion lines of a support (NDIS-CODES 11.2 step 7): provider travel (time capped by zone, and kilometres), activity-based transport,
/// centre capital cost and short-term accommodation nights. Travel time and the per-kilometre rates are the 2025-26 rules and are flagged provisional.
/// </summary>
public class PlanPricingCompanionTests
{
    private static PlanBlock Community(Func<PlanBlock, PlanBlock>? change = null) =>
        Block("c", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), change);

    private static PlanBlock WithTravel(PlanBlock block, int minutes, bool back = true, int sharing = 1, decimal km = 0m, int? mm = 2, PriceZone zone = PriceZone.National) =>
        block with
        {
            Location = new PlanLocation { State = "NSW", Zone = zone, Mm = mm },
            Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = minutes, ReturnToBase = back, ParticipantsSharing = sharing, KmEachWay = km },
        };

    private static PlannedLine TravelTime(PlanQuote quote) => Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);

    // ── Provider travel time ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(25, true, 2, PriceZone.National, 0.8333, 61.31)]    // MM1-3, 25 + 25 = 50 minutes, both legs under the 30-minute cap
    [InlineData(35, true, 2, PriceZone.National, 1.0, 73.58)]       // 35 capped to 30 each way: 60 minutes
    [InlineData(35, false, 2, PriceZone.National, 0.5, 36.79)]      // one way only: 30 minutes
    [InlineData(90, true, 4, PriceZone.National, 2.0, 147.16)]      // MM4-5: capped at 60 each way, 120 minutes
    [InlineData(90, true, 5, PriceZone.National, 2.0, 147.16)]
    [InlineData(90, true, null, PriceZone.National, 1.0, 73.58)]    // National with no level given is read as MM1-3, the stricter cap
    [InlineData(90, true, 6, PriceZone.Remote, 3.0, 309.03)]        // MM6: no cap, 180 minutes at the remote rate 103.01
    [InlineData(90, true, 7, PriceZone.VeryRemote, 3.0, 331.11)]    // MM7: no cap, at 110.37
    public void Travel_time_is_capped_by_zone_each_way_and_priced_at_the_rate_of_the_support_item(
        int minutes, bool back, int? mm, PriceZone zone, double hours, double total)
    {
        var quote = QuoteOne(WithTravel(Community(), minutes, back, mm: mm, zone: zone), Mon12Oct);

        var travel = TravelTime(quote);
        Assert.Equal("04_104_0125_6_1", travel.ItemCode);
        Assert.Equal(((decimal)Math.Round(hours, 4), (decimal)total, "H"), (travel.Qty, travel.Total, travel.Unit));
        Assert.Equal(PaceCategoryOf(quote), travel.PaceCategory);
    }

    private static int? PaceCategoryOf(PlanQuote quote) => quote.Lines.First(l => l.Kind == PlannedLineKind.Support).PaceCategory;

    [Fact]
    public void Several_participants_on_one_trip_divide_the_travel_time_and_the_item_rate_is_not_divided()
    {
        var quote = QuoteOne(WithTravel(Community(b => b with { ParticipantsPresent = 3 }), 25, sharing: 3), Mon12Oct);

        var travel = TravelTime(quote);
        Assert.Equal((0.2778m, 73.58m, 20.43m), (travel.Qty, travel.UnitPrice, travel.Total));   // 50 minutes / 3 at $73.58 an hour, floored
        Assert.Contains(5, travel.Trace.OpenQuestions);
    }

    [Fact]
    public void Travel_is_provisional_and_names_the_open_question_while_the_rates_are_2025_26_values()
    {
        var provisional = TravelTime(QuoteOne(WithTravel(Community(), 25), Mon12Oct));
        var confirmed = TravelTime(QuoteOne(WithTravel(Community(), 25), Mon12Oct, PlanPricingPolicy.Default with { TravelRatesProvisional = false }));

        Assert.True(provisional.Provisional);
        Assert.Equal(new[] { 6 }, provisional.Trace.OpenQuestions);
        Assert.False(confirmed.Provisional);
        Assert.Empty(confirmed.Trace.OpenQuestions);
    }

    [Fact]
    public void No_travel_line_when_the_provider_does_not_claim_travel_or_the_block_does_not_ask_for_it()
    {
        var block = WithTravel(Community(), 25);

        Assert.DoesNotContain(QuoteOne(block, Mon12Oct, PlanPricingPolicy.Default with { ClaimProviderTravel = false }).Lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.DoesNotContain(QuoteOne(block with { Travel = block.Travel! with { Claim = false } }, Mon12Oct).Lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.DoesNotContain(QuoteOne(Community(), Mon12Oct).Lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.Equal(294.32m, QuoteOne(Community(), Mon12Oct).Totals.Amount);
    }

    [Fact]
    public void An_item_whose_flag_does_not_allow_provider_travel_gets_no_travel_line_and_an_issue()
    {
        var rows = RealCatalogue.Select(r => r.ItemNumber == "04_104_0125_6_1" ? With(r, x => x.ProviderTravel = CatalogueClaimFlag.No) : r).ToList();

        var quote = Quote(new[] { WithTravel(Community(), 25) }, Mon12Oct, Mon12Oct, catalogue: rows);

        Assert.DoesNotContain(quote.Lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.Equal(PlanFailureReason.TravelNotClaimable, Assert.Single(quote.Issues).Reason);
    }

    [Fact]
    public void Travel_on_a_holiday_is_priced_at_the_holiday_item_and_carries_its_review_flag()
    {
        var quote = QuoteOne(WithTravel(Community(), 25), Mon5Oct, holidays: new[] { NswLabourDay });

        var travel = TravelTime(quote);
        Assert.Equal(("04_102_0125_6_1", 163.46m), (travel.ItemCode, travel.UnitPrice));
        Assert.True(travel.Review);
        Assert.True(travel.HolidayExposure);
    }

    // ── Provider travel kilometres ────────────────────────────────────────────────

    [Theory]
    [InlineData(PlanSupportType.PersonalCare, SupportIntensity.Standard, "01_799_0107_1_1", 1)]
    [InlineData(PlanSupportType.PersonalCare, SupportIntensity.HighIntensity, "01_799_0104_1_1", 1)]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Standard, "04_799_0125_6_1", 4)]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.HighIntensity, "04_799_0104_6_1", 4)]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.Standard, "04_799_0136_6_1", 4)]
    [InlineData(PlanSupportType.StaSupport, SupportIntensity.Standard, "01_799_0115_1_1", 16)]
    public void Provider_travel_kilometres_go_on_the_non_labour_item_of_the_support_s_registration_group(PlanSupportType type, SupportIntensity intensity, string code, int category)
    {
        var block = WithTravel(Block("k", type, DayOfWeek.Monday, T(9), T(13), b => b with { Intensity = intensity }), 0, km: 10m);

        var quote = QuoteOne(block, Mon12Oct);

        // No minutes were given, so there is no time line; 10 km each way and back at $0.99 is $19.80, in dollars at $1.00.
        Assert.DoesNotContain(quote.Lines, l => l.Kind == PlannedLineKind.ProviderTravelTime);
        var km = Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.ProviderTravelCosts);
        Assert.Equal((code, 19.80m, 1.00m, 19.80m), Row(km));
        Assert.Equal((category, "E", true), (km.PaceCategory, km.Unit, km.Provisional));
    }

    [Fact]
    public void Kilometres_are_one_way_without_a_return_leg_shared_by_the_trip_and_use_the_providers_rate()
    {
        var oneWay = QuoteOne(WithTravel(Community(), 0, back: false, km: 10m), Mon12Oct).Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelCosts);
        var shared = QuoteOne(WithTravel(Community(b => b with { ParticipantsPresent = 3 }), 0, sharing: 3, km: 10m), Mon12Oct).Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelCosts);
        var own = QuoteOne(WithTravel(Community(), 0, km: 10m), Mon12Oct, PlanPricingPolicy.Default with { KmRateStandard = 1.10m }).Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelCosts);

        Assert.Equal(9.90m, oneWay.Total);
        Assert.Equal(6.60m, shared.Total);     // 19.80 / 3
        Assert.Equal(22.00m, own.Total);
    }

    // ── Activity-based transport ──────────────────────────────────────────────────

    [Theory]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Standard, "04_590_0125_6_1")]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.HighIntensity, "04_592_0104_6_1")]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.Standard, "04_591_0136_6_1")]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.HighIntensity, "04_592_0104_6_1")]
    public void Activity_based_transport_is_the_item_of_the_support_s_registration_group(PlanSupportType type, SupportIntensity intensity, string code)
    {
        var block = Block("t", type, DayOfWeek.Monday, T(9), T(13), b => b with
        {
            Intensity = intensity, Transport = new PlanActivityTransport { Km = 20m },
        });

        var transport = Assert.Single(QuoteOne(block, Mon12Oct).Lines, l => l.Kind == PlannedLineKind.ActivityTransport);

        Assert.Equal((code, 19.80m, 1.00m, 19.80m), Row(transport));
        Assert.Equal(4, transport.PaceCategory);
    }

    [Fact]
    public void Tolls_and_parking_alone_are_at_cost_and_not_provisional_and_a_share_is_floored_to_the_cent()
    {
        var tolls = Community(b => b with { Transport = new PlanActivityTransport { Tolls = 12.50m, Parking = 6m } });
        var shared = Community(b => b with { ParticipantsPresent = 3, Transport = new PlanActivityTransport { Km = 10m, Tolls = 1m, ParticipantsSharing = 3 } });

        var costs = QuoteOne(tolls, Mon12Oct).Lines.Single(l => l.Kind == PlannedLineKind.ActivityTransport);
        var third = QuoteOne(shared, Mon12Oct).Lines.Single(l => l.Kind == PlannedLineKind.ActivityTransport);

        Assert.Equal((18.50m, PlannedLineFlags.None), (costs.Total, costs.Flags));
        Assert.Equal(3.63m, third.Total);   // (9.90 + 1.00) / 3 = 3.6333, floored
        Assert.True(third.Provisional);
    }

    [Fact]
    public void A_transport_block_with_nothing_to_claim_has_no_transport_line()
    {
        Assert.DoesNotContain(QuoteOne(Community(b => b with { Transport = new PlanActivityTransport() }), Mon12Oct).Lines, l => l.Kind == PlannedLineKind.ActivityTransport);
    }

    [Theory]
    [InlineData(PlanSupportType.PersonalCare)]
    [InlineData(PlanSupportType.StaSupport)]
    public void Activity_based_transport_only_goes_with_community_and_group_supports(PlanSupportType type)
    {
        var block = Block("t", type, DayOfWeek.Monday, T(9), T(13), b => b with { Transport = new PlanActivityTransport { Km = 20m } });

        var quote = QuoteOne(block, Mon12Oct);

        Assert.DoesNotContain(quote.Lines, l => l.Kind == PlannedLineKind.ActivityTransport);
        Assert.Equal(PlanFailureReason.TransportNotAvailable, Assert.Single(quote.Issues).Reason);
    }

    // ── Centre capital cost ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.Standard, "04_599_0136_6_1")]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.HighIntensity, "04_599_0104_6_1")]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Standard, "04_599_0136_6_1")]
    public void A_centre_adds_centre_capital_per_participant_per_hour_and_it_is_not_divided_by_the_group(PlanSupportType type, SupportIntensity intensity, string code)
    {
        var block = Block("cc", type, DayOfWeek.Saturday, T(9), T(15), b => b with { Setting = PlanSetting.Centre, Intensity = intensity, ParticipantsPresent = 3 });

        var line = Assert.Single(QuoteOne(block, Sat17Oct).Lines, l => l.Kind == PlannedLineKind.CentreCapital);

        Assert.Equal((code, 6m, 2.71m, 16.26m), Row(line));   // 6 hours at $2.71, whatever the ratio
        Assert.Equal((4, "H"), (line.PaceCategory, line.Unit));
    }

    [Theory]
    [InlineData(PlanSetting.Community)]
    [InlineData(PlanSetting.AtHome)]
    [InlineData(PlanSetting.Accommodation)]
    public void No_centre_capital_unless_the_setting_is_a_centre(PlanSetting setting)
    {
        var block = Block("cc", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { Setting = setting });

        Assert.DoesNotContain(QuoteOne(block, Sat17Oct).Lines, l => l.Kind == PlannedLineKind.CentreCapital);
    }

    [Theory]
    [InlineData(PlanSupportType.PersonalCare)]
    [InlineData(PlanSupportType.StaSupport)]
    public void Personal_care_and_STA_in_a_centre_have_no_centre_capital(PlanSupportType type)
    {
        var block = Block("cc", type, DayOfWeek.Monday, T(9), T(13), b => b with { Setting = PlanSetting.Centre });

        Assert.DoesNotContain(QuoteOne(block, Mon12Oct).Lines, l => l.Kind == PlannedLineKind.CentreCapital);
    }

    [Fact]
    public void Centre_capital_counts_the_hours_of_the_whole_block_across_bands()
    {
        var block = Block("cc", PlanSupportType.GroupActivity, DayOfWeek.Monday, T(18), T(22), b => b with { Setting = PlanSetting.Centre });

        var line = Assert.Single(QuoteOne(block, Mon12Oct).Lines, l => l.Kind == PlannedLineKind.CentreCapital);

        Assert.Equal((4m, 10.84m), (line.Qty, line.Total));
    }

    // ── Short-term accommodation nights ───────────────────────────────────────────

    private static PlanBlock Sta(Func<PlanBlock, PlanBlock>? change = null) =>
        Block("sta", PlanSupportType.StaSupport, DayOfWeek.Friday, T(17), T(9), b => (change is null ? b : change(b)) with { Setting = PlanSetting.Accommodation });

    [Fact]
    public void Accommodation_nights_are_the_STA_participant_item_a_day_each_and_never_divided()
    {
        var block = Sta(b => b with { Accommodation = new PlanAccommodation { Nights = 2 }, ParticipantsPresent = 3 });

        var line = Assert.Single(QuoteOne(block, Fri16Oct).Lines, l => l.Kind == PlannedLineKind.ParticipantAccommodation);

        Assert.Equal(("01_250_0115_1_1", 2m, 162.85m, 325.70m), Row(line));
        Assert.Equal(("D", 1), (line.Unit, line.PaceCategory));
        Assert.Equal(PlannedLineFlags.None, line.Flags);
    }

    [Fact]
    public void A_support_worker_who_must_stay_adds_the_worker_item_shared_by_the_participants_and_flagged_as_unconfirmed()
    {
        var alone = Sta(b => b with { Accommodation = new PlanAccommodation { Nights = 1, WorkerOnSite = true } });
        var group = Sta(b => b with { Accommodation = new PlanAccommodation { Nights = 2, WorkerOnSite = true }, ParticipantsPresent = 3 });

        var one = QuoteOne(alone, Fri16Oct).Lines.Single(l => l.Kind == PlannedLineKind.WorkerAccommodation);
        var shared = QuoteOne(group, Fri16Oct).Lines.Single(l => l.Kind == PlannedLineKind.WorkerAccommodation);

        Assert.Equal(("01_251_0115_1_1", 1m, 162.85m, 162.85m), Row(one));
        Assert.Equal(PlannedLineFlags.None, one.Flags);
        Assert.Equal(("01_251_0115_1_1", 2m, 54.28m, 108.56m), Row(shared));   // floor(162.85 / 3) = 54.28 a night
        Assert.True(shared.Provisional);
        Assert.Contains(5, shared.Trace.OpenQuestions);
    }

    [Fact]
    public void A_whole_STA_stay_is_the_hourly_items_the_sleepover_and_the_nights_all_in_the_daily_life_category()
    {
        var block = Sta(b => b with
        {
            WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(22), To = T(6) },
            Accommodation = new PlanAccommodation { Nights = 1, WorkerOnSite = true },
        });

        var quote = QuoteOne(block, Fri16Oct);

        Assert.Equal(new[]
        {
            ("01_200_0115_1_1", 3m, 73.58m, 220.74m),
            ("01_201_0115_1_1", 2m, 81.07m, 162.14m),
            ("01_206_0115_1_1", 1m, 311.79m, 311.79m),
            ("01_202_0115_1_1", 3m, 103.54m, 310.62m),
            ("01_250_0115_1_1", 1m, 162.85m, 162.85m),
            ("01_251_0115_1_1", 1m, 162.85m, 162.85m),
        }, quote.Lines.Select(Row));
        Assert.Equal(1330.99m, quote.Totals.Amount);
        var category = Assert.Single(quote.Totals.ByCategory);
        Assert.Equal((1, "Assistance with Daily Life", 8m), (category.PaceCategory, category.Name, category.Hours));
    }

    [Fact]
    public void A_short_term_accommodation_weekday_night_has_its_own_item_unlike_community_access()
    {
        var block = Block("sta-night", PlanSupportType.StaSupport, DayOfWeek.Monday, T(22), T(2));

        var quote = QuoteOne(block, Mon12Oct);

        Assert.Equal(new[] { ("01_201_0115_1_1", 2m, 81.07m, 162.14m), ("01_205_0115_1_1", 2m, 82.57m, 165.14m) }, quote.Lines.Select(Row));
        Assert.Empty(quote.Issues);
    }

    [Fact]
    public void Provider_travel_kilometres_on_an_STA_block_are_in_the_home_and_living_category()
    {
        var block = WithTravel(Block("sta-km", PlanSupportType.StaSupport, DayOfWeek.Monday, T(9), T(13)), 0, km: 10m);

        var quote = QuoteOne(block, Mon12Oct);

        Assert.Equal(new[] { 1, 16 }, quote.Totals.ByCategory.Select(c => c.PaceCategory));
    }

    [Fact]
    public void Accommodation_on_a_block_that_is_not_short_term_accommodation_is_refused_with_the_reason()
    {
        var block = Block("nights", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(17), T(9), b => b with { Accommodation = new PlanAccommodation { Nights = 1 } });

        var quote = QuoteOne(block, Fri16Oct);

        Assert.DoesNotContain(quote.Lines, l => l.Kind is PlannedLineKind.ParticipantAccommodation or PlannedLineKind.WorkerAccommodation);
        Assert.Equal(PlanFailureReason.AccommodationNotAvailable, Assert.Single(quote.Issues).Reason);
    }

    // ── Review M7: a trip is shared by the participants present unless the plan says otherwise ──

    private static PlanBlock GroupDayOut(Func<PlanBlock, PlanBlock>? change = null) =>
        Block("g", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b =>
        {
            b = b with
            {
                ParticipantsPresent = 3,
                Location = new PlanLocation { State = "NSW", Zone = PriceZone.National, Mm = 2 },
                Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 35, ReturnToBase = true, KmEachWay = 12m },
                Transport = new PlanActivityTransport { Km = 40m },
            };
            return change is null ? b : change(b);
        });

    [Fact]
    public void A_group_trip_with_no_sharing_given_is_shared_by_every_participant_present_not_charged_in_full_to_each_plan()
    {
        // Saturday 1:3, 35 minutes each way (capped to 30) and back, 12 km each way, 40 km of activity transport, sharing left out. It used to default to 1, so each of the
        // three participants' plans carried the whole trip: 3 x 103.54 of travel time and 3 x 39.60 of transport against the one trip NDIS-CODES 6 and 7 allow.
        var left = QuoteOne(GroupDayOut(), Sat17Oct);
        var three = QuoteOne(GroupDayOut(b => b with { Travel = b.Travel! with { ParticipantsSharing = 3 }, Transport = b.Transport! with { ParticipantsSharing = 3 } }), Sat17Oct);

        var time = left.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime);
        var km = left.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelCosts);
        var vehicle = left.Lines.Single(l => l.Kind == PlannedLineKind.ActivityTransport);
        Assert.Equal(("H", 0.3333m, 103.54m, 34.51m), (time.Unit, time.Qty, time.UnitPrice, time.Total));   // 60 minutes / 3 at the Saturday rate
        Assert.Equal(7.92m, km.Total);                                                                          // 12 km x 2 x 0.99 = 23.76, a third each
        Assert.Equal(13.20m, vehicle.Total);                                                                    // 39.60, a third each
        Assert.Equal(Json(three.Lines), Json(left.Lines));                                                      // the same as saying 3
        Assert.Contains(5, time.Trace.OpenQuestions);                                                           // the group travel-time basis is still an open question
    }

    [Fact]
    public void Saying_that_one_participant_takes_the_whole_trip_is_still_possible()
    {
        var quote = QuoteOne(GroupDayOut(b => b with { Travel = b.Travel! with { ParticipantsSharing = 1 }, Transport = b.Transport! with { ParticipantsSharing = 1 } }), Sat17Oct);

        Assert.Equal(103.54m, quote.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime).Total);
        Assert.Equal(23.76m, quote.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelCosts).Total);
        Assert.Equal(39.60m, quote.Lines.Single(l => l.Kind == PlannedLineKind.ActivityTransport).Total);
    }

    [Fact]
    public void A_trip_shared_by_more_participants_than_are_present_is_refused_as_invalid_input()
    {
        var quote = QuoteOne(GroupDayOut(b => b with { Travel = b.Travel! with { ParticipantsSharing = 4 } }), Sat17Oct);

        Assert.Equal(PlanFailureReason.InvalidInput, Assert.Single(quote.Issues).Reason);
        Assert.Empty(quote.Lines.Where(l => l.IsPriced));
    }

    private static SupportCatalogueItem With(SupportCatalogueItem row, Action<SupportCatalogueItem> change)
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
