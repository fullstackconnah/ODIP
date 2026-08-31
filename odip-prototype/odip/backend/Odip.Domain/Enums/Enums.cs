namespace Odip.Domain.Enums;

public enum PlanType
{
    SelfManaged,
    PlanManaged,
    AgencyManaged
}

/// <summary>
/// FUND-02: participant funding source, replacing free-text-only <c>FundingOrganisation</c> as
/// the primary signal. <see cref="Ndis"/> (the default/backfill value) means the participant's
/// NDIS plan fields (number, plan type, dates) are the relevant funding detail; <see cref="Other"/>
/// means the (reused) <see cref="Odip.Domain.Entities.Participant.FundingOrganisation"/> column
/// holds a required free-text "who funds this" answer instead, and the NDIS plan fields are
/// irrelevant. The wizard's INTAKE-07 conditional-visibility engine gates both directions off
/// this field — see frontend `src/lib/conditionalFields.ts`. Backfill (see the
/// AddParticipantFundingSource migration): rows with a non-empty pre-existing
/// FundingOrganisation become Other, empty/null rows become Ndis.
/// Named <c>ParticipantFundingSource</c> rather than the plain <c>FundingSource</c> the backlog
/// text uses because that name is already taken by the unrelated billing
/// <see cref="Odip.Domain.Billing.FundingSource"/> entity (a claims-routing funding-source
/// table) — same namespace tree, so a bare `FundingSource` here would be ambiguous everywhere
/// both `Odip.Domain.Enums` and `Odip.Domain.Billing` are in scope (e.g. DTOs.cs already `using`s
/// both).
/// </summary>
public enum ParticipantFundingSource
{
    Ndis,
    Other
}

/// <summary>
/// Participant identity gender (INTAKE-05). Mirrors the Master Data Dictionary's PID-009
/// convention ("M F NB Textbox" — a fixed set plus a free-text escape hatch): <see cref="Other"/>
/// pairs with <see cref="Odip.Domain.Entities.Participant.GenderSelfDescription"/> for an
/// optional self-described value. Nullable on the entity — existing/unspecified participants
/// stay unset rather than being forced into a default.
/// </summary>
public enum Gender
{
    Male,
    Female,
    NonBinary,
    PreferNotToSay,
    Other
}

/// <summary>
/// LIVING-01: the participant's living arrangement type. Nullable on the entity — unset until
/// intake captures it. Drives which of the LIVING-02/03/04 field groups the wizard's INTAKE-07
/// conditional-visibility engine reveals (frontend `src/lib/conditionalFields.ts`); see
/// <see cref="Odip.Domain.Entities.Participant.LivingArrangementNotes"/> for the one field
/// genuinely shared across all three arrangement types (modelled once, per the backlog's
/// "some fields shared across arrangement types" principle — mirrors INTAKE-04).
/// </summary>
public enum LivingArrangement
{
    Family,
    Independent,
    SupportedAccommodation
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

/// <summary>
/// Display-only staff position/title on <see cref="Odip.Domain.Entities.User"/>. Replaces the
/// old standalone <c>StaffRole</c> enum (see the staff/user-unification design spec) — this is
/// separate from, and does not affect, the access-control <see cref="UserRole"/> enum.
/// </summary>
public enum Position
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
    Missed,
    /// <summary>MED-03: the wrong medication was administered. Serious-incident territory —
    /// alongside Refused/Withheld/Missed this is one of the MAR outcomes INC-03's frontend
    /// prompt offers to drop into a pre-populated draft incident for. Stored as the 5th int
    /// value (column is a plain `integer`, no string conversion) — purely additive, no
    /// migration required.</summary>
    WrongMedication
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
/// INTAKE-09: who a captured <see cref="Odip.Domain.Entities.ParticipantRiskEntry"/> concerns —
/// the participant themselves, other participants they may be supported alongside, the public,
/// or support staff.
/// </summary>
public enum AtRiskParty
{
    Participant,
    OtherParticipants,
    Public,
    Staff
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
/// DIAG-02: the NDIS "High Intensity Daily Personal Activities" (HIDPA) support categories a
/// participant needs, per Supplementary Module 1 of the NDIS Practice Standards (the "High
/// Intensity Support Skills Descriptors", HISSD, in effect from 1 Feb 2024). Stored as a bitmask
/// int on <see cref="Entities.Participant.HidpaSupportCategories"/>, default <see cref="None"/> —
/// same [Flags]-on-a-participant-column shape as <see cref="ServiceStreams"/> (see that enum's doc
/// for the JsonStringEnumConverter comma-separated-names wire format both share), NOT the same
/// concept as <see cref="ServiceStreams.HIDPA"/> — that flag tags a participant as engaging with
/// the HIDPA business/service line in general; this enum instead records WHICH specific
/// high-intensity support categories they need, independent of ServiceStreams tagging.
///
/// CAVEAT: this 9-category list and the one-line descriptions were compiled from 3 corroborating
/// secondary sources (NDS, Team DSC, CentroQMS) — the primary NDIS Quality &amp; Safeguards
/// Commission PDF could not be fetched directly during research (repeated timeouts/a 403). Treat
/// member names/order as reliable (cross-source agreement) but verify exact descriptor wording
/// against the Commission's published PDF before shipping copy that quotes it verbatim to
/// end users: https://www.ndiscommission.gov.au/sites/default/files/2024-09/High%20Intensity%20support%20skills%20descriptors.pdf
///
/// DIAG-02's defined rule: an Epilepsy diagnosis (<see cref="Entities.Participant.PrimaryDiagnosis"/>
/// or any entry in <see cref="Entities.Participant.OtherDiagnoses"/>) pre-selects
/// <see cref="EpilepsyManagement"/> as a DEFAULT, not a lock — implemented entirely on the
/// frontend via the generic derivation capability in `src/lib/conditionalFields.ts`
/// (`useDeriveFieldValues`), which fires only on the transition into the epilepsy-selected state
/// so a user's later manual untick is never silently re-forced. Backend has no special-casing for
/// this rule; it just stores whatever bitmask the client submits. This is one-directional by
/// design: the engine only ever defaults <see cref="EpilepsyManagement"/> ON, never forces it back
/// OFF — so later REMOVING the Epilepsy diagnosis entirely (not just switching it away and back to
/// re-trigger the default) still never silently clears an already-set EpilepsyManagement flag. A
/// flagged high-intensity support need is never dropped without an explicit, separate user action.
/// </summary>
[Flags]
public enum HidpaSupportCategory
{
    None = 0,
    /// <summary>Manual/assisted bowel management (enemas, suppositories, ostomy/stoma bowel care) for participants who cannot self-manage elimination.</summary>
    ComplexBowelCare = 1,
    /// <summary>Delivering nutrition/fluids/medication via feeding tube (PEG, NG, jejunostomy), incl. site and equipment care.</summary>
    EnteralFeeding = 2,
    /// <summary>Safe mealtime assistance and swallowing-risk management for a diagnosed severe swallowing disorder, incl. choking/aspiration response.</summary>
    DysphagiaManagement = 4,
    /// <summary>Care of a surgical airway (tube, stoma site, suctioning) for participants who breathe via tracheostomy.</summary>
    TracheostomyCare = 8,
    /// <summary>Operating/monitoring mechanical ventilation equipment and responding to alarms/emergencies for ventilator-dependent participants.</summary>
    VentilatorSupport = 16,
    /// <summary>Managing indwelling/suprapubic urinary catheters — bag changes, hygiene, blockage/infection risk monitoring.</summary>
    UrinaryCatheterManagement = 32,
    /// <summary>Administering prescribed subcutaneous injections (incl. insulin) — diabetes-management guidance is folded into this descriptor, not a standalone category.</summary>
    SubcutaneousInjections = 64,
    /// <summary>Managing wounds requiring specialised dressing/monitoring beyond basic first aid.</summary>
    ComplexWoundCare = 128,
    /// <summary>Recognising and responding to seizures per the participant's seizure-management plan, incl. emergency medication (e.g. midazolam) where authorised. See the DIAG-02 derivation rule above.</summary>
    EpilepsyManagement = 256,
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
