export interface AppSettingsDto {
  qualificationWarningDays: number
  /** Whole hours a week before the roster warns (OVER_HOURS); 38 until an Admin changes it. */
  weeklyHoursWarning?: number
}

export interface UpdateAppSettingsDto {
  qualificationWarningDays: number
  weeklyHoursWarning?: number
}

export interface ModuleVisibilityDto {
  hiddenAccommodation: boolean
  hiddenVehicles: boolean
}
