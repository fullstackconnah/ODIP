using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Medications;

/// <summary>
/// Pure due-date computation for a Regular <see cref="ParticipantMedication"/>'s recurrence
/// pattern. Used by the MAR (<c>MedicationsController.GetMar</c>) to decide whether a medication
/// should expand into entries for a given day — the single source of truth for "is this
/// medication due today" so the three <see cref="MedicationFrequency"/> patterns are computed
/// consistently everywhere they're consumed.
/// </summary>
public static class MedicationScheduleCalculator
{
    /// <summary>Ordered so callers building a UI/day-name list get a stable Monday-first order.</summary>
    public static readonly Weekdays[] WeekdayOrder =
    [
        Weekdays.Monday, Weekdays.Tuesday, Weekdays.Wednesday, Weekdays.Thursday,
        Weekdays.Friday, Weekdays.Saturday, Weekdays.Sunday
    ];

    public static bool IsDue(ParticipantMedication medication, DateOnly date) =>
        IsDue(medication.Frequency, medication.DaysOfWeek, medication.IntervalDays, medication.AnchorDate, date);

    public static bool IsDue(MedicationFrequency frequency, Weekdays? daysOfWeek, int? intervalDays, DateOnly? anchorDate, DateOnly date)
    {
        return frequency switch
        {
            MedicationFrequency.Daily => true,
            MedicationFrequency.SpecificDays => daysOfWeek.HasValue && (daysOfWeek.Value & ToFlag(date.DayOfWeek)) != 0,
            MedicationFrequency.EveryNDays => IsDueEveryNDays(intervalDays, anchorDate, date),
            _ => true,
        };
    }

    private static bool IsDueEveryNDays(int? intervalDays, DateOnly? anchorDate, DateOnly date)
    {
        if (!anchorDate.HasValue || !intervalDays.HasValue || intervalDays.Value <= 0) return false;

        var diff = date.DayNumber - anchorDate.Value.DayNumber;
        var mod = diff % intervalDays.Value;
        if (mod < 0) mod += intervalDays.Value; // C#'s % keeps the dividend's sign — normalise for dates before the anchor.
        return mod == 0;
    }

    private static Weekdays ToFlag(DayOfWeek dayOfWeek) => dayOfWeek switch
    {
        DayOfWeek.Monday => Weekdays.Monday,
        DayOfWeek.Tuesday => Weekdays.Tuesday,
        DayOfWeek.Wednesday => Weekdays.Wednesday,
        DayOfWeek.Thursday => Weekdays.Thursday,
        DayOfWeek.Friday => Weekdays.Friday,
        DayOfWeek.Saturday => Weekdays.Saturday,
        DayOfWeek.Sunday => Weekdays.Sunday,
        _ => Weekdays.None,
    };
}
