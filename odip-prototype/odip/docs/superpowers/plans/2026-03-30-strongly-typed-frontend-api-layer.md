# Strongly Typed Frontend API Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `any` types across 90 TanStack Query hooks with precise TypeScript interfaces matching the backend C# DTOs, split the monolithic hooks.ts into domain-grouped modules, and add typed client helpers.

**Architecture:** Create a `types/` directory with domain-grouped TypeScript interfaces derived from backend DTOs (DTOs.cs + ClaimDTOs.cs), a `hooks/` directory with domain-grouped hook files importing those types, typed Axios wrapper helpers in client.ts, and barrel re-exports for backward compatibility.

**Tech Stack:** TypeScript, TanStack Query v5, Axios, React 19

**Spec:** `docs/superpowers/specs/2026-03-30-strongly-typed-frontend-api-layer-design.md`

---

## File Map

### New files to create:
```
frontend/src/api/types/enums.ts
frontend/src/api/types/common.ts
frontend/src/api/types/participants.ts
frontend/src/api/types/contacts.ts
frontend/src/api/types/trips.ts
frontend/src/api/types/bookings.ts
frontend/src/api/types/accommodation.ts
frontend/src/api/types/reservations.ts
frontend/src/api/types/vehicles.ts
frontend/src/api/types/staff.ts
frontend/src/api/types/settings.ts
frontend/src/api/types/activities.ts
frontend/src/api/types/tasks.ts
frontend/src/api/types/events.ts
frontend/src/api/types/documents.ts
frontend/src/api/types/dashboard.ts
frontend/src/api/types/auth.ts
frontend/src/api/types/itinerary.ts
frontend/src/api/types/schedule.ts
frontend/src/api/types/incidents.ts
frontend/src/api/types/claims.ts
frontend/src/api/types/provider.ts
frontend/src/api/types/catalogue.ts
frontend/src/api/types/public-holidays.ts
frontend/src/api/types/tenants.ts
frontend/src/api/types/index.ts
frontend/src/api/hooks/trips.ts
frontend/src/api/hooks/participants.ts
frontend/src/api/hooks/bookings.ts
frontend/src/api/hooks/accommodation.ts
frontend/src/api/hooks/vehicles.ts
frontend/src/api/hooks/staff.ts
frontend/src/api/hooks/tasks.ts
frontend/src/api/hooks/activities.ts
frontend/src/api/hooks/incidents.ts
frontend/src/api/hooks/schedule.ts
frontend/src/api/hooks/dashboard.ts
frontend/src/api/hooks/auth.ts
frontend/src/api/hooks/settings.ts
frontend/src/api/hooks/claims.ts
frontend/src/api/hooks/catalogue.ts
frontend/src/api/hooks/public-holidays.ts
frontend/src/api/hooks/documents.ts
frontend/src/api/hooks/constants.ts
frontend/src/api/hooks/index.ts
```

### Files to modify:
```
frontend/src/api/client.ts              — add typed helper functions
```

### Files to delete (after verification):
```
frontend/src/api/hooks.ts               — replaced by hooks/ directory
```

---

## Task 1: Create enum types

**Files:**
- Create: `frontend/src/api/types/enums.ts`

- [ ] **Step 1: Create the enums file**

Write `frontend/src/api/types/enums.ts` with all 33 enums from `backend/Odip.Domain/Enums/Enums.cs`. Each enum becomes a `const` array + derived union type. Use exact C# enum member names (PascalCase) since the backend serializes with `JsonStringEnumConverter`.

```typescript
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd frontend && npx tsc --noEmit --pretty frontend/src/api/types/enums.ts 2>&1 | head -20`
Expected: No errors (file is self-contained, no imports)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/types/enums.ts
git commit -m "feat(types): add all 33 enum union types from backend"
```

---

## Task 2: Create common types and domain DTO type files

**Files:**
- Create: `frontend/src/api/types/common.ts`
- Create: `frontend/src/api/types/participants.ts`
- Create: `frontend/src/api/types/contacts.ts`
- Create: `frontend/src/api/types/trips.ts`
- Create: `frontend/src/api/types/bookings.ts`
- Create: `frontend/src/api/types/accommodation.ts`
- Create: `frontend/src/api/types/reservations.ts`
- Create: `frontend/src/api/types/vehicles.ts`
- Create: `frontend/src/api/types/staff.ts`
- Create: `frontend/src/api/types/settings.ts`
- Create: `frontend/src/api/types/auth.ts`
- Create: `frontend/src/api/types/documents.ts`
- Create: `frontend/src/api/types/tenants.ts`

- [ ] **Step 1: Create common.ts**

Source: `backend/Odip.Application/Common/ApiResponse.cs`

```typescript
export interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string | null
  errors: string[] | null
}

export interface PagedResult<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}
```

- [ ] **Step 2: Create participants.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 10-111

```typescript
import type { PlanType, SupportRatio } from './enums'

export interface ParticipantListDto {
  id: string
  firstName: string
  lastName: string
  preferredName: string | null
  fullName: string
  maskedNdisNumber: string | null
  planType: PlanType
  region: string | null
  isRepeatClient: boolean
  isActive: boolean
  wheelchairRequired: boolean
  isHighSupport: boolean
  isIntensiveSupport: boolean
  supportRatio: SupportRatio
}

export interface ParticipantDetailDto extends ParticipantListDto {
  dateOfBirth: string | null
  ndisNumber: string | null
  fundingOrganisation: string | null
  requiresOvernightSupport: boolean
  hasRestrictivePracticeFlag: boolean
  mobilityNotes: string | null
  equipmentRequirements: string | null
  transportRequirements: string | null
  medicalSummary: string | null
  behaviourRiskSummary: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateParticipantDto {
  firstName: string
  lastName: string
  preferredName?: string
  dateOfBirth?: string
  ndisNumber?: string
  planType: PlanType
  region?: string
  fundingOrganisation?: string
  isRepeatClient: boolean
  wheelchairRequired: boolean
  isHighSupport: boolean
  isIntensiveSupport: boolean
  requiresOvernightSupport: boolean
  hasRestrictivePracticeFlag: boolean
  supportRatio: SupportRatio
  mobilityNotes?: string
  equipmentRequirements?: string
  transportRequirements?: string
  medicalSummary?: string
  behaviourRiskSummary?: string
  notes?: string
}

export interface UpdateParticipantDto extends CreateParticipantDto {
  isActive: boolean
}

export interface SupportProfileDto {
  id: string
  participantId: string
  communicationNotes: string | null
  behaviourSupportNotes: string | null
  restrictivePracticeDetails: string | null
  manualHandlingNotes: string | null
  medicationHealthSummary: string | null
  emergencyConsiderations: string | null
  travelSpecificNotes: string | null
  reviewDate: string | null
}

export interface UpdateSupportProfileDto {
  communicationNotes?: string
  behaviourSupportNotes?: string
  restrictivePracticeDetails?: string
  manualHandlingNotes?: string
  medicationHealthSummary?: string
  emergencyConsiderations?: string
  travelSpecificNotes?: string
  reviewDate?: string
}
```

- [ ] **Step 3: Create contacts.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 117-129

```typescript
import type { PreferredContactMethod } from './enums'

export interface ContactDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  roleRelationship: string | null
  organisation: string | null
  email: string | null
  mobile: string | null
  phone: string | null
  preferredContactMethod: PreferredContactMethod
}
```

- [ ] **Step 4: Create trips.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 135-222

```typescript
import type { TripStatus } from './enums'

export interface TripListDto {
  id: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  maxParticipants: number | null
  currentParticipantCount: number
  waitlistCount: number
  leadCoordinatorName: string | null
}

export interface TripDetailDto extends TripListDto {
  eventTemplateId: string | null
  eventTemplateName: string | null
  oopDueDate: string
  bookingCutoffDate: string | null
  leadCoordinatorId: string | null
  minParticipants: number | null
  requiredWheelchairCapacity: number | null
  requiredBeds: number | null
  requiredBedrooms: number | null
  minStaffRequired: number | null
  calculatedStaffRequired: number
  notes: string | null
  highSupportCount: number
  wheelchairCount: number
  overnightSupportCount: number
  staffAssignedCount: number
  outstandingTaskCount: number
  insuranceConfirmedCount: number
  insuranceOutstandingCount: number
  activeHoursPerDay: number
  departureTime: string | null
  returnTime: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTripDto {
  tripName: string
  tripCode?: string
  eventTemplateId?: string
  destination?: string
  region?: string
  startDate: string
  durationDays: number
  bookingCutoffDate?: string
  leadCoordinatorId?: string
  minParticipants?: number
  maxParticipants?: number
  requiredWheelchairCapacity?: number
  requiredBeds?: number
  requiredBedrooms?: number
  minStaffRequired?: number
  notes?: string
}

export interface UpdateTripDto extends CreateTripDto {
  status: TripStatus
  departureTime?: string
  returnTime?: string
}

export interface PatchTripDto {
  status?: TripStatus
}
```

- [ ] **Step 5: Create bookings.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 228-313

```typescript
import type { BookingStatus, SupportRatio, InsuranceStatus, PaymentStatus, PlanType } from './enums'

export interface BookingListDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  participantId: string
  participantName: string | null
  bookingStatus: BookingStatus
  bookingDate: string
  wheelchairRequired: boolean
  highSupportRequired: boolean
  nightSupportRequired: boolean
  hasRestrictivePracticeFlag: boolean
  supportRatioOverride: SupportRatio | null
  actionRequired: boolean
  insuranceStatus: InsuranceStatus
  paymentStatus: PaymentStatus
}

export interface BookingDetailDto extends BookingListDto {
  planTypeOverride: PlanType | null
  fundingNotes: string | null
  roomPreference: string | null
  transportNotes: string | null
  equipmentNotes: string | null
  riskSupportNotes: string | null
  bookingNotes: string | null
  cancellationReason: string | null
  createdAt: string
  updatedAt: string
  insuranceProvider: string | null
  insurancePolicyNumber: string | null
  insuranceCoverageStart: string | null
  insuranceCoverageEnd: string | null
  isInsuranceValid: boolean
}

export interface CreateBookingDto {
  tripInstanceId: string
  participantId: string
  bookingStatus?: BookingStatus
  bookingDate?: string
  supportRatioOverride?: SupportRatio
  nightSupportRequired: boolean
  wheelchairRequired: boolean
  highSupportRequired: boolean
  hasRestrictivePracticeFlag: boolean
  planTypeOverride?: PlanType
  fundingNotes?: string
  roomPreference?: string
  transportNotes?: string
  equipmentNotes?: string
  riskSupportNotes?: string
  bookingNotes?: string
  insuranceProvider?: string
  insurancePolicyNumber?: string
  insuranceCoverageStart?: string
  insuranceCoverageEnd?: string
  insuranceStatus?: InsuranceStatus
}

export interface UpdateBookingDto extends CreateBookingDto {
  paymentStatus: PaymentStatus
  actionRequired: boolean
  cancellationReason?: string
}

export interface PatchBookingDto {
  bookingStatus?: BookingStatus
  insuranceStatus?: InsuranceStatus
  paymentStatus?: PaymentStatus
}
```

- [ ] **Step 6: Create accommodation.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 319-393

```typescript
export interface AccommodationListDto {
  id: string
  propertyName: string
  location: string | null
  region: string | null
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  isFullyModified: boolean
  isSemiModified: boolean
  isWheelchairAccessible: boolean
  bedroomCount: number | null
  bedCount: number | null
  maxCapacity: number | null
  isActive: boolean
}

export interface AccommodationDetailDto extends AccommodationListDto {
  providerOwner: string | null
  contactPerson: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  website: string | null
  accessibilityNotes: string | null
  beddingConfiguration: string | null
  hoistBathroomNotes: string | null
  generalNotes: string | null
}

export interface CreateAccommodationDto {
  propertyName: string
  providerOwner?: string
  location?: string
  region?: string
  address?: string
  suburb?: string
  state?: string
  postcode?: string
  contactPerson?: string
  email?: string
  phone?: string
  mobile?: string
  website?: string
  isFullyModified: boolean
  isSemiModified: boolean
  isWheelchairAccessible: boolean
  accessibilityNotes?: string
  bedroomCount?: number
  bedCount?: number
  maxCapacity?: number
  beddingConfiguration?: string
  hoistBathroomNotes?: string
  generalNotes?: string
  isActive?: boolean
}

export type UpdateAccommodationDto = CreateAccommodationDto
```

- [ ] **Step 7: Create reservations.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 399-441

```typescript
import type { ReservationStatus } from './enums'

export interface ReservationDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  accommodationPropertyId: string
  propertyName: string | null
  requestSentDate: string | null
  dateBooked: string | null
  dateConfirmed: string | null
  checkInDate: string
  checkOutDate: string
  bedroomsReserved: number | null
  bedsReserved: number | null
  cost: number | null
  confirmationReference: string | null
  reservationStatus: ReservationStatus
  comments: string | null
  cancellationReason: string | null
  hasOverlapConflict: boolean
}

export interface CreateReservationDto {
  tripInstanceId: string
  accommodationPropertyId: string
  requestSentDate?: string
  checkInDate: string
  checkOutDate: string
  bedroomsReserved?: number
  bedsReserved?: number
  cost?: number
  comments?: string
  reservationStatus?: ReservationStatus
}

export interface UpdateReservationDto extends CreateReservationDto {
  dateBooked?: string
  dateConfirmed?: string
  confirmationReference?: string
  cancellationReason?: string
}
```

- [ ] **Step 8: Create vehicles.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 447-530

```typescript
import type { VehicleType, VehicleAssignmentStatus } from './enums'

export interface VehicleListDto {
  id: string
  vehicleName: string
  registration: string | null
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  isInternal: boolean
  isActive: boolean
  serviceDueDate: string | null
  registrationDueDate: string | null
}

export interface VehicleDetailDto extends VehicleListDto {
  rampHoistDetails: string | null
  driverRequirements: string | null
  notes: string | null
}

export interface CreateVehicleDto {
  vehicleName: string
  registration?: string
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  rampHoistDetails?: string
  driverRequirements?: string
  isInternal?: boolean
  isActive?: boolean
  serviceDueDate?: string
  registrationDueDate?: string
  notes?: string
}

export type UpdateVehicleDto = CreateVehicleDto

export interface VehicleAssignmentDto {
  id: string
  tripInstanceId: string
  vehicleId: string
  vehicleName: string | null
  registration: string | null
  status: VehicleAssignmentStatus
  requestedDate: string | null
  confirmedDate: string | null
  driverStaffId: string | null
  driverName: string | null
  seatRequirement: number | null
  wheelchairPositionRequirement: number | null
  pickupTravelNotes: string | null
  comments: string | null
  hasOverlapConflict: boolean
}

export interface CreateVehicleAssignmentDto {
  tripInstanceId: string
  vehicleId: string
  driverStaffId?: string
  seatRequirement?: number
  wheelchairPositionRequirement?: number
  pickupTravelNotes?: string
  comments?: string
}

export interface UpdateVehicleAssignmentDto extends CreateVehicleAssignmentDto {
  status: VehicleAssignmentStatus
  confirmedDate?: string
}
```

- [ ] **Step 9: Create staff.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 536-670

```typescript
import type { StaffRole, AvailabilityType, AssignmentStatus, SleepoverType } from './enums'

export interface StaffListDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  role: StaffRole
  email: string | null
  mobile: string | null
  region: string | null
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  isActive: boolean
  firstAidExpiryDate: string | null
  driverLicenceExpiryDate: string | null
  manualHandlingExpiryDate: string | null
  medicationCompetencyExpiryDate: string | null
  hasExpiredQualifications: boolean
  notes: string | null
}

export type StaffDetailDto = StaffListDto

export interface CreateStaffDto {
  firstName: string
  lastName: string
  role: StaffRole
  email?: string
  mobile?: string
  region?: string
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  isActive?: boolean
  notes?: string
  firstAidExpiryDate?: string
  driverLicenceExpiryDate?: string
  manualHandlingExpiryDate?: string
  medicationCompetencyExpiryDate?: string
}

export type UpdateStaffDto = CreateStaffDto

export interface StaffAvailabilityDto {
  id: string
  staffId: string
  startDateTime: string
  endDateTime: string
  availabilityType: AvailabilityType
  isRecurring: boolean
  recurrenceNotes: string | null
  notes: string | null
}

export interface CreateStaffAvailabilityDto {
  staffId: string
  startDateTime: string
  endDateTime: string
  availabilityType: AvailabilityType
  isRecurring: boolean
  recurrenceNotes?: string
  notes?: string
}

export type UpdateStaffAvailabilityDto = CreateStaffAvailabilityDto

export interface StaffAssignmentDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  staffId: string
  staffName: string | null
  assignmentRole: string | null
  assignmentStart: string
  assignmentEnd: string
  status: AssignmentStatus
  isDriver: boolean
  sleepoverType: SleepoverType
  shiftNotes: string | null
  hasConflict: boolean
}

export interface CreateStaffAssignmentDto {
  tripInstanceId: string
  staffId: string
  assignmentRole?: string
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType?: SleepoverType
  shiftNotes?: string
}

export interface UpdateStaffAssignmentDto extends CreateStaffAssignmentDto {
  status: AssignmentStatus
}
```

- [ ] **Step 10: Create remaining type files (settings, auth, documents, tenants)**

**settings.ts:**
```typescript
export interface AppSettingsDto {
  qualificationWarningDays: number
}

export interface UpdateAppSettingsDto {
  qualificationWarningDays: number
}
```

**auth.ts:**
```typescript
export interface LoginDto {
  username: string
  password: string
  email: string
}

export interface AuthResponseDto {
  token: string
  expiresAt: string
  username: string
  fullName: string
  role: string
  tenantName: string | null
  tenantId: string | null
}
```

**documents.ts:**
```typescript
import type { DocumentType } from './enums'

export interface TripDocumentDto {
  id: string
  tripInstanceId: string
  participantBookingId: string | null
  documentType: DocumentType
  fileName: string
  filePath: string | null
  fileSize: number | null
  documentDate: string | null
  notes: string | null
  uploadedAt: string
}
```

**tenants.ts:**
```typescript
export interface TenantDto {
  id: string
  name: string
  emailDomain: string
  isActive: boolean
  createdAt: string
}

export interface CreateTenantDto {
  name: string
  emailDomain: string
}

export interface UpdateTenantDto {
  name: string
  emailDomain: string
  isActive: boolean
}
```

- [ ] **Step 11: Verify all type files compile**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add frontend/src/api/types/
git commit -m "feat(types): add core domain DTO interfaces"
```

---

## Task 3: Create complex domain type files

**Files:**
- Create: `frontend/src/api/types/activities.ts`
- Create: `frontend/src/api/types/tasks.ts`
- Create: `frontend/src/api/types/events.ts`
- Create: `frontend/src/api/types/dashboard.ts`
- Create: `frontend/src/api/types/itinerary.ts`
- Create: `frontend/src/api/types/schedule.ts`
- Create: `frontend/src/api/types/incidents.ts`
- Create: `frontend/src/api/types/claims.ts`
- Create: `frontend/src/api/types/provider.ts`
- Create: `frontend/src/api/types/catalogue.ts`
- Create: `frontend/src/api/types/public-holidays.ts`
- Create: `frontend/src/api/types/index.ts`

- [ ] **Step 1: Create activities.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 676-762 (TripDay + ScheduledActivity) and lines 816-841 (Activity)

```typescript
import type { ScheduledActivityStatus, ActivityCategory } from './enums'

export interface TripDayDto {
  id: string
  tripInstanceId: string
  dayNumber: number
  date: string
  dayTitle: string | null
  dayNotes: string | null
  scheduledActivities: ScheduledActivityDto[]
}

export interface UpdateTripDayDto {
  dayTitle?: string
  dayNotes?: string
}

export interface ScheduledActivityDto {
  id: string
  tripDayId: string
  activityId: string | null
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  accessibilityNotes: string | null
  notes: string | null
  sortOrder: number
  status: ScheduledActivityStatus
  bookingReference: string | null
  providerName: string | null
  providerPhone: string | null
  providerEmail: string | null
  providerWebsite: string | null
  estimatedCost: number | null
  category: ActivityCategory | null
}

export interface CreateScheduledActivityDto {
  activityId?: string
  title: string
  startTime?: string
  endTime?: string
  location?: string
  accessibilityNotes?: string
  notes?: string
  sortOrder: number
  status?: ScheduledActivityStatus
  bookingReference?: string
  providerName?: string
  providerPhone?: string
  providerEmail?: string
  providerWebsite?: string
  estimatedCost?: number
}

export interface UpdateScheduledActivityDto {
  activityId?: string
  title: string
  startTime?: string
  endTime?: string
  location?: string
  accessibilityNotes?: string
  notes?: string
  sortOrder: number
  status: ScheduledActivityStatus
  bookingReference?: string
  providerName?: string
  providerPhone?: string
  providerEmail?: string
  providerWebsite?: string
  estimatedCost?: number
}

export interface ActivityDto {
  id: string
  eventTemplateId: string | null
  activityName: string
  category: ActivityCategory
  location: string | null
  accessibilityNotes: string | null
  suitabilityNotes: string | null
  notes: string | null
  isActive: boolean
}

export interface CreateActivityDto {
  eventTemplateId?: string
  activityName: string
  category: ActivityCategory
  location?: string
  accessibilityNotes?: string
  suitabilityNotes?: string
  notes?: string
  isActive?: boolean
}

export type UpdateActivityDto = CreateActivityDto
```

- [ ] **Step 2: Create tasks.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 768-810

```typescript
import type { TaskType, TaskPriority, TaskItemStatus } from './enums'

export interface TaskDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  participantBookingId: string | null
  accommodationReservationId: string | null
  vehicleAssignmentId: string | null
  staffAssignmentId: string | null
  taskType: TaskType
  title: string
  ownerId: string | null
  ownerName: string | null
  priority: TaskPriority
  dueDate: string | null
  status: TaskItemStatus
  completedDate: string | null
  notes: string | null
}

export interface CreateTaskDto {
  tripInstanceId: string
  participantBookingId?: string
  accommodationReservationId?: string
  vehicleAssignmentId?: string
  staffAssignmentId?: string
  taskType: TaskType
  title: string
  ownerId?: string
  priority?: TaskPriority
  dueDate?: string
  notes?: string
}

export interface UpdateTaskDto extends CreateTaskDto {
  status: TaskItemStatus
  completedDate?: string
}
```

- [ ] **Step 3: Create events.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 847-880

```typescript
export interface EventTemplateDto {
  id: string
  eventCode: string
  eventName: string
  defaultDestination: string | null
  defaultRegion: string | null
  preferredTimeOfYear: string | null
  standardDurationDays: number | null
  accessibilityNotes: string | null
  fullyModifiedAccommodationNotes: string | null
  semiModifiedAccommodationNotes: string | null
  wheelchairAccessNotes: string | null
  typicalActivities: string | null
  isActive: boolean
}

export interface CreateEventTemplateDto {
  eventCode: string
  eventName: string
  defaultDestination?: string
  defaultRegion?: string
  preferredTimeOfYear?: string
  standardDurationDays?: number
  accessibilityNotes?: string
  fullyModifiedAccommodationNotes?: string
  semiModifiedAccommodationNotes?: string
  wheelchairAccessNotes?: string
  typicalActivities?: string
  isActive?: boolean
}

export type UpdateEventTemplateDto = CreateEventTemplateDto
```

- [ ] **Step 4: Create dashboard.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 904-918

```typescript
import type { TripListDto } from './trips'
import type { TaskDto } from './tasks'

export interface DashboardSummaryDto {
  upcomingTripCount: number
  activeParticipantCount: number
  outstandingTaskCount: number
  overdueTaskCount: number
  conflictCount: number
  tripsMissingAccommodation: number
  tripsMissingVehicles: number
  tripsMissingStaff: number
  openIncidentCount: number
  qscOverdueCount: number
  upcomingTrips: TripListDto[]
  overdueTasks: TaskDto[]
}
```

- [ ] **Step 5: Create itinerary.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 938-1048

```typescript
import type { TripStatus, SupportRatio, ReservationStatus, VehicleType, VehicleAssignmentStatus, AssignmentStatus, SleepoverType, ActivityCategory, ScheduledActivityStatus } from './enums'

export interface ItineraryDto {
  tripId: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  leadCoordinatorName: string | null
  notes: string | null
  participantCount: number
  staffCount: number
  totalEstimatedCost: number
  participants: ItineraryParticipantDto[]
  accommodation: ItineraryAccommodationDto[]
  vehicles: ItineraryVehicleDto[]
  staff: ItineraryStaffDto[]
  days: ItineraryDayDto[]
}

export interface ItineraryParticipantDto {
  id: string
  name: string
  wheelchairRequired: boolean
  highSupportRequired: boolean
  nightSupportRequired: boolean
  supportRatio: SupportRatio | null
  mobilityNotes: string | null
  medicalSummary: string | null
}

export interface ItineraryAccommodationDto {
  propertyName: string
  address: string | null
  suburb: string | null
  state: string | null
  phone: string | null
  checkInDate: string
  checkOutDate: string
  bedroomsReserved: number | null
  bedsReserved: number | null
  confirmationReference: string | null
  reservationStatus: ReservationStatus
  cost: number | null
  comments: string | null
}

export interface ItineraryVehicleDto {
  vehicleName: string
  registration: string | null
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  driverName: string | null
  status: VehicleAssignmentStatus
  pickupTravelNotes: string | null
}

export interface ItineraryStaffDto {
  name: string
  role: string | null
  email: string | null
  mobile: string | null
  assignmentStart: string
  assignmentEnd: string
  isDriver: boolean
  sleepoverType: SleepoverType
  status: AssignmentStatus
}

export interface ItineraryDayDto {
  dayNumber: number
  date: string
  dayTitle: string | null
  dayNotes: string | null
  activities: ItineraryActivityDto[]
  accommodationEvents: ItineraryDayAccommodationEventDto[]
  staffOnDuty: string[]
}

export interface ItineraryActivityDto {
  title: string
  startTime: string | null
  endTime: string | null
  location: string | null
  category: ActivityCategory | null
  status: ScheduledActivityStatus
  accessibilityNotes: string | null
  notes: string | null
  bookingReference: string | null
  providerName: string | null
  providerPhone: string | null
  estimatedCost: number | null
}

export interface ItineraryDayAccommodationEventDto {
  eventType: string
  propertyName: string
  address: string | null
  confirmationReference: string | null
}
```

- [ ] **Step 6: Create schedule.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 1065-1136

```typescript
import type { TripStatus, StaffRole, VehicleType, AssignmentStatus, VehicleAssignmentStatus } from './enums'
import type { StaffAvailabilityDto } from './staff'

export interface ScheduleOverviewDto {
  trips: ScheduleTripDto[]
  staff: ScheduleStaffDto[]
  vehicles: ScheduleVehicleDto[]
}

export interface ScheduleTripDto {
  id: string
  tripName: string
  tripCode: string | null
  destination: string | null
  region: string | null
  startDate: string
  endDate: string
  durationDays: number
  status: TripStatus
  maxParticipants: number | null
  currentParticipantCount: number
  minStaffRequired: number | null
  staffAssignedCount: number
  vehicleAssignedCount: number
  leadCoordinatorName: string | null
}

export interface ScheduleStaffDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  role: StaffRole
  region: string | null
  isDriverEligible: boolean
  isFirstAidQualified: boolean
  isMedicationCompetent: boolean
  isManualHandlingCompetent: boolean
  isOvernightEligible: boolean
  tripStatuses: ScheduleStaffTripStatusDto[]
  availability: StaffAvailabilityDto[]
}

export interface ScheduleStaffTripStatusDto {
  tripId: string
  status: string
  assignmentRole: string | null
  assignmentStatus: AssignmentStatus | null
  assignmentId: string | null
}

export interface ScheduleVehicleDto {
  id: string
  vehicleName: string
  registration: string | null
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  isInternal: boolean
  tripStatuses: ScheduleVehicleTripStatusDto[]
}

export interface ScheduleVehicleTripStatusDto {
  tripId: string
  status: string
  assignmentStatus: VehicleAssignmentStatus | null
}
```

- [ ] **Step 7: Create incidents.ts**

Source: `backend/Odip.Application/DTOs/DTOs.cs` lines 1142-1230

```typescript
import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus } from './enums'

export interface IncidentListDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  incidentType: IncidentType
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  incidentDateTime: string
  location: string | null
  reportedByName: string | null
  involvedParticipantName: string | null
  qscReportingStatus: QscReportingStatus
  isOverdue24h: boolean
  createdAt: string
}

export interface IncidentDetailDto extends IncidentListDto {
  participantBookingId: string | null
  involvedParticipantId: string | null
  involvedStaffId: string | null
  involvedStaffName: string | null
  reportedByStaffId: string
  description: string
  immediateActionsTaken: string | null
  wereEmergencyServicesCalled: boolean
  emergencyServicesDetails: string | null
  witnessNames: string | null
  witnessStatements: string | null
  qscReportedAt: string | null
  qscReferenceNumber: string | null
  reviewedByStaffId: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  correctiveActions: string | null
  resolvedAt: string | null
  familyNotified: boolean
  familyNotifiedAt: string | null
  supportCoordinatorNotified: boolean
  supportCoordinatorNotifiedAt: string | null
  updatedAt: string
}

export interface CreateIncidentDto {
  tripInstanceId: string
  participantBookingId?: string
  involvedParticipantId?: string
  involvedStaffId?: string
  reportedByStaffId: string
  incidentType: IncidentType
  severity: IncidentSeverity
  title: string
  description: string
  incidentDateTime: string
  location?: string
  immediateActionsTaken?: string
  wereEmergencyServicesCalled: boolean
  emergencyServicesDetails?: string
  witnessNames?: string
  witnessStatements?: string
}

export interface UpdateIncidentDto extends CreateIncidentDto {
  status: IncidentStatus
  qscReportingStatus: QscReportingStatus
  qscReportedAt?: string
  qscReferenceNumber?: string
  reviewedByStaffId?: string
  reviewNotes?: string
  correctiveActions?: string
  familyNotified: boolean
  familyNotifiedAt?: string
  supportCoordinatorNotified: boolean
  supportCoordinatorNotifiedAt?: string
}
```

- [ ] **Step 8: Create claims.ts**

Source: `backend/Odip.Application/DTOs/ClaimDTOs.cs` lines 10-119

```typescript
import type { TripClaimStatus, ClaimLineItemStatus, ClaimDayType, ClaimType, GSTCode, PlanType } from './enums'

export interface TripClaimListDto {
  id: string
  tripInstanceId: string
  tripName: string
  status: TripClaimStatus
  claimReference: string
  totalAmount: number
  createdAt: string
  submittedDate: string | null
}

export interface TripClaimDetailDto extends TripClaimListDto {
  totalApprovedAmount: number
  authorisedByStaffId: string | null
  authorisedByStaffName: string | null
  paidDate: string | null
  notes: string | null
  lineItems: ClaimLineItemDto[]
}

export interface ClaimLineItemDto {
  id: string
  tripClaimId: string
  participantBookingId: string
  participantName: string
  ndisNumber: string
  planType: PlanType
  supportItemCode: string
  dayType: ClaimDayType
  supportsDeliveredFrom: string
  supportsDeliveredTo: string
  hours: number
  unitPrice: number
  totalAmount: number
  gstCode: GSTCode
  claimType: ClaimType
  participantApproved: boolean
  status: ClaimLineItemStatus
  rejectionReason: string | null
  paidAmount: number | null
}

export interface UpdateClaimDto {
  authorisedByStaffId?: string
  notes?: string
  status?: TripClaimStatus
}

export interface UpdateClaimLineItemDto {
  hours?: number
  unitPrice?: number
  supportItemCode?: string
  claimType?: ClaimType
  participantApproved?: boolean
  status?: ClaimLineItemStatus
  rejectionReason?: string
  paidAmount?: number
}

export interface ClaimPreviewRequestDto {
  departureTime?: string
  returnTime?: string
  activeHoursPerDay?: number
}

export interface GenerateClaimRequestDto {
  departureTime?: string
  returnTime?: string
  activeHoursPerDay?: number
}

export interface ClaimPreviewResponseDto {
  departureTime: string
  returnTime: string
  activeHoursPerDay: number
  staffCount: number
  state: string
  confirmedParticipantCount: number
  lineItems: ClaimPreviewLineItemDto[]
  totalAmount: number
}

export interface ClaimPreviewLineItemDto {
  participantName: string
  ndisNumber: string
  supportItemCode: string
  dayTypeLabel: string
  dayType: ClaimDayType
  supportsDeliveredFrom: string
  supportsDeliveredTo: string
  hours: number
  unitPrice: number
  totalAmount: number
}
```

- [ ] **Step 9: Create provider.ts, catalogue.ts, public-holidays.ts**

**provider.ts:**
```typescript
export interface ProviderSettingsDto {
  id: string
  registrationNumber: string
  abn: string
  organisationName: string
  address: string
  state: string
  gstRegistered: boolean
  isPaceProvider: boolean
  bankAccountName: string | null
  bsb: string | null
  accountNumber: string | null
  invoiceFooterNotes: string | null
}

export interface UpsertProviderSettingsDto {
  registrationNumber: string
  abn: string
  organisationName: string
  address: string
  state?: string
  gstRegistered: boolean
  isPaceProvider: boolean
  bankAccountName?: string
  bsb?: string
  accountNumber?: string
  invoiceFooterNotes?: string
}
```

**catalogue.ts:**
```typescript
import type { ClaimDayType } from './enums'

export interface SupportActivityGroupDto {
  id: string
  groupCode: string
  displayName: string
  supportCategory: number
  isActive: boolean
  items: SupportCatalogueItemDto[]
}

export interface SupportCatalogueItemDto {
  id: string
  itemNumber: string
  description: string
  unit: string
  dayType: ClaimDayType
  isIntensive: boolean
  priceLimit_ACT: number
  priceLimit_NSW: number
  priceLimit_NT: number
  priceLimit_QLD: number
  priceLimit_SA: number
  priceLimit_TAS: number
  priceLimit_VIC: number
  priceLimit_WA: number
  priceLimit_Remote: number
  priceLimit_VeryRemote: number
  catalogueVersion: string
  effectiveFrom: string
  isActive: boolean
}

export interface CatalogueImportPreviewDto {
  detectedVersion: string
  itemsToAdd: number
  itemsToDeactivate: number
  rows: CatalogueImportRowDto[]
  warnings: string[]
}

export interface CatalogueImportRowDto {
  itemNumber: string
  description: string
  dayType: ClaimDayType
  isIntensive: boolean
  priceLimit_ACT: number
  priceLimit_NSW: number
  priceLimit_NT: number
  priceLimit_QLD: number
  priceLimit_SA: number
  priceLimit_TAS: number
  priceLimit_VIC: number
  priceLimit_WA: number
  priceLimit_Remote: number
  priceLimit_VeryRemote: number
  isNew: boolean
  priceChanged: boolean
}

export interface ConfirmCatalogueImportDto {
  catalogueVersion: string
  rows: CatalogueImportRowDto[]
}
```

**public-holidays.ts:**
```typescript
export interface PublicHolidayDto {
  id: string
  date: string
  name: string
  state: string | null
}

export interface CreatePublicHolidayDto {
  date: string
  name: string
  state?: string
}
```

- [ ] **Step 10: Create types/index.ts barrel**

```typescript
export * from './enums'
export * from './common'
export * from './participants'
export * from './contacts'
export * from './trips'
export * from './bookings'
export * from './accommodation'
export * from './reservations'
export * from './vehicles'
export * from './staff'
export * from './settings'
export * from './auth'
export * from './documents'
export * from './tenants'
export * from './activities'
export * from './tasks'
export * from './events'
export * from './dashboard'
export * from './itinerary'
export * from './schedule'
export * from './incidents'
export * from './claims'
export * from './provider'
export * from './catalogue'
export * from './public-holidays'
```

- [ ] **Step 11: Verify all types compile**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add frontend/src/api/types/
git commit -m "feat(types): add complex domain DTO interfaces and barrel export"
```

---

## Task 4: Add typed client helpers

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add typed helpers to client.ts**

Add these functions after the existing interceptor code (after line 34):

```typescript
import type { ApiResponse } from './types'

export async function apiGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params })
  return response.data.data as T
}

export async function apiGetWithDefault<T>(url: string, defaultValue: T, params?: Record<string, any>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params })
  return response.data.data ?? defaultValue
}

export async function apiPost<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, data)
  return response.data.data as T
}

export async function apiPostRaw<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const response = await apiClient.post<ApiResponse<T>>(url, data)
  return response.data
}

export async function apiPut<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.put<ApiResponse<T>>(url, data)
  return response.data.data as T
}

export async function apiPutRaw<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const response = await apiClient.put<ApiResponse<T>>(url, data)
  return response.data
}

export async function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.patch<ApiResponse<T>>(url, data)
  return response.data.data as T
}

export async function apiPatchRaw<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const response = await apiClient.patch<ApiResponse<T>>(url, data)
  return response.data
}

export async function apiDelete(url: string): Promise<void> {
  await apiClient.delete(url)
}

export async function apiDeleteRaw<T>(url: string): Promise<ApiResponse<T>> {
  const response = await apiClient.delete<ApiResponse<T>>(url)
  return response.data
}
```

Note: `apiPostRaw`, `apiPutRaw`, `apiPatchRaw`, and `apiDeleteRaw` are needed because some mutations in the existing hooks return the full `ApiResponse` envelope (not just `.data.data`). For example, `useUpdateClaim` returns `r.data` (the whole envelope), `useLogin` returns `r.data` (the envelope), and `useDeleteClaim` returns `r.data` (the envelope).

- [ ] **Step 2: Verify compile**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(api): add typed Axios helper functions"
```

---

## Task 5: Create all hook files

**Files:**
- Create: All files in `frontend/src/api/hooks/`

This task creates every hook file. Each file mirrors the existing hooks from `hooks.ts` but with proper types. The exact query keys, invalidation patterns, and API paths are preserved from the current `hooks.ts`.

- [ ] **Step 1: Create hooks/trips.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, apiPatch, apiPostRaw, apiPutRaw, apiPatchRaw } from '../client'
import type { TripListDto, TripDetailDto, CreateTripDto, UpdateTripDto, PatchTripDto } from '../types'
import type { ApiResponse } from '../types'

export function useTrips(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['trips', params],
    queryFn: () => apiGet<TripListDto[]>('/trips', params),
  })
}

export function useTrip(id: string | undefined) {
  return useQuery({
    queryKey: ['trip', id],
    queryFn: () => apiGet<TripDetailDto>(`/trips/${id}`),
    enabled: !!id,
  })
}

export function useCreateTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTripDto) => apiPostRaw<TripDetailDto>('/trips', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  })
}

export function useUpdateTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTripDto }) => apiPutRaw<TripDetailDto>(`/trips/${id}`, data),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['trips'] }); qc.invalidateQueries({ queryKey: ['trip', vars.id] }) },
  })
}

export function usePatchTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PatchTripDto }) => apiPatchRaw<TripDetailDto>(`/trips/${id}`, data),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['trips'] }); qc.invalidateQueries({ queryKey: ['trip', vars.id] }) },
  })
}

export function useGenerateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tripId: string) => apiPostRaw<unknown>(`/trips/${tripId}/schedule/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-schedule'] }),
  })
}
```

- [ ] **Step 2: Create hooks for every remaining domain**

Create each of the following hook files following the same pattern — preserving exact query keys and invalidation from existing hooks.ts. The subagent must read `frontend/src/api/hooks.ts` to get the exact invalidation patterns for each mutation.

Files to create (each follows the same pattern as trips.ts):
- `hooks/participants.ts` — useParticipants, useParticipant, useParticipantBookings, useSupportProfile, useCreateParticipant, useUpdateParticipant, useDeleteParticipant
- `hooks/bookings.ts` — useBookings, useTripBookings, useCreateBooking, useUpdateBooking, usePatchBooking, useDeleteBooking, useCancelBooking
- `hooks/accommodation.ts` — useAccommodation, useAccommodationDetail, useCreateAccommodation, useUpdateAccommodation, useDeleteAccommodation, useCreateReservation, useUpdateReservation, useDeleteReservation, useCancelReservation
- `hooks/vehicles.ts` — useVehicles, useVehicleDetail, useTripVehicles, useCreateVehicle, useUpdateVehicle, useDeleteVehicle, useCreateVehicleAssignment
- `hooks/staff.ts` — useStaff, useStaffDetail, useAvailableStaff, useStaffAvailability, useTripStaff, useCreateStaff, useUpdateStaff, useDeleteStaff, useCreateStaffAssignment, useUpdateStaffAssignment, useDeleteStaffAssignment, useCreateStaffAvailability, useUpdateStaffAvailability, useDeleteStaffAvailability
- `hooks/tasks.ts` — useTasks, useTripTasks, useCreateTask, useUpdateTask, useDeleteTask
- `hooks/activities.ts` — useActivities, useEventTemplates, useTripSchedule, useCreateScheduledActivity, useUpdateScheduledActivity, useDeleteScheduledActivity
- `hooks/incidents.ts` — useIncidents, useIncident, useTripIncidents, useOverdueQscIncidents, useCreateIncident, useUpdateIncident, useDeleteIncident
- `hooks/schedule.ts` — useScheduleOverview
- `hooks/dashboard.ts` — useDashboard
- `hooks/auth.ts` — useLogin
- `hooks/settings.ts` — useSettings, useUpdateSettings, useAdminTenants
- `hooks/claims.ts` — useTripClaims, useClaim, useGenerateClaim, usePreviewClaim, useUpdateClaim, useUpdateClaimLineItem, useDeleteClaim
- `hooks/catalogue.ts` — useProviderSettings, useUpsertProviderSettings, useSupportCatalogue
- `hooks/public-holidays.ts` — usePublicHolidays, useCreatePublicHoliday, useDeletePublicHoliday
- `hooks/documents.ts` — useTripDocuments, useTripItinerary

**Critical rules for each hook file:**
1. Import types from `../types` (the barrel)
2. Import helpers from `../client` (`apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, and `*Raw` variants)
3. Use `apiGet<TypeDto[]>` for list endpoints, `apiGet<TypeDto>` for detail endpoints
4. Use `apiPostRaw`, `apiPutRaw`, `apiPatchRaw` for mutations that currently return `r.data` (the envelope)
5. Use `apiPost`, `apiPut` for mutations that currently return `r.data.data` (unwrapped)
6. Use `apiDelete` for delete mutations (returns void)
7. Preserve EXACT query keys from existing hooks.ts
8. Preserve EXACT invalidation patterns from existing hooks.ts

- [ ] **Step 3: Create hooks/constants.ts**

```typescript
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NotInvoiced: 'Not Invoiced',
  InvoiceSent: 'Invoice Sent',
  Partial:     'Partial',
  Paid:        'Paid',
  Overdue:     'Overdue',
}

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  NotInvoiced: 'bg-neutral-100 text-neutral-600',
  InvoiceSent: 'bg-blue-100 text-blue-700',
  Partial:     'bg-amber-100 text-amber-700',
  Paid:        'bg-green-100 text-green-700',
  Overdue:     'bg-red-100 text-red-700',
}

export const PAYMENT_STATUS_ITEMS = [
  { value: 'NotInvoiced', label: 'Not Invoiced' },
  { value: 'InvoiceSent', label: 'Invoice Sent' },
  { value: 'Partial',     label: 'Partial' },
  { value: 'Paid',        label: 'Paid' },
  { value: 'Overdue',     label: 'Overdue' },
]
```

- [ ] **Step 4: Create hooks/index.ts barrel**

```typescript
// Re-export all types so consumers can import types alongside hooks
export * from '../types'

// Re-export all hooks
export * from './trips'
export * from './participants'
export * from './bookings'
export * from './accommodation'
export * from './vehicles'
export * from './staff'
export * from './tasks'
export * from './activities'
export * from './incidents'
export * from './schedule'
export * from './dashboard'
export * from './auth'
export * from './settings'
export * from './claims'
export * from './catalogue'
export * from './public-holidays'
export * from './documents'
export * from './constants'
```

- [ ] **Step 5: Verify all hooks compile**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (hooks import from types barrel, types are self-consistent)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/hooks/
git commit -m "feat(hooks): add domain-grouped typed hook files with barrel exports"
```

---

## Task 6: Switch over and verify

**Files:**
- Delete: `frontend/src/api/hooks.ts` (after renaming as safety net)

- [ ] **Step 1: Rename old hooks.ts**

```bash
cd frontend && mv src/api/hooks.ts src/api/hooks.legacy.ts
```

- [ ] **Step 2: Verify the build succeeds**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -50`

The barrel `hooks/index.ts` serves the same import path `../api/hooks`. All page components that import from `'../api/hooks'` or `'../../api/hooks'` should resolve to `hooks/index.ts` automatically (TypeScript resolves directory index files).

If there are import resolution errors, check that `tsconfig.json` has `"moduleResolution": "bundler"` or `"node"` — Vite projects typically do.

Expected: Either zero errors, or errors only in `hooks.legacy.ts` (which is no longer imported).

- [ ] **Step 3: Run the frontend dev server to confirm**

Run: `cd frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds with zero errors.

- [ ] **Step 4: Delete legacy file**

```bash
rm frontend/src/api/hooks.legacy.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/api/
git commit -m "feat(api): switch to typed hook modules, remove legacy hooks.ts"
```

---

## Task 7: Clean up page components

**Files:**
- Modify: All page components in `frontend/src/pages/` that use `: any` casts

- [ ] **Step 1: Find all any casts**

Run: `grep -rn ": any" frontend/src/pages/ frontend/src/components/ | grep -v node_modules`

This identifies every `(t: any)`, `(b: any)`, `(item: any)` cast across pages and components.

- [ ] **Step 2: Remove any casts from each file**

For each file found in step 1:
- Remove `: any` from `.map()` callbacks — the type is now inferred from the typed hook
- Remove `: any` from destructured variables
- Add explicit type imports only where the component uses a DTO type directly (e.g., as a prop type or state type)

Example transformation:
```typescript
// Before
trips.map((t: any) => <div key={t.id}>{t.tripName}</div>)

// After (no change needed — t is now inferred as TripListDto)
trips.map((t) => <div key={t.id}>{t.tripName}</div>)
```

- [ ] **Step 3: Verify clean build**

Run: `cd frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ frontend/src/components/
git commit -m "refactor: remove any casts from page components"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full type check**

Run: `cd frontend && npx tsc --noEmit --pretty`
Expected: Zero errors.

- [ ] **Step 2: Full build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Lint check**

Run: `cd frontend && npm run lint 2>&1 | tail -20`
Expected: No new lint errors introduced.

- [ ] **Step 4: Spot-check a page**

Read `frontend/src/pages/TripsPage.tsx` and verify:
- No `: any` casts remain
- Hook return types show proper DTO types in IDE
- Build still succeeds

- [ ] **Step 5: Final commit if any remaining changes**

```bash
git add -A frontend/
git commit -m "chore: final cleanup for typed API layer"
```
