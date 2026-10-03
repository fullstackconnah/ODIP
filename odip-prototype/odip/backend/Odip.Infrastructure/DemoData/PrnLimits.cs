using Odip.Domain.Entities;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData;

/// <summary>
/// The app's limits on an as-needed dose, as <c>MedicationAdministrationRecorder</c> judges them when a worker records one: against the Administered records of the medication
/// that no later record superseded, on both sides of the time the dose was given, no more than the daily maximum in any 24 hours that holds it, and no less than the minimum
/// interval from the nearest dose before it and to the nearest after it. The recorder refuses a dose that breaks one unless the worker acknowledges the breach, and a row the
/// top-up writes carries no acknowledgement, so a dose that breaks a limit beside a record a person made (or one the other script wrote) is a row the app could not have
/// produced (third independent review R4). The recorder's rule is private to it and reads the database; this is a copy of it over the times already read, and
/// <c>DemoPrnLimitTests</c> holds the two to the same answer through the recorder itself.
/// </summary>
public static class PrnLimits
{
    /// <summary>
    /// True when a dose given at <paramref name="givenUtc"/> would break the medication's limits beside the doses given at <paramref name="administeredUtc"/> (the
    /// Administered, not superseded records of that medication; those further than 24 hours away do not matter).
    /// </summary>
    public static bool WouldBreach(ParticipantMedication med, DateTime givenUtc, IEnumerable<DateTime> administeredUtc)
    {
        if (med.PrnMaxDosesPer24h is null && med.PrnMinIntervalMinutes is null) return false;

        var lower = givenUtc.AddHours(-24);
        var upper = givenUtc.AddHours(24);
        var recorded = administeredUtc.Select(ProviderLocalTime.AsUtc).Where(t => t >= lower && t <= upper).OrderBy(t => t).ToList();

        if (med.PrnMaxDosesPer24h is { } max)
        {
            // The windows that matter start at an existing dose or at this one, which also covers a dose that pushes a later window over the limit.
            foreach (var start in recorded.Where(t => t >= lower && t <= givenUtc).Append(givenUtc))
            {
                var end = start.AddHours(24);
                if (recorded.Count(t => t >= start && t <= end) >= max) return true;
            }
        }

        if (med.PrnMinIntervalMinutes is { } interval)
        {
            DateTime? before = recorded.Where(t => t <= givenUtc).Select(t => (DateTime?)t).LastOrDefault();
            DateTime? after = recorded.Where(t => t > givenUtc).Select(t => (DateTime?)t).FirstOrDefault();
            if (before is { } previous && (givenUtc - previous).TotalMinutes < interval) return true;
            if (after is { } next && (next - givenUtc).TotalMinutes < interval) return true;
        }

        return false;
    }
}
