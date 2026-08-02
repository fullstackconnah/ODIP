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

export interface SyncHolidaysDto {
  fromYear?: number
  toYear?: number
}

export interface SyncResultDto {
  yearsProcessed: number
  holidaysAdded: number
  holidaysUpdated: number
  errors: string[]
}
