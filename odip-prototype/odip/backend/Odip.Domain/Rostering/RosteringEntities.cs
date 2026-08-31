using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>Lifecycle of a <see cref="Shift"/>.</summary>
public enum ShiftStatus
{
    Draft = 0,
    Published = 1,
    Completed = 2,
    Cancelled = 3
}

/// <summary>
/// A staff-participant pairing preference. Three states, not a score — the absence of a
/// <see cref="StaffParticipantCompatibility"/> row for a pair means Allowed.
/// </summary>
public enum CompatibilityLevel
{
    Preferred = 0,
    Allowed = 1,
    Excluded = 2
}

/// <summary>
/// Severity of a <see cref="Odip.Domain.Rostering.Services.RosterFinding"/>. Blocking is
/// reserved for the one regulatory hard stop (expired worker screening) — everything else is
/// a Warning the coordinator may override with a reason.
/// </summary>
public enum RosterFindingSeverity
{
    Warning = 0,
    Blocking = 1
}

/// <summary>
/// A single rostered support shift for one participant on one day. <see cref="StaffId"/> is
/// null while the shift is unfilled. Trip staffing is tracked separately on
/// <see cref="StaffAssignment"/> — a <see cref="Shift"/> never represents trip work — but both
/// are read together by <see cref="Odip.Domain.Rostering.Services.RosterConflictService"/> so a
/// trip blocks a community shift and vice versa.
/// </summary>
public class Shift : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    /// <summary>Null means the shift is unfilled.</summary>
    public Guid? UserId { get; set; }
    public User? User { get; set; }

    /// <summary>The day column this shift belongs to on the roster board.</summary>
    public DateOnly ServiceDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }

    /// <summary>True for shifts crossing midnight, e.g. a 22:00-06:00 overnight shift.</summary>
    public bool EndsNextDay { get; set; }

    public SupportRatio Ratio { get; set; }
    public SleepoverType NightType { get; set; }
    public ShiftStatus Status { get; set; } = ShiftStatus.Draft;

    /// <summary>Provenance: the <see cref="ShiftPattern"/> this shift was generated from. Null for one-offs.</summary>
    public Guid? ShiftPatternId { get; set; }
    public string? Notes { get; set; }

    /// <summary>Why the coordinator accepted the Warning findings below, if any were.</summary>
    public string? OverrideReason { get; set; }

    /// <summary>Comma-separated <see cref="Services.RosterFinding.Code"/> values the coordinator acknowledged.</summary>
    public string? AcknowledgedFindingCodes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Length of the shift in hours, accounting for <see cref="EndsNextDay"/>.</summary>
    public decimal DurationHours
    {
        get
        {
            var start = StartTime.ToTimeSpan();
            var end = EndTime.ToTimeSpan();
            var span = EndsNextDay
                ? (TimeSpan.FromHours(24) - start) + end
                : end - start;
            return (decimal)span.TotalHours;
        }
    }
}

/// <summary>
/// A weekly-recurring template that <see cref="Services.ShiftPatternExpander"/> materialises
/// into <see cref="Shift"/> rows. Day-of-week + time + effective range only — no RRULE, no
/// monthly/nth-weekday recurrence.
/// </summary>
public class ShiftPattern : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    /// <summary>User pre-filled onto generated shifts. Null leaves generated shifts unfilled.</summary>
    public Guid? DefaultUserId { get; set; }
    public User? DefaultUser { get; set; }

    public DayOfWeek DayOfWeek { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }
    public SupportRatio Ratio { get; set; }
    public SleepoverType NightType { get; set; }

    public DateOnly EffectiveFrom { get; set; }
    /// <summary>Inclusive. Null means the pattern has no end date.</summary>
    public DateOnly? EffectiveTo { get; set; }

    public bool IsActive { get; set; } = true;
    public string? Notes { get; set; }
}

/// <summary>
/// One cell of the staff-participant compatibility matrix. Absence of a row for a given
/// (StaffId, ParticipantId) pair means <see cref="CompatibilityLevel.Allowed"/>. Unique on
/// (TenantId, StaffId, ParticipantId) — enforced at the persistence layer.
/// </summary>
public class StaffParticipantCompatibility : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public CompatibilityLevel Level { get; set; }
    public string? Reason { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Origin marker (task 6d): true iff this row was created/is still owned by
    /// <see cref="Odip.Infrastructure.Services.StaffCompatibilityLinkService"/> because a
    /// participant's <see cref="Participant.PreferredStaffId"/> was set — as opposed to a human
    /// writing this cell directly in the compatibility matrix (<c>RosteringController.UpsertCompatibility</c>,
    /// the matrix's only writer, always stamps this false). The service never mutates or deletes
    /// a row where this is false, so a human's explicit judgement — including "Excluded", a
    /// safety signal — is never silently overwritten just because someone later picked that same
    /// staff member from the participant's preferred-staff dropdown.
    /// </summary>
    public bool AutoLinked { get; set; }
}

/// <summary>
/// A free-text note the assigned support worker attaches to one of their own <see cref="Shift"/>
/// rows (NOTES-01). There is no shift-completion transition anywhere in this domain for the
/// assigned worker to hang note-taking off — <see cref="ShiftStatus.Completed"/> is a defined
/// enum value but nothing in <c>RosteringController</c> or <c>PortalController</c> ever sets it,
/// the coordinator's Draft→Published toggle is the only status write that exists — so a note
/// simply attaches to the shift directly, any time during or after it, rather than gating on a
/// completion event the product doesn't actually have yet. Compliance-adjacent record: same
/// "never delete" idiom as <see cref="Odip.Domain.Entities.ParticipantNote"/>, except v1 doesn't
/// even carry an archive flag — the only mutation is the author correcting their own
/// <see cref="Body"/> (<c>PortalController.UpdateShiftNote</c>, author-scoped).
/// </summary>
public class ShiftNote : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ShiftId { get; set; }
    public Shift? Shift { get; set; }

    public Guid AuthorUserId { get; set; }
    public User? AuthorUser { get; set; }

    /// <summary>Denormalised display name, stamped server-side from JWT claims at creation — same idiom as ParticipantNote.CreatedByName.</summary>
    public string AuthorName { get; set; } = string.Empty;

    public string Body { get; set; } = string.Empty;

    /// <summary>
    /// NOTES-02: keyword categories <see cref="ShiftNoteKeywordScanner"/> matched in
    /// <see cref="Body"/> as of the last save (create or edit) — recomputed on every save, not
    /// just once at creation. Client-advisory only: never blocks the save, only drives the
    /// "consider filing an incident report" prompt on the portal.
    /// </summary>
    public ShiftNoteFlagCategory FlaggedCategories { get; set; } = ShiftNoteFlagCategory.None;

    /// <summary>
    /// NOTES-02: when the author dismissed the "file an incident report?" prompt for the CURRENT
    /// <see cref="FlaggedCategories"/> value. Server-persisted (not client/localStorage-only) so
    /// the dismissal survives across devices and sessions — same compliance-adjacent posture as
    /// the rest of this entity. Null while unflagged or not yet acknowledged. Cleared back to null
    /// by <c>PortalController.UpdateShiftNote</c> whenever an edit changes the computed
    /// <see cref="FlaggedCategories"/> value, so a stale dismissal never silently suppresses the
    /// prompt for newly-introduced flagged content.
    /// </summary>
    public DateTime? FlagsAcknowledgedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
