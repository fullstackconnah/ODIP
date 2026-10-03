using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The golden tests of the plan builder pricing engine: every worked edge case of NDIS-CODES 11.2 (examples 1 to 11), with the dollar amounts the
/// research computes from the 2026-27 national prices, priced here from the real 2026-27 workbook (imported by the real importer). A comment on each
/// test names the example it pins. The brief's own example is pinned last.
/// Codes: ASC standard 01_011 / 01_015 / 01_002 / 01_013 / 01_014 / 01_012 (weekday, evening, night, Saturday, Sunday, public holiday), sleepover
/// 01_010; community access 04_104 / 04_103 / - / 04_105 / 04_106 / 04_102 (RG 0125); group activities 04_102 / 04_103 / - / 04_104 / 04_105 /
/// 04_106 (RG 0136).
/// </summary>
public class PlanPricingGoldenTests
{
    private const string AscWeekday = "01_011_0107_1_1", AscEvening = "01_015_0107_1_1", AscNight = "01_002_0107_1_1",
        AscSaturday = "01_013_0107_1_1", AscSunday = "01_014_0107_1_1", AscSleepover = "01_010_0107_1_1";

    // ── Example 1: a block crossing 20:00 ─────────────────────────────────────────

    [Fact]
    public void Example_1_Mon_18_00_to_22_00_one_worker_is_309_30_split_and_324_28_higher_of()
    {
        var block = Block("e1", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(18), T(22));

        var split = QuoteOne(block, Mon12Oct, SplitPolicy);
        var higher = QuoteOne(block, Mon12Oct, HigherOfPolicy);

        Assert.Equal(new[] { (AscWeekday, 2m, 73.58m, 147.16m), (AscEvening, 2m, 81.07m, 162.14m) }, split.Lines.Select(Row));
        Assert.Equal(309.30m, split.Totals.Amount);
        Assert.Equal(new[] { (AscEvening, 4m, 81.07m, 324.28m) }, higher.Lines.Select(Row));
        Assert.Equal(324.28m, higher.Totals.Amount);
        Assert.All(split.Lines, l => Assert.Equal("A", l.Trace.Policy));
        Assert.All(higher.Lines, l => Assert.Equal("B", l.Trace.Policy));
        Assert.False(split.NeedsReview);
        Assert.False(higher.NeedsReview);
    }

    // ── Example 2: crossing midnight, weekday to weekday ──────────────────────────

    [Fact]
    public void Example_2_Mon_22_00_to_Tue_02_00_is_327_28_split_and_330_28_higher_of()
    {
        var block = Block("e2", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(2));

        var split = QuoteOne(block, Mon12Oct, SplitPolicy);
        var higher = QuoteOne(block, Mon12Oct, HigherOfPolicy);

        Assert.Equal(new[] { (AscEvening, 2m, 81.07m, 162.14m), (AscNight, 2m, 82.57m, 165.14m) }, split.Lines.Select(Row));
        Assert.Equal(327.28m, split.Totals.Amount);
        Assert.Equal(new[] { (AscNight, 4m, 82.57m, 330.28m) }, higher.Lines.Select(Row));
        Assert.Equal(330.28m, higher.Totals.Amount);
        // The second part is on the Tuesday: its service date is the day it falls on.
        Assert.Equal(new[] { Mon12Oct, Mon12Oct.AddDays(1) }, split.Lines.Select(l => l.ServiceDate));
    }

    // ── Example 3: crossing into a weekend ────────────────────────────────────────

    [Fact]
    public void Example_3_Fri_22_00_to_Sat_02_00_is_369_22_split_and_414_16_higher_of()
    {
        var block = Block("e3a", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(2));

        var split = QuoteOne(block, Fri16Oct, SplitPolicy);
        var higher = QuoteOne(block, Fri16Oct, HigherOfPolicy);

        Assert.Equal(new[] { (AscEvening, 2m, 81.07m, 162.14m), (AscSaturday, 2m, 103.54m, 207.08m) }, split.Lines.Select(Row));
        Assert.Equal(369.22m, split.Totals.Amount);
        Assert.Equal(new[] { (AscSaturday, 4m, 103.54m, 414.16m) }, higher.Lines.Select(Row));
        Assert.Equal(414.16m, higher.Totals.Amount);
    }

    [Fact]
    public void Example_3_Sat_22_00_to_Sun_02_00_is_474_08_split_and_534_00_higher_of()
    {
        var block = Block("e3b", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(2));

        var split = QuoteOne(block, Sat17Oct, SplitPolicy);
        var higher = QuoteOne(block, Sat17Oct, HigherOfPolicy);

        Assert.Equal(new[] { (AscSaturday, 2m, 103.54m, 207.08m), (AscSunday, 2m, 133.50m, 267.00m) }, split.Lines.Select(Row));
        Assert.Equal(474.08m, split.Totals.Amount);
        Assert.Equal(new[] { (AscSunday, 4m, 133.50m, 534.00m) }, higher.Lines.Select(Row));
        Assert.Equal(534.00m, higher.Totals.Amount);
    }

    // ── Example 4: community or group block crossing midnight on a weekday ────────

    [Theory]
    [InlineData(PlanSupportType.CommunityAccess, "04_103_0125_6_1", 81.07, 162.14)]
    [InlineData(PlanSupportType.GroupActivity, "04_103_0136_6_1", 81.07, 162.14)]
    public void Example_4_a_weekday_community_or_group_block_crossing_midnight_has_no_night_item_and_is_flagged_Review_not_mapped_elsewhere(
        PlanSupportType type, string eveningCode, double evening, double eveningTotal)
    {
        var block = Block("e4", type, DayOfWeek.Monday, T(22), T(2));

        foreach (var policy in new[] { SplitPolicy, HigherOfPolicy })
        {
            var quote = QuoteOne(block, Mon12Oct, policy);

            // The part that has an item is priced; the part that has none is a line with no code, no price and the Review flag.
            var priced = Assert.Single(Priced(quote));
            Assert.Equal((eveningCode, 2m, (decimal)evening, (decimal)eveningTotal), Row(priced));
            var night = Assert.Single(quote.Lines, l => !l.IsPriced);
            Assert.Null(night.ItemCode);
            Assert.Equal(PlanFailureReason.NoItem, night.Unpriced);
            Assert.True(night.Review);
            Assert.Equal((2m, 0m, 0m, ClaimDayType.WeekdayNight), (night.Qty, night.UnitPrice, night.Total, night.DayType));
            Assert.Equal(Mon12Oct.AddDays(1), night.ServiceDate);
            Assert.Equal(new TimeOnly[] { T(0), T(2) }, new[] { night.StartTime!.Value, night.EndTime!.Value });

            // Never another family: every code the quote holds is in the block's own family and registration group.
            var group = type == PlanSupportType.CommunityAccess ? "_0125_6_1" : "_0136_6_1";
            Assert.All(quote.Lines.Where(l => l.ItemCode is not null), l => Assert.EndsWith(group, l.ItemCode));
            Assert.Equal(162.14m, quote.Totals.Amount);
            var issue = Assert.Single(quote.Issues);
            Assert.Equal((PlanFailureReason.NoItem, "e4"), (issue.Reason, issue.BlockId));
            Assert.True(quote.NeedsReview);
        }
    }

    [Fact]
    public void Example_4_a_community_block_that_starts_before_06_00_on_a_weekday_has_the_same_gap()
    {
        var block = Block("e4b", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(4), T(8));

        var quote = QuoteOne(block, Mon12Oct);

        Assert.Equal(new[] { ("04_104_0125_6_1", 2m, 73.58m, 147.16m) }, quote.Lines.Where(l => l.IsPriced).Select(Row));
        Assert.Equal(PlanFailureReason.NoItem, Assert.Single(quote.Lines, l => !l.IsPriced).Unpriced);
    }

    // ── Example 5: a public holiday on a recurring Monday ─────────────────────────

    [Fact]
    public void Example_5_Mon_5_Oct_2026_is_a_NSW_holiday_so_4_hours_cost_653_84_not_294_32_and_it_is_flagged_for_review()
    {
        var block = Block("e5", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var quote = QuoteOne(block, Mon5Oct, holidays: new[] { NswLabourDay });

        var line = Assert.Single(quote.Lines);
        Assert.Equal(("04_102_0125_6_1", 4m, 163.46m, 653.84m), Row(line));
        Assert.Equal(PlannedLineFlags.Review | PlannedLineFlags.HolidayExposure, line.Flags);
        Assert.Equal("Labour Day", line.Trace.HolidayName);
        Assert.Equal(ClaimDayType.PublicHoliday, line.DayType);

        // The exposure is named, with what the same support costs on an ordinary day: +122%.
        var holiday = Assert.Single(quote.HolidayOccurrences);
        Assert.Equal(("e5", Mon5Oct, "Labour Day", "NSW", HolidayDecision.Review, false), (holiday.BlockId, holiday.Date, holiday.HolidayName, holiday.State, holiday.Decision, holiday.Skipped));
        Assert.Equal((653.84m, 294.32m, 359.52m), (holiday.AtHolidayRates, holiday.AtOrdinaryRates, holiday.Uplift));
        Assert.Equal((1, 359.52m), (quote.Totals.HolidayOccurrences, quote.Totals.HolidayUplift));
        Assert.True(quote.NeedsReview);
    }

    [Fact]
    public void Example_5_the_same_Monday_in_VIC_is_not_a_holiday_and_costs_294_32_with_nothing_to_review()
    {
        var block = Block("e5v", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Location = new PlanLocation { State = "VIC" } });

        var quote = QuoteOne(block, Mon5Oct, holidays: new[] { NswLabourDay });

        Assert.Equal(("04_104_0125_6_1", 4m, 73.58m, 294.32m), Row(Assert.Single(quote.Lines)));
        Assert.Equal(PlannedLineFlags.None, quote.Lines[0].Flags);
        Assert.Empty(quote.HolidayOccurrences);
        Assert.False(quote.NeedsReview);
    }

    [Fact]
    public void Example_5_the_holiday_decision_is_Review_by_default_Charge_clears_the_review_and_Skip_drops_the_occurrence()
    {
        var review = Block("e5r", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));
        var charge = review with { Id = "e5c", OnPublicHoliday = HolidayDecision.Charge };
        var skip = review with { Id = "e5s", OnPublicHoliday = HolidayDecision.Skip };
        Assert.Equal(HolidayDecision.Review, review.OnPublicHoliday);

        var quote = Quote(new[] { review, charge, skip }, Mon5Oct, Mon5Oct, holidays: new[] { NswLabourDay });

        var byBlock = quote.Lines.ToLookup(l => l.BlockId);
        Assert.Equal(PlannedLineFlags.Review | PlannedLineFlags.HolidayExposure, byBlock["e5r"].Single().Flags);
        Assert.Equal(PlannedLineFlags.HolidayExposure, byBlock["e5c"].Single().Flags);
        Assert.Equal(653.84m, byBlock["e5c"].Single().Total);
        Assert.Empty(byBlock["e5s"]);
        var skipped = Assert.Single(quote.HolidayOccurrences, h => h.BlockId == "e5s");
        Assert.True(skipped.Skipped);
        Assert.Null(skipped.AtHolidayRates);
        Assert.Equal(653.84m * 2, quote.Totals.Amount);
        Assert.Equal(3, quote.Totals.HolidayOccurrences);
    }

    // ── Example 6: an overnight stay with a sleepover ─────────────────────────────

    private static PlanBlock Overnight(Func<PlanBlock, PlanBlock>? change = null)
    {
        var block = Block("e6", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(17), T(9), b => b with
        {
            WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(22), To = T(6) },
        });
        return change is null ? block : change(block);
    }

    [Fact]
    public void Example_6_Fri_17_00_to_Sat_09_00_with_a_sleepover_22_00_to_06_00_is_1005_29()
    {
        var quote = QuoteOne(Overnight(), Fri16Oct, SplitPolicy);

        Assert.Equal(new[]
        {
            (AscWeekday, 3m, 73.58m, 220.74m),        // 17:00-20:00 Friday daytime
            (AscEvening, 2m, 81.07m, 162.14m),        // 20:00-22:00 Friday evening
            (AscSleepover, 1m, 311.79m, 311.79m),     // 22:00-06:00, one Each
            (AscSaturday, 3m, 103.54m, 310.62m),      // 06:00-09:00 Saturday
        }, quote.Lines.Select(Row));
        Assert.Equal(1005.29m, quote.Totals.Amount);

        var sleepover = quote.Lines[2];
        Assert.Equal((PlannedLineKind.Sleepover, "E"), (sleepover.Kind, sleepover.Unit));
        Assert.Equal((Fri16Oct, T(22), Sat17Oct, T(6)), (sleepover.ServiceDate, sleepover.StartTime!.Value, sleepover.EndDate!.Value, sleepover.EndTime!.Value));
        Assert.Equal(PlannedLineKind.Support, quote.Lines[0].Kind);
        Assert.False(quote.NeedsReview);
    }

    [Fact]
    public void Example_6_active_hours_beyond_two_inside_the_sleepover_are_extra_hourly_lines_at_the_Saturday_rate_on_a_weekday()
    {
        var quote = QuoteOne(Overnight(b => b with { SleepoverActiveHours = 4m }), Fri16Oct, SplitPolicy);

        var extra = Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);
        Assert.Equal((AscSaturday, 2m, 103.54m, 207.08m), Row(extra));
        Assert.Equal(1005.29m + 207.08m, quote.Totals.Amount);
        // Two active hours or fewer are inside the sleepover item.
        Assert.DoesNotContain(QuoteOne(Overnight(b => b with { SleepoverActiveHours = 2m }), Fri16Oct).Lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);
    }

    [Fact]
    public void Example_6_policy_B_is_never_applied_across_a_sleepover_each_active_part_is_its_own_support()
    {
        var quote = QuoteOne(Overnight(), Fri16Oct, HigherOfPolicy);

        Assert.Equal(new[]
        {
            (AscEvening, 5m, 81.07m, 405.35m),        // 17:00-22:00 is one support: the higher of daytime and evening
            (AscSleepover, 1m, 311.79m, 311.79m),
            (AscSaturday, 3m, 103.54m, 310.62m),
        }, quote.Lines.Select(Row));
        Assert.Equal(1027.76m, quote.Totals.Amount);
    }

    // ── Example 7: a group of three with a shared vehicle ─────────────────────────

    [Fact]
    public void Example_7_Sat_09_00_to_15_00_at_1_to_3_is_34_51_an_hour_207_06_for_each_participant_and_the_vehicle_is_shared()
    {
        var block = Block("e7", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3,
            Transport = new PlanActivityTransport { Km = 40m, Vehicle = VehicleKind.Standard, ParticipantsSharing = 3 },
        });

        var quote = QuoteOne(block, Sat17Oct);

        Assert.Equal(new[]
        {
            ("04_104_0136_6_1", 6m, 34.51m, 207.06m),   // floor(103.54 / 3) = 34.51; three participants make 621.18
            ("04_591_0136_6_1", 13.20m, 1.00m, 13.20m), // 40 km x $0.99 = $39.60, a third each, in dollars at $1.00
        }, quote.Lines.Select(Row));
        Assert.Equal(207.06m * 3, 621.18m);

        var vehicle = quote.Lines[1];
        Assert.Equal(PlannedLineKind.ActivityTransport, vehicle.Kind);
        Assert.True(vehicle.Provisional);          // 0.99 is the 2025-26 rate
        Assert.Contains(6, vehicle.Trace.OpenQuestions);
    }

    [Fact]
    public void Example_7_tolls_and_parking_are_added_at_cost_before_the_vehicle_cost_is_shared()
    {
        var block = Block("e7t", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3,
            Transport = new PlanActivityTransport { Km = 40m, Tolls = 12m, Parking = 9m, ParticipantsSharing = 3 },
        });

        var vehicle = QuoteOne(block, Sat17Oct).Lines.Single(l => l.Kind == PlannedLineKind.ActivityTransport);

        Assert.Equal(("04_591_0136_6_1", 20.20m, 1.00m, 20.20m), Row(vehicle));   // (39.60 + 12 + 9) / 3
    }

    [Fact]
    public void Example_7_an_accessible_vehicle_is_claimed_at_2_76_a_kilometre()
    {
        var block = Block("e7a", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3,
            Transport = new PlanActivityTransport { Km = 40m, Vehicle = VehicleKind.Accessible, ParticipantsSharing = 3 },
        });

        var vehicle = QuoteOne(block, Sat17Oct).Lines.Single(l => l.Kind == PlannedLineKind.ActivityTransport);

        Assert.Equal(("04_591_0136_6_1", 36.80m, 1.00m, 36.80m), Row(vehicle));   // 40 x 2.76 = 110.40, a third each
    }

    [Fact]
    public void Example_7_the_workers_commute_from_base_is_provider_travel_capped_at_30_minutes_a_leg_in_MM1_to_MM3()
    {
        var block = Block("e7p", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3,
            Location = new PlanLocation { State = "NSW", Zone = PriceZone.National, Mm = 2 },
            Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 35, ReturnToBase = true, ParticipantsSharing = 3 },
        });

        var travel = QuoteOne(block, Sat17Oct).Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime);

        // 35 minutes each way is capped to 30: 60 minutes in all, a third each: 20 minutes at the Saturday rate of the item, $103.54 an hour.
        Assert.Equal("04_104_0136_6_1", travel.ItemCode);
        Assert.Equal(("H", 0.3333m, 103.54m, 34.51m), (travel.Unit, travel.Qty, travel.UnitPrice, travel.Total));
        Assert.True(travel.Provisional);
        Assert.Contains(6, travel.Trace.OpenQuestions);
        Assert.Contains(5, travel.Trace.OpenQuestions);   // the rate basis for dividing travel time across a group is unclear
    }

    // ── Example 8: headcount changes mid-block ────────────────────────────────────

    [Fact]
    public void Example_8_a_participant_leaving_at_12_00_segments_the_block_at_34_51_and_then_51_77_an_hour()
    {
        var block = Block("e8", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3,
            HeadcountChanges = new[] { new PlanHeadcountChange { From = T(12), ParticipantsPresent = 2 } },
        });

        var quote = QuoteOne(block, Sat17Oct);

        Assert.Equal(new[]
        {
            ("04_104_0136_6_1", 3m, 34.51m, 103.53m),   // 09:00-12:00, N = 3: floor(103.54 / 3)
            ("04_104_0136_6_1", 3m, 51.77m, 155.31m),   // 12:00-15:00, N = 2: floor(103.54 / 2)
        }, quote.Lines.Select(Row));
        Assert.Equal(258.84m, quote.Totals.Amount);
        Assert.Equal(new[] { 3, 2 }, quote.Lines.Select(l => l.Trace.ParticipantsPresent));
        // The research marks this reading unconfirmed (NDIA, in writing): the lines say so instead of the engine guessing.
        Assert.All(quote.Lines, l => { Assert.True(l.Provisional); Assert.Contains(5, l.Trace.OpenQuestions); });
        Assert.Contains(quote.OpenQuestions, q => q.Number == 5);
    }

    // ── Example 9: a remote destination ───────────────────────────────────────────

    [Fact]
    public void Example_9_the_same_Saturday_group_item_at_MM6_is_144_96_and_48_32_an_hour_at_1_to_3_with_no_travel_time_cap()
    {
        var block = Block("e9", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3,
            Location = new PlanLocation { State = "WA", Zone = PriceZone.Remote, Mm = 6 },
            Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 90, ReturnToBase = true, ParticipantsSharing = 1 },
        });

        var quote = QuoteOne(block, Sat17Oct);

        var support = quote.Lines.Single(l => l.Kind == PlannedLineKind.Support);
        Assert.Equal(("04_104_0136_6_1", 6m, 48.32m, 289.92m), Row(support));
        Assert.Equal(144.96m, support.Trace.MaximumUnitPrice);
        Assert.Equal(PriceZone.Remote, support.Trace.Zone);
        // No cap in MM6-7: all 90 + 90 minutes are claimable (three hours at the item's remote rate).
        var travel = quote.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.Equal((3m, 144.96m, 434.88m), (travel.Qty, travel.UnitPrice, travel.Total));
        Assert.Contains("no-cap", string.Join(",", travel.Trace.Rules));
    }

    // ── Example 10: short-notice cancellation in a group ──────────────────────────

    [Fact]
    public void Example_10_a_group_participant_cancelling_inside_7_days_may_be_billed_the_planned_group_rate_and_the_others_are_billed_as_if_all_attended()
    {
        var block = Block("e10", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });
        var line = QuoteOne(block, Sat17Oct).Lines.Single();

        // Planned for three: 6 h at 34.51. A participant cancelling with 3 days' notice (under 7) may be billed up to 100% of that.
        Assert.Equal(("04_104_0136_6_1", 6m, 34.51m, 207.06m), Row(line));
        Assert.True(line.ShortNoticeCancellationAllowed);
        Assert.Equal(207.06m, PlanCancellation.MaximumClaim(line, noticeDays: 3));
        Assert.Equal(207.06m, PlanCancellation.MaximumClaim(line, noticeDays: 6));
        // 7 days or more is not short notice; a program of support is exempt.
        Assert.Equal(0m, PlanCancellation.MaximumClaim(line, noticeDays: 7));
        Assert.Equal(0m, PlanCancellation.MaximumClaim(line, noticeDays: 3, programOfSupport: true));

        // Everyone else keeps the planned group rate whoever cancelled: the engine never prices from who attends.
        var again = QuoteOne(block, Sat17Oct).Lines.Single();
        Assert.Equal(Json(line), Json(again));
    }

    // ── Example 11: a price change in the middle of the plan ──────────────────────

    [Fact]
    public async Task Example_11_a_plan_from_1_Oct_2026_to_30_Jun_2027_prices_each_occurrence_by_its_service_date_and_shows_the_price_basis()
    {
        var december = new DateOnly(2026, 12, 1);
        var catalogue = await WithDecemberPriceSetAsync(code => code == "04_104_0125_6_1");
        var block = Block("e11", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var quote = Quote(new[] { block }, new DateOnly(2026, 10, 1), new DateOnly(2027, 6, 30), catalogue: catalogue.ToList());

        var mondays = new List<DateOnly>();
        for (var d = new DateOnly(2026, 10, 1); d <= new DateOnly(2027, 6, 30); d = d.AddDays(1))
            if (d.DayOfWeek == DayOfWeek.Monday) mondays.Add(d);
        Assert.Equal(mondays, quote.Lines.Select(l => l.ServiceDate));
        foreach (var line in quote.Lines)
        {
            var early = line.ServiceDate < december;
            Assert.Equal(early ? 73.58m : 74.58m, line.UnitPrice);
            Assert.Equal(early ? new DateOnly(2026, 7, 1) : december, line.Trace.PriceBasisFrom);
            Assert.Equal(early ? "2026-27" : "2026-27 (2026-12-01)", line.Trace.CatalogueVersion);
            Assert.Equal(Math.Floor(line.UnitPrice * 4 * 100) / 100, line.Total);
        }

        Assert.Equal(9, quote.Lines.Count(l => l.ServiceDate < december));
        Assert.Equal(mondays.Count(m => m < december) * 294.32m + mondays.Count(m => m >= december) * 298.32m, quote.Totals.Amount);
    }

    [Fact]
    public void Example_11_a_re_quote_with_the_same_catalogue_and_inputs_is_identical()
    {
        var block = Block("e11b", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));

        var first = Quote(new[] { block }, new DateOnly(2026, 10, 1), new DateOnly(2027, 6, 30));
        var second = Quote(new[] { block }, new DateOnly(2026, 10, 1), new DateOnly(2027, 6, 30));

        Assert.Equal(Json(first), Json(second));
    }

    [Fact]
    public void Example_11_short_term_accommodation_hours_are_priced_with_the_hourly_items_across_the_end_of_the_legacy_per_day_items_on_30_Jun_2027()
    {
        var block = Block("e11s", PlanSupportType.StaSupport, DayOfWeek.Wednesday, T(9), T(13), b => b with { Setting = PlanSetting.Accommodation });

        var quote = Quote(new[] { block }, new DateOnly(2027, 6, 1), new DateOnly(2027, 7, 14));

        Assert.Equal(new[] { 2, 9, 16, 23, 30 }.Select(d => new DateOnly(2027, 6, d)).Concat(new[] { new DateOnly(2027, 7, 7), new DateOnly(2027, 7, 14) }), quote.Lines.Select(l => l.ServiceDate));
        Assert.All(quote.Lines, l => Assert.Equal(("01_200_0115_1_1", 4m, 73.58m, 294.32m), Row(l)));
    }

    // ── The brief's own example ───────────────────────────────────────────────────

    [Fact]
    public void The_brief_Mon_and_Wed_09_00_to_13_00_community_access_1_to_1_is_588_64_a_week_and_Sat_09_00_to_15_00_at_1_to_3_is_207_06_a_week()
    {
        var weekdays = new PlanBlock
        {
            Id = "mon-wed", SupportType = PlanSupportType.CommunityAccess, Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday },
            Start = T(9), End = T(13), Location = new PlanLocation { State = "NSW" },
        };
        var saturday = new PlanBlock
        {
            Id = "sat", SupportType = PlanSupportType.GroupActivity, Days = new[] { DayOfWeek.Saturday },
            Start = T(9), End = T(15), ParticipantsPresent = 3, Location = new PlanLocation { State = "NSW" },
        };

        var week = Quote(new[] { weekdays, saturday }, Mon12Oct, Sun18Oct);

        Assert.Equal(new[]
        {
            ("mon-wed", Mon12Oct, "04_104_0125_6_1", 4m, 73.58m, 294.32m),
            ("mon-wed", Mon12Oct.AddDays(2), "04_104_0125_6_1", 4m, 73.58m, 294.32m),
            ("sat", Sat17Oct, "04_104_0136_6_1", 6m, 34.51m, 207.06m),
        }, week.Lines.Select(l => (l.BlockId, l.ServiceDate, l.ItemCode!, l.Qty, l.UnitPrice, l.Total)));
        var totals = week.Totals.ByBlock.ToDictionary(b => b.BlockId);
        Assert.Equal((588.64m, 8m), (totals["mon-wed"].Amount, totals["mon-wed"].SupportHours));
        Assert.Equal((207.06m, 6m), (totals["sat"].Amount, totals["sat"].SupportHours));
        Assert.Equal((795.70m, 14m), (week.Totals.Amount, week.Totals.SupportHours));

        // Both are budget category 4, Assistance with Social, Economic and Community Participation.
        var category = Assert.Single(week.Totals.ByCategory);
        Assert.Equal((4, 795.70m, 14m), (category.PaceCategory, category.Amount, category.Hours));
        Assert.False(week.NeedsReview);
    }
}
