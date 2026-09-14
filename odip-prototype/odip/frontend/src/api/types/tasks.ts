import type { TaskType, TaskPriority, TaskItemStatus } from './enums'

/** Item 9 (tasks as the obligation engine): the label map for every TaskType, including the four
 * new obligation-engine types that have no trip to hang off (LeaveCoverage, IncidentQscReport,
 * MedicationWitness, FlaggedNoteFollowUp). Existing types keep rendering their raw enum text
 * elsewhere (TasksPage falls back to the raw value for any key not listed here), so only the new
 * types are given a friendly label — this isn't a full relabel of the column. */
export const TASK_TYPE_LABELS: Partial<Record<TaskType, string>> = {
  LeaveCoverage: 'Leave coverage',
  IncidentQscReport: 'QSC incident report',
  MedicationWitness: 'Medication witness',
  FlaggedNoteFollowUp: 'Flagged note follow-up',
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
