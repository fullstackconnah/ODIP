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
    public bool IsHighSupport { get; set; }
    public bool IsIntensiveSupport { get; set; }

    // Mobility aids (multi-select — a participant may use several)
    public bool MobilityAidWheelchair { get; set; }
    public bool MobilityAidWalker { get; set; }

    /// <summary>
    /// Transfer/mobility support methods. Values come from the Master Data Dictionary
    /// mobility picklist (SeedData/DataDictionarySeed.json) — the spreadsheet is the
    /// source of truth for the allowed set.
    /// </summary>
    public List<string> MobilitySupportOptions { get; set; } = new();

    public OvernightSupportType OvernightSupport { get; set; }
    public SupportRatio OvernightRatio { get; set; } = SupportRatio.OneToOne;

    // Equipment required (notes live in the existing EquipmentRequirements field)
    public bool RequiresHiLoBed { get; set; }
    public bool RequiresHoist { get; set; }
    public bool RequiresShowerChair { get; set; }
    public bool RequiresCommode { get; set; }
    public bool RequiresStandingMachine { get; set; }

    /// <summary>
    /// Legacy independently-writable flag — no writer sets this anymore. Every read path now
    /// derives the effective value from <see cref="RestrictivePractices"/> (true iff any active
    /// row exists) instead. Kept as a column rather than dropped to avoid a wider migration
    /// ripple; see the AddRestrictivePractices migration/task-5 report for details.
    /// </summary>
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
    public ICollection<RestrictivePractice> RestrictivePractices { get; set; } = new List<RestrictivePractice>();
}
