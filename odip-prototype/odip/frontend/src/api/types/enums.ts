// ── Plan Type ───────────────────────────────────────────
export const PLAN_TYPES = ['SelfManaged', 'PlanManaged', 'AgencyManaged'] as const
export type PlanType = typeof PLAN_TYPES[number]

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

// ── Staff Role ──────────────────────────────────────────
export const STAFF_ROLES = ['SupportWorker', 'SeniorSupportWorker', 'Coordinator', 'TeamLeader', 'Other'] as const
export type StaffRole = typeof STAFF_ROLES[number]

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
