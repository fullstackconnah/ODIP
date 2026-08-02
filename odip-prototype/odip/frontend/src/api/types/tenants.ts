export interface TenantDto {
  id: string
  name: string
  emailDomain: string
  isActive: boolean
  createdAt: string
}

export interface TenantUserDto {
  id: string
  fullName: string
  role: string
  isActive: boolean
}

export interface CreateTenantDto {
  name: string
  emailDomain: string
}

export interface UpdateTenantDto {
  name: string
  emailDomain: string
  isActive: boolean
}

export interface TenantSummaryDto {
  id: string
  name: string
  emailDomain: string
  isActive: boolean
  createdAt: string
  userCount: number
}

export interface CreateInitialUserDto {
  firstName: string
  lastName: string
  email: string
  username: string
  role: string
  password?: string
}

export interface CreateTenantWithSetupDto {
  name: string
  emailDomain: string
  providerSettings?: {
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
  } | null
  initialUser?: CreateInitialUserDto | null
}
