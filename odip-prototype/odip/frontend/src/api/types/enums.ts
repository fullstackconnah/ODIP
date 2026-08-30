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
export const TASK_TYPES = ['AccommodationRequest', 'AccommodationConfirmation', 'VehicleRequest', 'VehicleConfirmation', 'ParticipantConfirmation', 'FamilyContact', 'InvoiceOop', 'StaffingAllocation', 'RiskReview', 'MedicationCheck', 'PreDeparture', 'PostTrip', 'InsuranceConfirmation', 'GenerateNdisClaims', 'Other'] as const
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

// ── Incident Severity ───────────────────────────────────
export const INCIDENT_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number]

// ── Incident Status ─────────────────────────────────────
export const INCIDENT_STATUSES = ['Draft', 'Submitted', 'UnderReview', 'Escalated', 'Resolved', 'Closed'] as const
export type IncidentStatus = typeof INCIDENT_STATUSES[number]

// ── QSC Reporting Status ────────────────────────────────
export const QSC_REPORTING_STATUSES = ['NotRequired', 'Required', 'ReportedWithin24h', 'ReportedLate', 'Pending'] as const
export type QscReportingStatus = typeof QSC_REPORTING_STATUSES[number]

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
export const SHIFT_STATUSES = ['Draft', 'Published', 'Completed', 'Cancelled'] as const
export type ShiftStatus = typeof SHIFT_STATUSES[number]

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

// ── Day of Week (System.DayOfWeek, JsonStringEnumConverter — Sunday-first) ─
export const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export type DayOfWeekName = typeof DAYS_OF_WEEK[number]

// ── Alert Severity (computed participant risk alerts, task 6c) ───────────
export const ALERT_SEVERITIES = ['Critical', 'Warning', 'Info'] as const
export type AlertSeverity = typeof ALERT_SEVERITIES[number]

// ── Living Arrangement (LIVING-01) ───────────────────────────────────────
export const LIVING_ARRANGEMENTS = ['Family', 'Independent', 'SupportedAccommodation'] as const
export type LivingArrangement = typeof LIVING_ARRANGEMENTS[number]

// ── AU State/Territory (INTAKE-06 address — fixed dropdown, not a backend enum: the
// entity/DTO field is a plain string, same convention as the existing Contact.State column) ──
export const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const
export type AuState = typeof AU_STATES[number]
