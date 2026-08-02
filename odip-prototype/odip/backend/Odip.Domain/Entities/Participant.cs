using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Master record for every NDIS client/participant.
/// </summary>
public class Participant : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? PreferredName { get; set; }
    public string FullName => string.IsNullOrWhiteSpace(PreferredName)
        ? $"{FirstName} {LastName}"
        : $"{PreferredName} {LastName}";
    public DateOnly? DateOfBirth { get; set; }
    public string? NdisNumber { get; set; }
    public PlanType PlanType { get; set; }
    public string? Region { get; set; }
    public string? FundingOrganisation { get; set; }
    public bool IsRepeatClient { get; set; }
    public bool IsActive { get; set; } = true;
    public bool WheelchairRequired { get; set; }
    public bool IsHighSupport { get; set; }
    public bool IsIntensiveSupport { get; set; }
    public bool RequiresOvernightSupport { get; set; }
    public bool HasRestrictivePracticeFlag { get; set; }
    public SupportRatio SupportRatio { get; set; }
    public string? MobilityNotes { get; set; }
    public string? EquipmentRequirements { get; set; }
    public string? TransportRequirements { get; set; }
    public string? MedicalSummary { get; set; }
    public string? BehaviourRiskSummary { get; set; }
    public string? Notes { get; set; }
    public DateOnly? PlanStartDate { get; set; }
    public DateOnly? PlanEndDate { get; set; }
    public Guid? PlanManagerContactId { get; set; }
    public Contact? PlanManagerContact { get; set; }
    public Guid? PreferredStaffId { get; set; }
    public Staff? PreferredStaff { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public SupportProfile? SupportProfile { get; set; }
    public ICollection<ParticipantBooking> Bookings { get; set; } = new List<ParticipantBooking>();
    public ICollection<ParticipantContact> ParticipantContacts { get; set; } = new List<ParticipantContact>();
}
