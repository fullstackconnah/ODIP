export interface AppSettingsDto {
  qualificationWarningDays: number
}

export interface UpdateAppSettingsDto {
  qualificationWarningDays: number
}

export interface ModuleVisibilityDto {
  hiddenAccommodation: boolean
  hiddenVehicles: boolean
  /** Whether payslips apply (presentation only: the server refuses on its own). Optional so existing fixtures still type-check. */
  employmentHeroConnected?: boolean
}
