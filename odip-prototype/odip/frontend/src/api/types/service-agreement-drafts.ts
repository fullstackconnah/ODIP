export type AgreementState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA'

/** A non-binding, server-priced service-agreement draft. It is never a signed agreement. */
export interface ServiceAgreementDraftDto {
  id: string
  participantId: string
  version: number
  status: string
  state: AgreementState
  agreementStartDate: string
  agreementEndDate: string
  lines: ServiceAgreementDraftLineDto[]
}

export interface ServiceAgreementDraftLineDto {
  serviceType: string
  hours: number
  itemCode: string
  unitPrice: number
  catalogueVersion: string
  catalogueEffectiveFrom: string
  catalogueEffectiveTo: string | null
}

export interface CreateServiceAgreementDraftDto {
  planStartDate: string
  planEndDate: string
  agreementStartDate: string
  agreementEndDate: string
  state: AgreementState
  serviceTypes: string[]
  representative?: string
  lines: CreateServiceAgreementDraftLineDto[]
}

export interface CreateServiceAgreementDraftLineDto {
  serviceType: string
  itemCode: string
  hours: number
}
