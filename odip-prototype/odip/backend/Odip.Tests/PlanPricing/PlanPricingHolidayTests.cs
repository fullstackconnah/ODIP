using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Public holidays in the engine (NDIS-CODES 5.3): the delivery state's calendar decides, a public holiday beats Saturday and Sunday, a part-day
/// holiday is the holiday rate only inside its hours, a block that meets a holiday is flagged for review until somebody decides Charge or Skip, and
/// the exposure (what the holiday adds over an ordinary day) is named.
/// </summary>
public class PlanPricingHolidayTests
{
    private static PlanBlock Community(Func<PlanBlock, PlanBlock>? change = null) =>
        Block("h", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), change);

    private static HolidayEntry Whole(DateOnly date, string? state, string name = "A holiday", string source = "Nager.Date feed") => new(date, state, name, null, null, source);

    // ── Whose calendar ────────────────────────────────────────────────────────────

    [Fact]
    public void A_national_holiday_applies_in_every_state()
    {
        foreach (var state in new[] { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" })
        {
            var quote = QuoteOne(Community(b => b with { Location = new PlanLocation { State = state } }), Mon12Oct, holidays: new[] { Whole(Mon12Oct, null, "Everywhere") });

            Assert.Equal(163.46m * 4, quote.Totals.Amount);
        }
    }

    [Fact]
    public void A_holiday_of_another_state_does_not_apply_and_the_state_is_matched_in_any_case()
    {
        var other = QuoteOne(Community(), Mon12Oct, holidays: new[] { Whole(Mon12Oct, "VIC") });
        var lower = QuoteOne(Community(b => b with { Location = new PlanLocation { State = "nsw" } }), Mon12Oct, holidays: new[] { Whole(Mon12Oct, "NSW") });

        Assert.Equal(294.32m, other.Totals.Amount);
        Assert.Equal(653.84m, lower.Totals.Amount);
    }

    [Fact]
    public void The_delivery_state_of_the_block_decides_not_the_state_of_any_other_block()
    {
        var nsw = Community();
        var vic = Community(b => b with { Id = "vic", Location = new PlanLocation { State = "VIC" } });

        var quote = Quote(new[] { nsw, vic }, Mon5Oct, Mon5Oct, holidays: new[] { NswLabourDay });

        Assert.Equal(new[] { 653.84m, 294.32m }, quote.Lines.Select(l => l.Total));
    }

    [Fact]
    public void A_feed_row_and_an_override_for_the_same_day_are_one_holiday_not_two()
    {
        var feed = Whole(new DateOnly(2026, 12, 26), "NSW", "Boxing Day", "Nager.Date feed");
        var over = Whole(new DateOnly(2026, 12, 26), "NSW", "Boxing Day", "NDIS-CODES 5.3");
        var block = Block("bd", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3, OnPublicHoliday = HolidayDecision.Charge });

        var one = QuoteOne(block, new DateOnly(2026, 12, 26), holidays: new[] { over });
        var both = QuoteOne(block, new DateOnly(2026, 12, 26), holidays: new[] { feed, over });

        Assert.Equal(("04_106_0136_6_1", 6m, 54.48m, 326.88m), Row(Assert.Single(one.Lines)));   // Boxing Day 2026 is a Saturday: the holiday item, not the Saturday one
        Assert.Equal(Json(one), Json(both));
        Assert.Single(both.HolidayOccurrences);
    }

    // ── Part-day holidays ─────────────────────────────────────────────────────────

    [Fact]
    public void A_part_day_holiday_is_the_holiday_rate_only_inside_its_hours_and_says_the_reading_is_unconfirmed()
    {
        var christmasEve = new HolidayEntry(new DateOnly(2026, 12, 24), "NT", "Christmas Eve", T(19), null, "NDIS-CODES 5.3");
        var block = Block("nt", PlanSupportType.CommunityAccess, DayOfWeek.Thursday, T(18), T(22), b => b with { Location = new PlanLocation { State = "NT" } });

        var quote = QuoteOne(block, new DateOnly(2026, 12, 24), holidays: new[] { christmasEve });

        Assert.Equal(new[] { ("04_104_0125_6_1", 1m, 73.58m, 73.58m), ("04_102_0125_6_1", 3m, 163.46m, 490.38m) }, quote.Lines.Select(Row));
        Assert.Equal(PlannedLineFlags.None, quote.Lines[0].Flags);
        Assert.Equal(PlannedLineFlags.Review | PlannedLineFlags.HolidayExposure | PlannedLineFlags.Provisional, quote.Lines[1].Flags);
        Assert.Contains(8, quote.Lines[1].Trace.OpenQuestions);
        Assert.Contains("holiday:part-day", quote.Lines[1].Trace.Rules);
        Assert.Contains(quote.OpenQuestions, q => q.Number == 8);
        // On an ordinary Thursday the same four hours are 2 h of daytime (147.16) and 2 h of evening (162.14).
        var holiday = Assert.Single(quote.HolidayOccurrences);
        Assert.Equal((563.96m, 309.30m, 254.66m), (holiday.AtHolidayRates, holiday.AtOrdinaryRates, holiday.Uplift));
    }

    [Fact]
    public void A_support_wholly_outside_a_part_day_holiday_is_an_ordinary_day()
    {
        var christmasEve = new HolidayEntry(new DateOnly(2026, 12, 24), "NT", "Christmas Eve", T(19), null, "NDIS-CODES 5.3");
        var block = Block("nt", PlanSupportType.CommunityAccess, DayOfWeek.Thursday, T(9), T(13), b => b with { Location = new PlanLocation { State = "NT" } });

        var quote = QuoteOne(block, new DateOnly(2026, 12, 24), holidays: new[] { christmasEve });

        Assert.Equal(294.32m, quote.Totals.Amount);
        Assert.Empty(quote.HolidayOccurrences);
        Assert.False(quote.NeedsReview);
    }

    // ── Where the holiday falls in the occurrence ─────────────────────────────────

    [Fact]
    public void A_holiday_on_the_day_after_a_crossing_support_prices_only_the_part_that_falls_on_it_at_the_holiday_rate()
    {
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(2), b => b with { OnPublicHoliday = HolidayDecision.Charge });

        var quote = QuoteOne(block, Fri16Oct, holidays: new[] { Whole(Sat17Oct, "NSW") });

        Assert.Equal(new[] { ("01_015_0107_1_1", 2m, 81.07m, 162.14m), ("01_012_0107_1_1", 2m, 163.46m, 326.92m) }, quote.Lines.Select(Row));
        Assert.Equal(new[] { PlannedLineFlags.None, PlannedLineFlags.HolidayExposure }, quote.Lines.Select(l => l.Flags));
    }

    [Fact]
    public void Skip_drops_the_whole_occurrence_even_when_the_holiday_is_only_on_the_day_after_it_starts()
    {
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(2), b => b with { OnPublicHoliday = HolidayDecision.Skip });

        var quote = QuoteOne(block, Fri16Oct, holidays: new[] { Whole(Sat17Oct, "NSW") });

        Assert.Empty(quote.Lines);
        Assert.Equal(0m, quote.Totals.Amount);
        var skipped = Assert.Single(quote.HolidayOccurrences);
        Assert.Equal((true, Fri16Oct, "A holiday"), (skipped.Skipped, skipped.Date, skipped.HolidayName));
        Assert.Equal(new BlockTotal("x", 0m, 0m, 0, 1), Assert.Single(quote.Totals.ByBlock));
    }

    [Fact]
    public void A_support_that_ends_at_midnight_does_not_meet_the_holiday_that_starts_then()
    {
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(18), T(0));

        var quote = QuoteOne(block, Fri16Oct, holidays: new[] { Whole(Sat17Oct, "NSW") });

        Assert.Empty(quote.HolidayOccurrences);
        Assert.False(quote.NeedsReview);
        Assert.Equal(new[] { ("01_011_0107_1_1", 2m, 73.58m, 147.16m), ("01_015_0107_1_1", 4m, 81.07m, 324.28m) }, quote.Lines.Select(Row));
    }

    // ── A recurring block over several weeks ──────────────────────────────────────

    [Fact]
    public void A_weekly_block_meets_the_holiday_in_one_week_only_and_the_plan_names_that_exposure()
    {
        var weekly = Community();

        var quote = Quote(new[] { weekly }, new DateOnly(2026, 9, 28), new DateOnly(2026, 10, 25), holidays: new[] { NswLabourDay });

        Assert.Equal(new[] { new DateOnly(2026, 9, 28), Mon5Oct, Mon12Oct, new DateOnly(2026, 10, 19) }, quote.Lines.Select(l => l.ServiceDate));
        Assert.Equal(new[] { 294.32m, 653.84m, 294.32m, 294.32m }, quote.Lines.Select(l => l.Total));
        var holiday = Assert.Single(quote.HolidayOccurrences);
        Assert.Equal((Mon5Oct, 359.52m), (holiday.Date, holiday.Uplift));
        Assert.Equal(new[] { PlannedLineFlags.None, PlannedLineFlags.Review | PlannedLineFlags.HolidayExposure, PlannedLineFlags.None, PlannedLineFlags.None }, quote.Lines.Select(l => l.Flags));
        Assert.Equal(1, quote.Totals.ReviewLines);
        Assert.Equal(4 * 294.32m + 359.52m, quote.Totals.Amount);
    }

    // ── Policy B across a holiday ─────────────────────────────────────────────────

    [Fact]
    public void Policy_B_takes_the_holiday_rate_for_the_whole_support_when_part_of_it_is_on_a_part_day_holiday()
    {
        var christmasEve = new HolidayEntry(new DateOnly(2026, 12, 24), "NT", "Christmas Eve", T(19), null, "NDIS-CODES 5.3");
        var block = Block("nt", PlanSupportType.CommunityAccess, DayOfWeek.Thursday, T(18), T(22), b => b with { Location = new PlanLocation { State = "NT" } });

        var quote = QuoteOne(block, new DateOnly(2026, 12, 24), HigherOfPolicy, new[] { christmasEve });

        var line = Assert.Single(quote.Lines);
        Assert.Equal(("04_102_0125_6_1", 4m, 163.46m, 653.84m), Row(line));
        Assert.True(line.HolidayExposure && line.Review && line.Provisional);
        Assert.Equal("B", line.Trace.Policy);
    }

    [Fact]
    public void Policy_B_on_a_Sunday_night_into_a_Monday_holiday_prices_the_whole_support_at_the_holiday_rate()
    {
        var block = Block("sun", PlanSupportType.PersonalCare, DayOfWeek.Sunday, T(22), T(2), b => b with { OnPublicHoliday = HolidayDecision.Charge });

        var quote = QuoteOne(block, Sun18Oct, HigherOfPolicy, new[] { Whole(Sun18Oct.AddDays(1), "NSW") });

        Assert.Equal(("01_012_0107_1_1", 4m, 163.46m, 653.84m), Row(Assert.Single(quote.Lines)));
    }
}
