namespace Odip.Domain.Enums;

public enum PlanType
{
    SelfManaged,
    PlanManaged,
    AgencyManaged
}

public enum SupportRatio
{
    OneToOne,
    OneToTwo,
    TwoToOne,
    SharedSupport,
    Other,
    OneToThree,
    OneToFour,
    OneToFive
}

public enum PreferredContactMethod
{
    Email,
    Phone,
    Mobile,
    SMS
}

public enum TripStatus
{
    Draft,
    Planning,
    OpenForBookings,
    WaitlistOnly,
    Confirmed,
    InProgress,
    Completed,
    Cancelled,
    Archived
}

public enum BookingStatus
{
    Enquiry,
    Held,
    Confirmed,
    Waitlist,
    Cancelled,
    Completed,
    NoLongerAttending
}

public enum ReservationStatus
{
    Researching,
    Requested,
    Booked,
    Confirmed,
    Cancelled,
    Unavailable
}

public enum VehicleType
{
    Car,
    Van,
    Bus,
    MiniBus,
    AccessibleVan,
    Other
}

public enum VehicleAssignmentStatus
{
    Requested,
    Confirmed,
    Unavailable,
    Cancelled
}

public enum StaffRole
{
    SupportWorker,
    SeniorSupportWorker,
    Coordinator,
    TeamLeader,
    Other
}

public enum AvailabilityType
{
    Available,
    Unavailable,
    Leave,
    Training,
    Preferred,
    Tentative
}

public enum AssignmentStatus
{
    Proposed,
    Confirmed,
    Completed,
    Cancelled
}

public enum ScheduledActivityStatus
{
    Planned,
    Booked,
    Confirmed,
    Completed,
    Cancelled
}

public enum SleepoverType
{
    None,
    ActiveNight,
    PassiveNight,
    Sleepover
}

public enum ActivityCategory
{
    Leisure,
    Dining,
    Transport,
    Sightseeing,
    Adventure,
    Cultural,
    Sport,
    Other
}

public enum TaskType
{
    AccommodationRequest,
    AccommodationConfirmation,
    VehicleRequest,
    VehicleConfirmation,
    ParticipantConfirmation,
    FamilyContact,
    InvoiceOop,
    StaffingAllocation,
    RiskReview,
    MedicationCheck,
    PreDeparture,
    PostTrip,
    InsuranceConfirmation,
    GenerateNdisClaims,
    Other
}

public enum TaskPriority
{
    Low,
    Medium,
    High,
    Urgent
}

public enum TaskItemStatus
{
    NotStarted,
    InProgress,
    Completed,
    Overdue,
    Cancelled
}

public enum DocumentType
{
    ConsentForm,
    RiskAssessment,
    MedicalClearance,
    Invoice,
    TripPack,
    SupportPlan,
    Other
}

public enum UserRole
{
    Admin,
    Coordinator,
    SupportWorker,
    ReadOnly,
    SuperAdmin   // Platform operator — TenantId is null, bypasses all query filters
}

public enum IncidentType
{
    Injury,
    Illness,
    MedicationError,
    BehaviourOfConcern,
    RestrictivePracticeUse,
    PropertyDamage,
    MissingPerson,
    Abuse,
    Neglect,
    Death,
    Other
}

public enum IncidentSeverity
{
    Low,
    Medium,
    High,
    Critical
}

public enum IncidentStatus
{
    Draft,
    Submitted,
    UnderReview,
    Escalated,
    Resolved,
    Closed
}

public enum QscReportingStatus
{
    NotRequired,
    Required,
    ReportedWithin24h,
    ReportedLate,
    Pending
}

public enum InsuranceStatus
{
    None,
    Pending,
    Confirmed,
    Expired,
    Cancelled
}

public enum PaymentStatus
{
    NotInvoiced = 0,
    InvoiceSent = 1,
    Partial     = 2,
    Paid        = 3,
    Overdue     = 4
}

public enum ContactType
{
    General = 0,
    Guardian = 1,
    EmergencyContact = 2,
    PlanManager = 3,
    SupportCoordinator = 4,
    Primary = 5,
    Secondary = 6,
    Other = 7
}

public enum TripClaimStatus
{
    Draft = 0,
    Ready = 1,
    Submitted = 2,
    Approved = 3,
    Paid = 4,
    PartiallyPaid = 5,
    Rejected = 6,
    Cancelled = 7
}

public enum ClaimLineItemStatus
{
    Draft = 0,
    Submitted = 1,
    Approved = 2,
    Paid = 3,
    PartiallyPaid = 4,
    Rejected = 5
}

public enum ClaimDayType
{
    Weekday = 0,
    Saturday = 1,
    Sunday = 2,
    Weekend = 3,
    PublicHoliday = 4,
    ShortNotice = 5,
    WeekdayEvening = 6
}

public enum ClaimType
{
    Standard = 0,
    Cancellation = 1,
    Variation = 2,
    Adjustment = 3
}

public enum GSTCode
{
    P1 = 0,
    P2 = 1,
    P5 = 2,
    GST = 3,
    NoGST = 4,
    Exempt = 5
}

public enum ClaimStatus
{
    NotClaimed = 0,
    InClaim = 1,
    Draft = 2,
    Submitted = 3,
    Approved = 4,
    Paid = 5,
    Rejected = 6
}

public enum OvernightSupportType
{
    None = 0,
    ActiveNight = 1,
    PassiveNight = 2,
    Sleepover = 3,
    SleepoverSupport = 4
}

public enum AuditAction
{
    Created,
    Updated,
    Deleted
}

// ══════════════════════════════════════════════════════════════
// MEDICATION MANAGEMENT
// ══════════════════════════════════════════════════════════════

public enum MedicationForm
{
    Tablet,
    Capsule,
    Liquid,
    Injection,
    Patch,
    Cream,
    Inhaler,
    Drops,
    Suppository,
    Enteral,
    Other,
    Powder
}

public enum MedicationRoute
{
    Oral,
    Subcutaneous,
    Intramuscular,
    Topical,
    Inhaled,
    Enteral,
    Rectal,
    Sublingual,
    Ocular,
    Nasal,
    Other
}

public enum MedicationType
{
    Regular,
    Prn
}

public enum DrugSchedule
{
    Unscheduled,
    Schedule2,
    Schedule3,
    Schedule4,
    Schedule8
}

public enum MedicationSupportLevel
{
    SelfAdministered,
    PromptOnly,
    Assist,
    Administer
}

public enum MedicationStatus
{
    Active,
    OnHold,
    Ceased
}

public enum MedicationAdministrationStatus
{
    Administered,
    Refused,
    Withheld,
    Missed
}

/// <summary>How a medication is physically packaged for administration.</summary>
public enum PackagingType
{
    WebsterPack,
    DosetteBox,
    OriginalPackaging,
    Sachet,
    Other
}

/// <summary>
/// Recurrence pattern for a Regular medication's <see cref="Odip.Domain.Entities.ParticipantMedication.TimesOfDay"/>
/// schedule. Daily (the default/backfill value for pre-existing rows) is dosed every day at the
/// listed times; SpecificDays only on the flagged weekdays (see <see cref="Weekdays"/>);
/// EveryNDays every <c>IntervalDays</c> days starting from <c>AnchorDate</c>.
/// </summary>
public enum MedicationFrequency
{
    Daily,
    SpecificDays,
    EveryNDays
}

/// <summary>Bitmask of weekdays — backs <see cref="MedicationFrequency.SpecificDays"/>.</summary>
[Flags]
public enum Weekdays
{
    None = 0,
    Monday = 1,
    Tuesday = 2,
    Wednesday = 4,
    Thursday = 8,
    Friday = 16,
    Saturday = 32,
    Sunday = 64
}

/// <summary>
/// State machine for a staff-witnessed medication administration (see
/// <see cref="Odip.Domain.Entities.MedicationAdministration.WitnessStaffId"/>). NotRequired covers
/// both "not a high-risk dose" and the legacy free-text-only <c>WitnessName</c> path (no staff
/// record was selected, so there is nothing for anyone to approve/decline). Pending is set the
/// moment a witness staff member is selected at administration time; only that named staff member
/// can move it to Approved or Declined via the portal.
/// </summary>
public enum WitnessStatus
{
    NotRequired,
    Pending,
    Approved,
    Declined
}

/// <summary>What kind of shift-relevant routine/specific this is — drives grouping in the frontend.</summary>
public enum RoutineCategory
{
    PersonalCare,
    Meals,
    Medication,
    Mobility,
    Communication,
    Behaviour,
    Sleep,
    Activity,
    Other
}

/// <summary>
/// The NDIS-authoritative restrictive practice categories, plus <see cref="Unclassified"/> for
/// register rows backfilled from the old free-text <c>SupportProfile.RestrictivePracticeDetails</c>
/// field (see the AddRestrictivePractices migration) where no specific category is known.
/// </summary>
public enum RestrictivePracticeType
{
    Seclusion,
    ChemicalRestraint,
    MechanicalRestraint,
    PhysicalRestraint,
    EnvironmentalRestraint,
    Unclassified
}

/// <summary>
/// Business-stream tags for a participant — which service line(s) they engage with (task 6b).
/// Stored as a bitmask int on <see cref="Odip.Domain.Entities.Participant.ServiceStreams"/>,
/// default <see cref="None"/> — new/existing participants stay untagged until explicitly set;
/// no migration backfill is performed. Program.cs registers a global
/// <c>JsonStringEnumConverter</c>, which natively serialises a combined flags value as a
/// comma-separated list of names (e.g. "STA, Trip") and parses that same format back on input
/// (via <c>Enum.Parse</c>'s built-in flags support) — so DTOs expose this as the plain enum type
/// with no extra list-conversion plumbing needed (contrast with <see cref="Weekdays"/>, which is
/// hand-converted to/from <c>List&lt;string&gt;</c> because its DTOs are built by mapping already
/// -materialised entities rather than via a translated IQueryable projection).
/// </summary>
[Flags]
public enum ServiceStreams
{
    None = 0,
    STA = 1,
    BSP = 2,
    InHomeSupport = 4,
    Trip = 8,
    HIDPA = 16,
    CommunityAccessDailyLiving = 32,
    CommunityNursing = 64,
}

/// <summary>
/// Ranking for a computed <see cref="Odip.Application.DTOs.ParticipantAlertDto"/> (task 6c —
/// participant risk alerts). Declared in ascending urgency order so a plain numeric sort
/// (<c>(int)Severity</c> ascending) puts <see cref="Critical"/> first — the order the frontend
/// banner/table/dashboard card render alerts in.
/// </summary>
public enum AlertSeverity
{
    Critical = 0,
    Warning = 1,
    Info = 2,
}
