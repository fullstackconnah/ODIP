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
}
