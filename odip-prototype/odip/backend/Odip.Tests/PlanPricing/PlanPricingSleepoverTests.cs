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
        var night = Assert.Single(quote.Lines, l => !l.IsPriced);
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

        var extra = Assert.Single(QuoteOne(block, date).Lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);

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

    // ── Review L3: active hours that may be worked after midnight, and a group fraction on them ──

    [Theory]
    [InlineData(DayOfWeek.Saturday, true)]    // Saturday 22:00 to Sunday 06:00: Saturday's rate before midnight, Sunday's (higher) after
    [InlineData(DayOfWeek.Sunday, true)]      // Sunday to Monday: Sunday's rate before midnight, a weekday's (the Saturday rate, lower) after
    [InlineData(DayOfWeek.Friday, false)]     // Friday to Saturday: the Saturday rate on both sides of midnight
    [InlineData(DayOfWeek.Monday, false)]
    public void Active_hours_of_a_sleepover_that_starts_on_a_Saturday_or_a_Sunday_are_provisional_because_the_rate_changes_at_midnight(DayOfWeek day, bool flagged)
    {
        var date = new[] { Mon12Oct, Fri16Oct, Sat17Oct, Sun18Oct }.Single(d => d.DayOfWeek == day);
        var block = Overnight(PlanSupportType.PersonalCare, day, T(22), T(6), b => b with { SleepoverActiveHours = 4m });

        var quote = QuoteOne(block, date);

        var extra = Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);
        Assert.Equal(flagged, extra.Provisional);
        Assert.Equal(flagged, extra.Trace.OpenQuestions.Contains(14));
        Assert.Equal(flagged, extra.Trace.Rules.Contains("sleepover:active-hours-rate-straddle"));
        Assert.Equal(flagged, quote.OpenQuestions.Any(q => q.Number == 14));
        Assert.Equal(day == DayOfWeek.Sunday ? 133.50m : 103.54m, extra.UnitPrice);   // the arithmetic is unchanged: the rate of the day the sleepover starts
    }

    [Theory]
    [InlineData(1, 3)]
    [InlineData(2, 1)]
    [InlineData(2, 3)]
    public void A_group_fraction_on_the_active_hours_is_flagged_like_the_sleepover_line_itself(int workers, int participants)
    {
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(6), b => b with
        {
            SleepoverActiveHours = 4m, Workers = workers, ParticipantsPresent = participants,
        });

        var quote = QuoteOne(block, Mon12Oct);

        var sleepover = Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.Sleepover);
        var active = Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);
        Assert.True(sleepover.Provisional);
        Assert.True(active.Provisional);
        Assert.Contains(5, active.Trace.OpenQuestions);
        Assert.Contains("group:floor(price*workers/participants)", active.Trace.Rules);
        Assert.DoesNotContain(14, active.Trace.OpenQuestions);   // a Monday start does not straddle a change of rate
    }

    // ── Review L2: a long block needs its window ──

    [Fact]
    public void A_24_hour_block_where_the_worker_may_sleep_is_refused_until_it_says_which_part_is_the_night()
    {
        var day = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Friday, T(6), T(6));   // 06:00 to 06:00

        var refused = QuoteOne(day, Fri16Oct);
        var windowed = QuoteOne(Window(day, T(22), T(6)), Fri16Oct);

        Assert.Equal(PlanFailureReason.InvalidInput, Assert.Single(refused.Issues).Reason);
        Assert.Contains("sleepover window", refused.Issues[0].Message);
        Assert.Empty(refused.Lines.Where(l => l.IsPriced));
        Assert.Empty(windowed.Issues);
        Assert.Equal(1, windowed.Lines.Count(l => l.Kind == PlannedLineKind.Sleepover));
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
    public void On_the_night_the_clocks_go_forward_a_22_00_to_06_00_support_is_seven_hours_priced_hourly_and_every_line_says_the_reading_is_the_builders_own()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var saturday = new DateOnly(2026, 10, 3);   // clocks go forward at 02:00 on Sunday 4 October 2026
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6));

        var quote = QuoteOne(block, saturday);

        // 2 h on the Saturday and 5 h (not 6) on the Sunday morning: 7 elapsed hours, so the arithmetic is hourly (874.58, not the Each item 311.79) ...
        Assert.Equal(new[] { ("01_013_0107_1_1", 2m, 103.54m, 207.08m), ("01_014_0107_1_1", 5m, 133.50m, 667.50m) }, quote.Lines.Select(Row));
        Assert.Contains("clock-change:elapsed-hours", quote.Lines[1].Trace.Rules);
        // ... but counting elapsed hours is the engine's own reading (the schedule gives no example), so a person is asked: every line of the occurrence is
        // Provisional and Review, there is a typed issue, and the question is in the quote.
        Assert.All(quote.Lines, l => { Assert.True(l.Provisional && l.Review); Assert.Contains(13, l.Trace.OpenQuestions); });
        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.SleepoverClockChange, "sleep"), (issue.Reason, issue.BlockId));
        Assert.DoesNotContain("2026", issue.Message);
        Assert.True(quote.NeedsReview);
        Assert.Contains(quote.OpenQuestions, q => q.Number == 13 && q.Text.Contains("clocks"));
    }

    [SkippableFact]
    public void On_the_night_the_clocks_go_back_a_window_that_is_seven_hours_on_the_clock_is_eight_elapsed_hours_so_it_is_a_sleepover_the_builder_asks_about()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(5));   // 22:00 to 05:00 is 7 hours on the clock, 8 on 3 to 4 April 2027

        var quote = QuoteOne(block, new DateOnly(2027, 4, 3));
        var ordinary = QuoteOne(block, new DateOnly(2027, 4, 10));

        var line = Assert.Single(quote.Lines);
        Assert.Equal((PlannedLineKind.Sleepover, true, true), (line.Kind, line.Provisional, line.Review));
        Assert.Equal(PlanFailureReason.SleepoverClockChange, Assert.Single(quote.Issues).Reason);
        // A week later the same 7 hour window is not a sleepover and the usual issue applies.
        Assert.Equal(PlanFailureReason.SleepoverNotQualifying, Assert.Single(ordinary.Issues).Reason);
    }

    [SkippableFact]
    public void A_night_where_the_clock_and_the_elapsed_hours_agree_carries_no_clock_change_flag_even_on_a_changeover_night()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var back = QuoteOne(Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6)), new DateOnly(2027, 4, 3));   // 8 on the clock, 9 elapsed

        var line = Assert.Single(back.Lines);
        Assert.Equal((PlannedLineKind.Sleepover, PlannedLineFlags.None), (line.Kind, line.Flags));
        Assert.Empty(back.Issues);
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

    [SkippableFact]
    public void Two_boundaries_either_side_of_the_hour_the_clocks_skip_never_make_a_line_with_a_negative_length()
    {
        // Review L7 (a property over the widened generator found it, seed 82): a headcount change at 02:30 and another at 03:00 on the night the clocks go forward
        // (02:00 jumps to 03:00 in NSW, so 02:30 does not exist). The conversion pushed 02:30 an hour on, after 03:00, and the support between the two came out as
        // -30 minutes: a line of -0.5 hours and a negative total.
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var block = Block("skip", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6), b => b with
        {
            ParticipantsPresent = 2,
            HeadcountChanges = new[]
            {
                new PlanHeadcountChange { From = T(2, 30), ParticipantsPresent = 3 },
                new PlanHeadcountChange { From = T(3, 0), ParticipantsPresent = 1 },
            },
        });

        var quote = QuoteOne(block, new DateOnly(2026, 10, 3), SplitPolicy);

        // 22:00 to 06:00 is 7 elapsed hours. The wall clock never shows 02:30, so the part of the support from 00:00 to 02:30 ends where the clocks jump (2 elapsed hours) and
        // the 30 minutes up to 03:00 are not a part at all.
        Assert.All(quote.Lines, l => Assert.True(l.Qty > 0m && l.Total > 0m, $"{l.StartTime}-{l.EndTime}: {l.Qty} h, {l.Total}"));
        Assert.Equal(new[] { 2m, 2m, 3m }, quote.Lines.Select(l => l.Qty));
        Assert.Equal(7m, quote.Lines.Sum(l => l.Qty));
    }

    [SkippableFact]
    public void A_support_wholly_inside_the_hour_the_clocks_skip_has_no_time_to_price_and_says_so_instead_of_vanishing()
    {
        Skip.IfNot(ProviderLocalTime.TzDataAvailable, "needs the Australia/Sydney time zone");
        var block = Block("skipped", PlanSupportType.PersonalCare, DayOfWeek.Sunday, T(2, 15), T(2, 45));

        var forward = QuoteOne(block, new DateOnly(2026, 10, 4));   // 02:00 jumps to 03:00 that morning
        var ordinary = QuoteOne(block, Sun18Oct);

        Assert.Empty(forward.Lines);
        var issue = Assert.Single(forward.Issues);
        Assert.Equal((PlanFailureReason.SupportInSkippedHour, "skipped"), (issue.Reason, issue.BlockId));
        Assert.True(forward.NeedsReview);
        Assert.Equal(0.5m, Assert.Single(ordinary.Lines).Qty);   // any other Sunday it is half an hour
        Assert.Empty(ordinary.Issues);
    }

    // ── Review L10: the quote says which clock it counted on ──

    [Fact]
    public void A_quote_names_the_time_basis_the_host_gave_it_the_tz_database_or_the_fixed_plus_10_fallback()
    {
        var quote = QuoteOne(Block("any", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13)), Mon12Oct);

        Assert.Equal(ProviderLocalTime.TzDataAvailable ? PlanTimeBasis.TzDatabase : PlanTimeBasis.FixedOffset, quote.TimeBasis);
        Assert.Equal("tz-database", PlanTimeBasis.TzDatabase);
        Assert.Equal("fixed+10:00", PlanTimeBasis.FixedOffset);
    }

    [Fact]
    public void With_no_tz_database_the_clock_change_night_is_an_ordinary_sleepover_and_the_quote_says_every_zone_was_a_fixed_plus_10()
    {
        // The 3 October 2026 Saturday night is 7 elapsed hours in New South Wales (hourly, 874.58) and 8 hours on a clock that never changes (one Each item, 311.79).
        // The same request used to give either answer depending on the host, and nothing in the answer said which rule applied.
        var block = Overnight(PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(22), T(6));
        var request = new PlanQuoteRequest
        {
            Blocks = new[] { block }, PeriodFrom = new DateOnly(2026, 10, 3), PeriodTo = new DateOnly(2026, 10, 3),
            Catalogue = RealCatalogue, ZoneLookup = _ => throw new TimeZoneNotFoundException("no tz database on this host"),
        };

        var quote = PlanPricingEngine.Quote(request);

        Assert.Equal(PlanTimeBasis.FixedOffset, quote.TimeBasis);
        Assert.Equal(("01_010_0107_1_1", 1m, 311.79m), (Assert.Single(quote.Lines).ItemCode, quote.Lines[0].Qty, quote.Lines[0].Total));
        Assert.Empty(quote.Issues);
    }

    [Fact]
    public void A_quote_that_prices_nothing_still_names_its_time_basis()
    {
        var quote = Quote(Array.Empty<PlanBlock>(), Mon12Oct, Mon12Oct);

        Assert.False(string.IsNullOrEmpty(quote.TimeBasis));
    }
}
