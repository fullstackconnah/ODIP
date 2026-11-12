namespace Odip.Domain.Rostering.Services;

/// <summary>One block of an approved agreement (one <see cref="ShiftPattern"/>): the weekday it falls on and its times.</summary>
public readonly record struct AgreementBlock(DayOfWeek Day, TimeOnly Start, TimeOnly End, bool EndsNextDay);

/// <summary>
/// Whether a group activity sits inside what a participant's agreement funds (group activities part 2). Pure: the caller reads the blocks. The result only ever feeds a warning; nothing is refused on it.
/// </summary>
public static class AgreementActivityMatch
{
    /// <summary>Null when some block of the activity's weekday contains it (equal boundaries count); otherwise <see cref="RosterConflictService.ActivityAgreementNoBlock"/> (no block that weekday) or <see cref="RosterConflictService.ActivityAgreementTime"/> (a block that weekday, none containing it).</summary>
    public static string? Check(IEnumerable<AgreementBlock> blocks, DayOfWeek day, TimeOnly start, TimeOnly end, bool endsNextDay)
    {
        // shortcut: an overnight block covers only an activity that starts on its own weekday (not the tail after midnight), upgrade if a tail-day activity needs matching.
        // shortcut: no series interval input, so fortnightly and monthly series match on weekday and time alone.
        var sameDay = blocks.Where(b => b.Day == day).ToList();
        if (sameDay.Count == 0) return RosterConflictService.ActivityAgreementNoBlock;
        var (aStart, aEnd) = Minutes(start, end, endsNextDay);
        foreach (var b in sameDay)
        {
            var (bStart, bEnd) = Minutes(b.Start, b.End, b.EndsNextDay);
            if (bStart <= aStart && aEnd <= bEnd) return null;
        }

        return RosterConflictService.ActivityAgreementTime;
    }

    /// <summary>Half-open minute intervals on one axis (+1440 when a window ends the next day): touching ends do not overlap. The one overlap rule for the attach step and the generator.</summary>
    public static bool Overlaps(TimeOnly aStart, TimeOnly aEnd, bool aEndsNextDay, TimeOnly bStart, TimeOnly bEnd, bool bEndsNextDay)
    {
        var (a0, a1) = Minutes(aStart, aEnd, aEndsNextDay);
        var (b0, b1) = Minutes(bStart, bEnd, bEndsNextDay);
        return a0 < b1 && b0 < a1;
    }

    private static (int Start, int End) Minutes(TimeOnly start, TimeOnly end, bool endsNextDay) =>
        (start.Hour * 60 + start.Minute, end.Hour * 60 + end.Minute + (endsNextDay ? 1440 : 0));
}
