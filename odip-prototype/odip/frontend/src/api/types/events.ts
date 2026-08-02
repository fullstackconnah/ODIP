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
