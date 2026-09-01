import type { RoutineCategory } from './enums'

export interface ParticipantRoutineDto {
  id: string
  participantId: string
  title: string
  description: string
  category: RoutineCategory
  /** Non-empty set of days the routine applies on (PD-4) — e.g. `['Monday', 'Wednesday']`. Every day is the full 7-element list, not an empty one or a null sentinel. */
  days: string[]
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
  days: string[]
  startTime?: string | null
  endTime?: string | null
  isCritical: boolean
  isActive: boolean
}

export interface UpdateParticipantRoutineDto {
  title: string
  description: string
  category: RoutineCategory
  days: string[]
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
