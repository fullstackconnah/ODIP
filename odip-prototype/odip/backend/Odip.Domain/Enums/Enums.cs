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
/// text uses, because that name was taken by the billing funding-source entity (since retired).
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
    Other,
    // Generic obligation tasks (item 9 of the connection map) — raised and auto-completed by
    // IObligationTaskService rather than a controller's direct BookingTasks.Add.
    LeaveCoverage,
    IncidentQscReport,
    MedicationWitness,
    FlaggedNoteFollowUp,
    // An Admin's review of a shift a Coordinator booked as an emergency or safety need past a participant's budget
    // (budget phase 3). Persisted as an integer (19): append-only, never renumber.
    BudgetEmergencyReview
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

/// <summary>
/// IN-5: view-independent body region for an <see cref="Entities.IncidentInjury"/> — a region is
/// a body part, not "body part as seen from the front/back". SPEC-04's frontend
/// <c>BodyDiagram</c> component maps each region onto zero, one, or two SVG paths (front/back)
/// plus exactly one always-visible list button; this enum is the single value space shared by
/// both. Verbatim list per SPEC-04 IN-5.
/// </summary>
public enum BodyRegion
{
    Head,
    Face,
    Neck,
    Chest,
    Abdomen,
    Pelvis,
    UpperBack,
    LowerBack,
    Buttocks,
    LeftShoulder,
    RightShoulder,
    LeftUpperArm,
    RightUpperArm,
    LeftElbow,
    RightElbow,
    LeftForearm,
    RightForearm,
    LeftWrist,
    RightWrist,
    LeftHand,
    RightHand,
    LeftHip,
    RightHip,
    LeftThigh,
    RightThigh,
    LeftKnee,
    RightKnee,
    LeftLowerLeg,
    RightLowerLeg,
    LeftAnkle,
    RightAnkle,
    LeftFoot,
    RightFoot,
    Other
}

/// <summary>IN-5: the kind of injury sustained at a given <see cref="BodyRegion"/>. Verbatim list per SPEC-04 IN-5.</summary>
public enum InjuryType
{
    Bruise,
    Laceration,
    Abrasion,
    Burn,
    Fracture,
    SprainOrStrain,
    Bite,
    PressureInjury,
    Swelling,
    Other
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

/// <summary>
/// Discriminates a <see cref="Odip.Domain.Entities.TripClaim"/>'s origin (shift-completion
/// design spec §1, delivery PR 3). Append-only — Trip=0 keeps every pre-existing row correct.
/// </summary>
public enum ClaimKind
{
    Trip = 0,
    Shift = 1
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
    WeekdayEvening = 6,
    /// <summary>The catalogue's separate Weekday Night items (ASC, STA and their high-intensity twins). Appended: the values above are persisted.</summary>
    WeekdayNight = 7
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

/// <summary>
/// How strictly an organisation applies participant readiness (intake complete, onboarding
/// complete, signed service agreement) before a participant can be rostered, booked or activated.
/// Chosen per organisation on <c>ProviderSettings.ParticipantReadinessMode</c>.
/// <see cref="Warn"/> is the default for every existing and new organisation: the work proceeds
/// and what is missing is reported as readiness issues. <see cref="Enforce"/> keeps the strict,
/// fail-closed rule (<c>ParticipantReadinessGate</c>). The integer values are persisted (0 = Warn
/// is also the column's database default): never renumber or reorder.
/// </summary>
public enum ParticipantReadinessMode
{
    Warn = 0,
    Enforce = 1
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

/// <summary>
/// How a provider (tenant) applies the Medication Competency credential when a user records a medication administration
/// (<c>ProviderSettings.MedicationCompetencyMode</c>). Warn is the default and the rollout setting; Enforce is the end state.
/// </summary>
public enum MedicationCompetencyMode
{
    /// <summary>Recording is allowed for anyone. A record made by a user without a current credential is flagged
    /// (<c>MedicationAdministration.RecordedWithoutCompetency</c>) so it can be reviewed, and the portal shows a warning.</summary>
    Warn = 0,

    /// <summary>A user without a current credential is refused: 403 MEDICATION_COMPETENCY_MISSING / _EXPIRED / _UNVERIFIABLE.</summary>
    Enforce = 1,
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
/// INTAKE (sub-wave B) — the seven distinct consent decisions captured by the Participant Profile
/// source form's "Consent and Terms" block (research spec §1c-19/§4.5, Master Data Dictionary
/// CNST-001..013 collapsed to these seven, per this PR's brief): photo/video promotional use,
/// alcohol consent, non-prescribed/OTC (incl. paracetamol) medication, emergency medical
/// treatment, privacy collection, travel insurance acceptance (Terms &amp; Conditions for
/// Holidays/STA), and the general Terms &amp; Conditions acceptance itself. See
/// <see cref="Odip.Domain.Entities.ParticipantConsent"/>'s type doc for the full entity shape.
/// </summary>
public enum ConsentType
{
    PhotoVideo,
    Alcohol,
    OtcMedication,
    EmergencyMedical,
    Privacy,
    TravelInsurance,
    TermsAndConditions
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
///
/// INTAKE-03 RECONCILIATION: the Community Access service-stream variant's 14-item HIDPA checklist
/// (research spec §3, Section 3) was checked against this enum's original 9 members — 9 of the 14
/// items already existed here (added by DIAG-02) and matched near-verbatim, so this member list was
/// extended rather than replaced or duplicated. The 5 new members below (512..8192) are the genuine
/// gap. The checklist's "None of the above" item is already covered by this enum's existing
/// <see cref="None"/> = 0 default, and its free-text HIDPA-notes item is covered by
/// <see cref="Entities.Participant.HidpaNotes"/>.
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
    /// <summary>INTAKE-03. Managing a surgical stoma/colostomy — appliance changes, site care, output monitoring. Research spec §3 Section 3: "Stoma/colostomy".</summary>
    StomaColostomyCare = 512,
    /// <summary>INTAKE-03. Administering and managing insulin therapy for diagnosed diabetes. Research spec §3 Section 3: "Diabetes management (insulin)".</summary>
    DiabetesManagementInsulin = 1024,
    /// <summary>INTAKE-03. Repositioning/skin-integrity care to prevent or manage pressure injuries. Research spec §3 Section 3: "Pressure care".</summary>
    PressureCare = 2048,
    /// <summary>INTAKE-03. Support delivered under a formal high-intensity behaviour support plan. Research spec §3 Section 3: "High intensity behaviour support".</summary>
    HighIntensityBehaviourSupport = 4096,
    /// <summary>INTAKE-03. Administering medication regimes with complex dosing/timing/route requirements beyond routine oral medication. Research spec §3 Section 3: "Medication administration (complex)".</summary>
    ComplexMedicationAdministration = 8192,
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

/// <summary>
/// INTAKE sub-wave C1 — the ten structured health/medical conditions the Participant Profile
/// source form's "Diagnoses &amp; Medical Conditions" table (research spec §1c-8, Master Data
/// Dictionary MED-002..011) tracks per participant, one <see cref="Entities.ParticipantHealthCondition"/>
/// row each: Intellectual Disability, Visual Impairment, Hearing Impairment, Mental Health, High
/// Blood Pressure, Wound Care, Epilepsy, Diabetes, Asthma, Dysphagia. This is a support-planning
/// detail grid, NOT a replacement for <see cref="Entities.Participant.PrimaryDiagnosis"/>/
/// <see cref="Entities.Participant.OtherDiagnoses"/> (DIAG-01's clinical diagnosis labels) — see
/// <see cref="Entities.ParticipantHealthCondition"/>'s type doc for the full reconciliation between
/// the two, including the one-way Epilepsy-diagnosis-to-grid derivation rule.
/// </summary>
public enum HealthConditionType
{
    IntellectualDisability,
    VisualImpairment,
    HearingImpairment,
    MentalHealth,
    HighBloodPressure,
    WoundCare,
    Epilepsy,
    Diabetes,
    Asthma,
    Dysphagia,
}

/// <summary>
/// INTAKE sub-wave C1, Master Data Dictionary MOB-002/003 — the Participant Profile source form's
/// Ambulant sub-grid (§1c-9 "Client Functional Information"): "No Assist/Unsteady/Frame/Short
/// Distance". Nullable on <see cref="Entities.Participant.AmbulantStatus"/> — unset until intake
/// captures it. Deliberately these four source-form values only, not a wider invented scale.
/// </summary>
public enum AmbulantStatus
{
    NoAssist,
    Unsteady,
    Frame,
    ShortDistance,
}

/// <summary>
/// INTAKE sub-wave C1, Master Data Dictionary MOB-006 — the Participant Profile source form's
/// "Level of Personal Care" field (§1c-9): "Independent/Supervision/One-person/Two-person".
/// </summary>
public enum PersonalCareLevel
{
    Independent,
    Supervision,
    OnePerson,
    TwoPerson,
}

/// <summary>
/// INTAKE sub-wave C1 — shared Low/Medium/High/Critical rating vocabulary reused by both
/// <see cref="Entities.Participant.FallsRiskRating"/> (MOB-003, §1c-9's Ambulant sub-grid "Falls
/// Risk Low/Med/High/Crit") and <see cref="Entities.Participant.BehaviourRiskRating"/> (COG-011,
/// §1c-10's "Risk Assessment 5-years-ago/Current [Low/Med/High/Critical each]") — the richer
/// 4-value Participant Profile vocabulary, not the Intake coversheet's 3-value Low/Med/High/NA
/// variant (§2's flagged value-set delta; a null value on the nullable column already covers the
/// "not applicable/not rated" case without a separate NA member).
/// </summary>
public enum RiskRatingLevel
{
    Low,
    Medium,
    High,
    Critical,
}

/// <summary>
/// INTAKE sub-wave C1, Master Data Dictionary COG-001 — the Participant Profile source form's
/// "Memory" field (§1c-10 "Cognitive and Behavioural"): "Excellent/Fair/Poor".
/// </summary>
public enum MemoryLevel
{
    Excellent,
    Fair,
    Poor,
}

/// <summary>
/// INTAKE sub-wave C2 — the 20 activities-of-daily-living rows the Participant Profile source
/// form's §1c-15 "Personal Activities of Daily Living" table (6 rows) and §1c-17 "Community and
/// Domestic ADL" table (14 rows) track per participant, one <see cref="Entities.ParticipantAdlAssessment"/>
/// row each. Modelled as ONE enum (not two) so the entity/controller/materialization code is a
/// single fixed-enumerated-set grid, exactly like <see cref="HealthConditionType"/> — see
/// <see cref="Entities.ParticipantAdlAssessment"/>'s type doc for why a Category discriminator is
/// NOT stored as its own database column, and <see cref="AdlTypeGroups"/> for the grouping this
/// enum's single declaration order backs.
///
/// PERSONAL ADLs (first 6, research spec §1c-15): Dressing, Bathing/Showering, Oral Care,
/// Grooming, Toileting/Bowel Care, Medication Administration.
/// COMMUNITY/DOMESTIC ADLs (remaining 14, research spec §1c-17): Community Access, Socialising,
/// Money Handling, Attending Appointments, Work/Study, Transportation, Public Transport, Road
/// Awareness, Kitchen, Laundry, Cleaning, Gardening, Shopping, Banking.
/// </summary>
public enum AdlType
{
    // ── Personal ADLs (§1c-15) ──────────────────────────────
    Dressing,
    Bathing,
    OralCare,
    Grooming,
    Toileting,
    MedicationAdministration,

    // ── Community / Domestic ADLs (§1c-17) ──────────────────
    CommunityAccess,
    Socialising,
    MoneyHandling,
    Appointments,
    WorkStudy,
    Transportation,
    PublicTransport,
    RoadAwareness,
    Kitchen,
    Laundry,
    Cleaning,
    Gardening,
    Shopping,
    Banking,
}

/// <summary>
/// INTAKE sub-wave C2 — the discriminator grouping <see cref="AdlType"/> into the two source-form
/// tables it came from (Personal vs Community/Domestic), used to render the wizard/detail-page grid
/// as two visually grouped sections without a stored database column — see
/// <see cref="AdlTypeGroups"/> for the lookup and <see cref="Entities.ParticipantAdlAssessment"/>'s
/// type doc for why this is derived rather than persisted.
/// </summary>
public enum AdlCategory
{
    Personal,
    CommunityDomestic,
}

/// <summary>
/// Static <see cref="AdlType"/> -&gt; <see cref="AdlCategory"/> lookup, derived from
/// <see cref="AdlType"/>'s fixed declaration order (the first 6 members are Personal, the
/// remaining 14 are Community/Domestic) rather than a stored column — see
/// <see cref="Entities.ParticipantAdlAssessment"/>'s type doc for the reasoning. Both the backend
/// (MaterializeAll's grid) and the frontend (PERSONAL_ADL_TYPES/COMMUNITY_DOMESTIC_ADL_TYPES/
/// adlCategoryOf in api/types/enums.ts) group rows this same way; keep the two in sync if this
/// list ever changes — a partition-completeness test guards each side (AdlTypeGroupsTests.cs
/// here, api/types/enums.test.ts on the frontend).
/// </summary>
public static class AdlTypeGroups
{
    public static readonly IReadOnlyList<AdlType> Personal = new[]
    {
        AdlType.Dressing, AdlType.Bathing, AdlType.OralCare, AdlType.Grooming, AdlType.Toileting, AdlType.MedicationAdministration,
    };

    public static readonly IReadOnlyList<AdlType> CommunityDomestic = new[]
    {
        AdlType.CommunityAccess, AdlType.Socialising, AdlType.MoneyHandling, AdlType.Appointments, AdlType.WorkStudy,
        AdlType.Transportation, AdlType.PublicTransport, AdlType.RoadAwareness, AdlType.Kitchen, AdlType.Laundry,
        AdlType.Cleaning, AdlType.Gardening, AdlType.Shopping, AdlType.Banking,
    };

    public static AdlCategory CategoryOf(AdlType type) => Personal.Contains(type) ? AdlCategory.Personal : AdlCategory.CommunityDomestic;
}

/// <summary>
/// INTAKE sub-wave C2 — the Personal ADL table's rating scale, shown on the source form only as
/// the column header letters "I/S/A/F" (research spec §1c-15/§1c-17) with NO expansion given
/// anywhere in the 4 analysed source documents (confirmed absent from the extracted text — see
/// the research spec's §6 "ambiguous/illegible" doctrine for how this codebase treats an
/// unconfirmed source reading). "Independent/Supervision/Assistance/FullSupport" is this PR's
/// best-effort plain-English expansion of the industry-standard ADL rating scale the letters
/// almost certainly stand for — NOT a confirmed source-document expansion. Flagged in this PR's
/// report rather than silently assumed; verify against the original Oassist form/staff training
/// material before this ships as end-user-facing copy that claims to quote the source verbatim.
/// Nullable on <see cref="Entities.ParticipantAdlAssessment.Level"/> — null = not yet assessed.
/// </summary>
public enum AdlLevel
{
    Independent,
    Supervision,
    Assistance,
    FullSupport,
}

/// <summary>
/// INTAKE-03/04 — the two structured checklists the Community Access service-stream variant adds
/// (research spec §3): Community Mobility &amp; Transport Risk (Section 7, 9 items) and Community
/// Behaviours of Concern (Section 8's checkbox list, 12 items). Derived via
/// <see cref="ChecklistItemTypeGroups"/> from <see cref="ChecklistItemType"/>, same "category
/// derived, not stored" shape as <see cref="AdlCategory"/>/<see cref="AdlTypeGroups"/>.
/// </summary>
public enum ChecklistType
{
    CommunityMobilityRisk,
    CommunityBehaviourOfConcern,
}

/// <summary>Tri-state checklist item answer. Null on <see cref="Entities.ParticipantChecklistItem.Value"/> = not yet assessed (mirrors <see cref="AdlLevel"/>'s nullable convention).</summary>
public enum ChecklistItemValue
{
    No,
    Yes,
    NotApplicable,
}

/// <summary>
/// INTAKE-03/04 — one member per checklist item across BOTH new Community Access checklists
/// (research spec §3): the 9-item Community Mobility &amp; Transport Risk checklist (Section 7) and
/// the 12-item Community Behaviours of Concern checklist (Section 8's checkbox list, distinct from
/// the free-text Triggers/EarlyWarningSigns/DeEscalation/WhatNotToDo fields on
/// <see cref="Entities.Participant"/>). Modelled as ONE enum (not two), exactly like
/// <see cref="AdlType"/> spans Personal and Community/Domestic ADLs — category is derived via
/// <see cref="ChecklistItemTypeGroups"/>, not stored, same pattern as
/// <see cref="AdlTypeGroups"/>.
///
/// COMMUNITY MOBILITY &amp; TRANSPORT RISK (first 9, research spec §3 Section 7, quoted verbatim):
/// "Uses wheelchair, Wheelchair accessible vehicle required, Walking frame/ aids, Issues with uneven
/// ground, Falls risk, Fatigues easily, Seatbelt must be checked, Sensory sensitivities (noise/crowds),
/// Communication aid/device used".
/// COMMUNITY BEHAVIOURS OF CONCERN (remaining 12, research spec §3 Section 8, quoted verbatim):
/// "Harm to self, Harm to others, Property damage, Absconding/running away, Verbal aggression/yelling,
/// Physical aggression, Refusal to move/ transition, Inappropriate public behaviour, Taking others'
/// property, Removing clothing in public, Removing seatbelt in vehicle, Other".
/// </summary>
public enum ChecklistItemType
{
    // ── Community Mobility & Transport Risk checklist (research spec §3, Section 7) ──────────
    UsesWheelchair,
    WheelchairAccessibleVehicleRequired,
    WalkingFrameOrAids,
    IssuesWithUnevenGround,
    FallsRisk,
    FatiguesEasily,
    SeatbeltMustBeChecked,
    SensorySensitivities,
    CommunicationAidOrDeviceUsed,

    // ── Community Behaviours of Concern checklist (research spec §3, Section 8) ───────────────
    HarmToSelf,
    HarmToOthers,
    PropertyDamage,
    AbscondingRunningAway,
    VerbalAggressionYelling,
    PhysicalAggression,
    RefusalToMoveTransition,
    InappropriatePublicBehaviour,
    TakingOthersProperty,
    RemovingClothingInPublic,
    RemovingSeatbeltInVehicle,
    Other,
}

/// <summary>
/// Static <see cref="ChecklistItemType"/> -&gt; <see cref="ChecklistType"/> lookup, derived from
/// <see cref="ChecklistItemType"/>'s fixed declaration order (the first 9 members are Community
/// Mobility &amp; Transport Risk, the remaining 12 are Community Behaviours of Concern) rather than
/// a stored column — exactly the same shape and reasoning as <see cref="AdlTypeGroups"/>.
/// </summary>
public static class ChecklistItemTypeGroups
{
    public static readonly IReadOnlyList<ChecklistItemType> CommunityMobilityRisk = new[]
    {
        ChecklistItemType.UsesWheelchair, ChecklistItemType.WheelchairAccessibleVehicleRequired,
        ChecklistItemType.WalkingFrameOrAids, ChecklistItemType.IssuesWithUnevenGround,
        ChecklistItemType.FallsRisk, ChecklistItemType.FatiguesEasily,
        ChecklistItemType.SeatbeltMustBeChecked, ChecklistItemType.SensorySensitivities,
        ChecklistItemType.CommunicationAidOrDeviceUsed,
    };

    public static readonly IReadOnlyList<ChecklistItemType> CommunityBehaviourOfConcern = new[]
    {
        ChecklistItemType.HarmToSelf, ChecklistItemType.HarmToOthers, ChecklistItemType.PropertyDamage,
        ChecklistItemType.AbscondingRunningAway, ChecklistItemType.VerbalAggressionYelling,
        ChecklistItemType.PhysicalAggression, ChecklistItemType.RefusalToMoveTransition,
        ChecklistItemType.InappropriatePublicBehaviour, ChecklistItemType.TakingOthersProperty,
        ChecklistItemType.RemovingClothingInPublic, ChecklistItemType.RemovingSeatbeltInVehicle,
        ChecklistItemType.Other,
    };

    public static ChecklistType CategoryOf(ChecklistItemType type) =>
        CommunityMobilityRisk.Contains(type) ? ChecklistType.CommunityMobilityRisk : ChecklistType.CommunityBehaviourOfConcern;
}
