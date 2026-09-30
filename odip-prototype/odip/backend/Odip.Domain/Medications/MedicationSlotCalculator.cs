using System.Globalization;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;

namespace Odip.Domain.Medications;

/// <summary>
/// Pure dose-slot arithmetic shared by the MAR (<c>GET medications/mar</c>, one calendar day) and the
/// shift package (a shift window, which spans two calendar dates for an overnight shift). Extracted
/// from <c>MedicationsController.GetMar</c> so both surfaces compute slots, the "overdue" state and
/// the TimesOfDay parsing the same way.
///
/// Every slot is a zone-less PROVIDER-LOCAL wall-clock <see cref="DateTime"/> (Kind Unspecified) —
/// exactly what <c>MedicationAdministration.ScheduledAt</c> stores. "Overdue" is decided on UTC
/// instants via <see cref="ProviderLocalTime"/>, never by comparing a local value with UTC "now".
/// </summary>
public static class MedicationSlotCalculator
{
    /// <summary>A scheduled dose is "overdue" once it has been unrecorded for this long after its slot time.</summary>
    public const int OverdueGraceMinutes = 60;

    /// <summary>
    /// Parses a <see cref="ParticipantMedication.TimesOfDay"/> CSV ("08:00,20:00") into its times, in the
    /// order written. False (and an empty list) when the CSV is blank, has any malformed entry, or has no
    /// entries — a malformed schedule yields NO slots rather than a partial set.
    /// </summary>
    public static bool TryParseTimesOfDay(string? csv, out List<TimeSpan> times)
    {
        times = new List<TimeSpan>();
        if (string.IsNullOrWhiteSpace(csv)) return false;

        foreach (var part in csv.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!TimeSpan.TryParseExact(part, "hh\\:mm", CultureInfo.InvariantCulture, out var t))
            {
                times = new List<TimeSpan>();
                return false;
            }
            times.Add(t);
        }

        return times.Count > 0;
    }

    /// <summary>
    /// The due slots of one Regular medication inside the half-open provider-local window
    /// [<paramref name="windowStartLocal"/>, <paramref name="windowEndLocal"/>): for each calendar date the
    /// window touches (one, or two for an overnight shift), when the medication's course covers that date
    /// (<see cref="ParticipantMedication.StartDate"/> not after it, <see cref="ParticipantMedication.EndDate"/>
    /// not before it - tested PER DATE, because an overnight window can straddle the day a course starts or
    /// ends) and <see cref="MedicationScheduleCalculator.IsDue(ParticipantMedication, DateOnly)"/> holds, each
    /// valid TimesOfDay entry becomes the slot <c>date + time</c>. Order: by date, then the order the times
    /// are written in the CSV. Duplicate times are NOT collapsed (the MAR has always listed them twice).
    /// </summary>
    public static List<DateTime> EnumerateSlots(ParticipantMedication medication, DateTime windowStartLocal, DateTime windowEndLocal)
    {
        var slots = new List<DateTime>();
        if (windowEndLocal <= windowStartLocal) return slots;
        if (!TryParseTimesOfDay(medication.TimesOfDay, out var times)) return slots;

        var firstDate = DateOnly.FromDateTime(windowStartLocal);
        // The last calendar date that contains any instant strictly before the (exclusive) window end.
        var lastDate = DateOnly.FromDateTime(windowEndLocal.AddTicks(-1));

        for (var date = firstDate; date <= lastDate; date = date.AddDays(1))
        {
            var dayStart = date.ToDateTime(TimeOnly.MinValue);
            // The course test the single-day MAR's query has always applied, here per calendar date: the medication has started
            // by the end of that date (StartDate < dayEnd) and had not ended before its start (EndDate >= dayStart).
            if (medication.StartDate >= dayStart.AddDays(1)) continue;
            if (medication.EndDate is { } endDate && endDate < dayStart) continue;
            if (!MedicationScheduleCalculator.IsDue(medication, date)) continue;
            foreach (var t in times)
            {
                var slot = dayStart.Add(t);
                if (slot >= windowStartLocal && slot < windowEndLocal) slots.Add(slot);
            }
        }

        return slots;
    }

    /// <summary>
    /// True when an UNRECORDED scheduled dose is overdue: more than <see cref="OverdueGraceMinutes"/> have
    /// elapsed since the slot's UTC instant (the provider-local slot converted through
    /// <paramref name="zone"/>). A dose that already has a record is never overdue — pass
    /// <paramref name="hasRecord"/>.
    /// </summary>
    public static bool IsOverdue(DateTime slotLocal, bool hasRecord, DateTime nowUtc, TimeZoneInfo zone) =>
        !hasRecord && ProviderLocalTime.LocalToUtc(slotLocal, zone).AddMinutes(OverdueGraceMinutes) < nowUtc;
}
