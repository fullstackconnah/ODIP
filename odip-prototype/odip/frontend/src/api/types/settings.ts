export interface AppSettingsDto {
  qualificationWarningDays: number
  /** Whole hours a week before the roster warns (OVER_HOURS); 38 until an Admin changes it. */
  weeklyHoursWarning?: number
  /** Minutes a finished shift may drift from the roster before it goes to review; 15 until an Admin changes it. */
  varianceReviewMinutes?: number
  /** Days before a participant's plan ends that the alert starts; 30 until an Admin changes it. */
  planExpiryWarningDays?: number
  /** Minutes a sign-in lasts before the person must sign in again (Settings > Security); null or absent = no limit, as before. */
  sessionLengthMinutes?: number | null
}

export interface UpdateSecuritySettingsDto {
  /** 15 to 480, or null for no limit. */
  sessionLengthMinutes: number | null
}

/** My account: the signed-in person's own details (GET/PUT /profile). */
export interface MyProfileDto {
  firstName: string
  lastName: string
  email: string
  mobile: string | null
  /** Employment Hero keeps the name and mobile up to date, so they can't be edited here. */
  managedByEmploymentHero: boolean
}

export interface UpdateMyProfileDto {
  firstName: string
  lastName: string
  mobile: string | null
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
