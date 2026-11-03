using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering.Services;

namespace Odip.Domain.Rostering;

/// <summary>Why a draft row has this person (R7). Regular is the pattern's regular; the rest are the participant's compatibility tier.</summary>
public enum AutoRosterPick { Regular, Preferred, Backup, Emergency, Allowed }

/// <summary>Why auto-roster could not fill a shift (R7, D10). Serialised as a string.</summary>
public enum UncoveredReason { ParticipantNotReady, NoStaff, OnlyNoStaff, HoursCapReached, NeedsOverride, NobodyFree }

/// <summary>The fixed rules of auto-roster (R7): which findings never stop a draft row, and what a person's weekly goal is.</summary>
public static class AutoRosterRules
{
    /// <summary>
    /// An allow-list of shift-level findings that ride along as warnings on a draft row. Anything else disqualifies an ordinary candidate (OVER_HOURS, the casual fortnight cap,
    /// competency, credential, screening, pending leave), and a worker-level code added to the engine later disqualifies by default.
    /// </summary>
    public static readonly IReadOnlySet<string> SoftCodes = new HashSet<string>
    {
        RosterConflictService.PublicHoliday, RosterConflictService.RatioShortfall,
        RosterConflictService.VehicleOverSeats, RosterConflictService.VehicleOverWheelchair,
    };

    /// <summary>The person's goal hours a week: the saved figure, else by employment type: full-time the organisation's weekly hours, part-time (and unset) half of it to the nearest 0.5, casual 0 (filled last).</summary>
    public static (decimal Hours, bool IsDefault) GoalFor(User user, decimal orgWeeklyHours) =>
        user.GoalWeeklyHours is { } saved ? (saved, false)
        : user.EmploymentType switch
        {
            EmploymentType.FullTime => (orgWeeklyHours, true),
            EmploymentType.Casual => (0m, true),
            _ => (Math.Round(orgWeeklyHours, MidpointRounding.AwayFromZero) / 2m, true),
        };
}
