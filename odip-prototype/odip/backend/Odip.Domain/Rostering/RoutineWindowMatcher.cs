using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Rostering;

/// <summary>A routine that applies inside a shift window, with when it falls.</summary>
/// <param name="Routine">The routine.</param>
/// <param name="OccursAtLocal">
/// Provider-local start of the routine's FIRST occurrence inside the window, clipped to the window start when it began
/// earlier (an ongoing routine is shown at the shift's start). Null for an untimed routine, which has no time to sit under.
/// </param>
/// <param name="AfterMidnight">The occurrence falls on the calendar day AFTER the window starts (an overnight shift's early hours).</param>
public sealed record RoutineOccurrence(ParticipantRoutine Routine, DateTime? OccursAtLocal, bool AfterMidnight);

/// <summary>
/// Which of a participant's routines are relevant to a shift window - the server-side home of the rule that used to live
/// only in the frontend (<c>getRelevantRoutines</c>), with the OVERNIGHT gap fixed. The old rule compared the routine's
/// time-of-day with the shift window stretched past midnight, but never stretched the ROUTINE: a 02:00 or 06:30 routine could
/// not match a 22:00-06:00 shift, and the weekday was the start day's only.
///
/// Here each routine is placed on every calendar date the window touches (one, or two for an overnight shift) whose weekday it
/// applies on: a timed routine occupies [date + start, date + end) (a routine whose end is before its start crosses midnight),
/// and is relevant when that overlaps the half-open window [start, end). An untimed routine is relevant only when critical
/// ("must-know regardless of timing"), on any date of the window it applies on. Inactive routines never match.
/// Ordered critical-first, then chronologically within the window (untimed last), then by title.
/// </summary>
public static class RoutineWindowMatcher
{
    public static List<RoutineOccurrence> Match(IEnumerable<ParticipantRoutine> routines, DateTime windowStartLocal, DateTime windowEndLocal)
    {
        var matches = new List<RoutineOccurrence>();
        if (windowEndLocal <= windowStartLocal) return matches;

        var firstDate = DateOnly.FromDateTime(windowStartLocal);
        var lastDate = DateOnly.FromDateTime(windowEndLocal.AddTicks(-1));

        foreach (var routine in routines)
        {
            if (!routine.IsActive) continue;

            var applicableDates = new List<DateOnly>();
            for (var d = firstDate; d <= lastDate; d = d.AddDays(1))
                if (routine.Days.HasFlag(ParticipantRoutineDayMapper.ToFlag(d.DayOfWeek))) applicableDates.Add(d);
            if (applicableDates.Count == 0) continue;

            if (routine.StartTime is not { } start || routine.EndTime is not { } end)
            {
                // Untimed: no window to compare, so only the must-know (critical) ones are surfaced.
                if (routine.IsCritical) matches.Add(new RoutineOccurrence(routine, null, false));
                continue;
            }

            foreach (var date in applicableDates)
            {
                var occurrenceStart = date.ToDateTime(start);
                var occurrenceEnd = date.ToDateTime(end);
                if (occurrenceEnd < occurrenceStart) occurrenceEnd = occurrenceEnd.AddDays(1);   // crosses midnight

                if (windowStartLocal < occurrenceEnd && occurrenceStart < windowEndLocal)
                {
                    var occursAt = occurrenceStart < windowStartLocal ? windowStartLocal : occurrenceStart;
                    matches.Add(new RoutineOccurrence(routine, occursAt, occursAt.Date > windowStartLocal.Date));
                    break;   // the first occurrence inside the window is enough
                }
            }
        }

        return matches
            .OrderByDescending(m => m.Routine.IsCritical)
            .ThenBy(m => m.OccursAtLocal is null ? 1 : 0)
            .ThenBy(m => m.OccursAtLocal)
            .ThenBy(m => m.Routine.Title, StringComparer.Ordinal)
            .ToList();
    }
}
