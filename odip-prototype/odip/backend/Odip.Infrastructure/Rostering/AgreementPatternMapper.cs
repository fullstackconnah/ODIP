using System.Globalization;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// What the blocks of an approved agreement revision become on the roster (plan builder, phase D). A pattern for each weekday a block lists and each worker it asks for at once (a 2:1 support is
/// two patterns on the same day, as the roster already models 2:1 cover: two overlapping shifts, each its own worker, both open until somebody is chosen). The pattern is the block's own wall clock
/// (the revision's delivery state and the provider are in one time zone: approval refuses it otherwise), covers the agreement's own dates, has no worker and is active.
/// Pure: nothing is read or saved here.
/// </summary>
public static class AgreementPatternMapper
{
    /// <summary>The most patterns one approval may make: a plan allows 200 blocks of 7 days and up to 10 workers, and each pattern is a row, an audit row and shifts.</summary>
    public const int MaxPatternsPerApproval = 100;

    /// <summary>How many patterns the blocks make, known without making them: each block's listed days times its workers.</summary>
    public static int Count(IEnumerable<PlanBlock> blocks) => blocks.Sum(block => (block.Days?.Count ?? 0) * Math.Max(block.Workers, 1));

    /// <summary>The patterns of every block of <paramref name="draft"/>, in the plan's order, each block's days Monday first and a day's worker slots in order. Not saved, and not yet in any context.</summary>
    public static IReadOnlyList<ShiftPattern> Map(ServiceAgreementDraft draft, IReadOnlyList<DraftBlockDto> blocks)
    {
        var patterns = new List<ShiftPattern>();
        foreach (var entry in blocks)
        {
            var block = entry.Block;
            var requirements = DraftJson.Write(entry.Requirements);
            foreach (var day in block.Days.OrderBy(d => ((int)d + 6) % 7))
                for (var slot = 1; slot <= Math.Max(block.Workers, 1); slot++)
                    patterns.Add(new ShiftPattern
                    {
                        Id = Guid.NewGuid(), TenantId = draft.TenantId, ParticipantId = draft.ParticipantId, DefaultUserId = null,
                        DayOfWeek = day, StartTime = block.Start, EndTime = block.End, EndsNextDay = block.EndsNextDay,
                        Ratio = RatioOf(block.Workers, block.ParticipantsPresent), NightType = NightTypeOf(block),
                        EffectiveFrom = draft.AgreementStartDate, EffectiveTo = draft.AgreementEndDate, IsActive = true,
                        Notes = NotesOf(draft.Version, block),
                        SourceDraftId = draft.Id, SourceBlockKey = block.Id, WorkerSlot = slot, RequirementsJson = requirements,
                    });
        }

        return patterns;
    }

    /// <summary>The roster's ratio for a block: one worker for one to five participants is the roster's own one-to-N, one worker for more is shared support, two workers for one is 2:1, and any other pair is Other.</summary>
    public static SupportRatio RatioOf(int workers, int participantsPresent) => (workers, participantsPresent) switch
    {
        (1, 1) => SupportRatio.OneToOne,
        (2, 1) => SupportRatio.TwoToOne,
        (1, 2) => SupportRatio.OneToTwo,
        (1, 3) => SupportRatio.OneToThree,
        (1, 4) => SupportRatio.OneToFour,
        (1, 5) => SupportRatio.OneToFive,
        (1, > 5) => SupportRatio.SharedSupport,
        _ => SupportRatio.Other,
    };

    /// <summary>A block where the worker may sleep is a sleepover; otherwise one that crosses midnight (its end is not after its start) is an active night; otherwise it is none.</summary>
    public static SleepoverType NightTypeOf(PlanBlock block) => block.WorkerMaySleep ? SleepoverType.Sleepover : block.EndsNextDay ? SleepoverType.ActiveNight : SleepoverType.None;

    /// <summary>"From agreement v2: Personal care, at home": for the patterns list, where a person sees what made the pattern. The machine-readable source is in the columns.</summary>
    public static string NotesOf(int version, PlanBlock block) => string.Create(CultureInfo.InvariantCulture,
        $"From agreement v{version}: {ServiceAgreementDraftService.SupportTypeLabel(block.SupportType)}, {SettingLabel(block.Setting)}");

    private static string SettingLabel(PlanSetting setting) => setting switch
    {
        PlanSetting.Community => "community",
        PlanSetting.Centre => "centre",
        PlanSetting.AtHome => "at home",
        PlanSetting.Accommodation => "accommodation",
        _ => "community",
    };
}
