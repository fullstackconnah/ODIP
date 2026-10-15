using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// A change to one roster pattern of an approved agreement, as the blocks of the next revision (agreement PR 1, decisions D5, D7 and D13). Pure: blocks in, blocks out, or the reason in words.
/// </summary>
public class AgreementBlockChangeTests
{
    private static readonly DayOfWeek[] Weekdays = { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday };
    private static readonly DraftBlockRequirementsDto Female = new() { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } };

    private static DraftBlockDto Entry(PlanBlock block) => new() { Block = block, Requirements = Female };

    private static List<DraftBlockDto> Plan(params PlanBlock[] blocks) => blocks.Select(Entry).ToList();

    private static PlanBlock Mornings(string id = "weekdays") => Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = Weekdays });

    /// <summary>The pattern the approval made for that block, day and first worker: made by the mapper itself, so it is the real one.</summary>
    private static ShiftPattern PatternOf(IReadOnlyList<DraftBlockDto> blocks, string blockId, DayOfWeek day) =>
        AgreementPatternMapper.Map(new ServiceAgreementDraft { Id = Guid.NewGuid(), Version = 1, State = "NSW", AgreementStartDate = new DateOnly(2026, 10, 12), AgreementEndDate = new DateOnly(2026, 12, 20) }, blocks)
            .First(p => p.SourceBlockKey == blockId && p.DayOfWeek == day && p.WorkerSlot == 1);

    private static AgreementPatternChangeDto Keep(ShiftPattern p) => new()
    {
        PatternId = p.Id, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay, Ratio = p.Ratio, NightType = p.NightType,
    };

    private static List<DraftBlockDto> Applied(IReadOnlyList<DraftBlockDto> blocks, ShiftPattern pattern, AgreementPatternChangeDto change)
    {
        var (result, error) = AgreementBlockChange.Apply(blocks, pattern, change);
        Assert.Null(error);
        return result!;
    }

    private static string Refused(IReadOnlyList<DraftBlockDto> blocks, ShiftPattern pattern, AgreementPatternChangeDto change)
    {
        var (result, error) = AgreementBlockChange.Apply(blocks, pattern, change);
        Assert.Null(result);
        return error!;
    }


    [Fact]
    public void One_day_of_a_weekday_block_splits_it_the_block_keeps_its_id_and_other_days_and_the_day_follows_it_with_the_same_asks()
    {
        var blocks = Plan(Mornings(), Block("sat", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(10), T(12)));
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);

        var result = Applied(blocks, monday, Keep(monday) with { EndTime = T(14) });

        Assert.Equal(new[] { "weekdays", "weekdays-mon", "sat" }, result.Select(b => b.Block.Id));
        Assert.Equal(new[] { DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday }, result[0].Block.Days);
        Assert.Equal((T(9), T(13)), (result[0].Block.Start, result[0].Block.End));
        Assert.Equal(new[] { DayOfWeek.Monday }, result[1].Block.Days);
        Assert.Equal((T(9), T(14), PlanSupportType.CommunityAccess), (result[1].Block.Start, result[1].Block.End, result[1].Block.SupportType));
        Assert.Same(Female, result[1].Requirements);
        Assert.Same(blocks[1], result[2]);                                                         // another block is not touched
    }

    [Fact]
    public void A_block_of_one_day_is_changed_in_place_with_its_id_and_its_place()
    {
        var blocks = Plan(Mornings(), Block("sat", PlanSupportType.PersonalCare, DayOfWeek.Saturday, T(10), T(12)));
        var saturday = PatternOf(blocks, "sat", DayOfWeek.Saturday);

        var result = Applied(blocks, saturday, Keep(saturday) with { DayOfWeek = DayOfWeek.Sunday, StartTime = T(11), EndTime = T(15) });

        Assert.Equal(new[] { "weekdays", "sat" }, result.Select(b => b.Block.Id));
        Assert.Equal(new[] { DayOfWeek.Sunday }, result[1].Block.Days);
        Assert.Equal((T(11), T(15)), (result[1].Block.Start, result[1].Block.End));
        Assert.Same(blocks[0], result[0]);
    }

    [Fact]
    public void Every_day_changes_the_whole_block_in_place_and_cannot_move_a_day()
    {
        var blocks = Plan(Mornings());
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);

        var block = Assert.Single(Applied(blocks, monday, Keep(monday) with { StartTime = T(10), EndTime = T(14), AllDays = true })).Block;

        Assert.Equal(("weekdays", T(10), T(14)), (block.Id, block.Start, block.End));
        Assert.Equal(Weekdays, block.Days);
        Assert.Contains("keeps its days", Refused(blocks, monday, Keep(monday) with { DayOfWeek = DayOfWeek.Saturday, AllDays = true }));
    }

    [Fact]
    public void Moving_one_day_to_a_day_the_block_has_not_got_splits_it_and_to_one_it_has_is_refused()
    {
        var blocks = Plan(Mornings());
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);

        var moved = Applied(blocks, monday, Keep(monday) with { DayOfWeek = DayOfWeek.Saturday });

        Assert.Equal(new[] { "weekdays", "weekdays-sat" }, moved.Select(b => b.Block.Id));
        Assert.Equal(new[] { DayOfWeek.Saturday }, moved[1].Block.Days);
        Assert.Equal("This support is already on Tuesday. Pick another day, or change that day's pattern.", Refused(blocks, monday, Keep(monday) with { DayOfWeek = DayOfWeek.Tuesday }));
    }

    [Theory]
    [InlineData(SupportRatio.OneToTwo, 1, 2)]
    [InlineData(SupportRatio.TwoToOne, 2, 1)]
    [InlineData(SupportRatio.OneToFive, 1, 5)]
    public void A_new_ratio_is_the_blocks_workers_and_participants_present(SupportRatio ratio, int workers, int present)
    {
        var blocks = Plan(Mornings());
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);

        var changed = Assert.Single(Applied(blocks, monday, Keep(monday) with { Ratio = ratio, AllDays = true })).Block;

        Assert.Equal((workers, present), (changed.Workers, changed.ParticipantsPresent));
        Assert.Equal(ratio, AgreementPatternMapper.RatioOf(changed.Workers, changed.ParticipantsPresent));
    }


    [Fact]
    public void A_ratio_the_roster_cannot_count_participants_from_is_refused_and_an_unchanged_one_keeps_the_blocks_own()
    {
        var shared = Plan(Mornings() with { ParticipantsPresent = 7 });                            // shared support: one worker for seven
        var sharedMonday = PatternOf(shared, "weekdays", DayOfWeek.Monday);
        Assert.Equal(SupportRatio.SharedSupport, sharedMonday.Ratio);

        var later = Assert.Single(Applied(shared, sharedMonday, Keep(sharedMonday) with { EndTime = T(14), AllDays = true })).Block;

        Assert.Equal((1, 7), (later.Workers, later.ParticipantsPresent));
        var blocks = Plan(Mornings());
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);
        Assert.Contains("cannot be priced for that ratio", Refused(blocks, monday, Keep(monday) with { Ratio = SupportRatio.SharedSupport }));
        Assert.Contains("cannot be priced for that ratio", Refused(blocks, monday, Keep(monday) with { Ratio = SupportRatio.Other }));
    }

    [Fact]
    public void A_pattern_edited_by_hand_before_agreement_pr1_is_read_against_its_block_and_its_ratio_is_kept_not_reverted()
    {
        var blocks = Plan(Mornings());                                                              // one worker for one
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);
        monday.Ratio = SupportRatio.OneToTwo;                                                        // changed by hand on the Patterns page, which the server allowed until now

        var later = Applied(blocks, monday, Keep(monday) with { EndTime = T(14) })[1].Block;          // the panel shows 1:2, and only the time is changed
        var same = Applied(blocks, monday, Keep(monday))[1].Block;                                   // asking for what the roster has is a change to the agreement, not "nothing to change"

        Assert.Equal((1, 2, T(14)), (later.Workers, later.ParticipantsPresent, later.End));
        Assert.Equal((1, 2, T(13)), (same.Workers, same.ParticipantsPresent, same.End));
    }

    [Fact]
    public void A_sleepover_sets_worker_may_sleep_and_leaving_one_clears_its_window_and_active_hours()
    {
        var night = Block("night", PlanSupportType.PersonalCare, DayOfWeek.Monday, T(22), T(6), b => b with
        {
            Setting = PlanSetting.AtHome, WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(23), To = T(5) }, SleepoverActiveHours = 1m,
        });
        var blocks = Plan(night);
        var pattern = PatternOf(blocks, "night", DayOfWeek.Monday);
        Assert.Equal(SleepoverType.Sleepover, pattern.NightType);

        var active = Assert.Single(Applied(blocks, pattern, Keep(pattern) with { NightType = SleepoverType.ActiveNight })).Block;

        Assert.Equal((false, (PlanSleepoverWindow?)null, 0m), (active.WorkerMaySleep, active.SleepoverWindow, active.SleepoverActiveHours));
        Assert.Empty(active.Validate());                                                           // a window left behind would be "a sleepover window needs 'worker may sleep'"
        var activeBlocks = Plan(active);
        var activePattern = PatternOf(activeBlocks, "night", DayOfWeek.Monday);
        Assert.True(Assert.Single(Applied(activeBlocks, activePattern, Keep(activePattern) with { NightType = SleepoverType.Sleepover })).Block.WorkerMaySleep);
    }

    [Fact]
    public void A_night_type_a_next_day_end_or_a_day_the_block_cannot_have_is_refused_in_words()
    {
        var blocks = Plan(Mornings());
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);

        Assert.Contains("An active night runs past midnight", Refused(blocks, monday, Keep(monday) with { NightType = SleepoverType.ActiveNight }));
        Assert.Contains("an active night or a sleepover", Refused(blocks, monday, Keep(monday) with { NightType = SleepoverType.PassiveNight }));
        Assert.Contains("runs past midnight is an active night or a sleepover", Refused(blocks, monday, Keep(monday) with { EndTime = T(2), EndsNextDay = true }));
        Assert.Contains("Tick ends the next day", Refused(blocks, monday, Keep(monday) with { StartTime = T(22), EndTime = T(6) }));
        Assert.Contains("untick ends the next day", Refused(blocks, monday, Keep(monday) with { EndsNextDay = true }));
        Assert.Equal("Pick a day of the week.", Refused(blocks, monday, Keep(monday) with { DayOfWeek = (DayOfWeek)9 }));
    }

    [Fact]
    public void A_split_blocks_id_is_numbered_on_when_taken_and_cut_to_fit_64_characters()
    {
        var taken = Plan(Mornings(), Block("weekdays-mon", PlanSupportType.PersonalCare, DayOfWeek.Sunday, T(10), T(12)));
        var monday = PatternOf(taken, "weekdays", DayOfWeek.Monday);
        Assert.Equal("weekdays-mon-2", Applied(taken, monday, Keep(monday) with { EndTime = T(14) })[1].Block.Id);

        var longId = new string('b', PlanBlock.MaxIdLength);
        var longPlan = Plan(Mornings(longId));
        var longMonday = PatternOf(longPlan, longId, DayOfWeek.Monday);
        var split = Applied(longPlan, longMonday, Keep(longMonday) with { EndTime = T(14) })[1].Block;
        Assert.Equal(new string('b', PlanBlock.MaxIdLength - 7) + "-mon", split.Id);
        Assert.Empty(split.Validate());
    }

    [Fact]
    public void A_pattern_whose_block_is_gone_or_a_change_that_changes_nothing_is_refused()
    {
        var blocks = Plan(Mornings());
        var monday = PatternOf(blocks, "weekdays", DayOfWeek.Monday);

        Assert.Contains("not in the agreement any more", Refused(Plan(Mornings("other")), monday, Keep(monday) with { EndTime = T(14) }));
        Assert.Contains("Nothing to change", Refused(blocks, monday, Keep(monday)));
    }
}
