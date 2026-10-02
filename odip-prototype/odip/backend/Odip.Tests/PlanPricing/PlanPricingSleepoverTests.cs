using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Sleepovers (NDIS-CODES 4.1 and 11.2 step 4): starts before and ends after midnight, at least 8 continuous hours, the worker may sleep; one Each item
/// whatever the day, including 2 hours of active support, and the rest of the active hours hourly. A worker who may sleep in a window that is not a
/// sleepover is priced hourly and flagged, never guessed. The 2026-27 prices: 01_010 311.79, 01_206 (STA) 311.79.
/// </summary>
public class PlanPricingSleepoverTests
{
    private static PlanBlock Overnight(PlanSupportType type, DayOfWeek day, TimeOnly start, TimeOnly end, Func<PlanBlock, PlanBlock>? change = null) =>
        Block("sleep", type, day, start, end, b => (change is null ? b : change(b)) with { WorkerMaySleep = true });

    private static PlanBlock Window(PlanBlock block, TimeOnly from, TimeOnly to) => block with { SleepoverWindow = new PlanSleepoverWindow { From = from, To = to } };

    // ── Qualifying ────────────────────────────────────────────────────────────────

    [Fact]
    public void Without_a_window_the_whole_block_is_the_sleepover_and_it_is_one_Each_item()
    {
        var quote = QuoteOne(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6)), Fri16Oct);

        var line = Assert.Single(quote.Lines);
        Assert.Equal(("01_010_0107_1_1", 1m, 311.79m, 311.79m), Row(line));
        Assert.Equal((PlannedLineKind.Sleepover, "E", 1, Fri16Oct), (line.Kind, line.Unit, line.PaceCategory, line.ServiceDate));
        Assert.False(quote.NeedsReview);
        Assert.Equal(0m, quote.Totals.SupportHours);   // a sleepover is not support hours
    }

    [Fact]
    public void A_short_term_accommodation_sleepover_is_the_STA_Each_item()
    {
        var quote = QuoteOne(Overnight(PlanSupportType.StaSupport, DayOfWeek.Friday, T(22), T(6)), Fri16Oct);

        Assert.Equal(("01_206_0115_1_1", 1m, 311.79m, 311.79m), Row(Assert.Single(quote.Lines)));
    }

    [Fact]
    public void A_sleepover_costs_the_same_on_a_weekday_a_Saturday_a_Sunday_and_a_public_holiday()
    {
        foreach (var (day, date) in new[] { (DayOfWeek.Monday, Mon12Oct), (DayOfWeek.Saturday, Sat17Oct), (DayOfWeek.Sunday, Sun18Oct) })
            Assert.Equal(311.79m, QuoteOne(Overnight(PlanSupportType.PersonalCare, day, T(22), T(6)), date).Totals.Amount);

        var holiday = new HolidayEntry(Mon12Oct, "NSW", "A holiday", null, null, "test");
        Assert.Equal(311.79m, QuoteOne(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(6), b => b with { OnPublicHoliday = HolidayDecision.Charge }), Mon12Oct, holidays: new[] { holiday }).Totals.Amount);
    }

    [Fact]
    public void Eight_hours_across_midnight_qualify_and_seven_do_not()
    {
        var eight = QuoteOne(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6)), Fri16Oct);
        var seven = QuoteOne(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(5)), Fri16Oct);

        Assert.Equal(PlannedLineKind.Sleepover, Assert.Single(eight.Lines).Kind);

        // Seven hours: priced hourly (2 h Friday evening, 5 h Saturday), flagged for review, and the reason is typed.
        Assert.Equal(new[] { ("01_015_0107_1_1", 2m, 81.07m, 162.14m), ("01_013_0107_1_1", 5m, 103.54m, 517.70m) }, seven.Lines.Select(Row));
        Assert.All(seven.Lines, l => Assert.True(l.Review));
        var issue = Assert.Single(seven.Issues);
        Assert.Equal(PlanFailureReason.SleepoverNotQualifying, issue.Reason);
        Assert.True(seven.NeedsReview);
    }

    [Fact]
    public void A_window_that_does_not_cross_midnight_is_not_a_sleepover_however_long()
    {
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(12), T(20));

        var quote = QuoteOne(block, Mon12Oct);

        Assert.Equal(new[] { ("01_011_0107_1_1", 8m, 73.58m, 588.64m) }, quote.Lines.Select(Row));
        Assert.Equal(PlanFailureReason.SleepoverNotQualifying, Assert.Single(quote.Issues).Reason);
    }

    [Fact]
    public void A_window_inside_a_longer_overnight_block_must_itself_be_eight_hours()
    {
        var shortWindow = Window(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(20), T(8)), T(0, 30), T(8));
        var wholeBlock = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(20), T(8));

        Assert.Equal(PlanFailureReason.SleepoverNotQualifying, Assert.Single(QuoteOne(shortWindow, Mon12Oct).Issues).Reason);
        // With no window the 12-hour block is the window: one Each item for the night.
        Assert.Equal(("01_010_0107_1_1", 1m, 311.79m, 311.79m), Row(Assert.Single(QuoteOne(wholeBlock, Mon12Oct).Lines)));
    }

    [Fact]
    public void An_overnight_block_with_a_worker_who_may_not_sleep_is_priced_hourly_with_nothing_to_review()
    {
        var block = Block("awake", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(6));

        var quote = QuoteOne(block, Mon12Oct);

        Assert.Equal(new[] { ("01_015_0107_1_1", 2m, 81.07m, 162.14m), ("01_002_0107_1_1", 6m, 82.57m, 495.42m) }, quote.Lines.Select(Row));
        Assert.Empty(quote.Issues);
        Assert.False(quote.NeedsReview);
    }

    // ── Community and group supports have no sleepover item ───────────────────────

    [Theory]
    [InlineData(PlanSupportType.CommunityAccess, "04_104_0125_6_1", "04_103_0125_6_1", "04_105_0125_6_1")]
    [InlineData(PlanSupportType.GroupActivity, "04_102_0136_6_1", "04_103_0136_6_1", "04_104_0136_6_1")]
    public void A_community_or_group_block_with_a_sleepover_window_prices_the_active_parts_and_flags_the_night_without_mapping_it_elsewhere(
        PlanSupportType type, string daytime, string evening, string saturday)
    {
        var block = Window(Overnight(type, DayOfWeek.Friday, T(17), T(9)), T(22), T(6));

        var quote = QuoteOne(block, Fri16Oct);

        Assert.Equal(new[] { (daytime, 3m, 73.58m, 220.74m), (evening, 2m, 81.07m, 162.14m), (saturday, 3m, 103.54m, 310.62m) }, quote.Lines.Where(l => l.IsPriced).Select(Row));
        var night = Assert.Single(quote.Lines.Where(l => !l.IsPriced));
        Assert.Equal((PlannedLineKind.Sleepover, PlanFailureReason.SleepoverNotAvailable, true), (night.Kind, night.Unpriced, night.Review));
        Assert.Equal(new[] { Fri16Oct, Sat17Oct }, new[] { night.ServiceDate, night.EndDate!.Value });
        Assert.Equal(PlanFailureReason.SleepoverNotAvailable, Assert.Single(quote.Issues).Reason);
        Assert.Equal(693.50m, quote.Totals.Amount);
    }

    // ── Active hours inside a sleepover ───────────────────────────────────────────

    [Theory]
    [InlineData(DayOfWeek.Monday, "01_013_0107_1_1", 103.54)]    // a weekday: at Saturday rates
    [InlineData(DayOfWeek.Saturday, "01_013_0107_1_1", 103.54)]  // Saturday: the rate of the day
    [InlineData(DayOfWeek.Sunday, "01_014_0107_1_1", 133.50)]    // Sunday: the rate of the day
    public void Active_hours_beyond_two_are_priced_at_the_Saturday_rate_on_a_weekday_and_at_the_rate_of_the_day_otherwise(DayOfWeek day, string code, double rate)
    {
        var date = new[] { Mon12Oct, Sat17Oct, Sun18Oct }.Single(d => d.DayOfWeek == day);
        var block = Overnight(PlanSupportType.PersonalCare, day, T(22), T(6), b => b with { SleepoverActiveHours = 3m });

        var extra = Assert.Single(QuoteOne(block, date).Lines.Where(l => l.Kind == PlannedLineKind.SleepoverActiveHours));

        Assert.Equal((code, 1m, (decimal)rate, (decimal)rate), Row(extra));
    }

    [Fact]
    public void Active_hours_on_a_public_holiday_are_priced_at_the_holiday_rate_and_flagged()
    {
        var holiday = new HolidayEntry(Mon12Oct, "NSW", "A holiday", null, null, "test");
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(6), b => b with { SleepoverActiveHours = 3m });

        var extra = QuoteOne(block, Mon12Oct, holidays: new[] { holiday }).Lines.Single(l => l.Kind == PlannedLineKind.SleepoverActiveHours);

        Assert.Equal(("01_012_0107_1_1", 1m, 163.46m, 163.46m), Row(extra));
        Assert.Equal(PlannedLineFlags.HolidayExposure | PlannedLineFlags.Review, extra.Flags);
    }

    [Fact]
    public void Part_hours_beyond_two_are_pro_rata_and_short_term_accommodation_uses_its_own_Saturday_item()
    {
        var personal = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(6), b => b with { SleepoverActiveHours = 2.5m });
        var sta = Overnight(PlanSupportType.StaSupport, DayOfWeek.Monday, T(22), T(6), b => b with { SleepoverActiveHours = 4m });

        Assert.Equal(("01_013_0107_1_1", 0.5m, 103.54m, 51.77m), Row(QuoteOne(personal, Mon12Oct).Lines.Single(l => l.Kind == PlannedLineKind.SleepoverActiveHours)));
        Assert.Equal(("01_202_0115_1_1", 2m, 103.54m, 207.08m), Row(QuoteOne(sta, Mon12Oct).Lines.Single(l => l.Kind == PlannedLineKind.SleepoverActiveHours)));
    }

    // ── A group and the sleepover ─────────────────────────────────────────────────

    [Theory]
    [InlineData(1, 3, 103.93)]    // 311.79 / 3
    [InlineData(2, 1, 623.58)]    // 2 workers: 311.79 x 2
    [InlineData(2, 3, 207.86)]    // floor(311.79 x 2 / 3)
    public void The_group_fraction_applies_to_the_sleepover_item_and_the_line_says_the_reading_is_unconfirmed(int workers, int participants, double expected)
    {
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6), b => b with { Workers = workers, ParticipantsPresent = participants });

        var line = Assert.Single(QuoteOne(block, Fri16Oct).Lines);

        Assert.Equal((decimal)expected, line.UnitPrice);
        Assert.True(line.Provisional);
        Assert.Contains(5, line.Trace.OpenQuestions);
    }

    [Fact]
    public void A_one_to_one_sleepover_carries_no_provisional_flag()
    {
        var line = Assert.Single(QuoteOne(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6)), Fri16Oct).Lines);

        Assert.Equal(PlannedLineFlags.None, line.Flags);
    }

    // ── A holiday during a sleepover ──────────────────────────────────────────────

    [Fact]
    public void A_holiday_that_falls_only_in_the_sleepover_window_costs_nothing_extra_but_is_reviewed_and_can_be_skipped()
    {
        var holiday = new HolidayEntry(Sat17Oct, "NSW", "A Saturday holiday", null, null, "test");
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6));

        var review = QuoteOne(block, Fri16Oct, holidays: new[] { holiday });
        var skip = QuoteOne(block with { OnPublicHoliday = HolidayDecision.Skip }, Fri16Oct, holidays: new[] { holiday });

        var line = Assert.Single(review.Lines);
        Assert.Equal((311.79m, PlannedLineFlags.Review), (line.Total, line.Flags));   // no HolidayExposure: the Each item costs the same on any day
        var occurrence = Assert.Single(review.HolidayOccurrences);
        Assert.Equal((311.79m, 311.79m, 0m), (occurrence.AtHolidayRates, occurrence.AtOrdinaryRates, occurrence.Uplift));
        Assert.Empty(skip.Lines);
        Assert.True(Assert.Single(skip.HolidayOccurrences).Skipped);
    }

    [Fact]
    public void A_public_holiday_on_the_morning_after_a_sleepover_prices_the_hours_after_it_at_the_holiday_rate()
    {
        var holiday = new HolidayEntry(Sat17Oct, "NSW", "A Saturday holiday", null, null, "test");
        var block = Window(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(17), T(9)), T(22), T(6)) with { OnPublicHoliday = HolidayDecision.Charge };

        var quote = QuoteOne(block, Fri16Oct, holidays: new[] { holiday });

        Assert.Equal(("01_012_0107_1_1", 3m, 163.46m, 490.38m), Row(quote.Lines[^1]));
        Assert.Equal(PlannedLineFlags.HolidayExposure, quote.Lines[^1].Flags);
        Assert.Equal(490.38m - 310.62m, Assert.Single(quote.HolidayOccurrences).Uplift);
    }

    // ── The night the clocks change (NDIS-CODES 11.1: hours are elapsed hours) ────

    [SkippableFact]
    public void On_the_night_the_clocks_go_forward_a_22_00_to_06_00_support_is_seven_hours_and_not_a_sleepover()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var saturday = new DateOnly(2026, 10, 3);   // clocks go forward at 02:00 on Sunday 4 October 2026
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6));

        var quote = QuoteOne(block, saturday);

        // 2 h on the Saturday and 5 h (not 6) on the Sunday morning: 7 elapsed hours, so no sleepover and nothing to review.
        Assert.Equal(new[] { ("01_013_0107_1_1", 2m, 103.54m, 207.08m), ("01_014_0107_1_1", 5m, 133.50m, 667.50m) }, quote.Lines.Select(Row));
        Assert.Contains("clock-change:elapsed-hours", quote.Lines[1].Trace.Rules);
        Assert.Empty(quote.Issues);
        Assert.False(quote.NeedsReview);
    }

    [SkippableFact]
    public void The_same_night_in_Queensland_where_the_clocks_do_not_change_is_a_sleepover()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Brisbane time zone");
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6), b => b with { Location = new PlanLocation { State = "QLD" } });

        var quote = QuoteOne(block, new DateOnly(2026, 10, 3));

        Assert.Equal(PlannedLineKind.Sleepover, Assert.Single(quote.Lines).Kind);
    }

    [SkippableFact]
    public void On_the_night_the_clocks_go_back_the_same_support_is_nine_elapsed_hours_and_a_sleepover()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var saturday = new DateOnly(2027, 4, 3);   // clocks go back at 03:00 on Sunday 4 April 2027
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6));

        var quote = QuoteOne(block, saturday);

        Assert.Equal(PlannedLineKind.Sleepover, Assert.Single(quote.Lines).Kind);
    }

    [SkippableFact]
    public void An_hourly_support_on_the_night_the_clocks_go_back_counts_the_extra_hour()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var block = Block("awake", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6));

        var quote = QuoteOne(block, new DateOnly(2027, 4, 3));

        // Saturday 22:00-24:00 is 2 h; Sunday 00:00-06:00 is 7 elapsed hours because 02:00-03:00 happens twice.
        Assert.Equal(new[] { 2m, 7m }, quote.Lines.Select(l => l.Qty));
    }
}
