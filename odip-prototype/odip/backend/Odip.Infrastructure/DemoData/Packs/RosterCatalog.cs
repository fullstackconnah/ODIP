using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

internal enum PatternPhase
{
    /// <summary>Weekly, in force since 2026-09-01, no end date.</summary>
    Active,

    /// <summary>Weekly, in force until a week before the first run: shows in the patterns list, generates only history.</summary>
    Ended,

    /// <summary>Switched off (a paused arrangement): generates nothing.</summary>
    Inactive,

    /// <summary>Starts on the first day of next month (relative to the first run), then generates like any active pattern.</summary>
    StartsNextMonth,
}

/// <summary>A weekly shift pattern (staff, participant, day, times). Keys are story names; they feed <see cref="DemoIds"/>.</summary>
internal sealed record PatternSpec(
    string Key, string Staff, string Participant, DayOfWeek Day, TimeOnly Start, TimeOnly End, bool EndsNextDay, SupportRatio Ratio, SleepoverType Night,
    PatternPhase Phase, string? Notes = null);

/// <summary>
/// One shift of a week pack. <see cref="DayOffset"/> is days after the pack week's Monday. A null <see cref="Staff"/> is an unfilled shift.
/// </summary>
internal sealed record StoryShift(
    string Key, string? Staff, string Participant, int DayOffset, TimeOnly Start, TimeOnly End, bool EndsNextDay = false,
    SupportRatio Ratio = SupportRatio.OneToOne, SleepoverType Night = SleepoverType.None, ShiftStatus Status = ShiftStatus.Published,
    string? OverrideReason = null, string? AcknowledgedCodes = null, string? Notes = null);

/// <summary>
/// The roster the top-up keeps in place: thirteen weekly patterns that fill the ordinary week, and a "week pack" of designed shifts that is
/// created for each of the next two weeks, so any upcoming week on the board shows the roster checks the product has (plan 2.2). Every
/// pack week is keyed by its Monday, so a week is built once and then left alone.
///
/// Pools (plan 2.0): the pack and patterns draw on James, Daniel, Marcus, Emily, Lachlan, Priya (the shift pool, with the credential
/// stories) and on Brendan, Rachel and Jade for the ordinary patterns. Nothing here may touch the 02:00-03:00 hour on the Sunday daylight
/// saving starts: no Saturday-night shift exists, and the Sunday night shift starts at 22:00.
///
/// Two deviations from the plan's table, both so a designed finding stays the only finding on its shift:
///  - the "not overnight eligible" night shift (check 12) is on Tuesday, not Friday, because Daniel's "Unavailable" day (check 5) is a whole
///    Friday, as the availability editor writes it, and would have added an unplanned STAFF_UNAVAILABLE to a Friday night shift;
///  - the Lachlan WSC_EXPIRED shift (check 1) is on Wednesday and his first-aid story on Friday: his screening lapses two days after the first fill,
///    so a Tuesday shift would not be after the lapse when the first fill falls on a Sunday.
/// </summary>
internal static class RosterCatalog
{
    private static readonly TimeOnly Midnight = new(0, 0);

    public static readonly IReadOnlyList<PatternSpec> Patterns = new PatternSpec[]
    {
        // Nine active weekly patterns.
        new("priya-thomas-mon", "priya", "thomas", DayOfWeek.Monday, T(9), T(13), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Active),
        new("priya-chloe-sun", "priya", "chloe", DayOfWeek.Sunday, T(12), T(16), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Active),
        new("brendan-isabella-tue", "brendan", "isabella", DayOfWeek.Tuesday, T(10), T(14), false, SupportRatio.SharedSupport, SleepoverType.None, PatternPhase.Active),
        new("brendan-jack-wed", "brendan", "jack", DayOfWeek.Wednesday, T(9), T(13), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Active),
        new("brendan-noah-thu", "brendan", "noah", DayOfWeek.Thursday, T(10), T(14), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Active),
        new("rachel-olivia-fri-sleepover", "rachel", "olivia", DayOfWeek.Friday, T(21), T(7), true, SupportRatio.OneToOne, SleepoverType.Sleepover, PatternPhase.Active,
            "Friday sleepover."),
        new("rachel-william-sat", "rachel", "william", DayOfWeek.Saturday, T(10), T(13), false, SupportRatio.OneToTwo, SleepoverType.None, PatternPhase.Active,
            "Shared with another participant."),
        new("jade-dylan-mon", "jade", "dylan", DayOfWeek.Monday, T(14), T(18), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Active),
        new("james-sophie-sun-night", "james", "sophie", DayOfWeek.Sunday, T(22), T(6), true, SupportRatio.OneToOne, SleepoverType.ActiveNight, PatternPhase.Active,
            "Active night: Sophie is checked on through the night."),

        // Two that have ended, one that is switched off, one that has not started yet.
        new("priya-mia-wed", "priya", "mia", DayOfWeek.Wednesday, T(10), T(14), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Ended),
        new("brendan-william-fri", "brendan", "william", DayOfWeek.Friday, T(9), T(13), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Ended),
        new("jade-mia-tue", "jade", "mia", DayOfWeek.Tuesday, T(10), T(14), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.Inactive,
            "Paused while Mia is away."),
        new("daniel-ethan-tue", "daniel", "ethan", DayOfWeek.Tuesday, T(16), T(19), false, SupportRatio.OneToOne, SleepoverType.None, PatternPhase.StartsNextMonth),
    };

    private const string OnLeaveReason = "Leave approved after the roster was published; cover arranged with Rachel";
    private const string StudyReason = "Study night swapped this week, confirmed with Daniel";

    /// <summary>The designed shifts of one pack week, in the order the plan's 2.2 table lists the checks they trigger.</summary>
    public static readonly IReadOnlyList<StoryShift> Stories = new StoryShift[]
    {
        new("wsc-expired", "lachlan", "mia", 2, T(8), T(12)),                                     // 1  WSC_EXPIRED
        new("wsc-missing", "jade", "noah", 2, T(10), T(14)),                                      // 2  WSC_MISSING
        new("double-a", "james", "sophie", 3, T(9), T(17)),                                       // 3  DOUBLE_BOOKED_SHIFT (with double-b)
        new("double-b", "james", "harrison", 3, T(14), T(18)),
        new("unavailable", "daniel", "grace", 4, T(9), T(13)),                                    // 5  STAFF_UNAVAILABLE
        new("on-leave", "priya", "thomas", 3, T(10), T(14),                                       // 6  STAFF_ON_LEAVE (reason persisted)
            OverrideReason: OnLeaveReason, AcknowledgedCodes: "STAFF_ON_LEAVE"),
        new("recurring", "daniel", "ethan", 2, T(15), T(19),                                      // 7  STAFF_RECURRING_UNAVAILABLE (reason persisted)
            OverrideReason: StudyReason, AcknowledgedCodes: "STAFF_RECURRING_UNAVAILABLE"),
        new("leave-pending", "emily", "charlotte", 4, T(14), T(22)),                              // 8  STAFF_LEAVE_PENDING
        new("recurring-pending", "emily", "grace", 1, T(7), T(11)),                               // 9  STAFF_RECURRING_PENDING
        new("excluded", "emily", "ryan", 5, T(9), T(13)),                                         // 10 COMPATIBILITY_EXCLUDED
        new("needs-mh", "daniel", "mason", 0, T(10), T(14)),                                      // 12 COMPETENCY_MISSING: wheelchair, Daniel not manual-handling
        new("needs-night", "daniel", "ryan", 1, T(22), T(6), true, SupportRatio.OneToOne, SleepoverType.ActiveNight),   // 12: not overnight-eligible
        new("needs-fa", "lachlan", "sophie", 4, T(10), T(14)),                                    // 12: high support, no first aid
        new("ratio-a", "james", "sophie", 0, T(7), T(15), false, SupportRatio.TwoToOne),          // 13 RATIO_SHORTFALL, and PUBLIC_HOLIDAY on a holiday Monday
        new("ratio-b", null, "sophie", 0, T(7), T(15), false, SupportRatio.TwoToOne),             //    the partner slot, unassigned: the Unfilled lane
        new("hours-mon", "marcus", "olivia", 0, T(8, 30), T(17)),                                 // 14 OVER_HOURS: five 8.5 hour days = 42.5 h
        new("hours-tue", "marcus", "william", 1, T(8, 30), T(17)),
        new("hours-wed", "marcus", "olivia", 2, T(8, 30), T(17)),
        new("hours-thu", "marcus", "william", 3, T(8, 30), T(17)),
        new("hours-fri", "marcus", "olivia", 4, T(8, 30), T(17)),
        new("draft", null, "noah", 5, T(14), T(18), Status: ShiftStatus.Draft),                   //    a roster shift nobody has published yet
        new("cancelled", null, "thomas", 6, T(10), T(14), Status: ShiftStatus.Cancelled, Notes: "Participant is away."),
    };

    private static TimeOnly T(int hour, int minute = 0) => new(hour, minute);

    public static Guid PatternId(string key) => DemoIds.For("shift-pattern", key);

    /// <summary>A shift generated from a pattern, keyed by the pattern (so an owner-edited pattern still owns its own history) and the date.</summary>
    public static Guid PatternShiftId(Guid patternId, DateOnly date) => DemoIds.For("shift", "pattern", patternId, date);

    public static Guid StoryShiftId(string key, DateOnly weekMonday) => DemoIds.For("shift", "story", key, weekMonday);

    /// <summary>The pack weeks to make now: next week and the week after.</summary>
    public static IReadOnlyList<DateOnly> PackWeeks(DemoAnchors anchors) => new[] { anchors.Monday(1), anchors.Monday(2) };

    /// <summary>The Monday before the first pack week could ever have been made (the plan's fixed 2026-09-01 start, less a day of slack).</summary>
    private static readonly DateOnly Epoch = new(2026, 8, 31);

    /// <summary>
    /// Every pack week a story shift may exist for, from the first one the top-up could ever have made to the last it makes now: used to
    /// recognise the rows to move forward, never to create them. Not a lookback of a few weeks: a host that was switched off for months must
    /// still have its old Published shifts closed out when it comes back. (A clock set before the epoch gets thirteen weeks back instead.)
    /// </summary>
    public static IEnumerable<DateOnly> PackWeeksEverCreated(DemoAnchors anchors)
    {
        var first = anchors.W0 < Epoch ? anchors.Monday(-13) : Epoch;
        for (var week = first; week <= anchors.Monday(2); week = week.AddDays(7)) yield return week;
    }

    public static IEnumerable<Guid> StoryShiftIds(IEnumerable<DateOnly> weeks) =>
        weeks.SelectMany(week => Stories.Select(story => StoryShiftId(story.Key, week)));

    /// <summary>Effective dates and activity for a pattern, from the first run's calendar (stored on the row, so they never change afterwards).</summary>
    public static (DateOnly From, DateOnly? To, bool IsActive) Window(PatternSpec spec, DemoAnchors anchors)
    {
        var from = new DateOnly(2026, 9, 1);
        return spec.Phase switch
        {
            PatternPhase.Ended => (from, Max(from, anchors.W0.AddDays(-7)), true),
            PatternPhase.Inactive => (from, null, false),
            PatternPhase.StartsNextMonth => (new DateOnly(anchors.D0.Year, anchors.D0.Month, 1).AddMonths(1), null, true),
            _ => (from, null, true),
        };
    }

    private static DateOnly Max(DateOnly a, DateOnly b) => a >= b ? a : b;
}
