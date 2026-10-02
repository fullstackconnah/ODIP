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
    public void A_part_day_holiday_row_ending_at_00_00_prices_exactly_like_one_with_no_end_time()
    {
        // Review L1: the same NT Christmas Eve, but the row says 19:00 to 00:00 as a person typing it into the override table would. It used to be ignored: 309.30, not 563.96.
        var written = new HolidayEntry(new DateOnly(2026, 12, 24), "NT", "Christmas Eve", T(19), T(0), "owner");
        var omitted = written with { To = null };
        var block = Block("nt", PlanSupportType.CommunityAccess, DayOfWeek.Thursday, T(18), T(22), b => b with { Location = new PlanLocation { State = "NT" } });

        var quote = QuoteOne(block, new DateOnly(2026, 12, 24), holidays: new[] { written });

        Assert.Equal(new[] { ("04_104_0125_6_1", 1m, 73.58m, 73.58m), ("04_102_0125_6_1", 3m, 163.46m, 490.38m) }, quote.Lines.Select(Row));
        Assert.Equal(Json(QuoteOne(block, new DateOnly(2026, 12, 24), holidays: new[] { omitted }).Lines), Json(quote.Lines));
        Assert.Equal(254.66m, Assert.Single(quote.HolidayOccurrences).Uplift);
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

    // ── Review M4: is the calendar there at all? ──────────────────────────────────

    private static PlanQuote Notices(PlanBlock block, DateOnly from, DateOnly to, IReadOnlyCollection<HolidayCoverage>? coverage, DateOnly? overridesThrough) =>
        Quote(new[] { block }, from, to, holidayCoverage: coverage, overridesThrough: overridesThrough);

    [Fact]
    public void A_period_that_reaches_a_year_with_no_holiday_rows_for_the_delivery_state_says_so()
    {
        var coverage = new[] { new HolidayCoverage("NSW", 2026), new HolidayCoverage("VIC", 2027) };

        var quote = Notices(Community(), new DateOnly(2026, 12, 1), new DateOnly(2027, 2, 28), coverage, null);

        var notice = Assert.Single(quote.Notices, n => n.Code == "holiday-calendar-missing");
        Assert.Equal(8, notice.OpenQuestion);
        Assert.Contains("NSW 2027", notice.Message);
        Assert.DoesNotContain("NSW 2026", notice.Message);      // 2026 is covered
        Assert.Contains(quote.OpenQuestions, q => q.Number == 8);
        Assert.False(quote.NeedsReview);                        // a notice does not block approval
    }

    [Fact]
    public void A_national_row_covers_every_state_and_a_period_inside_covered_years_says_nothing()
    {
        var qld = Community() with { Location = new PlanLocation { State = "QLD" } };

        var covered = Notices(qld, new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 20), new[] { new HolidayCoverage(null, 2026) }, null);
        var other = Notices(qld, new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 20), new[] { new HolidayCoverage("NSW", 2026) }, null);
        var unknown = Notices(qld, new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 20), null, null);

        Assert.DoesNotContain(covered.Notices, n => n.Code == "holiday-calendar-missing");
        Assert.Contains("QLD 2026", Assert.Single(other.Notices, n => n.Code == "holiday-calendar-missing").Message);
        Assert.DoesNotContain(unknown.Notices, n => n.Code == "holiday-calendar-missing");        // coverage not supplied: no check
    }

    [Fact]
    public void The_day_after_the_last_day_counts_because_an_occurrence_can_run_into_it()
    {
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Thursday, T(22), T(2));

        var quote = Notices(block, new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 31), new[] { new HolidayCoverage("NSW", 2026) }, null);

        Assert.Contains("NSW 2027", Assert.Single(quote.Notices, n => n.Code == "holiday-calendar-missing").Message);   // Thursday 31 December 22:00 ends on 1 January 2027
    }

    [Fact]
    public void A_period_that_runs_past_the_last_override_row_says_so_and_no_rows_at_all_says_that()
    {
        var covered = new[] { new HolidayCoverage("NSW", 2027), new HolidayCoverage("NSW", 2028) };

        var past = Notices(Community(), new DateOnly(2027, 7, 1), new DateOnly(2028, 6, 30), covered, new DateOnly(2027, 4, 25));
        var inside = Notices(Community(), new DateOnly(2027, 1, 1), new DateOnly(2027, 4, 25), covered, new DateOnly(2027, 4, 25));
        var none = Notices(Community(), new DateOnly(2027, 7, 1), new DateOnly(2027, 7, 31), covered, DateOnly.MinValue);

        var notice = Assert.Single(past.Notices, n => n.Code == "holiday-overrides-end");
        Assert.Equal(8, notice.OpenQuestion);
        Assert.Contains("2027-04-25", notice.Message);
        Assert.DoesNotContain(inside.Notices, n => n.Code == "holiday-overrides-end");
        Assert.Contains("no public holiday overrides", Assert.Single(none.Notices, n => n.Code == "holiday-overrides-end").Message);
    }

    // ── Review M4: the named dates ────────────────────────────────────────────────

    private static PlanBlock Personal(DayOfWeek day, string state, HolidayDecision decision = HolidayDecision.Review) =>
        Block("named", PlanSupportType.PersonalCare, day, T(9), T(13), b => b with { Location = new PlanLocation { State = state }, OnPublicHoliday = decision });

    [Fact]
    public void Boxing_Day_with_no_calendar_row_is_priced_as_an_ordinary_day_and_flagged_for_review_never_guessed()
    {
        // Saturday 26 December 2026 in Tasmania: the state's own list has Monday 28 December, and the schedule names 26 December as a public holiday.
        var quote = QuoteOne(Personal(DayOfWeek.Saturday, "TAS"), new DateOnly(2026, 12, 26));

        var line = Assert.Single(quote.Lines);
        Assert.Equal(("01_013_0107_1_1", 4m, 103.54m, 414.16m), Row(line));                      // the Saturday rate, as it was before this round
        Assert.True(line.Review);
        Assert.False(line.HolidayExposure);
        Assert.Contains(8, line.Trace.OpenQuestions);
        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.NamedDateNotInCalendar, "named"), (issue.Reason, issue.BlockId));
        Assert.Contains("26 December", issue.Message);
        Assert.Empty(quote.HolidayOccurrences);
        Assert.True(quote.NeedsReview);
    }

    [Fact]
    public void Anzac_Day_on_a_Sunday_with_no_calendar_row_is_flagged_and_Charge_prices_the_holiday_rate_and_Skip_drops_it()
    {
        var anzac = new DateOnly(2027, 4, 25);   // a Sunday; Queensland observes Monday 26 April

        var review = QuoteOne(Personal(DayOfWeek.Sunday, "QLD"), anzac);
        var charge = QuoteOne(Personal(DayOfWeek.Sunday, "QLD", HolidayDecision.Charge), anzac);
        var skip = QuoteOne(Personal(DayOfWeek.Sunday, "QLD", HolidayDecision.Skip), anzac);

        Assert.Equal(("01_014_0107_1_1", 534.00m, true), (review.Lines[0].ItemCode!, review.Lines[0].Total, review.Lines[0].Review));
        var line = Assert.Single(charge.Lines);
        Assert.Equal(("01_012_0107_1_1", 4m, 163.46m, 653.84m), Row(line));                       // decided: the public holiday rate
        Assert.Equal(PlannedLineFlags.HolidayExposure, line.Flags);
        Assert.Equal("Anzac Day", line.Trace.HolidayName);
        var occurrence = Assert.Single(charge.HolidayOccurrences);
        Assert.Equal(("Anzac Day", 653.84m, 534.00m, 119.84m), (occurrence.HolidayName, occurrence.AtHolidayRates, occurrence.AtOrdinaryRates, occurrence.Uplift));
        Assert.Empty(charge.Issues);
        Assert.Empty(skip.Lines);
        Assert.True(Assert.Single(skip.HolidayOccurrences).Skipped);
    }

    [Fact]
    public void A_calendar_row_for_the_state_on_the_date_means_the_named_date_needs_no_flag_and_another_states_row_does_not_count()
    {
        var date = new DateOnly(2026, 12, 26);

        var own = QuoteOne(Personal(DayOfWeek.Saturday, "NSW", HolidayDecision.Charge), date, holidays: new[] { Whole(date, "NSW", "Boxing Day") });
        var other = QuoteOne(Personal(DayOfWeek.Saturday, "TAS"), date, holidays: new[] { Whole(date, "NSW", "Boxing Day") });
        var national = QuoteOne(Personal(DayOfWeek.Saturday, "TAS"), date, holidays: new[] { Whole(date, null, "Boxing Day") });

        Assert.Empty(own.Issues);
        Assert.Equal("Boxing Day", own.Lines[0].Trace.HolidayName);
        Assert.Contains(other.Issues, i => i.Reason == PlanFailureReason.NamedDateNotInCalendar);
        Assert.DoesNotContain(national.Issues, i => i.Reason == PlanFailureReason.NamedDateNotInCalendar);
    }

    [Fact]
    public void The_named_date_is_met_by_a_support_that_runs_into_it_and_only_26_December_and_25_April_are_named()
    {
        var night = Block("night", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(2), b => b with { Location = new PlanLocation { State = "TAS" } });

        var intoBoxingDay = QuoteOne(night, new DateOnly(2026, 12, 25));                                                   // Friday 25 December 22:00 to Saturday 26 December 02:00
        var christmasOnly = QuoteOne(night with { Days = new[] { DayOfWeek.Thursday } }, new DateOnly(2026, 12, 24));    // ends on the 25th: not named here
        var newYear = QuoteOne(Personal(DayOfWeek.Friday, "TAS"), new DateOnly(2027, 1, 1));

        Assert.Contains(intoBoxingDay.Issues, i => i.Reason == PlanFailureReason.NamedDateNotInCalendar);
        Assert.DoesNotContain(christmasOnly.Issues, i => i.Reason == PlanFailureReason.NamedDateNotInCalendar);
        Assert.DoesNotContain(newYear.Issues, i => i.Reason == PlanFailureReason.NamedDateNotInCalendar);
    }

    [Fact]
    public void The_same_named_date_across_months_of_one_block_is_one_issue_with_a_count()
    {
        var everyDay = Block("daily", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(9), T(13), b => b with { Days = Enum.GetValues<DayOfWeek>().ToArray() });

        var quote = Quote(new[] { everyDay }, new DateOnly(2026, 12, 20), new DateOnly(2027, 5, 1));

        var issue = Assert.Single(quote.Issues);       // 26 December 2026 and 25 April 2027, one issue
        Assert.Equal((PlanFailureReason.NamedDateNotInCalendar, 2, new DateOnly(2026, 12, 26)), (issue.Reason, issue.Count, issue.FirstDate));
    }
}
