using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The rest of the engine's rules: which family and registration group a support is priced under (and the typed refusal when the provider does
/// not hold it), intensity, group outings, the crossing policy against a price change, the catalogue gaps, the request's own limits and the totals.
/// </summary>
public class PlanPricingRulesTests
{
    private static PlanBlock Weekday(PlanSupportType type, SupportIntensity intensity = SupportIntensity.Standard, string id = "b") =>
        Block(id, type, DayOfWeek.Monday, T(9), T(13), b => b with { Intensity = intensity });

    private static PlanPricingPolicy Without(params string[] groups) =>
        PlanPricingPolicy.Default with { RegistrationGroupsHeld = PlanPricingPolicy.AllRegistrationGroups.Except(groups).ToList() };

    // ── Intensity ─────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(PlanSupportType.PersonalCare, SupportIntensity.Standard, "01_011_0107_1_1", 73.58)]
    [InlineData(PlanSupportType.PersonalCare, SupportIntensity.HighIntensity, "01_400_0104_1_1", 79.60)]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Standard, "04_104_0125_6_1", 73.58)]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.HighIntensity, "04_400_0104_1_1", 79.60)]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Icbs, "04_450_0125_1_1", 79.60)]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.Standard, "04_102_0136_6_1", 73.58)]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.HighIntensity, "04_600_0104_6_1", 79.60)]
    [InlineData(PlanSupportType.StaSupport, SupportIntensity.Standard, "01_200_0115_1_1", 73.58)]
    [InlineData(PlanSupportType.StaSupport, SupportIntensity.HighIntensity, "01_252_0115_1_1", 79.60)]
    public void Each_family_and_intensity_finds_its_weekday_item_through_the_classification_map(PlanSupportType type, SupportIntensity intensity, string code, double price)
    {
        var line = Assert.Single(QuoteOne(Weekday(type, intensity), Mon12Oct).Lines);

        Assert.Equal((code, 4m, (decimal)price), (line.ItemCode, line.Qty, line.UnitPrice));
    }

    [Theory]
    [InlineData(PlanSupportType.PersonalCare)]
    [InlineData(PlanSupportType.GroupActivity)]
    [InlineData(PlanSupportType.StaSupport)]
    public void ICBS_exists_only_for_community_access_so_anywhere_else_it_is_an_unpriced_review_line_not_another_item(PlanSupportType type)
    {
        var quote = QuoteOne(Weekday(type, SupportIntensity.Icbs), Mon12Oct);

        var line = Assert.Single(quote.Lines);
        Assert.Equal((null, PlanFailureReason.NoItem, true), (line.ItemCode, line.Unpriced, line.Review));
        Assert.Equal(0m, quote.Totals.Amount);
    }

    // ── Group outings ─────────────────────────────────────────────────────────────

    [Fact]
    public void A_group_outing_is_priced_under_registration_group_0136_by_default_and_under_0125_when_the_provider_says_so()
    {
        var block = Block("g", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });

        var byDefault = Assert.Single(QuoteOne(block, Sat17Oct).Lines);
        var community = Assert.Single(QuoteOne(block, Sat17Oct, PlanPricingPolicy.Default with { GroupOutings = GroupOutingFamily.CommunityAccess }).Lines);

        Assert.Equal(("04_104_0136_6_1", 34.51m, 207.06m), (byDefault.ItemCode, byDefault.UnitPrice, byDefault.Total));
        Assert.Equal(("04_105_0125_6_1", 34.51m, 207.06m), (community.ItemCode, community.UnitPrice, community.Total));   // same price, the community access Saturday item
    }

    // ── Review M8: two workers for several participants is the case NDIA has not answered ──

    [Fact]
    public void Two_workers_for_several_participants_are_priced_but_the_line_is_provisional_and_names_question_5()
    {
        // Workers = 2 for six participants, Saturday 09:00 to 15:00: floor(103.54 x 2 / 6) = 34.51 an hour, 207.06 each, 1,242.36 across the six. If NDIA reads the
        // divisor as price / 6 (17.25 an hour) the plan is twice the limit, so the line has to say the reading is unconfirmed (NDIS-CODES 6, question 5 of 11.3).
        var block = Block("w2", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { Workers = 2, ParticipantsPresent = 6 });

        var quote = QuoteOne(block, Sat17Oct);

        var line = Assert.Single(quote.Lines);
        Assert.Equal(("04_104_0136_6_1", 6m, 34.51m, 207.06m), Row(line));
        Assert.True(line.Provisional);
        Assert.Contains(5, line.Trace.OpenQuestions);
        Assert.Contains("group:workers-over-participants-unconfirmed", line.Trace.Rules);
        Assert.Contains(5, quote.OpenQuestions.Select(q => q.Number));
    }

    [Fact]
    public void Every_part_of_a_two_worker_group_support_that_crosses_a_band_is_marked()
    {
        var block = Block("w2", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(18), T(22), b => b with { Workers = 2, ParticipantsPresent = 2 });

        var quote = QuoteOne(block, Mon12Oct, SplitPolicy);

        Assert.Equal(2, quote.Lines.Count);
        Assert.All(quote.Lines, l =>
        {
            Assert.True(l.Provisional);
            Assert.Contains(5, l.Trace.OpenQuestions);
        });
    }

    [Fact]
    public void One_worker_for_a_group_and_two_workers_for_one_participant_are_not_marked()
    {
        var group = Block("g", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });
        var pair = Block("p", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(9), T(13), b => b with { Workers = 2 });

        foreach (var line in QuoteOne(group, Sat17Oct).Lines.Concat(QuoteOne(pair, Mon12Oct).Lines))
        {
            Assert.False(line.Provisional);
            Assert.DoesNotContain(5, line.Trace.OpenQuestions);
        }
    }

    [Fact]
    public void The_extra_active_hours_of_a_two_worker_group_sleepover_are_marked_like_the_sleepover_line()
    {
        var block = Block("s", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(22), T(6), b => b with
        {
            Workers = 2, ParticipantsPresent = 2, WorkerMaySleep = true, SleepoverActiveHours = 4m,
        });

        var quote = QuoteOne(block, Fri16Oct);

        var active = Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.SleepoverActiveHours);
        Assert.True(active.Provisional);
        Assert.Contains(5, active.Trace.OpenQuestions);
        Assert.True(Assert.Single(quote.Lines, l => l.Kind == PlannedLineKind.Sleepover).Provisional);
    }

    // ── Registration groups ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(PlanSupportType.PersonalCare, SupportIntensity.Standard, "0107", "personal care")]
    [InlineData(PlanSupportType.PersonalCare, SupportIntensity.HighIntensity, "0104", "personal care")]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Standard, "0125", "community access")]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.Icbs, "0125", "community access")]
    [InlineData(PlanSupportType.CommunityAccess, SupportIntensity.HighIntensity, "0104", "community access")]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.Standard, "0136", "group activities")]
    [InlineData(PlanSupportType.GroupActivity, SupportIntensity.HighIntensity, "0104", "group activities")]
    [InlineData(PlanSupportType.StaSupport, SupportIntensity.Standard, "0115", "short-term accommodation support")]
    public void A_family_whose_registration_group_is_off_is_refused_with_a_typed_reason_and_nothing_is_priced(
        PlanSupportType type, SupportIntensity intensity, string group, string family)
    {
        var quote = QuoteOne(Weekday(type, intensity), Mon12Oct, Without(group));

        Assert.Empty(quote.Lines);
        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.RegistrationGroupNotHeld, "b"), (issue.Reason, issue.BlockId));
        Assert.Contains(group, issue.Message);
        Assert.Contains(family, issue.Message);
        Assert.True(quote.NeedsReview);
        // With the group back on, the same block is priced.
        Assert.NotEmpty(QuoteOne(Weekday(type, intensity), Mon12Oct).Lines);
    }

    [Fact]
    public void A_group_that_is_off_refuses_only_the_blocks_that_need_it()
    {
        var community = Weekday(PlanSupportType.CommunityAccess, id: "community");
        var personal = Weekday(PlanSupportType.PersonalCare, id: "personal");

        var quote = Quote(new[] { community, personal }, Mon12Oct, Mon12Oct, Without("0125"));

        Assert.Equal(new[] { "personal" }, quote.Lines.Select(l => l.BlockId));
        Assert.Equal("community", Assert.Single(quote.Issues).BlockId);
        Assert.Equal(new[] { "personal" }, quote.Totals.ByBlock.Select(b => b.BlockId));
        Assert.Equal(294.32m, quote.Totals.Amount);
    }

    [Fact]
    public void The_group_outing_setting_decides_which_registration_group_a_group_block_needs()
    {
        var block = Block("g", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15));
        var communityOutings = PlanPricingPolicy.Default with { GroupOutings = GroupOutingFamily.CommunityAccess };

        Assert.Equal(PlanFailureReason.RegistrationGroupNotHeld, Assert.Single(QuoteOne(block, Sat17Oct, Without("0136")).Issues).Reason);
        Assert.Equal(PlanFailureReason.RegistrationGroupNotHeld, Assert.Single(QuoteOne(block, Sat17Oct, communityOutings with { RegistrationGroupsHeld = new[] { "0136" } }).Issues).Reason);
        Assert.NotEmpty(QuoteOne(block, Sat17Oct, communityOutings with { RegistrationGroupsHeld = new[] { "0125" } }).Lines);
    }

    [Fact]
    public void The_sleepover_needs_registration_group_0107_even_for_a_high_intensity_block_that_holds_0104()
    {
        var block = Block("hi", PlanSupportType.PersonalCare, DayOfWeek.Friday, T(17), T(9), b => b with
        {
            Intensity = SupportIntensity.HighIntensity, WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(22), To = T(6) },
        });

        var quote = QuoteOne(block, Fri16Oct, Without("0107"));

        Assert.Equal(new[] { ("01_400_0104_1_1", 3m, 79.60m, 238.80m), ("01_401_0104_1_1", 2m, 87.70m, 175.40m), ("01_402_0104_1_1", 3m, 112.01m, 336.03m) }, quote.Lines.Where(l => l.IsPriced).Select(Row));
        var night = Assert.Single(quote.Lines, l => !l.IsPriced);
        Assert.Equal((PlannedLineKind.Sleepover, PlanFailureReason.RegistrationGroupNotHeld), (night.Kind, night.Unpriced));
        Assert.Contains("0107", night.Trace.Why);
    }

    [Fact]
    public void Centre_capital_needs_registration_group_0136_and_the_support_itself_is_still_priced_without_it()
    {
        var block = Block("cc", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Setting = PlanSetting.Centre });

        var quote = QuoteOne(block, Mon12Oct, Without("0136"));

        Assert.Equal(("04_104_0125_6_1", 4m, 73.58m, 294.32m), Row(Assert.Single(quote.Lines)));
        var issue = Assert.Single(quote.Issues);
        Assert.Equal(PlanFailureReason.RegistrationGroupNotHeld, issue.Reason);
        Assert.Contains("centre capital", issue.Message);
    }

    [Fact]
    public void Short_term_accommodation_set_to_the_legacy_per_day_items_is_refused_the_builder_does_not_offer_them()
    {
        var sta = Weekday(PlanSupportType.StaSupport, id: "sta");
        var community = Weekday(PlanSupportType.CommunityAccess, id: "community");

        var quote = Quote(new[] { sta, community }, Mon12Oct, Mon12Oct, PlanPricingPolicy.Default with { StaUsesHourlyAndAccommodation = false });

        Assert.Equal(new[] { "community" }, quote.Lines.Select(l => l.BlockId));
        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.StaLegacyNotSupported, "sta"), (issue.Reason, issue.BlockId));
        Assert.Contains("30 June 2027", issue.Message);
    }

    [Fact]
    public void Every_quote_says_the_registration_groups_are_unconfirmed_until_somebody_confirms_them()
    {
        var unconfirmed = QuoteOne(Weekday(PlanSupportType.CommunityAccess), Mon12Oct);
        var confirmed = QuoteOne(Weekday(PlanSupportType.CommunityAccess), Mon12Oct, PlanPricingPolicy.Default with { RegistrationGroupsConfirmed = true });

        var notice = Assert.Single(unconfirmed.Notices);
        Assert.Equal(("registration-groups-not-confirmed", 1), (notice.Code, notice.OpenQuestion));
        Assert.Contains(unconfirmed.OpenQuestions, q => q.Number == 1);
        Assert.Empty(confirmed.Notices);
        Assert.Empty(confirmed.OpenQuestions);
        Assert.False(unconfirmed.NeedsReview);   // a notice is not an issue: it does not block approval
    }

    // ── Policy B and the price change ─────────────────────────────────────────────

    [Fact]
    public async Task Policy_B_prices_a_support_on_the_date_it_starts_so_a_later_December_import_cannot_change_it_while_split_parts_follow_their_own_dates()
    {
        var december = await WithDecemberPriceSetAsync(code => code.StartsWith("01_0", StringComparison.Ordinal) && code.Contains("_0107_", StringComparison.Ordinal));
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(2));
        var monday = new DateOnly(2026, 11, 30);   // the support starts the day before the new prices, and ends on the first day of them

        var higherBefore = QuoteOne(block, monday, HigherOfPolicy);
        var higherAfter = Quote(new[] { block }, monday, monday, HigherOfPolicy, catalogue: december.ToList());
        var splitAfter = Quote(new[] { block }, monday, monday, SplitPolicy, catalogue: december.ToList());

        Assert.Equal(("01_002_0107_1_1", 4m, 82.57m, 330.28m), Row(Assert.Single(higherBefore.Lines)));
        Assert.Equal(Json(higherBefore.Lines), Json(higherAfter.Lines));
        // Split: the Monday evening part is November's price, the Tuesday night part is December's (82.57 + 1.00).
        Assert.Equal(new[] { ("01_015_0107_1_1", 2m, 81.07m, 162.14m), ("01_002_0107_1_1", 2m, 83.57m, 167.14m) }, splitAfter.Lines.Select(Row));
        Assert.Equal(new[] { new DateOnly(2026, 11, 30), new DateOnly(2026, 12, 1) }, splitAfter.Lines.Select(l => l.ServiceDate));
    }

    [Fact]
    public async Task A_companion_line_is_priced_on_the_date_the_occurrence_starts_even_when_the_support_it_follows_is_after_midnight()
    {
        var december = await WithDecemberPriceSetAsync(code => code.StartsWith("01_0", StringComparison.Ordinal) && code.Contains("_0107_", StringComparison.Ordinal));
        var block = Block("x", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(9), b => b with
        {
            WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(22), To = T(6) },
            Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 20, ReturnToBase = true },
        });
        var monday = new DateOnly(2026, 11, 30);

        var before = QuoteOne(block, monday);
        var after = Quote(new[] { block }, monday, monday, catalogue: december.ToList());

        // The first support hour is Tuesday 06:00, a December date, but the travel is claimed on Monday: Monday's price of the item applies.
        var travelBefore = before.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime);
        var travelAfter = after.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime);
        Assert.Equal(("01_011_0107_1_1", 73.58m, monday), (travelAfter.ItemCode, travelAfter.UnitPrice, travelAfter.ServiceDate));
        Assert.Equal(Json(travelBefore), Json(travelAfter));
        Assert.Equal(74.58m, after.Lines.Single(l => l.Kind == PlannedLineKind.Support).UnitPrice);   // the Tuesday support itself is December's
    }

    [Fact]
    public void Policy_B_is_not_applied_with_two_workers_or_a_changing_headcount_and_the_parts_stay_split_and_say_so()
    {
        var twoWorkers = Block("w", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(18), T(22), b => b with { Workers = 2 });
        var changing = Block("h", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(18), T(22), b => b with
        {
            ParticipantsPresent = 2, HeadcountChanges = new[] { new PlanHeadcountChange { From = T(21), ParticipantsPresent = 1 } },
        });

        foreach (var block in new[] { twoWorkers, changing })
        {
            var quote = QuoteOne(block, Mon12Oct, HigherOfPolicy);

            Assert.True(quote.Lines.Count >= 2);
            Assert.All(quote.Lines, l => Assert.Contains("crossing:B-not-applicable", l.Trace.Rules));
            Assert.All(quote.Lines, l => Assert.Equal("A", l.Trace.Policy));
        }

        Assert.Equal(new[] { ("01_011_0107_1_1", 2m, 147.16m, 294.32m), ("01_015_0107_1_1", 2m, 162.14m, 324.28m) }, QuoteOne(twoWorkers, Mon12Oct, HigherOfPolicy).Lines.Select(Row));
    }

    [Theory]
    [InlineData(CrossingPolicy.Split)]
    [InlineData(CrossingPolicy.HigherOf)]
    public void A_split_for_a_headcount_change_alone_is_not_a_crossing_and_is_not_labelled_as_one(CrossingPolicy crossing)
    {
        // Review L6: Saturday 09:00 to 15:00 with the headcount 3 and then 2 is one band cut in two because the number of participants changes, not a support that
        // crosses a band. It carried the rule crossing:A and the policy "A" (and crossing:B-not-applicable under policy B), which is the "why" a coordinator reads.
        var block = Block("e8", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with
        {
            ParticipantsPresent = 3, HeadcountChanges = new[] { new PlanHeadcountChange { From = T(12), ParticipantsPresent = 2 } },
        });

        var quote = QuoteOne(block, Sat17Oct, PlanPricingPolicy.Default with { Crossing = crossing });

        Assert.Equal(2, quote.Lines.Count);
        Assert.All(quote.Lines, l =>
        {
            Assert.Null(l.Trace.Policy);
            Assert.DoesNotContain(l.Trace.Rules, r => r.StartsWith("crossing:", StringComparison.Ordinal));
            Assert.Contains("headcount:segment", l.Trace.Rules);
        });
    }

    [Fact]
    public void A_support_that_crosses_a_band_and_changes_headcount_is_still_a_crossing()
    {
        var block = Block("c", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(18), T(22), b => b with
        {
            ParticipantsPresent = 2, HeadcountChanges = new[] { new PlanHeadcountChange { From = T(21), ParticipantsPresent = 1 } },
        });

        var quote = QuoteOne(block, Mon12Oct, SplitPolicy);

        Assert.Equal(3, quote.Lines.Count);   // 18:00-20:00, 20:00-21:00, 21:00-22:00
        Assert.All(quote.Lines, l =>
        {
            Assert.Equal("A", l.Trace.Policy);
            Assert.Contains("crossing:A", l.Trace.Rules);
        });
    }

    [Fact]
    public void Policy_B_leaves_a_support_that_does_not_cross_a_boundary_as_it_is_and_does_not_mark_it()
    {
        var block = Block("one", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(9), T(13));

        var line = Assert.Single(QuoteOne(block, Mon12Oct, HigherOfPolicy).Lines);

        Assert.Equal(("01_011_0107_1_1", 4m, 73.58m, 294.32m), Row(line));
        Assert.Null(line.Trace.Policy);
        Assert.DoesNotContain("crossing:B", line.Trace.Rules);
    }

    // ── The catalogue has gaps ────────────────────────────────────────────────────

    [Fact]
    public void A_period_before_the_catalogue_starts_has_an_unpriced_review_line_for_every_occurrence_and_one_issue_with_a_count()
    {
        var quote = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 30));

        Assert.Equal(5, quote.Lines.Count);   // 1, 8, 15, 22 and 29 June
        Assert.All(quote.Lines, l => Assert.Equal((null, PlanFailureReason.CatalogueNotFound, true, 0m), (l.ItemCode, l.Unpriced, l.Review, l.Total)));
        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.CatalogueNotFound, 5, new DateOnly(2026, 6, 1)), (issue.Reason, issue.Count, issue.FirstDate));
        Assert.DoesNotContain("2026", issue.Message);   // no date in the text, or fifty occurrences would be fifty issues
        Assert.Equal((5, 5, 0m), (quote.Totals.UnpricedLines, quote.Totals.ReviewLines, quote.Totals.Amount));
        Assert.True(quote.NeedsReview);
    }

    [Fact]
    public void A_period_that_starts_before_the_catalogue_prices_the_occurrences_it_can_and_flags_the_rest()
    {
        var quote = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, new DateOnly(2026, 6, 22), new DateOnly(2026, 7, 13));

        Assert.Equal(new[] { false, false, true, true }, quote.Lines.Select(l => l.IsPriced));
        Assert.Equal(2 * 294.32m, quote.Totals.Amount);
    }

    [Fact]
    public void An_empty_catalogue_prices_nothing_and_says_why_for_every_line()
    {
        var quote = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct, catalogue: Array.Empty<SupportCatalogueItem>());

        Assert.Equal(PlanFailureReason.CatalogueNotFound, Assert.Single(quote.Lines).Unpriced);
    }

    [Fact]
    public void A_row_whose_unit_is_not_hours_is_never_multiplied_by_hours()
    {
        var rows = RealCatalogue.Select(r => r.ItemNumber == "04_104_0125_6_1" ? Copy(r, x => x.Unit = "E") : r).ToList();

        var quote = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct, catalogue: rows);

        var line = Assert.Single(quote.Lines);
        Assert.Equal((null, PlanFailureReason.UnexpectedUnit, 0m), (line.ItemCode, line.Unpriced, line.Total));
    }

    [Fact]
    public void An_item_with_no_remote_price_is_unpriced_for_a_remote_block_and_priced_for_a_national_one()
    {
        var rows = RealCatalogue.Select(r => r.ItemNumber == "04_104_0125_6_1" ? Copy(r, x => x.PriceRemote = null) : r).ToList();
        var remote = Weekday(PlanSupportType.CommunityAccess) with { Location = new PlanLocation { State = "WA", Zone = PriceZone.Remote, Mm = 6 } };

        Assert.Equal(PlanFailureReason.ZoneNotEligible, Assert.Single(Quote(new[] { remote }, Mon12Oct, Mon12Oct, catalogue: rows).Lines).Unpriced);
        Assert.Equal(294.32m, Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct, catalogue: rows).Totals.Amount);
    }

    [Fact]
    public void The_same_catalogue_gap_in_every_week_is_one_issue_with_a_count_whatever_the_reason()
    {
        var weekday = RealCatalogue.Single(r => r.ItemNumber == "04_104_0125_6_1");
        var noRemote = RealCatalogue.Select(r => r.ItemNumber == "04_104_0125_6_1" ? Copy(r, x => x.PriceRemote = null) : r).ToList();
        var quotable = RealCatalogue.Select(r => r.ItemNumber == "04_104_0125_6_1" ? Copy(r, x => x.PriceNational = null) : r).ToList();
        var remote = Weekday(PlanSupportType.CommunityAccess) with { Location = new PlanLocation { State = "WA", Zone = PriceZone.Remote, Mm = 6 } };

        var zone = Quote(new[] { remote }, Mon12Oct, Mon12Oct.AddDays(20), catalogue: noRemote);
        var priced = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct.AddDays(20), catalogue: quotable);

        Assert.Equal(3, zone.Lines.Count);
        Assert.Equal((PlanFailureReason.ZoneNotEligible, 3), (Assert.Single(zone.Issues).Reason, zone.Issues[0].Count));
        Assert.Equal((PlanFailureReason.CatalogueNotPriced, 3), (Assert.Single(priced.Issues).Reason, priced.Issues[0].Count));
        Assert.Contains(weekday.ItemNumber, zone.Issues[0].Message);
        Assert.DoesNotContain("2026", zone.Issues[0].Message);
        Assert.DoesNotContain("2026", priced.Issues[0].Message);
    }

    // ── The request ───────────────────────────────────────────────────────────────

    [Fact]
    public void A_block_with_a_missing_headcount_list_is_refused_with_the_message_and_the_others_are_priced()
    {
        var noList = Weekday(PlanSupportType.CommunityAccess, id: "no-list") with { HeadcountChanges = null! };
        var nullEntry = Weekday(PlanSupportType.CommunityAccess, id: "null-entry") with { HeadcountChanges = new PlanHeadcountChange[] { null! } };

        var quote = Quote(new[] { Weekday(PlanSupportType.CommunityAccess, id: "good"), noList, nullEntry }, Mon12Oct, Mon12Oct.AddDays(14));

        Assert.Equal(new[] { "good" }, quote.Lines.Select(l => l.BlockId).Distinct());
        Assert.Equal(new[] { "no-list", "null-entry" }, quote.Issues.Select(i => i.BlockId));
        Assert.All(quote.Issues, i => { Assert.Equal(PlanFailureReason.InvalidInput, i.Reason); Assert.Contains("headcount changes must be a list", i.Message); });
    }

    [Fact]
    public void A_missing_block_in_the_list_is_an_issue_not_a_crash()
    {
        var quote = Quote(new PlanBlock?[] { Weekday(PlanSupportType.CommunityAccess), null }!, Mon12Oct, Mon12Oct);

        Assert.Single(quote.Lines);
        Assert.Equal(PlanFailureReason.InvalidInput, Assert.Single(quote.Issues).Reason);
    }

    [Fact]
    public void A_null_request_is_a_programming_error_and_an_empty_one_is_an_empty_quote()
    {
        Assert.Throws<ArgumentNullException>(() => PlanPricingEngine.Quote(null!));

        var empty = Quote(Array.Empty<PlanBlock>(), Mon12Oct, Mon12Oct);
        Assert.Empty(empty.Lines);
        Assert.Equal(0m, empty.Totals.Amount);
        Assert.False(empty.NeedsReview);
    }

    [Fact]
    public void A_period_that_ends_before_it_starts_or_runs_past_the_limit_prices_nothing_and_says_so()
    {
        var backwards = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct.AddDays(-1));
        var forever = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct.AddDays(PlanPricingEngine.MaxPeriodDays));
        var longest = Quote(new[] { Weekday(PlanSupportType.CommunityAccess) }, Mon12Oct, Mon12Oct.AddDays(PlanPricingEngine.MaxPeriodDays - 1));

        Assert.Empty(backwards.Lines);
        Assert.Equal(PlanFailureReason.InvalidInput, Assert.Single(backwards.Issues).Reason);
        Assert.Empty(forever.Lines);
        Assert.Contains("longer than", Assert.Single(forever.Issues).Message);
        Assert.NotEmpty(longest.Lines);
    }

    [Fact]
    public void A_period_outside_the_years_2000_to_2100_is_refused_so_no_date_arithmetic_can_overflow()
    {
        var block = Weekday(PlanSupportType.CommunityAccess) with { Days = Enum.GetValues<DayOfWeek>().ToArray() };
        var early = Quote(new[] { block }, new DateOnly(1999, 12, 30), new DateOnly(2000, 1, 5));
        var late = Quote(new[] { block }, new DateOnly(2100, 12, 25), new DateOnly(2101, 1, 2));
        var atTheEdge = Quote(new[] { block }, DateOnly.MaxValue.AddDays(-3), DateOnly.MaxValue);

        foreach (var quote in new[] { early, late, atTheEdge })
        {
            Assert.Empty(quote.Lines);
            Assert.Contains("2000", Assert.Single(quote.Issues).Message);
        }

        Assert.NotEmpty(Quote(new[] { block }, new DateOnly(2000, 1, 1), new DateOnly(2000, 1, 7)).Lines);
        Assert.NotEmpty(Quote(new[] { block }, new DateOnly(2100, 12, 25), new DateOnly(2100, 12, 31)).Lines);
    }

    [Fact]
    public void A_day_that_is_not_a_day_of_the_week_never_reaches_the_date_arithmetic()
    {
        var block = Weekday(PlanSupportType.CommunityAccess) with { Days = new[] { (DayOfWeek)(-3), (DayOfWeek)99, DayOfWeek.Monday } };

        var quote = Quote(new[] { block }, new DateOnly(2000, 1, 1), new DateOnly(2000, 1, 31));

        Assert.Empty(quote.Lines);
        Assert.Contains(quote.Issues, i => i.Reason == PlanFailureReason.InvalidInput && i.Message.Contains("day of the week"));
    }

    [Fact]
    public void Too_many_blocks_prices_nothing()
    {
        var blocks = Enumerable.Range(0, PlanPricingEngine.MaxBlocks + 1).Select(i => Weekday(PlanSupportType.CommunityAccess, id: $"b{i}")).ToList();

        var quote = Quote(blocks, Mon12Oct, Mon12Oct);

        Assert.Empty(quote.Lines);
        Assert.Contains("at most", Assert.Single(quote.Issues).Message);
        Assert.Equal(PlanPricingEngine.MaxBlocks, Quote(blocks.Take(PlanPricingEngine.MaxBlocks).ToList(), Mon12Oct, Mon12Oct).Totals.ByBlock.Count);
    }

    [Fact]
    public void A_plan_with_more_occurrences_than_the_limit_is_refused_and_one_inside_it_is_priced()
    {
        var everyDay = Enum.GetValues<DayOfWeek>().ToArray();
        PlanBlock Daily(int i) => Weekday(PlanSupportType.CommunityAccess, id: $"d{i}") with { Days = everyDay };

        var tooMany = Quote(Enumerable.Range(0, 32).Select(Daily).ToList(), Mon12Oct, Mon12Oct.AddDays(PlanPricingEngine.MaxPeriodDays - 1));   // 32 x 800 = 25,600
        var within = Quote(Enumerable.Range(0, 20).Select(Daily).ToList(), Mon12Oct, Mon12Oct.AddDays(364));                                      // 20 x 365 = 7,300

        Assert.Empty(tooMany.Lines);
        Assert.Contains(PlanPricingEngine.MaxOccurrences.ToString("N0", System.Globalization.CultureInfo.InvariantCulture), Assert.Single(tooMany.Issues).Message);
        Assert.Equal(7300, within.Lines.Count);
        Assert.Equal(PlanFailureReason.InvalidInput, tooMany.Issues[0].Reason);
    }

    [Fact]
    public void A_quote_that_would_make_more_lines_than_the_ceiling_is_refused_before_anything_is_priced()
    {
        // 15 blocks of 24 hours every day with the most headcount changes a block may have: 12,000 occurrences (inside the occurrence limit)
        // but about 280,000 lines, each with a trace. The request is under 1 MiB, which is why the line estimate is the guard that counts.
        var everyDay = Enum.GetValues<DayOfWeek>().ToArray();
        PlanBlock Heavy(int i) => new()
        {
            Id = $"h{i}", SupportType = PlanSupportType.PersonalCare, Days = everyDay, Start = T(0), End = T(0), ParticipantsPresent = 5, Location = new PlanLocation { State = "NSW" },
            HeadcountChanges = Enumerable.Range(1, PlanBlock.MaxHeadcountChanges).Select(k => new PlanHeadcountChange { From = new TimeOnly(k, 0), ParticipantsPresent = 1 + k % 4 }).ToList(),
        };
        var blocks = Enumerable.Range(0, 15).Select(Heavy).ToList();
        Assert.All(blocks, b => Assert.Empty(b.Validate()));

        var quote = Quote(blocks, Mon12Oct, Mon12Oct.AddDays(PlanPricingEngine.MaxPeriodDays - 1));

        Assert.Empty(quote.Lines);
        var issue = Assert.Single(quote.Issues);
        Assert.Equal(PlanFailureReason.InvalidInput, issue.Reason);
        Assert.Contains(PlanPricingEngine.MaxEstimatedLines.ToString("N0", System.Globalization.CultureInfo.InvariantCulture), issue.Message);
        Assert.Contains("headcount changes", issue.Message);
    }

    [Fact]
    public void A_plan_at_the_documented_limits_with_no_headcount_changes_still_prices()
    {
        // 200 blocks, one weekday each, over 800 days: about 23,000 occurrences and as many lines. The blocks are fifteen minutes at different times of day,
        // so none overlaps another and the estimate (a few lines an occurrence) stays well under the ceiling.
        var blocks = Enumerable.Range(0, 200).Select(i => Block($"w{i}", PlanSupportType.PersonalCare, (DayOfWeek)(i % 7), T(0).AddMinutes(i / 7 * 30), T(0).AddMinutes(i / 7 * 30 + 15))).ToList();
        var from = Mon12Oct;
        var to = Mon12Oct.AddDays(PlanPricingEngine.MaxPeriodDays - 1);
        var expected = blocks.Sum(b => Enumerable.Range(0, PlanPricingEngine.MaxPeriodDays).Count(d => from.AddDays(d).DayOfWeek == b.Days[0]));
        Assert.InRange(expected, 22_000, PlanPricingEngine.MaxOccurrences);

        var quote = Quote(blocks, from, to);

        Assert.DoesNotContain(quote.Issues, i => i.Reason == PlanFailureReason.InvalidInput);
        Assert.Equal(expected, quote.Lines.Count(l => l.Kind == PlannedLineKind.Support));
        Assert.Equal(200, quote.Totals.ByBlock.Count);
    }

    [Fact]
    public void A_block_that_breaks_a_rule_or_repeats_an_id_is_refused_with_its_messages_and_the_others_are_priced()
    {
        var good = Weekday(PlanSupportType.CommunityAccess, id: "good");
        var bad = good with { Id = "bad", Workers = 0, Days = Array.Empty<DayOfWeek>() };
        var twin = good with { SupportType = PlanSupportType.PersonalCare };

        var quote = Quote(new[] { good, bad, twin }, Mon12Oct, Mon12Oct);

        Assert.Equal(new[] { "good" }, quote.Lines.Select(l => l.BlockId));
        Assert.Equal(2, quote.Issues.Count(i => i.BlockId == "bad"));
        Assert.All(quote.Issues.Where(i => i.BlockId == "bad"), i => Assert.Equal(PlanFailureReason.InvalidInput, i.Reason));
        Assert.Contains(quote.Issues, i => i.BlockId == "good" && i.Message.Contains("same id"));
    }

    // ── Review M5: blocks that overlap in time ────────────────────────────────────

    private static PlanBlock At(string id, PlanSupportType type, DayOfWeek day, TimeOnly start, TimeOnly end) => Block(id, type, day, start, end);

    [Fact]
    public void Two_blocks_that_overlap_in_time_on_the_same_date_raise_one_review_issue_naming_both_and_still_price_both()
    {
        var a = At("a", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));
        var b = At("b", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(12), T(14));

        var quote = Quote(new[] { a, b }, Mon12Oct, Mon12Oct.AddDays(14));   // three Mondays

        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.BlocksOverlap, "a", 3, Mon12Oct), (issue.Reason, issue.BlockId, issue.Count, issue.FirstDate));
        Assert.Contains("'a'", issue.Message);
        Assert.Contains("'b'", issue.Message);
        Assert.Contains("Workers", issue.Message);                                 // the way to say two workers
        Assert.DoesNotContain("2026", issue.Message);
        Assert.True(quote.NeedsReview);
        Assert.Equal(6, quote.Lines.Count);                                      // nothing is dropped: a person decides
    }

    [Fact]
    public void Blocks_that_touch_or_sit_on_different_days_do_not_overlap_and_neither_does_one_block_with_two_workers()
    {
        var morning = At("morning", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));
        var afternoon = At("afternoon", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(13), T(17));   // starts as the first ends
        var tuesday = At("tuesday", PlanSupportType.CommunityAccess, DayOfWeek.Tuesday, T(9), T(13));
        var twoWorkers = At("two", PlanSupportType.CommunityAccess, DayOfWeek.Wednesday, T(9), T(13)) with { Workers = 2 };

        var quote = Quote(new[] { morning, afternoon, tuesday, twoWorkers }, Mon12Oct, Mon12Oct.AddDays(6));

        Assert.DoesNotContain(quote.Issues, i => i.Reason == PlanFailureReason.BlocksOverlap);
    }

    [Fact]
    public void A_support_that_runs_past_midnight_overlaps_a_block_on_the_next_day()
    {
        var late = At("late", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(2));
        var early = At("early", PlanSupportType.PersonalCare, DayOfWeek.Tuesday, T(1), T(3));
        var after = At("after", PlanSupportType.PersonalCare, DayOfWeek.Tuesday, T(2), T(4));

        var quote = Quote(new[] { late, early, after }, Mon12Oct, Mon12Oct.AddDays(1));

        // 'late' (Monday 22:00 to Tuesday 02:00) and 'early' (Tuesday 01:00 to 03:00) overlap for an hour; 'after' starts as 'late' ends, but 'early' runs into it.
        var issues = quote.Issues.Where(i => i.Reason == PlanFailureReason.BlocksOverlap).ToList();
        Assert.Equal(new[] { "late", "early" }, issues.Select(i => i.BlockId));
        Assert.Contains("'late'", issues[0].Message);
        Assert.Contains("'early'", issues[0].Message);
        Assert.Contains("'early'", issues[1].Message);
        Assert.Contains("'after'", issues[1].Message);
        Assert.Equal(new DateOnly[] { Mon12Oct, Mon12Oct.AddDays(1) }, issues.Select(i => i.FirstDate!.Value));
    }

    [Fact]
    public void An_occurrence_that_is_skipped_for_a_holiday_or_a_block_that_is_refused_overlaps_nothing()
    {
        var a = At("a", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13)) with { OnPublicHoliday = HolidayDecision.Skip };
        var b = At("b", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(12), T(14)) with { OnPublicHoliday = HolidayDecision.Skip };
        var refused = At("refused", PlanSupportType.PersonalCare, DayOfWeek.Tuesday, T(9), T(13));
        var other = At("other", PlanSupportType.CommunityAccess, DayOfWeek.Tuesday, T(9), T(13));
        var holiday = new HolidayEntry(Mon12Oct, "NSW", "A holiday", null, null, "test");

        var quote = Quote(new[] { a, b, refused, other }, Mon12Oct, Mon12Oct.AddDays(1), Without("0107"), new[] { holiday });

        Assert.DoesNotContain(quote.Issues, i => i.Reason == PlanFailureReason.BlocksOverlap);
        Assert.Contains(quote.Issues, i => i.Reason == PlanFailureReason.RegistrationGroupNotHeld);
    }

    [Fact]
    public void Three_blocks_on_top_of_each_other_are_three_pairs()
    {
        var blocks = new[] { "a", "b", "c" }.Select(id => At(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13))).ToList();

        var quote = Quote(blocks, Mon12Oct, Mon12Oct);

        Assert.Equal(new[] { "a", "a", "b" }, quote.Issues.Where(i => i.Reason == PlanFailureReason.BlocksOverlap).Select(i => i.BlockId));
    }

    // ── Totals, order and the cancellation ceiling ────────────────────────────────

    [Fact]
    public void Totals_add_up_by_category_and_by_block_and_the_open_questions_are_the_ones_the_lines_name()
    {
        var community = Weekday(PlanSupportType.CommunityAccess, id: "community") with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 20, ReturnToBase = true } };
        var personal = Weekday(PlanSupportType.PersonalCare, id: "personal");

        var quote = Quote(new[] { community, personal }, Mon12Oct, Mon12Oct);

        Assert.Equal(quote.Totals.Amount, quote.Totals.ByCategory.Sum(c => c.Amount));
        Assert.Equal(quote.Totals.Amount, quote.Totals.ByBlock.Sum(b => b.Amount));
        Assert.Equal(new[] { 1, 4 }, quote.Totals.ByCategory.Select(c => c.PaceCategory));
        Assert.Equal(new[] { 1, 6 }, quote.OpenQuestions.Select(q => q.Number));   // unconfirmed registration groups, and the travel rates
        Assert.Equal(1, quote.Totals.ProvisionalLines);
        Assert.Equal(294.32m + 294.32m + quote.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime).Total, quote.Totals.Amount);
    }

    [Fact]
    public void The_lines_come_out_in_block_order_then_date_and_time_whatever_the_order_the_days_were_given_in()
    {
        var a = Block("a", PlanSupportType.CommunityAccess, DayOfWeek.Wednesday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Wednesday, DayOfWeek.Monday } });
        var b2 = Block("b", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(8), T(9));

        var quote = Quote(new[] { b2, a }, Mon12Oct, Mon12Oct.AddDays(2));

        Assert.Equal(new[] { ("b", Mon12Oct), ("a", Mon12Oct), ("a", Mon12Oct.AddDays(2)) }, quote.Lines.Select(l => (l.BlockId, l.ServiceDate)));
    }

    [Fact]
    public void The_cancellation_ceiling_is_the_planned_line_only_inside_seven_days_and_only_for_a_priced_item_that_allows_it()
    {
        var quote = QuoteOne(Weekday(PlanSupportType.CommunityAccess) with { Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 20 } }, Mon12Oct);
        var support = quote.Lines.Single(l => l.Kind == PlannedLineKind.Support);
        var travel = quote.Lines.Single(l => l.Kind == PlannedLineKind.ProviderTravelTime);
        var unpriced = Assert.Single(QuoteOne(Weekday(PlanSupportType.PersonalCare, SupportIntensity.Icbs), Mon12Oct).Lines);

        Assert.Equal((294.32m, 0m, 294.32m), (PlanCancellation.MaximumClaim(support, 0), PlanCancellation.MaximumClaim(support, 7), PlanCancellation.MaximumClaim(support, 6)));
        Assert.Equal(0m, PlanCancellation.MaximumClaim(travel, 1));
        Assert.Equal(0m, PlanCancellation.MaximumClaim(unpriced, 1));
        Assert.Throws<ArgumentNullException>(() => PlanCancellation.MaximumClaim(null!, 1));
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
