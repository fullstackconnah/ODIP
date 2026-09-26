export type AgreementState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA'

/** A non-binding, server-priced service-agreement draft. It is never a signed agreement. */
export interface ServiceAgreementDraftDto {
  id: string
  participantId: string
  version: number
  status: string
  templateVersion: string
  templateDocxSha256: string
  templatePdfSha256: string
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

/** An immutable, development-only document capture. It remains PendingVerification. */
export interface ElectronicSigningSnapshotDto {
  id: string
  draftId: string
  draftVersion: number
  documentJson: string
  documentHash: string
  status: 'PendingVerification'
}

export interface SubmitElectronicSigningEvidenceDto {
  idempotencyKey: string
  signerName: string
  signerCapacity: string
  isAuthorisedRepresentative: boolean
  consentToElectronicMethod: boolean
  intendsToSign: boolean
  documentWasDisplayed: boolean
}

export interface ElectronicSigningEvidenceDto {
  id: string
  status: 'PendingVerification'
  evidenceHash: string
  createdAt: string
}
