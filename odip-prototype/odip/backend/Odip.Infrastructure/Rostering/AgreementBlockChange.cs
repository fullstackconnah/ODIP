using System.Globalization;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// A change to one roster pattern of an approved agreement, as the blocks of the next revision (agreement PR 1). A pattern is one weekday and one worker of a block, so the change is made to the
/// block and applies to every worker of it. With <see cref="AgreementPatternChangeDto.AllDays"/> it applies to every day of the block; otherwise to the pattern's day only, which splits a block of
/// several days: the block keeps its id, its place and its other days, and the changed day becomes a block of its own right after it, asking the same of a worker. Every other block is the same
/// object it was. Pure: nothing is read or saved here, and the engine still validates and prices what comes out.
/// </summary>
public static class AgreementBlockChange
{
    /// <summary>The blocks with the change made, in plan order, or the reason it cannot be made, in words for the coordinator.</summary>
    public static (List<DraftBlockDto>? Blocks, string? Error) Apply(IReadOnlyList<DraftBlockDto> blocks, ShiftPattern pattern, AgreementPatternChangeDto change)
    {
        var index = -1;
        for (var i = 0; i < blocks.Count && index < 0; i++) if (string.Equals(blocks[i].Block.Id, pattern.SourceBlockKey, StringComparison.Ordinal)) index = i;
        if (index < 0) return (null, "The support this pattern was made from is not in the agreement any more. Open the agreement to change it.");
        if (!Enum.IsDefined(change.DayOfWeek)) return (null, "Pick a day of the week.");
        var entry = blocks[index];
        var block = entry.Block;
        // The ratio is read against the block, which is what the agreement says: before agreement PR 1 a pattern could be edited by hand, so its own ratio may have drifted from it.
        var blockRatio = AgreementPatternMapper.RatioOf(block.Workers, block.ParticipantsPresent);
        if (change.DayOfWeek == pattern.DayOfWeek && change.StartTime == pattern.StartTime && change.EndTime == pattern.EndTime && change.EndsNextDay == pattern.EndsNextDay
            && change.Ratio == blockRatio && change.NightType == pattern.NightType)
            return (null, "Nothing to change: the day, times, ratio and night type are what the agreement already says.");

        // A block's end is on the next day exactly when it is not after its start (PlanBlock.EndsNextDay is derived): a request that says otherwise cannot be a block.
        if (change.EndsNextDay != (change.EndTime <= change.StartTime))
            return (null, change.EndsNextDay
                ? "A support that ends the next day ends at or before the time it starts. Pick an earlier end time, or untick ends the next day."
                : "The end time is at or before the start time. Tick ends the next day, or pick a later end time.");

        // The block's own ratio keeps its own numbers (shared support for seven stays seven); any other is read back from the roster's ratio.
        (int Workers, int ParticipantsPresent)? shape = change.Ratio == blockRatio ? (block.Workers, block.ParticipantsPresent) : AgreementPatternMapper.ShapeOf(change.Ratio);
        if (shape is not { } counts)
            return (null, "The agreement cannot be priced for that ratio from here. Choose one worker for one to five participants or two workers for one, or change the ratio in the agreement.");

        // A sleepover is a block where the worker may sleep; leaving one takes its window and active hours with it, which PlanBlock.Validate refuses on a block where nobody sleeps.
        var sleeps = change.NightType == SleepoverType.Sleepover;
        var changed = block with
        {
            Start = change.StartTime, End = change.EndTime, Workers = counts.Workers, ParticipantsPresent = counts.ParticipantsPresent, WorkerMaySleep = sleeps,
            SleepoverWindow = sleeps ? block.SleepoverWindow : null, SleepoverActiveHours = sleeps ? block.SleepoverActiveHours : 0m,
        };
        // The night type is what approval will read back from the block (AgreementPatternMapper.NightTypeOf): anything else would make a pattern that is not the one asked for.
        if (AgreementPatternMapper.NightTypeOf(changed) != change.NightType) return (null, NightTypeMessage(change.NightType));


        var result = blocks.ToList();
        var otherDays = block.Days.Where(day => day != pattern.DayOfWeek).ToList();
        if (change.AllDays)
        {
            if (change.DayOfWeek != pattern.DayOfWeek) return (null, "A change to every day of this support keeps its days. To move one day, untick every day.");
            result[index] = entry with { Block = changed };
        }
        else if (otherDays.Contains(change.DayOfWeek))
            return (null, string.Create(CultureInfo.InvariantCulture, $"This support is already on {change.DayOfWeek}. Pick another day, or change that day's pattern."));
        else if (otherDays.Count == 0)
            result[index] = entry with { Block = changed with { Days = new[] { change.DayOfWeek } } };
        else
        {
            result[index] = entry with { Block = block with { Days = otherDays } };
            result.Insert(index + 1, entry with { Block = changed with { Id = SplitId(block.Id, change.DayOfWeek, blocks), Days = new[] { change.DayOfWeek } } });
        }

        return (result, null);
    }

    private static string NightTypeMessage(SleepoverType asked) => asked switch
    {
        SleepoverType.None => "A support that runs past midnight is an active night or a sleepover. Choose one of those, or end it by midnight.",
        SleepoverType.ActiveNight => "An active night runs past midnight. Tick ends the next day, or choose None.",
        _ => "The agreement prices a night as an active night or a sleepover. Choose one of those.",
    };

    /// <summary>
    /// The id of the block a split makes: the old id and the day ("weekdays-mon"), the old id cut so the whole fits <see cref="PlanBlock.MaxIdLength"/> (never through a surrogate pair), and numbered
    /// on ("-2", "-3") while a block of the revision already has it.
    /// </summary>
    private static string SplitId(string id, DayOfWeek day, IReadOnlyList<DraftBlockDto> blocks)
    {
        var taken = blocks.Select(b => b.Block.Id).ToHashSet(StringComparer.Ordinal);
        var cut = Math.Min(id.Length, PlanBlock.MaxIdLength - 7);
        if (cut < id.Length && cut > 0 && char.IsHighSurrogate(id[cut - 1])) cut--;
        var stem = string.Concat(id.AsSpan(0, cut), "-", day.ToString()[..3].ToLowerInvariant());
        var candidate = stem;
        for (var n = 2; taken.Contains(candidate); n++) candidate = string.Create(CultureInfo.InvariantCulture, $"{stem}-{n}");
        return candidate;
    }
}
