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

    /// <summary>Participant identity gender (INTAKE-05). Null = not specified.</summary>
    public Gender? Gender { get; set; }

    /// <summary>Optional free-text self-description, only meaningful when <see cref="Gender"/> is <see cref="Enums.Gender.Other"/>.</summary>
    public string? GenderSelfDescription { get; set; }
    public string? NdisNumber { get; set; }
    public PlanType PlanType { get; set; }
    public string? Region { get; set; }

    /// <summary>FUND-02: NDIS vs Other funding source. Defaults to Ndis (also the backfill default
    /// for pre-existing rows with no FundingOrganisation text).</summary>
    public ParticipantFundingSource FundingSource { get; set; } = ParticipantFundingSource.Ndis;

    /// <summary>
    /// Reused as the "Other — specify" free-text field (FUND-02): required when
    /// <see cref="FundingSource"/> is <see cref="Enums.ParticipantFundingSource.Other"/>, hidden
    /// and excluded from the wizard payload when <see cref="Enums.ParticipantFundingSource.Ndis"/>.
    /// </summary>
    public string? FundingOrganisation { get; set; }
    public bool IsRepeatClient { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsHighSupport { get; set; }
    public bool IsIntensiveSupport { get; set; }

    /// <summary>LIVING-01: living arrangement type. Nullable — unset until intake captures it.</summary>
    public LivingArrangement? LivingArrangement { get; set; }

    // LIVING-02 (Family arrangement). MainSupportPersonName plausibly links to a future
    // CONTACT-01 typed contact rather than free text ("decide during design", per the backlog) —
    // CONTACT-01 isn't built yet (this wave precedes it), so these ship as free-text fields now.
    // When CONTACT-01 lands, consider replacing MainSupportPersonName/Relationship with a FK to a
    // "Family/Other" typed contact instead of duplicating name/relationship as plain strings here.
    public string? MainSupportPersonName { get; set; }
    public string? MainSupportPersonRelationship { get; set; }
    public string? OthersLivingInAccommodation { get; set; }
    public string? ResidentialInfo { get; set; }

    // LIVING-03 (Independent arrangement).
    public bool? LivesWithOthers { get; set; }
    public string? WhoLivesWith { get; set; }

    // LIVING-04 (Supported Accommodation arrangement) — controller ruling, since the backlog's
    // source bullet was empty: SIL provider name/contact, accommodation type (free text — see
    // AccommodationType doc comment), on-site support hours (free text, e.g. "24/7"/"9-5
    // weekdays"). "Notes" from the same ruling is LivingArrangementNotes below, shared with the
    // other two arrangement types rather than duplicated per-type.
    public string? SilProviderName { get; set; }
    public string? SilProviderContactPhone { get; set; }
    /// <summary>
    /// Free text rather than a validated picklist (judged against field-registry conventions —
    /// c.f. Region, MobilityNotes): unlike MobilitySupportOptions, there is no curated Master
    /// Data Dictionary list for accommodation type to validate against, and the ruling explicitly
    /// allows "free text or small enum".
    /// </summary>
    public string? AccommodationType { get; set; }
    public string? OnSiteSupportHours { get; set; }

    /// <summary>
    /// LIVING-01's one genuinely shared field: modelled ONCE and shown for whichever arrangement
    /// is selected (Family, Independent, or Supported Accommodation), rather than duplicated per
    /// arrangement type — mirrors INTAKE-04's de-duplication principle. Also satisfies LIVING-04's
    /// ruled "notes" field. See conditionalFields.ts's multi-def pitfall warning for why this is a
    /// single unioned ConditionalFieldDef on the frontend rather than one per arrangement type.
    /// </summary>
    public string? LivingArrangementNotes { get; set; }

    // INTAKE-06 — structured address. Relates to LIVING-01 (address is where the participant
    // lives) but kept as plain participant-level fields rather than nested under the living
    // arrangement — a participant has exactly one current address regardless of arrangement type.
    public string? AddressStreet { get; set; }
    public string? AddressSuburb { get; set; }
    /// <summary>AU state/territory abbreviation (e.g. "QLD", "NSW") — frontend renders a fixed dropdown.</summary>
    public string? AddressState { get; set; }
    /// <summary>4-digit AU postcode, validated server-side (see ParticipantsController.ValidateAddressPostcode).</summary>
    public string? AddressPostcode { get; set; }

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
    public Guid? PreferredUserId { get; set; }
    public User? PreferredUser { get; set; }

    /// <summary>
    /// Business-stream tags (STA/BSP/In-Home Support/Trip/HIDPA/Community Access & Daily
    /// Living/Community Nursing). Defaults to <see cref="ServiceStreams.None"/> — untagged; no
    /// backfill is performed for participants that existed before this field was added.
    /// </summary>
    public ServiceStreams ServiceStreams { get; set; } = ServiceStreams.None;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public SupportProfile? SupportProfile { get; set; }
    public ICollection<ParticipantBooking> Bookings { get; set; } = new List<ParticipantBooking>();
    public ICollection<ParticipantContact> ParticipantContacts { get; set; } = new List<ParticipantContact>();
    public ICollection<RestrictivePractice> RestrictivePractices { get; set; } = new List<RestrictivePractice>();
}
