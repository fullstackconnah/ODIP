using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// One of the three "today, on shift" stories (plan 2.1): the participant the shift is for, its rostered window, and the staff who may be cast on it,
/// in order of preference. <see cref="Key"/> feeds <see cref="DemoIds"/>: a story's shift for a date is <c>(Key, date)</c>, so it is made once per day.
/// </summary>
public sealed record LiveStory(string Key, string Participant, TimeOnly Start, TimeOnly End, string[] Workers)
{
    public bool Covers(DateTime slotLocal, DateOnly date) =>
        DateOnly.FromDateTime(slotLocal) == date && TimeOnly.FromDateTime(slotLocal) >= Start && TimeOnly.FromDateTime(slotLocal) < End;
}

/// <summary>
/// The live set (plan 2.1). Each day the top-up rosters three one-to-one shifts for the participants whose stories the demo tells, each started,
/// worked and finished by the clock (see <see cref="LiveSetPack"/>), and the stories' own wording lives here so a test can read it.
///
/// Who works them is not fixed. The plan names James, Marcus and Emily, but the roster the top-up already keeps (RosterCatalog) books those same
/// people on most weekdays, and a worker cannot be in two places, nor work more than the weekly hours the roster board flags. So each story
/// lists the staff who could do it, in order, and the first one the roster's own rules (<see cref="RosterConflictService"/>, the engine behind the
/// board's findings) find nothing wrong with for that day is cast. A day nobody fits is skipped, not forced.
///
/// The lists name everyone, preferred person first, because the engine is what decides who is eligible: Sophie, Harrison and Charlotte are all high
/// support with overnight support, so a worker needs first aid and overnight eligibility (and manual handling for Harrison's wheelchair), which
/// leaves eight of the ten workers (Daniel and Lachlan never qualify). The two stories that give a dose to a high-risk or controlled medicine
/// leave out Emily, who is not medication competent (she is the evening story's own first choice, as the plan has her). The weekly cap is what
/// limits coverage: the pattern roster already uses most of the free hours of those eight (about 150 hours a week are left, and Jade's missing
/// screening is a designed finding that takes her out), so each shift is six hours, not the plan's eight. Measured over the weeks ahead of the first
/// run, eight-hour shifts could be cast on about eight days in ten (the Friday demo day among the ones left out), seven-hour ones on nine in ten,
/// and six-hour ones on every day, which is why the live set rosters six hours: 07:00 to 13:00, 08:00 to 14:00 and 15:00 to 21:00, so somebody is
/// working at any moment between 07:00 and 21:00 apart from the hour between the first two shifts' ends and the evening's start. A day nobody
/// fits is still skipped, not forced.
/// </summary>
public static class LiveSetCatalog
{
    private static TimeOnly T(int hour, int minute = 0) => new(hour, minute);

    /// <summary>Sophie's day: the epilepsy medication chart, the morning routine, a headache and an injury note (the plan's L1).</summary>
    public static readonly LiveStory Morning = new("live-morning", "sophie", T(7), T(13),
        new[] { "james", "brendan", "jade", "rachel", "priya", "sarah", "marcus" });

    /// <summary>Harrison's day: a late start, high-risk insulin with a witness, a running break and no note yet (the plan's L2).</summary>
    public static readonly LiveStory Insulin = new("live-insulin", "harrison", T(8), T(14),
        new[] { "marcus", "james", "jade", "brendan", "priya", "rachel", "sarah" });

    /// <summary>Charlotte's evening: a shift that has not started at ten in the morning, with yesterday's handover unread (the plan's L3).</summary>
    public static readonly LiveStory Evening = new("live-evening", "charlotte", T(15), T(21),
        new[] { "emily", "priya", "jade", "brendan", "rachel", "james", "sarah", "marcus" });

    public static readonly IReadOnlyList<LiveStory> Stories = new[] { Morning, Insulin, Evening };

    public static Guid ShiftId(LiveStory story, DateOnly date) => DemoIds.For("shift", "live", story.Key, date);

    /// <summary>The ids of every live shift of the given dates, so a lookup of which already exist is one primary-key probe.</summary>
    public static IEnumerable<Guid> ShiftIds(IEnumerable<DateOnly> dates) => dates.SelectMany(d => Stories.Select(s => ShiftId(s, d)));

    /// <summary>
    /// A live shift somebody else has taken over is theirs, not the script's ("it never touches a shift somebody else changed"), in one of three ways: a coordinator returned
    /// it for correction (the app makes its completion inactive, puts the shift back to Published and counts the return, so a start would make a second completion under the
    /// id the first still holds and fail on the primary key at every tick for good: second independent review X1); a person started it by hand (the script's times are placed
    /// from its own start, and could come before theirs, and its close would finish a shift they are working); or a coordinator moved it, to other times or another date
    /// (the script's break, tick and as-needed dose are placed at the story's wall-clock times, which may come before the start it would then have, and its doses are of the
    /// story's window and not the shift's: third independent review R2). It is the one rule for every pack (R1): the live set does not work such a shift, and the history
    /// neither waits for it to be finished nor counts its window as the live set's for good (<see cref="Packs.MedicationHistoryPack"/> releases the window once it is over).
    /// <paramref name="date"/> is the date the shift's id was made for, which is its date until somebody changes it.
    /// </summary>
    public static bool TakenOver(LiveStory story, DateOnly date, Guid shiftId, DateOnly serviceDate, TimeOnly start, TimeOnly end, bool endsNextDay, int returnCount, Guid? activeCompletionId) =>
        returnCount > 0
        || (activeCompletionId is { } completion && completion != DemoIds.For("shift-completion", shiftId))
        || serviceDate != date || start != story.Start || end != story.End || endsNextDay;

    public static bool TakenOver(LiveStory story, DateOnly date, DemoQueries.ShiftState shift) =>
        TakenOver(story, date, shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.ReturnCount, shift.ActiveCompletionId);

    // ── the stories' own words ───────────────────────────────────────────────

    public static string MorningNote(DateOnly date) => (int)date.DayOfWeek switch
    {
        0 => "Quiet start. Sophie chose her own clothes and had a long breakfast. Out for a short walk in the garden afterwards.",
        1 => "Sophie was bright this morning. Helped fold the washing and chose music for the kitchen. Reminded her to sip water through the walk.",
        2 => "Settled morning. Sophie was keen to talk about her sister's visit on the weekend. Good appetite at breakfast.",
        3 => "Sophie slept well according to the overnight notes. A calm morning, with a long phone call to her mother after breakfast.",
        4 => "Sophie started slowly but warmed up by mid-morning. She enjoyed the garden and chose a puzzle for later.",
        5 => "Cheerful start to the day. Sophie helped set the table and picked the menu for dinner.",
        _ => "Relaxed morning. Sophie wanted to listen to her audiobook, so we kept things quiet and stayed home.",
    };

    /// <summary>The note of the day the demo started: the one the scanner flags (Falls and Injury) and an incident is filed from (plan I-09).</summary>
    public const string InjuryNote =
        "Sophie slipped on the wet bathroom tiles while getting ready. Small wound on her left elbow, cleaned and covered. No other concerns.";

    public static string InsulinHandover(DateOnly date) => date.DayOfWeek == DayOfWeek.Saturday
        ? "Harrison managed his own carb count at lunch. Insulin given and witnessed at the usual time. Quiet afternoon, no concerns."
        : "Insulin given and witnessed. His blood sugar ran a little low before lunch, so the metformin was held and rechecked at 2pm; it was back in range.";

    public static string EveningHandover(DateOnly date) => date.DayOfWeek == DayOfWeek.Sunday
        ? "Charlotte was calm all evening. Quetiapine taken at the usual time. She chose a film and was in bed by ten."
        : "Unsettled before dinner; headphones and a quiet room helped. Quetiapine taken at 8pm. Keep line of sight after 8 o'clock.";

    public static string MorningHandover(DateOnly date) =>
        "Settled day. Omeprazole was declined twice, so it is worth offering again tomorrow with food. Paracetamol given for a headache and it eased within the hour.";

    public static string HandoverOf(LiveStory story, DateOnly date) =>
        story == Insulin ? InsulinHandover(date) : story == Evening ? EveningHandover(date) : MorningHandover(date);
}
