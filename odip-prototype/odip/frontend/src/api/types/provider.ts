export interface ProviderSettingsDto {
  id: string
  registrationNumber: string
  abn: string
  organisationName: string
  address: string
  state: string
  gstRegistered: boolean
  isPaceProvider: boolean
  bankAccountName: string | null
  bsb: string | null
  accountNumber: string | null
  invoiceFooterNotes: string | null
  /** MED-02: primary manager contact — shown first by the (future) MED-01 missed-medication guidance. */
  managerName: string | null
  managerPhone: string | null
}

export interface UpsertProviderSettingsDto {
  registrationNumber: string
  abn: string
  organisationName: string
  address: string
  state?: string
  gstRegistered: boolean
  isPaceProvider: boolean
  bankAccountName?: string
  bsb?: string
  accountNumber?: string
  invoiceFooterNotes?: string
  managerName?: string
  managerPhone?: string
}
