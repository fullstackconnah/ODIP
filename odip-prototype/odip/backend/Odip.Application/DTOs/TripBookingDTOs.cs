using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// TRIP DTOs
// ══════════════════════════════════════════════════════════════

public record TripListDto
{
    public Guid Id { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public int? MaxParticipants { get; init; }
    public int CurrentParticipantCount { get; init; }
    public int WaitlistCount { get; init; }
    public string? LeadCoordinatorName { get; init; }
}

public record TripDetailDto : TripListDto
{
    public Guid? EventTemplateId { get; init; }
    public string? EventTemplateName { get; init; }
    public DateOnly OopDueDate { get; init; }
    public DateOnly? BookingCutoffDate { get; init; }
    public Guid? LeadCoordinatorId { get; init; }
    public int? MinParticipants { get; init; }
    public int? RequiredWheelchairCapacity { get; init; }
    public int? RequiredBeds { get; init; }
    public int? RequiredBedrooms { get; init; }
    public int? MinStaffRequired { get; init; }
    public decimal CalculatedStaffRequired { get; init; }
    /// <summary>Whole staff the trip needs, as <see cref="Odip.Domain.Entities.TripInstance.StaffRequired"/> works it out; null while nothing has set it.</summary>
    public int? StaffRequired { get; init; }
    public string? Notes { get; init; }
    public int HighSupportCount { get; init; }
    public int WheelchairCount { get; init; }
    public int OvernightSupportCount { get; init; }
    public int StaffAssignedCount { get; init; }
    public int OutstandingTaskCount { get; init; }
    public int InsuranceConfirmedCount { get; init; }
    public int InsuranceOutstandingCount { get; init; }
    public decimal ActiveHoursPerDay { get; init; }
    public TimeOnly? DepartureTime { get; init; }
    public TimeOnly? ReturnTime { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record CreateTripDto : IValidatableObject
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string TripName { get; init; } = string.Empty;
    [StringLength(20)]
    public string? TripCode { get; init; }
    public Guid? EventTemplateId { get; init; }
    [StringLength(200)]
    public string? Destination { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    [Range(1, 365)]
    public int DurationDays { get; init; }
    public DateOnly? BookingCutoffDate { get; init; }
    public Guid? LeadCoordinatorId { get; init; }
    [Range(0, 1000)]
    public int? MinParticipants { get; init; }
    [Range(0, 1000)]
    public int? MaxParticipants { get; init; }
    [Range(0, 100)]
    public int? RequiredWheelchairCapacity { get; init; }
    [Range(0, 1000)]
    public int? RequiredBeds { get; init; }
    [Range(0, 1000)]
    public int? RequiredBedrooms { get; init; }
    [Range(0, 100)]
    public int? MinStaffRequired { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }

    // A body without a start date binds to 0001-01-01, which a DateOnly cannot refuse on its own.
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (StartDate == default) yield return new ValidationResult("Start date is required.", new[] { nameof(StartDate) });
    }
}

public record UpdateTripDto : CreateTripDto
{
    /// <summary>Null leaves the stored status alone.</summary>
    public TripStatus? Status { get; init; }
    public TimeOnly? DepartureTime { get; init; }
    public TimeOnly? ReturnTime { get; init; }
    /// <summary>The UpdatedAt the editor read; when it no longer matches the stored row the save is refused (409). Omitted: saved as before.</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }
}

public record PatchTripDto
{
    public TripStatus? Status { get; init; }
}

// ══════════════════════════════════════════════════════════════
// BOOKING DTOs
// ══════════════════════════════════════════════════════════════

public record BookingListDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid ParticipantId { get; init; }
    public string? ParticipantName { get; init; }
    public BookingStatus BookingStatus { get; init; }
    public DateOnly BookingDate { get; init; }
    public bool WheelchairRequired { get; init; }
    public bool HighSupportRequired { get; init; }
    public bool NightSupportRequired { get; init; }
    public bool HasRestrictivePracticeFlag { get; init; }
    public SupportRatio? SupportRatioOverride { get; init; }
    public bool ActionRequired { get; init; }
    public InsuranceStatus InsuranceStatus { get; init; }
    public PaymentStatus PaymentStatus { get; init; }
}

public record BookingDetailDto : BookingListDto
{
    public PlanType? PlanTypeOverride { get; init; }
    public string? FundingNotes { get; init; }
    public string? RoomPreference { get; init; }
    public string? TransportNotes { get; init; }
    public string? EquipmentNotes { get; init; }
    public string? RiskSupportNotes { get; init; }
    public string? BookingNotes { get; init; }
    public string? CancellationReason { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public string? InsuranceProvider { get; init; }
    public string? InsurancePolicyNumber { get; init; }
    public DateOnly? InsuranceCoverageStart { get; init; }
    public DateOnly? InsuranceCoverageEnd { get; init; }
    public bool IsInsuranceValid { get; init; }
    /// <summary>
    /// Set on the create response only: what was missing for this participant when the booking was
    /// made (Warn mode lets the booking proceed). Null (omitted from the JSON) when nothing was.
    /// </summary>
    public List<string>? ReadinessIssues { get; init; }
    /// <summary>
    /// Set on the response of a write that left the booking Confirmed (budget phase 3): where the trip takes a pool past the participant's funding for a period. A warning only, in every mode: the
    /// booking is confirmed whatever it says. Omitted when there is nothing to say, the booking is not confirmed, or the participant has no budget recorded.
    /// </summary>
    public List<BudgetWarningDto>? BudgetWarnings { get; init; }
}

public record CreateBookingDto
{
    [Required]
    public Guid TripInstanceId { get; init; }
    [Required]
    public Guid ParticipantId { get; init; }
    public BookingStatus BookingStatus { get; init; } = BookingStatus.Enquiry;
    public DateOnly? BookingDate { get; init; }
    public SupportRatio? SupportRatioOverride { get; init; }
    public bool NightSupportRequired { get; init; }
    public bool WheelchairRequired { get; init; }
    public bool HighSupportRequired { get; init; }
    public bool HasRestrictivePracticeFlag { get; init; }
    public PlanType? PlanTypeOverride { get; init; }
    [StringLength(2000)]
    public string? FundingNotes { get; init; }
    [StringLength(500)]
    public string? RoomPreference { get; init; }
    [StringLength(2000)]
    public string? TransportNotes { get; init; }
    [StringLength(2000)]
    public string? EquipmentNotes { get; init; }
    [StringLength(4000)]
    public string? RiskSupportNotes { get; init; }
    [StringLength(4000)]
    public string? BookingNotes { get; init; }
    [StringLength(200)]
    public string? InsuranceProvider { get; init; }
    [StringLength(100)]
    public string? InsurancePolicyNumber { get; init; }
    public DateOnly? InsuranceCoverageStart { get; init; }
    public DateOnly? InsuranceCoverageEnd { get; init; }
    public InsuranceStatus InsuranceStatus { get; init; } = InsuranceStatus.None;
}

public record UpdateBookingDto : CreateBookingDto
{
    public PaymentStatus PaymentStatus { get; init; }
    public bool ActionRequired { get; init; }
    [StringLength(2000)]
    public string? CancellationReason { get; init; }
    /// <summary>The UpdatedAt the editor read; when it no longer matches the stored row the save is refused (409). Omitted: saved as before.</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }
}

public record PatchBookingDto
{
    public BookingStatus? BookingStatus { get; init; }
    public InsuranceStatus? InsuranceStatus { get; init; }
    public PaymentStatus? PaymentStatus { get; init; }
}
