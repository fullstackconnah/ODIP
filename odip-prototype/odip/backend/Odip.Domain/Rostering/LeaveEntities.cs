using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>Kind of date-range leave. Ordinal order is stable — used as a plain int EF column.</summary>
public enum LeaveType { Annual, Sick, Personal, Other }

/// <summary>
/// Shared lifecycle for both <see cref="LeaveRequest"/> and <see cref="RecurringUnavailability"/>.
/// Ordinal order is stable — used as a plain int EF column, and the migration's leave-data
/// backfill (Task 3) writes the literal value 1 (Approved) for legacy rows.
/// State-transition matrix: Pending -> Approved (coordinator) | Declined (coordinator, note
/// required) | Cancelled (staff, own, or coordinator). Approved -> Cancelled (coordinator only).
/// Declined and Cancelled are terminal. An on-behalf coordinator entry starts directly at
/// Approved — not a transition, the initial state.
/// </summary>
public enum LeaveStatus { Pending, Approved, Declined, Cancelled }

/// <summary>
/// A staff member's date-range leave request (Annual/Sick/Personal/Other), whole days only.
/// Tenant-scoped directly (unlike the <see cref="Entities.StaffAvailability"/> rows it
/// supersedes) to match the newer rostering entities' convention. See
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §1.
/// </summary>
public class LeaveRequest : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public LeaveType LeaveType { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }             // inclusive
    public LeaveStatus Status { get; set; } = LeaveStatus.Pending;
    public string? Reason { get; set; }               // staff's own note
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }          // required on Declined
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A staff member's weekly-recurring unavailability window (day of week + same-day time range,
/// effective date range) — the true recurrence <see cref="Entities.StaffAvailability"/>'s unused
/// <c>IsRecurring</c>/<c>RecurrenceNotes</c> pair never implemented. Structurally mirrors
/// <see cref="ShiftPattern"/>; no overnight windows (EndTime must be after StartTime), no
/// monthly/nth-weekday recurrence — weekly only, same as <see cref="ShiftPatternExpander"/>.
/// </summary>
public class RecurringUnavailability : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public DayOfWeek DayOfWeek { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }              // same-day only, no overnight
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public string? Notes { get; set; }
    public LeaveStatus Status { get; set; } = LeaveStatus.Pending;
    public Guid RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
