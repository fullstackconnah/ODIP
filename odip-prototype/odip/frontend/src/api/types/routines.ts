import type { RoutineCategory } from './enums'

export interface ParticipantRoutineDto {
  id: string
  participantId: string
  title: string
  description: string
  category: RoutineCategory
  /** Null means the routine applies every day. */
  dayOfWeek: string | null
  /** "HH:mm:ss". Null (with endTime also null) means untimed — applies across the whole day. */
  startTime: string | null
  endTime: string | null
  isCritical: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateParticipantRoutineDto {
  title: string
  description: string
  category: RoutineCategory
  dayOfWeek?: string | null
  startTime?: string | null
  endTime?: string | null
  isCritical: boolean
  isActive: boolean
}

export interface UpdateParticipantRoutineDto {
  title: string
  description: string
  category: RoutineCategory
  dayOfWeek?: string | null
  startTime?: string | null
  endTime?: string | null
  isCritical: boolean
  isActive: boolean
}

export const ROUTINE_CATEGORY_LABELS: Record<RoutineCategory, string> = {
  PersonalCare: 'Personal Care',
  Meals: 'Meals',
  Medication: 'Medication',
  Mobility: 'Mobility',
  Communication: 'Communication',
  Behaviour: 'Behaviour',
  Sleep: 'Sleep',
  Activity: 'Activity',
  Other: 'Other',
}
