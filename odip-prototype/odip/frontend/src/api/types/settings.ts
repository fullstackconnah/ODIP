export interface AppSettingsDto {
  qualificationWarningDays: number
  /** Whole hours a week before the roster warns (OVER_HOURS); 38 until an Admin changes it. */
  weeklyHoursWarning?: number
  /** Minutes a finished shift may drift from the roster before it goes to review; 15 until an Admin changes it. */
  varianceReviewMinutes?: number
  /** Days before a participant's plan ends that the alert starts; 30 until an Admin changes it. */
  planExpiryWarningDays?: number
}

/** Every field is optional: a field left out keeps its stored value, so each section saves only its own. */
export interface UpdateAppSettingsDto {
  qualificationWarningDays?: number
  weeklyHoursWarning?: number
  varianceReviewMinutes?: number
  planExpiryWarningDays?: number
}

export interface ModuleVisibilityDto {
  hiddenAccommodation: boolean
  hiddenVehicles: boolean
  /** Whether payslips apply (presentation only: the server refuses on its own). Optional so existing fixtures still type-check. */
  employmentHeroConnected?: boolean
}
