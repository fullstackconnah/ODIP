using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// What a block of an approved agreement revision becomes on the roster: one pattern for each weekday it lists and each worker it asks for at once, with the ratio and night type the
/// roster already uses. The table is the owner-visible default of phase D, so each row of it is a test.
/// </summary>
public class AgreementPatternMapperTests
{
    private static readonly Guid Tenant = Guid.NewGuid(), Participant = Guid.NewGuid();

    private static ServiceAgreementDraft Draft(int version = 2) => new()
    {
        Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = Participant, Version = version, State = "NSW",
        AgreementStartDate = new DateOnly(2026, 10, 12), AgreementEndDate = new DateOnly(2027, 4, 11), PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
    };

    private static PlanBlock Block(string id, PlanSupportType type, DayOfWeek[] days, int startHour, int endHour, Func<PlanBlock, PlanBlock>? change = null)
    {
        var block = new PlanBlock { Id = id, SupportType = type, Days = days, Start = new TimeOnly(startHour, 0), End = new TimeOnly(endHour, 0), Location = new PlanLocation { State = "NSW" } };
        return change is null ? block : change(block);
    }

    private static readonly DayOfWeek[] Weekdays = { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday };

    private static IReadOnlyList<ShiftPattern> Map(ServiceAgreementDraft draft, params (PlanBlock Block, DraftBlockRequirementsDto? Requirements)[] blocks) =>
        AgreementPatternMapper.Map(draft, blocks.Select(b => new DraftBlockDto { Block = b.Block, Requirements = b.Requirements ?? new DraftBlockRequirementsDto() }).ToList());

    private static IReadOnlyList<ShiftPattern> Map(PlanBlock block, ServiceAgreementDraft? draft = null) => Map(draft ?? Draft(), (block, null));

    [Fact]
    public void A_weekday_daytime_one_to_one_block_is_one_pattern_for_each_listed_day_that_does_not_cross_midnight()
    {
        var draft = Draft();

        var patterns = Map(Block("community-weekdays", PlanSupportType.CommunityAccess, Weekdays, 9, 13), draft);

        Assert.Equal(Weekdays, patterns.Select(p => p.DayOfWeek));
        Assert.All(patterns, p =>
        {
            Assert.Equal((new TimeOnly(9, 0), new TimeOnly(13, 0), false), (p.StartTime, p.EndTime, p.EndsNextDay));
            Assert.Equal((SupportRatio.OneToOne, SleepoverType.None, 1), (p.Ratio, p.NightType, p.WorkerSlot));
            Assert.Equal((draft.Id, "community-weekdays", Tenant, Participant), (p.SourceDraftId, p.SourceBlockKey, p.TenantId, p.ParticipantId));
            Assert.Equal((true, (Guid?)null), (p.IsActive, p.DefaultUserId));
            Assert.NotEqual(Guid.Empty, p.Id);
        });
        Assert.Equal(5, patterns.Select(p => p.Id).Distinct().Count());
    }

    [Fact]
    public void The_pattern_covers_the_agreements_own_dates_both_ends_included_whatever_today_is()
    {
        var patterns = Map(Block("b", PlanSupportType.PersonalCare, new[] { DayOfWeek.Saturday }, 9, 12));

        var pattern = Assert.Single(patterns);
        Assert.Equal((new DateOnly(2026, 10, 12), (DateOnly?)new DateOnly(2027, 4, 11)), (pattern.EffectiveFrom, pattern.EffectiveTo));
    }

    [Fact]
    public void A_block_that_crosses_midnight_is_an_active_night_that_starts_on_the_listed_day()
    {
        var patterns = Map(Block("late", PlanSupportType.PersonalCare, new[] { DayOfWeek.Monday }, 22, 2));

        var pattern = Assert.Single(patterns);
        Assert.Equal((DayOfWeek.Monday, new TimeOnly(22, 0), new TimeOnly(2, 0), true, SleepoverType.ActiveNight), (pattern.DayOfWeek, pattern.StartTime, pattern.EndTime, pattern.EndsNextDay, pattern.NightType));
    }

    [Fact]
    public void A_block_where_the_worker_may_sleep_is_a_sleepover_for_each_of_its_seven_nights()
    {
        var every = Enum.GetValues<DayOfWeek>();
        var block = Block("overnight-sleepover", PlanSupportType.PersonalCare, every, 22, 6, b => b with { WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = new TimeOnly(22, 0), To = new TimeOnly(6, 0) } });

        var patterns = Map(block);

        Assert.Equal(7, patterns.Count);
        Assert.All(patterns, p => Assert.Equal((true, SleepoverType.Sleepover), (p.EndsNextDay, p.NightType)));
    }

    [Fact]
    public void A_twenty_four_hour_block_has_the_same_start_and_end_and_ends_the_next_day()
    {
        var block = Block("respite", PlanSupportType.StaSupport, new[] { DayOfWeek.Friday, DayOfWeek.Saturday }, 16, 16, b => b with { Setting = PlanSetting.Accommodation });

        var patterns = Map(block);

        Assert.Equal(new[] { DayOfWeek.Friday, DayOfWeek.Saturday }, patterns.Select(p => p.DayOfWeek));
        Assert.All(patterns, p => Assert.Equal((new TimeOnly(16, 0), new TimeOnly(16, 0), true, SleepoverType.ActiveNight), (p.StartTime, p.EndTime, p.EndsNextDay, p.NightType)));   // 24 hours, nobody asleep: an active night
        Assert.All(Map(block with { WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = new TimeOnly(22, 0), To = new TimeOnly(6, 0) } }), p => Assert.Equal(SleepoverType.Sleepover, p.NightType));
    }

    [Fact]
    public void A_two_to_one_support_is_two_patterns_for_each_day_one_for_each_worker_both_open()
    {
        var block = Block("two-to-one", PlanSupportType.PersonalCare, new[] { DayOfWeek.Monday, DayOfWeek.Wednesday }, 8, 10, b => b with { Workers = 2 });

        var patterns = Map(block);

        Assert.Equal(4, patterns.Count);
        Assert.All(patterns, p => Assert.Equal((SupportRatio.TwoToOne, (Guid?)null), (p.Ratio, p.DefaultUserId)));
        Assert.Equal(new[] { (DayOfWeek.Monday, 1), (DayOfWeek.Monday, 2), (DayOfWeek.Wednesday, 1), (DayOfWeek.Wednesday, 2) }, patterns.Select(p => (p.DayOfWeek, p.WorkerSlot!.Value)));
        Assert.Equal(4, patterns.Select(p => p.Id).Distinct().Count());
    }

    [Theory]
    [InlineData(1, 1, SupportRatio.OneToOne, 1)]
    [InlineData(2, 1, SupportRatio.TwoToOne, 2)]
    [InlineData(1, 2, SupportRatio.OneToTwo, 1)]
    [InlineData(1, 3, SupportRatio.OneToThree, 1)]
    [InlineData(1, 4, SupportRatio.OneToFour, 1)]
    [InlineData(1, 5, SupportRatio.OneToFive, 1)]
    [InlineData(1, 6, SupportRatio.SharedSupport, 1)]
    [InlineData(1, 40, SupportRatio.SharedSupport, 1)]
    [InlineData(3, 1, SupportRatio.Other, 3)]
    [InlineData(2, 2, SupportRatio.Other, 2)]
    [InlineData(10, 40, SupportRatio.Other, 10)]
    public void The_ratio_comes_from_the_workers_and_the_participants_present_and_each_worker_is_one_pattern_for_the_day(int workers, int present, SupportRatio ratio, int patternsForTheDay)
    {
        var patterns = Map(Block("b", PlanSupportType.GroupActivity, new[] { DayOfWeek.Saturday }, 9, 15, b => b with { Workers = workers, ParticipantsPresent = present }));

        Assert.Equal(patternsForTheDay, patterns.Count);
        Assert.All(patterns, p => Assert.Equal(ratio, p.Ratio));
        Assert.Equal(Enumerable.Range(1, patternsForTheDay), patterns.Select(p => p.WorkerSlot!.Value));
    }

    [Fact]
    public void The_note_says_which_revision_support_and_setting_the_pattern_came_from_for_a_person_reading_the_patterns_list()
    {
        var notes = new[]
        {
            Map(Block("a", PlanSupportType.PersonalCare, new[] { DayOfWeek.Monday }, 9, 10, b => b with { Setting = PlanSetting.AtHome }), Draft(2)).Single().Notes,
            Map(Block("b", PlanSupportType.CommunityAccess, new[] { DayOfWeek.Monday }, 9, 10, b => b with { Setting = PlanSetting.Community }), Draft(3)).Single().Notes,
            Map(Block("c", PlanSupportType.GroupActivity, new[] { DayOfWeek.Monday }, 9, 10, b => b with { Setting = PlanSetting.Centre }), Draft(1)).Single().Notes,
            Map(Block("d", PlanSupportType.StaSupport, new[] { DayOfWeek.Monday }, 9, 10, b => b with { Setting = PlanSetting.Accommodation }), Draft(12)).Single().Notes,
        };

        Assert.Equal(new[]
        {
            "From agreement v2: Personal care, at home", "From agreement v3: Community access, community",
            "From agreement v1: Group activity, centre", "From agreement v12: Short-term accommodation support, accommodation",
        }, notes);
    }

    [Fact]
    public void What_the_block_asks_of_a_worker_is_copied_as_stored_and_the_pattern_carries_no_name()
    {
        var requirements = new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid", "ManualHandling" } };

        var patterns = Map(Draft(), (Block("b", PlanSupportType.PersonalCare, new[] { DayOfWeek.Monday, DayOfWeek.Tuesday }, 9, 10), requirements));

        Assert.All(patterns, p => Assert.Equal(DraftJson.Write(requirements), p.RequirementsJson));
        Assert.Equal("""{"workerGender":"Female","driver":true,"skills":["FirstAid","ManualHandling"]}""", patterns[0].RequirementsJson);
        Assert.All(patterns, p => Assert.Null(p.DefaultUserId));
    }

    [Fact]
    public void A_block_that_asks_for_nothing_still_carries_its_stored_requirements_so_a_shift_can_say_there_were_none()
    {
        var pattern = Map(Block("b", PlanSupportType.PersonalCare, new[] { DayOfWeek.Monday }, 9, 10)).Single();

        Assert.Equal("""{"workerGender":"NoPreference","driver":false,"skills":[]}""", pattern.RequirementsJson);
    }

    [Fact]
    public void The_blocks_of_a_revision_follow_one_another_in_plan_order_and_the_days_of_a_block_run_monday_first()
    {
        var first = Block("first", PlanSupportType.PersonalCare, new[] { DayOfWeek.Sunday, DayOfWeek.Monday }, 9, 10);
        var second = Block("second", PlanSupportType.CommunityAccess, new[] { DayOfWeek.Friday }, 9, 10);

        var patterns = Map(Draft(), (first, null), (second, null));

        Assert.Equal(new[] { ("first", DayOfWeek.Monday), ("first", DayOfWeek.Sunday), ("second", DayOfWeek.Friday) }, patterns.Select(p => (p.SourceBlockKey!, p.DayOfWeek)));
    }

    [Fact]
    public void The_count_is_the_listed_days_times_the_workers_of_every_block_and_is_known_before_any_pattern_is_made()
    {
        var blocks = new[]
        {
            Block("a", PlanSupportType.PersonalCare, Weekdays, 9, 10, b => b with { Workers = 2 }),
            Block("b", PlanSupportType.CommunityAccess, new[] { DayOfWeek.Saturday }, 9, 10),
        };

        Assert.Equal(11, AgreementPatternMapper.Count(blocks));
        Assert.Equal(100, AgreementPatternMapper.MaxPatternsPerApproval);
    }
}
