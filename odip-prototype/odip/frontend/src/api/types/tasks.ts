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
