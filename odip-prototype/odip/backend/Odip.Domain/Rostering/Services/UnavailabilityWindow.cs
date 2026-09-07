using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>
/// Which of the three unavailability sources <see cref="Infrastructure.Rostering.StaffUnavailabilityQuery"/>
/// (see that type's remarks for why the interface lives in Infrastructure while this shape lives
/// here) tagged a given <see cref="UnavailabilityWindow"/> with. Only <c>Approved</c>
/// <see cref="RecurringUnavailability"/> rules ever produce a <see cref="RecurringRule"/> window —
/// a Pending rule raises nothing, per docs/specs/2026-09-07-staff-leave-unavailability-design.md §3.
/// </summary>
public enum UnavailabilityKind
{
    ApprovedLeave,
    PendingLeave,
    RecurringRule,
    Legacy
}

/// <summary>
/// One concrete time window a staff member is unavailable for, from whichever of the three
/// sources produced it. <see cref="Start"/>/<see cref="End"/> are always a concrete
/// <see cref="DateTime"/> pair — for a <see cref="UnavailabilityKind.RecurringRule"/> window this
/// is one specific occurrence's date + time-of-day, already expanded by
/// <see cref="RecurringUnavailabilityExpander"/>, never the raw weekly rule.
/// <see cref="LegacySourceType"/>/<see cref="LegacyNotes"/> are populated only for
/// <see cref="UnavailabilityKind.Legacy"/> windows (the source <see cref="Entities.StaffAvailability"/>
/// row's own <c>AvailabilityType</c>/<c>Notes</c>) — <see cref="RosteringDTOs.LeaveBarDto"/> (Task 5)
/// surfaces them on the roster board; <see cref="RosterConflictService"/> itself never reads either.
/// </summary>
public sealed record UnavailabilityWindow(
    Guid UserId, DateTime Start, DateTime End, UnavailabilityKind Kind,
    AvailabilityType? LegacySourceType = null, string? LegacyNotes = null);
