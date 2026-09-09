using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>
/// Which of the three unavailability sources <see cref="Infrastructure.Rostering.StaffUnavailabilityQuery"/>
/// (see that type's remarks for why the interface lives in Infrastructure while this shape lives
/// here) tagged a given <see cref="UnavailabilityWindow"/> with. A <see cref="RecurringUnavailability"/>
/// rule now produces a window whether it's <c>Approved</c> (<see cref="RecurringRule"/>) or
/// <c>Pending</c> (<see cref="PendingRecurringRule"/>) — mirroring how <see cref="ApprovedLeave"/>/
/// <see cref="PendingLeave"/> both surface, per the 2026-09-09 audit ruling that a pending recurring
/// request must be as visible as pending one-off leave. <see cref="PendingRecurringRule"/> gets the
/// same soft, non-reason-required treatment <see cref="PendingLeave"/> gets in
/// <see cref="RosterConflictService"/> — never the Blocking/RequiresReason treatment an Approved
/// rule gets.
/// </summary>
public enum UnavailabilityKind
{
    ApprovedLeave,
    PendingLeave,
    RecurringRule,
    PendingRecurringRule,
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
