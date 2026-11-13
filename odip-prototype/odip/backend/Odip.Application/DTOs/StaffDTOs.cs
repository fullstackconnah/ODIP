using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// STAFF DTOs
// ══════════════════════════════════════════════════════════════

public record StaffListDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    /// <summary>The access-control role (Admin/Coordinator/SupportWorker/ReadOnly/SuperAdmin) — separate from <see cref="Position"/>.</summary>
    public UserRole Role { get; init; }
    /// <summary>Display-only staff position/title — separate from and unrelated to <see cref="Role"/>.</summary>
    public Position Position { get; init; }
    public EmploymentType? EmploymentType { get; init; }
    public decimal? GoalWeeklyHours { get; init; }
    public string? Email { get; init; }
    public string? Mobile { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsCprQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public bool IsActive { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? CprExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    /// <summary>Null for callers who may not see the number (see StaffScreeningMask); the expiry date stays visible.</summary>
    public string? WorkerScreeningNumber { get; init; }
    /// <summary>True when a number is stored, whether or not the caller may see it.</summary>
    public bool WorkerScreeningRecorded { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
    /// <summary>Employment Hero's start date for this person: read-only here, set only by the payroll sync. Null means no limit.</summary>
    public DateOnly? EmploymentStartDate { get; init; }
    public bool HasExpiredQualifications { get; init; }
    public string? Notes { get; init; }
}

public record StaffDetailDto : StaffListDto
{
    /// <summary>The row's UpdatedAt: the staff edit form sends it back as ExpectedUpdatedAt.</summary>
    public DateTime UpdatedAt { get; init; }
    /// <summary>When a sign-in invite email was last sent (UTC); null: never invited. Set on the overview only, and null for non-managers (see StaffScreeningMask).</summary>
    public DateTime? SignInInviteSentAt { get; init; }
    /// <summary>True once the person has signed in at all; null everywhere but the overview, and for non-managers (see StaffScreeningMask).</summary>
    public bool? HasSignedIn { get; init; }
    /// <summary>True while the sign-in address waits for a confirmation (User.SignInAddressUnconfirmed); null for non-managers (see StaffScreeningMask).</summary>
    public bool? SignInAddressUnconfirmed { get; init; }
}

/// <summary>Connection map item 12 — one row of GET /staff/{id}/overview's upcomingShifts (today → +14 days).</summary>
public record StaffOverviewUpcomingShiftDto
{
    public Guid ShiftId { get; init; }
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public ShiftStatus Status { get; init; }
}

/// <summary>Connection map item 12 — one row of GET /staff/{id}/overview's upcomingTripAssignments (trips ending today or later).</summary>
public record StaffOverviewTripAssignmentDto
{
    public Guid AssignmentId { get; init; }
    public Guid TripInstanceId { get; init; }
    public string TripName { get; init; } = string.Empty;
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
}

/// <summary>
/// Connection map item 12 — GET /staff/{id}/overview, the staff hub's single data source. Mirrors
/// the participant hub's ParticipantDetailDto-plus-sub-resources shape, but pre-joined server-side
/// into one call. Availability/UpcomingShifts/UpcomingTripAssignments/RecentIncidents/
/// RecentCompletions are each built from exactly one query (plus the small internal ones
/// IStaffAvailabilityItemsQuery and ShiftCompletionMapper.BuildQueueItemsAsync already make) —
/// no per-row queries.
/// </summary>
public record StaffOverviewDto
{
    public StaffDetailDto Staff { get; init; } = null!;
    /// <summary>Every Leave/RecurringUnavailability/legacy StaffAvailability row overlapping the next 90 days, all kinds.</summary>
    public List<ScheduleAvailabilityItemDto> Availability { get; init; } = new();
    public List<StaffOverviewUpcomingShiftDto> UpcomingShifts { get; init; } = new();
    public List<StaffOverviewTripAssignmentDto> UpcomingTripAssignments { get; init; } = new();
    /// <summary>Newest 10 active incidents where this staff member is the involved user (not the reporter).</summary>
    public List<IncidentListDto> RecentIncidents { get; init; } = new();
    /// <summary>Last 10 shift completions submitted by this staff member, newest first.</summary>
    public List<CompletionQueueItemDto> RecentCompletions { get; init; } = new();
}

/// <summary>
/// Create request for a Staff/User row. Username and Email are required per the staff/user
/// unification design spec §4.1 — a staff record now IS a real login-capable account, not a
/// lightweight profile row. Username itself is not an input field here: it is derived from
/// FirstName/LastName with collision-safe suffixing (see
/// <see cref="Odip.Infrastructure.Data.StaffUserUnificationMapping.ResolveUsername"/>, reused
/// by <see cref="Odip.Api.Controllers.StaffController.Create"/> rather than duplicated), the same
/// algorithm the staff/user-unification migration uses. <see cref="Role"/> is the access-control
/// role (subject to the §4.1 guardrails — own-tenant only, cannot grant/edit SuperAdmin, a
/// Coordinator actor cannot assign Admin); <see cref="Position"/> is the separate display-only title.
/// </summary>
public record CreateStaffDto
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string FirstName { get; init; } = string.Empty;
    [Required, StringLength(100, MinimumLength = 1)]
    public string LastName { get; init; } = string.Empty;
    [Required, StringLength(200), EmailAddress]
    public string Email { get; init; } = string.Empty;
    /// <summary>
    /// The admin has checked the address after being told it is at neither the tenant's own domain nor a common email provider
    /// (<see cref="Odip.Application.Common.AddressConfirmation"/>). Without it such an address is refused with a 400. On an update it
    /// matters only when the address is being changed.
    /// </summary>
    public bool AddressConfirmed { get; init; }
    public UserRole Role { get; init; } = UserRole.SupportWorker;
    public Position Position { get; init; }
    public EmploymentType? EmploymentType { get; init; }
    /// <summary>Hours a week this person aims to work: 0 to 80 in half-hours, null to use the default for their employment type.</summary>
    public decimal? GoalWeeklyHours { get; init; }
    /// <summary>The 400 message for a goal outside 0 to 80 or off the half-hour, else null. Checked in the controller (not an attribute) so a direct call is refused too.</summary>
    public string? GoalHoursError() =>
        GoalWeeklyHours is { } hours && (hours < 0 || hours > 80 || hours % 0.5m != 0) ? "Goal hours a week must be from 0 to 80, in half-hours." : null;
    [StringLength(20, ErrorMessage = "Mobile can be up to 20 characters.")]
    public string? Mobile { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsCprQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public bool IsActive { get; init; } = true;
    [StringLength(2000)]
    public string? Notes { get; init; }
    public DateOnly? FirstAidExpiryDate { get; init; }
    public DateOnly? CprExpiryDate { get; init; }
    public DateOnly? DriverLicenceExpiryDate { get; init; }
    public DateOnly? ManualHandlingExpiryDate { get; init; }
    public DateOnly? MedicationCompetencyExpiryDate { get; init; }
    [StringLength(50)]
    public string? WorkerScreeningNumber { get; init; }
    public DateOnly? WorkerScreeningExpiryDate { get; init; }
}

public record UpdateStaffDto : CreateStaffDto
{
    /// <summary>The staff row's UpdatedAt the form loaded: the server answers 409 if it changed since. Absent from older open tabs and the quick editors, which save as before.</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }
}

// ══════════════════════════════════════════════════════════════
// APP SETTINGS DTOs
// ══════════════════════════════════════════════════════════════

public record AppSettingsDto
{
    public int QualificationWarningDays { get; init; }
    public int WeeklyHoursWarning { get; init; }
    public int VarianceReviewMinutes { get; init; }
    public int PlanExpiryWarningDays { get; init; }
    public int? SessionLengthMinutes { get; init; }
    public int AutoRosterReach { get; init; } = 3;
}

public record UpdateSecuritySettingsDto
{
    /// <summary>Null = no limit. The key must be present: a body without it is a 400, never read as no limit.</summary>
    [System.Text.Json.Serialization.JsonRequired]
    [System.ComponentModel.DataAnnotations.Range(15, 480)]
    public int? SessionLengthMinutes { get; init; }
}

public record MyProfileDto
{
    public string FirstName { get; init; } = "";
    public string LastName { get; init; } = "";
    public string Email { get; init; } = "";
    public string? Mobile { get; init; }
    /// <summary>The Employment Hero sync owns the name and mobile of a linked person, so they cannot be edited here.</summary>
    public bool ManagedByEmploymentHero { get; init; }
}

/// <summary>Deliberately no id, tenant, role or email: a person edits only their own name and mobile.</summary>
public record UpdateMyProfileDto
{
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public string? Mobile { get; init; }
}

/// <summary>Presence-based: a field left out keeps the stored value, so one Settings section's save never touches another section's fields.</summary>
public record UpdateAppSettingsDto
{
    [System.ComponentModel.DataAnnotations.Range(1, 365)]
    public int? QualificationWarningDays { get; init; }
    /// <summary>Whole hours a week before the roster warns; left out keeps the stored figure.</summary>
    [System.ComponentModel.DataAnnotations.Range(1, 100)]
    public int? WeeklyHoursWarning { get; init; }
    /// <summary>Minutes of start or finish variance before a finished shift needs review.</summary>
    [System.ComponentModel.DataAnnotations.Range(1, 240)]
    public int? VarianceReviewMinutes { get; init; }
    /// <summary>Days before a participant's plan ends that the alert starts.</summary>
    [System.ComponentModel.DataAnnotations.Range(1, 365)]
    public int? PlanExpiryWarningDays { get; init; }
    /// <summary>0 Preferred only, 1 through Backup, 2 through Emergency, 3 anyone not marked No; left out keeps the stored value.</summary>
    [System.ComponentModel.DataAnnotations.Range(0, 3)]
    public int? AutoRosterReach { get; init; }
}
