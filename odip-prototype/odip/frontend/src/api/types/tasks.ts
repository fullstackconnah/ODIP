import type { TaskType, TaskPriority, TaskItemStatus } from './enums'

/** Every TaskType in words, for the task list and anywhere else a type is shown (item 9 added the obligation-engine ones; platform
 * review V2-B the rest, which printed the raw enum). */
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  AccommodationRequest: 'Accommodation request',
  AccommodationConfirmation: 'Accommodation confirmation',
  VehicleRequest: 'Vehicle request',
  VehicleConfirmation: 'Vehicle confirmation',
  ParticipantConfirmation: 'Participant confirmation',
  FamilyContact: 'Family contact',
  InvoiceOop: 'Invoice / OOP',
  StaffingAllocation: 'Staffing allocation',
  RiskReview: 'Risk review',
  MedicationCheck: 'Medication check',
  PreDeparture: 'Pre-departure',
  PostTrip: 'Post-trip',
  InsuranceConfirmation: 'Insurance confirmation',
  GenerateNdisClaims: 'Generate NDIS claims',
  LeaveCoverage: 'Leave coverage',
  IncidentQscReport: 'NDIS Commission report',
  IncidentCommissionDetailedReport: 'NDIS Commission 5-day report',
  MedicationWitness: 'Medication witness',
  FlaggedNoteFollowUp: 'Flagged note follow-up',
  BudgetEmergencyReview: 'Budget emergency review',
  RestrictivePracticeRegisterAddition: 'Restrictive practice register',
  Other: 'Other',
}

export interface TaskDto {
  id: string
  /** Optional as of item 9 — an obligation-engine task (LeaveCoverage, IncidentQscReport, etc.)
   * isn't necessarily raised against a trip. Omitted from JSON (not null) when absent. */
  tripInstanceId?: string
  tripName?: string | null
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
  /** Deep link into the surface this task is actually about (a leave request, an incident, a
   * shift note, …) — when present, TasksPage renders an "Open" link to it. Omitted from JSON
   * when there's nothing to link to. */
  linkTo?: string
  /** Opaque de-dup/grouping key from whatever generated this task (e.g. one per leave request or
   * per flagged note) — not rendered, just carried through. */
  sourceKey?: string
  shiftId?: string
  incidentReportId?: string
  medicationAdministrationId?: string
  shiftNoteId?: string
  leaveRequestId?: string
}

export interface CreateTaskDto {
  /** Optional: a task needs no trip. */
  tripInstanceId?: string | null
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
