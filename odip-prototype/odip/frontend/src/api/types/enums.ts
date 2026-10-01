// ── Plan Type ───────────────────────────────────────────
export const PLAN_TYPES = ['SelfManaged', 'PlanManaged', 'AgencyManaged'] as const
export type PlanType = typeof PLAN_TYPES[number]

// ── Gender (participant identity, INTAKE-05) ────────────
export const GENDERS = ['Male', 'Female', 'NonBinary', 'PreferNotToSay', 'Other'] as const
export type Gender = typeof GENDERS[number]

// ── Funding Source (FUND-02 — replaces free-text-only Funding Organisation) ──
export const FUNDING_SOURCES = ['Ndis', 'Other'] as const
export type FundingSource = typeof FUNDING_SOURCES[number]

// ── Support Ratio ───────────────────────────────────────
export const SUPPORT_RATIOS = ['OneToOne', 'OneToTwo', 'TwoToOne', 'SharedSupport', 'Other', 'OneToThree', 'OneToFour', 'OneToFive'] as const
export type SupportRatio = typeof SUPPORT_RATIOS[number]

// ── Preferred Contact Method ────────────────────────────
export const PREFERRED_CONTACT_METHODS = ['Email', 'Phone', 'Mobile', 'SMS'] as const
export type PreferredContactMethod = typeof PREFERRED_CONTACT_METHODS[number]

// ── Trip Status ─────────────────────────────────────────
export const TRIP_STATUSES = ['Draft', 'Planning', 'OpenForBookings', 'WaitlistOnly', 'Confirmed', 'InProgress', 'Completed', 'Cancelled', 'Archived'] as const
export type TripStatus = typeof TRIP_STATUSES[number]

// ── Booking Status ──────────────────────────────────────
export const BOOKING_STATUSES = ['Enquiry', 'Held', 'Confirmed', 'Waitlist', 'Cancelled', 'Completed', 'NoLongerAttending'] as const
export type BookingStatus = typeof BOOKING_STATUSES[number]

// ── Reservation Status ──────────────────────────────────
export const RESERVATION_STATUSES = ['Researching', 'Requested', 'Booked', 'Confirmed', 'Cancelled', 'Unavailable'] as const
export type ReservationStatus = typeof RESERVATION_STATUSES[number]

// ── Vehicle Type ────────────────────────────────────────
export const VEHICLE_TYPES = ['Car', 'Van', 'Bus', 'MiniBus', 'AccessibleVan', 'Other'] as const
export type VehicleType = typeof VEHICLE_TYPES[number]

// ── Vehicle Assignment Status ───────────────────────────
export const VEHICLE_ASSIGNMENT_STATUSES = ['Requested', 'Confirmed', 'Unavailable', 'Cancelled'] as const
export type VehicleAssignmentStatus = typeof VEHICLE_ASSIGNMENT_STATUSES[number]

// ── Position (display-only staff title — separate from the access-control UserRole below) ──
export const POSITIONS = ['SupportWorker', 'SeniorSupportWorker', 'Coordinator', 'TeamLeader', 'Other'] as const
export type Position = typeof POSITIONS[number]

// ── Availability Type ───────────────────────────────────
export const AVAILABILITY_TYPES = ['Available', 'Unavailable', 'Leave', 'Training', 'Preferred', 'Tentative'] as const
export type AvailabilityType = typeof AVAILABILITY_TYPES[number]

// ── Assignment Status ───────────────────────────────────
export const ASSIGNMENT_STATUSES = ['Proposed', 'Confirmed', 'Completed', 'Cancelled'] as const
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number]

// ── Scheduled Activity Status ───────────────────────────
export const SCHEDULED_ACTIVITY_STATUSES = ['Planned', 'Booked', 'Confirmed', 'Completed', 'Cancelled'] as const
export type ScheduledActivityStatus = typeof SCHEDULED_ACTIVITY_STATUSES[number]

// ── Sleepover Type ──────────────────────────────────────
export const SLEEPOVER_TYPES = ['None', 'ActiveNight', 'PassiveNight', 'Sleepover'] as const
export type SleepoverType = typeof SLEEPOVER_TYPES[number]

// ── Activity Category ───────────────────────────────────
export const ACTIVITY_CATEGORIES = ['Leisure', 'Dining', 'Transport', 'Sightseeing', 'Adventure', 'Cultural', 'Sport', 'Other'] as const
export type ActivityCategory = typeof ACTIVITY_CATEGORIES[number]

// ── Task Type ───────────────────────────────────────────
export const TASK_TYPES = ['AccommodationRequest', 'AccommodationConfirmation', 'VehicleRequest', 'VehicleConfirmation', 'ParticipantConfirmation', 'FamilyContact', 'InvoiceOop', 'StaffingAllocation', 'RiskReview', 'MedicationCheck', 'PreDeparture', 'PostTrip', 'InsuranceConfirmation', 'GenerateNdisClaims', 'LeaveCoverage', 'IncidentQscReport', 'MedicationWitness', 'FlaggedNoteFollowUp', 'Other'] as const
export type TaskType = typeof TASK_TYPES[number]

// ── Task Priority ───────────────────────────────────────
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const
export type TaskPriority = typeof TASK_PRIORITIES[number]

// ── Task Item Status ────────────────────────────────────
export const TASK_ITEM_STATUSES = ['NotStarted', 'InProgress', 'Completed', 'Overdue', 'Cancelled'] as const
export type TaskItemStatus = typeof TASK_ITEM_STATUSES[number]

// ── Document Type ───────────────────────────────────────
export const DOCUMENT_TYPES = ['ConsentForm', 'RiskAssessment', 'MedicalClearance', 'Invoice', 'TripPack', 'SupportPlan', 'Other'] as const
export type DocumentType = typeof DOCUMENT_TYPES[number]

// ── User Role ───────────────────────────────────────────
export const USER_ROLES = ['Admin', 'Coordinator', 'SupportWorker', 'ReadOnly', 'SuperAdmin'] as const
export type UserRole = typeof USER_ROLES[number]

// ── Incident Type ───────────────────────────────────────
export const INCIDENT_TYPES = ['Injury', 'Illness', 'MedicationError', 'BehaviourOfConcern', 'RestrictivePracticeUse', 'PropertyDamage', 'MissingPerson', 'Abuse', 'Neglect', 'Death', 'Other'] as const
export type IncidentType = typeof INCIDENT_TYPES[number]

/** IN-3: single source for the incident-type Dropdown's items and any read-only display elsewhere. */
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  Injury: 'Injury',
  Illness: 'Illness',
  MedicationError: 'Medication Error',
  BehaviourOfConcern: 'Behaviour of Concern',
  RestrictivePracticeUse: 'Restrictive Practice Use',
  PropertyDamage: 'Property Damage',
  MissingPerson: 'Missing Person',
  Abuse: 'Abuse',
  Neglect: 'Neglect',
  Death: 'Death',
  Other: 'Other',
}

// ── Incident Severity ───────────────────────────────────
export const INCIDENT_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number]

/** IN-3: single source for the severity Dropdown's items and any read-only display elsewhere. */
export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Critical',
}

// ── Incident Status ─────────────────────────────────────
export const INCIDENT_STATUSES = ['Draft', 'Submitted', 'UnderReview', 'Escalated', 'Resolved', 'Closed'] as const
export type IncidentStatus = typeof INCIDENT_STATUSES[number]

/** Compliance step: single source for the Status Dropdown's items. */
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  Draft: 'Draft',
  Submitted: 'Submitted',
  UnderReview: 'Under Review',
  Escalated: 'Escalated',
  Resolved: 'Resolved',
  Closed: 'Closed',
}

// ── Body Region (IN-5 — injury incidents) ───────────────
// View-independent: a region is a body part, not "body part as seen from the front/back". The
// frontend BodyDiagram component maps each of these onto an always-visible list button plus,
// for most regions, one or two aria-hidden decorative SVG paths (front/back). Verbatim list per
// SPEC-04 IN-5 — do not reorder/rename without checking the backend BodyRegion enum stays in sync.
export const BODY_REGIONS = [
  'Head', 'Face', 'Neck', 'Chest', 'Abdomen', 'Pelvis', 'UpperBack', 'LowerBack', 'Buttocks',
  'LeftShoulder', 'RightShoulder', 'LeftUpperArm', 'RightUpperArm', 'LeftElbow', 'RightElbow',
  'LeftForearm', 'RightForearm', 'LeftWrist', 'RightWrist', 'LeftHand', 'RightHand',
  'LeftHip', 'RightHip', 'LeftThigh', 'RightThigh', 'LeftKnee', 'RightKnee',
  'LeftLowerLeg', 'RightLowerLeg', 'LeftAnkle', 'RightAnkle', 'LeftFoot', 'RightFoot',
  'Other',
] as const
export type BodyRegion = typeof BODY_REGIONS[number]

export const BODY_REGION_LABELS: Record<BodyRegion, string> = {
  Head: 'Head',
  Face: 'Face',
  Neck: 'Neck',
  Chest: 'Chest',
  Abdomen: 'Abdomen',
  Pelvis: 'Pelvis',
  UpperBack: 'Upper back',
  LowerBack: 'Lower back',
  Buttocks: 'Buttocks',
  LeftShoulder: 'Left shoulder',
  RightShoulder: 'Right shoulder',
  LeftUpperArm: 'Left upper arm',
  RightUpperArm: 'Right upper arm',
  LeftElbow: 'Left elbow',
  RightElbow: 'Right elbow',
  LeftForearm: 'Left forearm',
  RightForearm: 'Right forearm',
  LeftWrist: 'Left wrist',
  RightWrist: 'Right wrist',
  LeftHand: 'Left hand',
  RightHand: 'Right hand',
  LeftHip: 'Left hip',
  RightHip: 'Right hip',
  LeftThigh: 'Left thigh',
  RightThigh: 'Right thigh',
  LeftKnee: 'Left knee',
  RightKnee: 'Right knee',
  LeftLowerLeg: 'Left lower leg',
  RightLowerLeg: 'Right lower leg',
  LeftAnkle: 'Left ankle',
  RightAnkle: 'Right ankle',
  LeftFoot: 'Left foot',
  RightFoot: 'Right foot',
  Other: 'Other',
}

/** Which of the four `BodyDiagram` fieldset headings each region groups under. */
export const BODY_REGION_GROUPS: { heading: string; regions: BodyRegion[] }[] = [
  { heading: 'Head & Torso', regions: ['Head', 'Face', 'Neck', 'Chest', 'Abdomen', 'Pelvis', 'UpperBack', 'LowerBack', 'Buttocks'] },
  { heading: 'Arms', regions: ['LeftShoulder', 'RightShoulder', 'LeftUpperArm', 'RightUpperArm', 'LeftElbow', 'RightElbow', 'LeftForearm', 'RightForearm', 'LeftWrist', 'RightWrist', 'LeftHand', 'RightHand'] },
  { heading: 'Legs', regions: ['LeftHip', 'RightHip', 'LeftThigh', 'RightThigh', 'LeftKnee', 'RightKnee', 'LeftLowerLeg', 'RightLowerLeg', 'LeftAnkle', 'RightAnkle', 'LeftFoot', 'RightFoot'] },
  { heading: 'Other', regions: ['Other'] },
]

// ── Injury Type (IN-5 — selectable per injury row) ──────
export const INJURY_TYPES = [
  'Bruise', 'Laceration', 'Abrasion', 'Burn', 'Fracture', 'SprainOrStrain', 'Bite', 'PressureInjury', 'Swelling', 'Other',
] as const
export type InjuryType = typeof INJURY_TYPES[number]

export const INJURY_TYPE_LABELS: Record<InjuryType, string> = {
  Bruise: 'Bruise',
  Laceration: 'Laceration',
  Abrasion: 'Abrasion',
  Burn: 'Burn',
  Fracture: 'Fracture',
  SprainOrStrain: 'Sprain or strain',
  Bite: 'Bite',
  PressureInjury: 'Pressure injury',
  Swelling: 'Swelling',
  Other: 'Other',
}

// ── QSC Reporting Status ────────────────────────────────
export const QSC_REPORTING_STATUSES = ['NotRequired', 'Required', 'ReportedWithin24h', 'ReportedLate', 'Pending'] as const
export type QscReportingStatus = typeof QSC_REPORTING_STATUSES[number]

/** Compliance step: single source for the QSC Reporting Status Dropdown's items. */
export const QSC_REPORTING_STATUS_LABELS: Record<QscReportingStatus, string> = {
  NotRequired: 'Not Required',
  Required: 'Required',
  ReportedWithin24h: 'Reported Within 24h',
  ReportedLate: 'Reported Late',
  Pending: 'Pending',
}

// ── Insurance Status ────────────────────────────────────
export const INSURANCE_STATUSES = ['None', 'Pending', 'Confirmed', 'Expired', 'Cancelled'] as const
export type InsuranceStatus = typeof INSURANCE_STATUSES[number]

// ── Payment Status ──────────────────────────────────────
export const PAYMENT_STATUSES = ['NotInvoiced', 'InvoiceSent', 'Partial', 'Paid', 'Overdue'] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]

// ── Service Streams (participant business-stream tags) ──
export const SERVICE_STREAMS = [
  'STA', 'BSP', 'InHomeSupport', 'Trip', 'HIDPA', 'CommunityAccessDailyLiving', 'CommunityNursing',
] as const
export type ServiceStream = typeof SERVICE_STREAMS[number]

// ── Contact Type ────────────────────────────────────────
export const CONTACT_TYPES = ['General', 'Guardian', 'EmergencyContact', 'PlanManager', 'SupportCoordinator', 'Primary', 'Secondary', 'Other'] as const
export type ContactType = typeof CONTACT_TYPES[number]

// ── Trip Claim Status ───────────────────────────────────
export const TRIP_CLAIM_STATUSES = ['Draft', 'Ready', 'Submitted', 'Approved', 'Paid', 'PartiallyPaid', 'Rejected', 'Cancelled'] as const
export type TripClaimStatus = typeof TRIP_CLAIM_STATUSES[number]

// ── Claim Line Item Status ──────────────────────────────
export const CLAIM_LINE_ITEM_STATUSES = ['Draft', 'Submitted', 'Approved', 'Paid', 'PartiallyPaid', 'Rejected'] as const
export type ClaimLineItemStatus = typeof CLAIM_LINE_ITEM_STATUSES[number]

// ── Claim Day Type ──────────────────────────────────────
export const CLAIM_DAY_TYPES = ['Weekday', 'Saturday', 'Sunday', 'Weekend', 'PublicHoliday', 'ShortNotice', 'WeekdayEvening'] as const
export type ClaimDayType = typeof CLAIM_DAY_TYPES[number]

// ── Claim Type ──────────────────────────────────────────
export const CLAIM_TYPES = ['Standard', 'Cancellation', 'Variation', 'Adjustment'] as const
export type ClaimType = typeof CLAIM_TYPES[number]

// ── GST Code ────────────────────────────────────────────
export const GST_CODES = ['P1', 'P2', 'P5', 'GST', 'NoGST', 'Exempt'] as const
export type GSTCode = typeof GST_CODES[number]

// ── Claim Status ────────────────────────────────────────
export const CLAIM_STATUSES = ['NotClaimed', 'InClaim', 'Draft', 'Submitted', 'Approved', 'Paid', 'Rejected'] as const
export type ClaimStatus = typeof CLAIM_STATUSES[number]

// ── Overnight Support Type ──────────────────────────────
export const OVERNIGHT_SUPPORT_TYPES = ['None', 'ActiveNight', 'PassiveNight', 'Sleepover', 'SleepoverSupport'] as const
export type OvernightSupportType = typeof OVERNIGHT_SUPPORT_TYPES[number]

// ── Shift Status ─────────────────────────────────────────
// InProgress/PendingReview added by the shift-completion design spec (§1/§3) — a worker's
// Start/Finish taps flip a Published shift through these two states before Approve/Return
// settles it back to Completed or Published.
export const SHIFT_STATUSES = ['Draft', 'Published', 'Completed', 'Cancelled', 'InProgress', 'PendingReview'] as const
export type ShiftStatus = typeof SHIFT_STATUSES[number]

// Subset of SHIFT_STATUSES a coordinator can actually set via PUT /shifts/{id} —
// RosteringController.UpdateShift's fromAllowed/toAllowed gate only ever allows a
// Draft/Published/Cancelled source AND target; InProgress/PendingReview/Completed are
// system/worker-driven states reachable only through the completion endpoints
// (start/finish/approve/return) and any other transition into/out of them 409s with
// ShiftErrorCodes.ShiftStatusLocked. ShiftSlideOver's status dropdown narrows to this set,
// showing the shift's actual status read-only when it's one of the worker-driven ones instead
// of offering a transition the backend will always reject.
export const COORDINATOR_SETTABLE_SHIFT_STATUSES = ['Draft', 'Published', 'Cancelled'] as const

// ── Claim Kind ───────────────────────────────────────────
// Discriminates a TripClaim's origin (shift-completion design spec §1, PR 3): Trip claims are
// generated from a TripInstance's confirmed bookings; Shift claims are generated from a
// participant's completed, unclaimed Shifts. Append-only, mirrors backend ClaimKind exactly.
export const CLAIM_KINDS = ['Trip', 'Shift'] as const
export type ClaimKind = typeof CLAIM_KINDS[number]

// ── Compatibility Level ──────────────────────────────────
export const COMPATIBILITY_LEVELS = ['Preferred', 'Allowed', 'Excluded'] as const
export type CompatibilityLevel = typeof COMPATIBILITY_LEVELS[number]

// ── Roster Finding Severity ──────────────────────────────
export const ROSTER_FINDING_SEVERITIES = ['Warning', 'Blocking'] as const
export type RosterFindingSeverity = typeof ROSTER_FINDING_SEVERITIES[number]

// ── Roster Staff Compliance ──────────────────────────────
export const ROSTER_COMPLIANCE_LEVELS = ['Ok', 'Warning', 'Blocked'] as const
export type RosterComplianceLevel = typeof ROSTER_COMPLIANCE_LEVELS[number]

// ── Medication Form ─────────────────────────────────────
export const MEDICATION_FORMS = ['Tablet', 'Capsule', 'Liquid', 'Injection', 'Patch', 'Cream', 'Inhaler', 'Drops', 'Suppository', 'Enteral', 'Other', 'Powder'] as const
export type MedicationForm = typeof MEDICATION_FORMS[number]

// ── Packaging Type ───────────────────────────────────────
export const PACKAGING_TYPES = ['WebsterPack', 'DosetteBox', 'OriginalPackaging', 'Sachet', 'Other'] as const
export type PackagingType = typeof PACKAGING_TYPES[number]

// ── Medication Route ─────────────────────────────────────
export const MEDICATION_ROUTES = ['Oral', 'Subcutaneous', 'Intramuscular', 'Topical', 'Inhaled', 'Enteral', 'Rectal', 'Sublingual', 'Ocular', 'Nasal', 'Other'] as const
export type MedicationRoute = typeof MEDICATION_ROUTES[number]

// ── Medication Type ──────────────────────────────────────
export const MEDICATION_TYPES = ['Regular', 'Prn'] as const
export type MedicationType = typeof MEDICATION_TYPES[number]

// ── Drug Schedule ─────────────────────────────────────────
export const DRUG_SCHEDULES = ['Unscheduled', 'Schedule2', 'Schedule3', 'Schedule4', 'Schedule8'] as const
export type DrugSchedule = typeof DRUG_SCHEDULES[number]

// ── Medication Support Level ─────────────────────────────
export const MEDICATION_SUPPORT_LEVELS = ['SelfAdministered', 'PromptOnly', 'Assist', 'Administer'] as const
export type MedicationSupportLevel = typeof MEDICATION_SUPPORT_LEVELS[number]

// ── Medication Status ────────────────────────────────────
export const MEDICATION_STATUSES = ['Active', 'OnHold', 'Ceased'] as const
export type MedicationStatus = typeof MEDICATION_STATUSES[number]

// ── Medication Competency mode (provider setting) ────────
/**
 * How a provider applies the Medication Competency credential when a dose is recorded. Warn (the default): anyone may record and a record
 * by someone without a current credential is flagged (`recordedWithoutCompetency`). Enforce: such a record is refused (403).
 */
export const MEDICATION_COMPETENCY_MODES = ['Warn', 'Enforce'] as const
export type MedicationCompetencyMode = typeof MEDICATION_COMPETENCY_MODES[number]

// ── Medication Administration Status ─────────────────────
// MED-03: WrongMedication appended last (backend enum is a plain int column) — alongside
// Refused/Withheld/Missed it's one of the outcomes INC-03's MAR flow offers to drop into a
// pre-populated draft incident for.
export const MEDICATION_ADMINISTRATION_STATUSES = ['Administered', 'Refused', 'Withheld', 'Missed', 'WrongMedication'] as const
export type MedicationAdministrationStatus = typeof MEDICATION_ADMINISTRATION_STATUSES[number]

// ── Medication Frequency ──────────────────────────────────
export const MEDICATION_FREQUENCIES = ['Daily', 'SpecificDays', 'EveryNDays'] as const
export type MedicationFrequency = typeof MEDICATION_FREQUENCIES[number]

// ── Weekday (SpecificDays schedule picker) ────────────────
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export type Weekday = typeof WEEKDAYS[number]

// ── Witness Status ────────────────────────────────────────
export const WITNESS_STATUSES = ['NotRequired', 'Pending', 'Approved', 'Declined'] as const
export type WitnessStatus = typeof WITNESS_STATUSES[number]

// ── Routine Category ─────────────────────────────────────
export const ROUTINE_CATEGORIES = ['PersonalCare', 'Meals', 'Medication', 'Mobility', 'Communication', 'Behaviour', 'Sleep', 'Activity', 'Other'] as const
export type RoutineCategory = typeof ROUTINE_CATEGORIES[number]

// ── At-Risk Party (INTAKE-09) ─────────────────────────────
export const AT_RISK_PARTIES = ['Participant', 'OtherParticipants', 'Public', 'Staff'] as const
export type AtRiskParty = typeof AT_RISK_PARTIES[number]

// ── Day of Week (System.DayOfWeek, JsonStringEnumConverter — Sunday-first) ─
export const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export type DayOfWeekName = typeof DAYS_OF_WEEK[number]

// ── Alert Severity (computed participant risk alerts, task 6c) ───────────
export const ALERT_SEVERITIES = ['Critical', 'Warning', 'Info'] as const
export type AlertSeverity = typeof ALERT_SEVERITIES[number]

// ── Consent Type (INTAKE sub-wave B) ──────────────────────
export const CONSENT_TYPES = ['PhotoVideo', 'Alcohol', 'OtcMedication', 'EmergencyMedical', 'Privacy', 'TravelInsurance', 'TermsAndConditions'] as const
export type ConsentType = typeof CONSENT_TYPES[number]

// ── Living Arrangement (LIVING-01) ───────────────────────────────────────
export const LIVING_ARRANGEMENTS = ['Family', 'Independent', 'SupportedAccommodation'] as const
export type LivingArrangement = typeof LIVING_ARRANGEMENTS[number]

// ── AU State/Territory (INTAKE-06 address — fixed dropdown, not a backend enum: the
// entity/DTO field is a plain string, same convention as the existing Contact.State column) ──
export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const
export type AuState = typeof AU_STATES[number]

// ── HIDPA Support Category (DIAG-02 — High Intensity Daily Personal Activities) ──
// Backend is a [Flags] int enum on Participant.HidpaSupportCategories, same
// JsonStringEnumConverter comma-separated-names wire format as ServiceStreams (see
// parseHidpaCategories/formatHidpaCategories in participants.ts). NOT the same concept as
// ServiceStream's 'HIDPA' member above — that tags a participant as engaging the HIDPA
// business/service line in general; this records WHICH specific high-intensity support
// categories they need. See Odip.Domain.Enums.HidpaSupportCategory's doc comment (backend) for
// the sourcing/caveat on the descriptor wording.
//
// INTAKE-03 RECONCILIATION: the Community Access service-stream variant's 14-item HIDPA
// checklist (research spec §3, Section 3) was checked against this enum's original 9 members —
// 9 of the 14 already existed (added by DIAG-02) and matched near-verbatim, so this member list
// was extended (StomaColostomyCare..ComplexMedicationAdministration below) rather than replaced
// or duplicated. The checklist's "None of the above" item is covered by the array simply being
// empty; its free-text HIDPA-notes item is Participant.HidpaNotes (see HIDPA_CATEGORY_LABELS'
// sibling notes field, hidpaNotes, on the wizard's Medical step — ungated, same visibility as
// this whole category list).
export const HIDPA_SUPPORT_CATEGORIES = [
  'ComplexBowelCare', 'EnteralFeeding', 'DysphagiaManagement', 'TracheostomyCare', 'VentilatorSupport',
  'UrinaryCatheterManagement', 'SubcutaneousInjections', 'ComplexWoundCare', 'EpilepsyManagement',
  'StomaColostomyCare', 'DiabetesManagementInsulin', 'PressureCare', 'HighIntensityBehaviourSupport',
  'ComplexMedicationAdministration',
] as const
export type HidpaSupportCategory = typeof HIDPA_SUPPORT_CATEGORIES[number]

// ── Contact Role Type (CONTACT-01/02/03 — the 14 NDIS/disability-practice contact
// roles a Person can hold for a Participant; see Odip.Domain.Enums.ContactRoleType's doc for the
// nominee-scope modelling note). Backend is a plain int enum, same JsonStringEnumConverter
// wire format as every other enum on this page — NOT the same concept as the pre-existing,
// unused CONTACT_TYPES above (that's the legacy Contact entity's 8-value type, untouched). ──
export const CONTACT_ROLE_TYPES = [
  'NextOfKin', 'EmergencyContact', 'Guardian', 'PlanNominee', 'ChildRepresentative',
  'SupportCoordinator', 'PlanManager', 'Gp', 'Specialist', 'Pharmacy', 'ProviderContact',
  'Advocate', 'Interpreter', 'Solicitor', 'FinancialAdministrator',
] as const
export type ContactRoleType = typeof CONTACT_ROLE_TYPES[number]

// ── Nominee Scope (PlanNominee role only) ────────────────
export const NOMINEE_SCOPES = ['Plan', 'Correspondence'] as const
export type NomineeScope = typeof NOMINEE_SCOPES[number]

// ── Health Condition Type (INTAKE sub-wave C1 — the 10-row structured condition grid) ──
export const HEALTH_CONDITION_TYPES = [
  'IntellectualDisability', 'VisualImpairment', 'HearingImpairment', 'MentalHealth',
  'HighBloodPressure', 'WoundCare', 'Epilepsy', 'Diabetes', 'Asthma', 'Dysphagia',
] as const
export type HealthConditionType = typeof HEALTH_CONDITION_TYPES[number]

// ── Ambulant Status (INTAKE sub-wave C1, Mobility & Functional) ─────────────────────────
export const AMBULANT_STATUSES = ['NoAssist', 'Unsteady', 'Frame', 'ShortDistance'] as const
export type AmbulantStatus = typeof AMBULANT_STATUSES[number]

// ── Personal Care Level (INTAKE sub-wave C1, Mobility & Functional) ─────────────────────
export const PERSONAL_CARE_LEVELS = ['Independent', 'Supervision', 'OnePerson', 'TwoPerson'] as const
export type PersonalCareLevel = typeof PERSONAL_CARE_LEVELS[number]

// ── Risk Rating Level (INTAKE sub-wave C1 — shared by FallsRiskRating and BehaviourRiskRating) ──
export const RISK_RATING_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const
export type RiskRatingLevel = typeof RISK_RATING_LEVELS[number]

// ── Memory Level (INTAKE sub-wave C1, Behaviour & Communication) ────────────────────────
export const MEMORY_LEVELS = ['Excellent', 'Fair', 'Poor'] as const
export type MemoryLevel = typeof MEMORY_LEVELS[number]

// ── ADL Type (INTAKE sub-wave C2, Daily Living step — the 20-row structured ADL grid) ───
// Fixed declaration order matches the backend's Enum.GetValues<AdlType>() order exactly —
// first 6 are Personal ADLs, remaining 14 are Community/Domestic ADLs. See ADL_TYPE_CATEGORIES
// below for the grouping this order backs (mirrors the backend's AdlTypeGroups).
export const ADL_TYPES = [
  // Personal ADLs
  'Dressing', 'Bathing', 'OralCare', 'Grooming', 'Toileting', 'MedicationAdministration',
  // Community / Domestic ADLs
  'CommunityAccess', 'Socialising', 'MoneyHandling', 'Appointments', 'WorkStudy',
  'Transportation', 'PublicTransport', 'RoadAwareness', 'Kitchen', 'Laundry',
  'Cleaning', 'Gardening', 'Shopping', 'Banking',
] as const
export type AdlType = typeof ADL_TYPES[number]

/** The Personal-ADL subset of ADL_TYPES — the first 6 declaration-order entries. */
export const PERSONAL_ADL_TYPES = ADL_TYPES.slice(0, 6)
/** The Community/Domestic-ADL subset of ADL_TYPES — the remaining 14 declaration-order entries. */
export const COMMUNITY_DOMESTIC_ADL_TYPES = ADL_TYPES.slice(6)

export const ADL_CATEGORIES = ['Personal', 'CommunityDomestic'] as const
export type AdlCategory = typeof ADL_CATEGORIES[number]

/** AdlType -> AdlCategory lookup, derived from ADL_TYPES' fixed order — mirrors the backend's AdlTypeGroups.CategoryOf. Not a stored field on either side. */
export function adlCategoryOf(type: AdlType): AdlCategory {
  return (PERSONAL_ADL_TYPES as readonly string[]).includes(type) ? 'Personal' : 'CommunityDomestic'
}

// ── ADL Level (INTAKE sub-wave C2) — the Personal/Community ADL tables' "I/S/A/F" rating
// scale. See the backend's AdlLevel enum doc: the source form only ever shows the unexpanded
// letters "I/S/A/F", never spelling them out — "Independent/Supervision/Assistance/FullSupport"
// is this PR's best-effort plain-English reading, flagged (not a confirmed source expansion).
export const ADL_LEVELS = ['Independent', 'Supervision', 'Assistance', 'FullSupport'] as const
export type AdlLevel = typeof ADL_LEVELS[number]

// ── Contact Role Status ───────────────────────────────────
export const CONTACT_ROLE_STATUSES = ['Active', 'Expired', 'Superseded'] as const
export type ContactRoleStatus = typeof CONTACT_ROLE_STATUSES[number]

// ── Checklist Item Type (INTAKE-03/04, CommunityAccessDailyLiving service-stream variant) ──
// One member per checklist item across BOTH new Community Access checklists (research spec §3):
// the 9-item Community Mobility & Transport Risk checklist (Section 7) and the 12-item Community
// Behaviours of Concern checklist (Section 8's checkbox list, distinct from the free-text
// bocTriggers/bocEarlyWarningSigns/bocDeEscalationStrategies/bocWhatNotToDo fields on the
// participant). Modelled as ONE array (not two), exactly like ADL_TYPES spans Personal and
// Community/Domestic ADLs — fixed declaration order matches the backend's
// Enum.GetValues<ChecklistItemType>() order exactly: first 9 are Community Mobility & Transport
// Risk, remaining 12 are Community Behaviours of Concern. See CHECKLIST_ITEM_TYPE_GROUPS below
// for the grouping this order backs (mirrors the backend's ChecklistItemTypeGroups).
//
// COMMUNITY MOBILITY & TRANSPORT RISK (first 9, research spec §3 Section 7, quoted verbatim):
// "Uses wheelchair, Wheelchair accessible vehicle required, Walking frame/ aids, Issues with
// uneven ground, Falls risk, Fatigues easily, Seatbelt must be checked, Sensory sensitivities
// (noise/crowds), Communication aid/device used".
// COMMUNITY BEHAVIOURS OF CONCERN (remaining 12, research spec §3 Section 8, quoted verbatim):
// "Harm to self, Harm to others, Property damage, Absconding/running away, Verbal
// aggression/yelling, Physical aggression, Refusal to move/ transition, Inappropriate public
// behaviour, Taking others' property, Removing clothing in public, Removing seatbelt in vehicle,
// Other".
export const CHECKLIST_ITEM_TYPES = [
  // Community Mobility & Transport Risk checklist (research spec §3, Section 7)
  'UsesWheelchair', 'WheelchairAccessibleVehicleRequired', 'WalkingFrameOrAids', 'IssuesWithUnevenGround',
  'FallsRisk', 'FatiguesEasily', 'SeatbeltMustBeChecked', 'SensorySensitivities', 'CommunicationAidOrDeviceUsed',
  // Community Behaviours of Concern checklist (research spec §3, Section 8)
  'HarmToSelf', 'HarmToOthers', 'PropertyDamage', 'AbscondingRunningAway', 'VerbalAggressionYelling',
  'PhysicalAggression', 'RefusalToMoveTransition', 'InappropriatePublicBehaviour', 'TakingOthersProperty',
  'RemovingClothingInPublic', 'RemovingSeatbeltInVehicle', 'Other',
] as const
export type ChecklistItemType = typeof CHECKLIST_ITEM_TYPES[number]

/** The Community Mobility & Transport Risk subset of CHECKLIST_ITEM_TYPES — the first 9 declaration-order entries. */
export const COMMUNITY_MOBILITY_RISK_ITEM_TYPES = CHECKLIST_ITEM_TYPES.slice(0, 9)
/** The Community Behaviours of Concern subset of CHECKLIST_ITEM_TYPES — the remaining 12 declaration-order entries. */
export const COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES = CHECKLIST_ITEM_TYPES.slice(9)

export const CHECKLIST_TYPES = ['CommunityMobilityRisk', 'CommunityBehaviourOfConcern'] as const
export type ChecklistType = typeof CHECKLIST_TYPES[number]

/** ChecklistItemType -> ChecklistType lookup, derived from CHECKLIST_ITEM_TYPES' fixed order — mirrors the backend's ChecklistItemTypeGroups.CategoryOf. Not a stored field on either side. Same "category derived, not stored" shape as adlCategoryOf/ADL_TYPES above. */
export function getChecklistItemGroup(type: ChecklistItemType): ChecklistType {
  return (COMMUNITY_MOBILITY_RISK_ITEM_TYPES as readonly string[]).includes(type) ? 'CommunityMobilityRisk' : 'CommunityBehaviourOfConcern'
}

/** Plain-English labels for the 21 CHECKLIST_ITEM_TYPES, per the quoted item lists in this const's doc comment above. */
export const CHECKLIST_ITEM_TYPE_LABELS: Record<ChecklistItemType, string> = {
  UsesWheelchair: 'Uses wheelchair',
  WheelchairAccessibleVehicleRequired: 'Wheelchair accessible vehicle required',
  WalkingFrameOrAids: 'Walking frame / aids',
  IssuesWithUnevenGround: 'Issues with uneven ground',
  FallsRisk: 'Falls risk',
  FatiguesEasily: 'Fatigues easily',
  SeatbeltMustBeChecked: 'Seatbelt must be checked',
  SensorySensitivities: 'Sensory sensitivities (noise/crowds)',
  CommunicationAidOrDeviceUsed: 'Communication aid/device used',
  HarmToSelf: 'Harm to self',
  HarmToOthers: 'Harm to others',
  PropertyDamage: 'Property damage',
  AbscondingRunningAway: 'Absconding / running away',
  VerbalAggressionYelling: 'Verbal aggression / yelling',
  PhysicalAggression: 'Physical aggression',
  RefusalToMoveTransition: 'Refusal to move / transition',
  InappropriatePublicBehaviour: 'Inappropriate public behaviour',
  TakingOthersProperty: "Taking others' property",
  RemovingClothingInPublic: 'Removing clothing in public',
  RemovingSeatbeltInVehicle: 'Removing seatbelt in vehicle',
  Other: 'Other',
}

/**
 * Tri-state checklist item answer. Null on a ParticipantChecklistItemDto's `value` = not yet
 * assessed (mirrors AdlLevel's nullable convention above). Backend is a plain (non-flags) int
 * enum with the same global JsonStringEnumConverter wire format as AdlLevel — a bare string, not
 * comma-joined.
 */
export const CHECKLIST_ITEM_VALUES = ['No', 'Yes', 'NotApplicable'] as const
export type ChecklistItemValue = typeof CHECKLIST_ITEM_VALUES[number]

/** Mirrors ADL_LEVEL_LABELS' convention (a label map alongside the value's own const) — see adl-assessments.ts. */
export const CHECKLIST_ITEM_VALUE_LABELS: Record<ChecklistItemValue, string> = {
  No: 'No',
  Yes: 'Yes',
  NotApplicable: 'N/A',
}

// ── Community Access Risk Item Type (PF-10.2 — SPEC-05 §10's 22-item itemised risk-rating
// matrix: Road & Traffic Safety, Behaviours of Concern, Health & Personal Safety, in that fixed
// declaration order. Mirrors the backend's CommunityAccessRiskItemType exactly. Genuinely a
// different shape from CHECKLIST_ITEM_TYPES above — each item here is rated Low/Med/High/Critical
// (RISK_RATING_LEVELS) with a free-text Support/Strategy note, not a Yes/No/N-A checkbox. ──
//
// ROAD & TRAFFIC SAFETY (first 5, research spec §10, quoted verbatim): "General Road awareness,
// Runs across roads / bolts into traffic, Absconding/flight risk in the community, Wanders or gets
// lost in crowds/large venues, Removes seatbelt/opens door while vehicle moving".
// BEHAVIOURS OF CONCERN (next 8, quoted verbatim): "Harm to self (hits self, head banging,
// scratching), Harm to others (hits, kicks, bites, spits, pushes), Break items / throws objects,
// Property damage (windows, walls, cars, furniture), Verbal aggression/yelling in public, Refusal
// to return to vehicle/transition refusal, Inappropriate public behaviour, Taking food or items
// belonging to others".
// HEALTH & PERSONAL SAFETY (remaining 9, quoted verbatim): "Choking / eating and drinking in the
// community, Seizure in the community, Diabetes — hypo/hyper event, Asthma / breathing difficulty,
// Allergy or anaphylaxis exposure, Falls — uneven ground, stairs, fatigue, Continence accident
// while out, Heat/sun exposure, Water safety (pool, beach, river)".
export const COMMUNITY_ACCESS_RISK_ITEM_TYPES = [
  // Road & Traffic Safety (research spec §10)
  'GeneralRoadAwareness', 'RunsAcrossRoadsOrBoltsIntoTraffic', 'AbscondingFlightRiskInCommunity',
  'WandersOrGetsLostInCrowds', 'RemovesSeatbeltOrOpensDoorWhileMoving',
  // Behaviours of Concern (research spec §10)
  'HarmToSelf', 'HarmToOthers', 'BreakItemsOrThrowsObjects', 'PropertyDamage',
  'VerbalAggressionYellingInPublic', 'RefusalToReturnToVehicleTransition', 'InappropriatePublicBehaviour',
  'TakingFoodOrItemsBelongingToOthers',
  // Health & Personal Safety (research spec §10)
  'ChokingEatingDrinkingInCommunity', 'SeizureInCommunity', 'DiabetesHypoHyperEvent',
  'AsthmaBreathingDifficulty', 'AllergyOrAnaphylaxisExposure', 'FallsUnevenGroundStairsFatigue',
  'ContinenceAccidentWhileOut', 'HeatSunExposure', 'WaterSafety',
] as const
export type CommunityAccessRiskItemType = typeof COMMUNITY_ACCESS_RISK_ITEM_TYPES[number]

/** The Road & Traffic Safety subset of COMMUNITY_ACCESS_RISK_ITEM_TYPES — the first 5 declaration-order entries. */
export const ROAD_TRAFFIC_RISK_ITEM_TYPES = COMMUNITY_ACCESS_RISK_ITEM_TYPES.slice(0, 5)
/** The Behaviours of Concern subset — the next 8 declaration-order entries. */
export const BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES = COMMUNITY_ACCESS_RISK_ITEM_TYPES.slice(5, 13)
/** The Health & Personal Safety subset — the remaining 9 declaration-order entries. */
export const HEALTH_AND_PERSONAL_SAFETY_RISK_ITEM_TYPES = COMMUNITY_ACCESS_RISK_ITEM_TYPES.slice(13)

export const COMMUNITY_ACCESS_RISK_CATEGORIES = ['RoadTraffic', 'BehavioursOfConcern', 'HealthAndPersonalSafety'] as const
export type CommunityAccessRiskCategory = typeof COMMUNITY_ACCESS_RISK_CATEGORIES[number]

/** CommunityAccessRiskItemType -> CommunityAccessRiskCategory lookup, derived from COMMUNITY_ACCESS_RISK_ITEM_TYPES' fixed order — mirrors the backend's CommunityAccessRiskItemTypeGroups.CategoryOf. Not a stored field on either side. Same "category derived, not stored" shape as getChecklistItemGroup/adlCategoryOf above. */
export function getCommunityAccessRiskItemCategory(type: CommunityAccessRiskItemType): CommunityAccessRiskCategory {
  if ((ROAD_TRAFFIC_RISK_ITEM_TYPES as readonly string[]).includes(type)) return 'RoadTraffic'
  if ((BEHAVIOURS_OF_CONCERN_RISK_ITEM_TYPES as readonly string[]).includes(type)) return 'BehavioursOfConcern'
  return 'HealthAndPersonalSafety'
}

/** Plain-English labels for the 22 COMMUNITY_ACCESS_RISK_ITEM_TYPES, per the quoted item lists in this const's doc comment above. */
export const COMMUNITY_ACCESS_RISK_ITEM_TYPE_LABELS: Record<CommunityAccessRiskItemType, string> = {
  GeneralRoadAwareness: 'General road awareness',
  RunsAcrossRoadsOrBoltsIntoTraffic: 'Runs across roads / bolts into traffic',
  AbscondingFlightRiskInCommunity: 'Absconding / flight risk in the community',
  WandersOrGetsLostInCrowds: 'Wanders or gets lost in crowds/large venues',
  RemovesSeatbeltOrOpensDoorWhileMoving: 'Removes seatbelt/opens door while vehicle moving',
  HarmToSelf: 'Harm to self (hits self, head banging, scratching)',
  HarmToOthers: 'Harm to others (hits, kicks, bites, spits, pushes)',
  BreakItemsOrThrowsObjects: 'Break items / throws objects',
  PropertyDamage: 'Property damage (windows, walls, cars, furniture)',
  VerbalAggressionYellingInPublic: 'Verbal aggression/yelling in public',
  RefusalToReturnToVehicleTransition: 'Refusal to return to vehicle/transition refusal',
  InappropriatePublicBehaviour: 'Inappropriate public behaviour',
  TakingFoodOrItemsBelongingToOthers: "Taking food or items belonging to others",
  ChokingEatingDrinkingInCommunity: 'Choking / eating and drinking in the community',
  SeizureInCommunity: 'Seizure in the community',
  DiabetesHypoHyperEvent: 'Diabetes — hypo/hyper event',
  AsthmaBreathingDifficulty: 'Asthma / breathing difficulty',
  AllergyOrAnaphylaxisExposure: 'Allergy or anaphylaxis exposure',
  FallsUnevenGroundStairsFatigue: 'Falls — uneven ground, stairs, fatigue',
  ContinenceAccidentWhileOut: 'Continence accident while out',
  HeatSunExposure: 'Heat/sun exposure',
  WaterSafety: 'Water safety (pool, beach, river)',
}
