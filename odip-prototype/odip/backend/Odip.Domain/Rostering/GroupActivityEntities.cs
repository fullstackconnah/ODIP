using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// One outing or session several participants attend together (group activities D2). Each participant is their own <see cref="Shift"/>, linked by <see cref="Shift.GroupActivityId"/>; the
/// workers live on <see cref="GroupActivityStaff"/> rows, never on those shifts. Status reuses <see cref="ShiftStatus"/> (PR1 writes Draft, Published and Cancelled; later states lock the activity).
/// </summary>
public class GroupActivity : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public DateOnly ServiceDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }

    public string Title { get; set; } = string.Empty;
    public Guid? ActivityId { get; set; }
    public Activity? Activity { get; set; }
    public string? Location { get; set; }
    public Guid? ServiceLocationId { get; set; }
    public ServiceLocation? ServiceLocation { get; set; }
    public string? Notes { get; set; }

    /// <summary>The fewest workers the activity needs whatever its ratios say (0 to 20); null means none beyond the ratios.</summary>
    public int? MinStaffRequired { get; set; }

    public ShiftStatus Status { get; set; } = ShiftStatus.Draft;

    /// <summary>The recurring series this occurrence belongs to; null for a one-off.</summary>
    public Guid? SeriesId { get; set; }
    public GroupActivitySeries? Series { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CancelledAt { get; set; }

    public ICollection<GroupActivityStaff> Staff { get; set; } = new List<GroupActivityStaff>();
}

public enum GroupActivityInterval { Weekly, Fortnightly, Monthly }

/// <summary>The repeat rule a recurring group activity was created with. Its occurrences are ordinary <see cref="GroupActivity"/> rows pointing back here.</summary>
public class GroupActivitySeries : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public GroupActivityInterval Interval { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A participant who is on a whole recurring series (group activities part 2): written by a Series-scope add, removed by a Series-scope remove. It belongs to the series, so cancelling occurrences never touches it. Ratio is the one asked for; an occurrence with no agreement shift to attach is made at it.</summary>
public class GroupActivitySeriesParticipant : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid SeriesId { get; set; }
    public Guid ParticipantId { get; set; }
    public SupportRatio Ratio { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A worker on a <see cref="GroupActivity"/>, for their own part of its window. One row per worker; a busy period to every roster rule (<c>RosterAvailability.ActivityStaffBusyAsync</c>).</summary>
public class GroupActivityStaff : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid GroupActivityId { get; set; }
    public GroupActivity? GroupActivity { get; set; }

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }

    public string? Role { get; set; }

    /// <summary>Why the coordinator accepted the Warning findings below, if any were (as <see cref="Shift.OverrideReason"/>).</summary>
    public string? OverrideReason { get; set; }

    /// <summary>Comma-separated finding codes the coordinator acknowledged (as <see cref="Shift.AcknowledgedFindingCodes"/>).</summary>
    public string? AcknowledgedFindingCodes { get; set; }

    // ── Work recorded by the worker and reviewed by a coordinator (GA PR3). All nullable, so rows made before PR3 need no backfill. ──

    /// <summary>When the worker started (UTC): the server's clock at Start, the typed start at Finish, or the coordinator's recorded time.</summary>
    public DateTime? ActualStart { get; set; }
    public DateTime? ActualEnd { get; set; }
    /// <summary>The zone the actual times are paid and shown in (the row shift's place, else the organisation's).</summary>
    public string? TimeZoneId { get; set; }
    /// <summary>One unpaid break, entered at Finish: both set or both null.</summary>
    public DateTime? BreakStartedAt { get; set; }
    public DateTime? BreakEndedAt { get; set; }
    public LocationCheckStatus? LocationCheck { get; set; }
    public int? LocationDistanceMetres { get; set; }
    /// <summary>When the server recorded the start.</summary>
    public DateTime? StartedAt { get; set; }
    /// <summary>Set at Finish (or when a coordinator records times on a row that never finished): the row enters review.</summary>
    public DateTime? SubmittedAt { get; set; }
    public ReviewOutcome? ReviewOutcome { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    /// <summary>The coordinator who recorded the times, and why (required with the times).</summary>
    public Guid? AdjustedByUserId { get; set; }
    public string? AdjustmentReason { get; set; }

    /// <summary>Derived, never stored.</summary>
    public GroupStaffRowState State =>
        ReviewOutcome == Rostering.ReviewOutcome.Approved ? GroupStaffRowState.Approved
        : SubmittedAt != null ? GroupStaffRowState.Finished
        : ActualStart != null ? GroupStaffRowState.Started
        : GroupStaffRowState.NotStarted;
}

public enum GroupStaffRowState { NotStarted, Started, Finished, Approved }
