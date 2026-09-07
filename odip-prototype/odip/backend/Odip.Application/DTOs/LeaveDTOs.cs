using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// LEAVE + RECURRING UNAVAILABILITY DTOs
// docs/specs/2026-09-07-staff-leave-unavailability-design.md §2
// leaveType/status/dayOfWeek serialise as string enum names ("Annual", "Pending", "Monday"),
// matching how RosteringDTOs.cs already renders its own enums (Program.cs's
// JsonStringEnumConverter, registered globally in AddJsonOptions).
// ══════════════════════════════════════════════════════════════

public record LeaveRequestDto
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string UserFullName { get; init; } = string.Empty;
    public LeaveType LeaveType { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public LeaveStatus Status { get; init; }
    public string? Reason { get; init; }
    public Guid RequestedByUserId { get; init; }
    public DateTime RequestedAt { get; init; }
    public Guid? DecidedByUserId { get; init; }
    public DateTime? DecidedAt { get; init; }
    public string? DecisionNote { get; init; }
}

public record CreateLeaveRequestDto
{
    public LeaveType LeaveType { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public string? Reason { get; init; }
    /// <summary>Ignored on the portal path (always the caller's own id). Required on POST /leave — 400 if missing.</summary>
    public Guid? UserId { get; init; }
}

public record LeaveDecisionDto
{
    /// <summary>Required (400 if blank) on decline. Unused on approve/cancel.</summary>
    public string? DecisionNote { get; init; }
}

public record RecurringUnavailabilityDto
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string UserFullName { get; init; } = string.Empty;
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public string? Notes { get; init; }
    public LeaveStatus Status { get; init; }
    public Guid RequestedByUserId { get; init; }
    public DateTime RequestedAt { get; init; }
    public Guid? DecidedByUserId { get; init; }
    public DateTime? DecidedAt { get; init; }
    public string? DecisionNote { get; init; }
}

public record CreateRecurringUnavailabilityDto
{
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public string? Notes { get; init; }
    /// <summary>Ignored on the portal path (always the caller's own id). Required on POST /leave/unavailability — 400 if missing.</summary>
    public Guid? UserId { get; init; }
}

/// <summary>POST /leave/{id}/approve response — the approved row plus any overlapping Published shifts/Confirmed trip assignments the coordinator should see before confirming. Approval itself is never blocked by these.</summary>
public record LeaveApprovalResultDto
{
    public LeaveRequestDto Leave { get; init; } = null!;
    public List<RosterFindingDto> Overlaps { get; init; } = new();
}

/// <summary>POST /leave/unavailability/{id}/approve response — same shape as <see cref="LeaveApprovalResultDto"/>.</summary>
public record RecurringUnavailabilityApprovalResultDto
{
    public RecurringUnavailabilityDto Unavailability { get; init; } = null!;
    public List<RosterFindingDto> Overlaps { get; init; } = new();
}

/// <summary>GET /portal/leave response.</summary>
public record PortalLeaveResponseDto
{
    public List<LeaveRequestDto> Leave { get; init; } = new();
    public List<RecurringUnavailabilityDto> Unavailability { get; init; } = new();
}
