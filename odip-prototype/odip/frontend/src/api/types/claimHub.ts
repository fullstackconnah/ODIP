// The NDIA claims hub (`claim-hub/*`, `claim-batches/*`). Null members are omitted on the wire, so they are optional here.
// Money is a 2-dp number, dates are `yyyy-MM-dd`, enums travel as their names.

export type AgeBand = 'none' | 'amber' | 'red' | 'over90'

export interface HubProblemDto {
  rule: string
  severity: 'block' | 'warn'
  message: string
}

export interface HubLineDto {
  lineId: string
  claimId: string
  claimReference: string
  claimKind: 'trip' | 'shift'
  participantId: string
  participantName: string
  supportNumber: string
  supportName?: string
  from: string
  to: string
  hours: number
  quantity?: number
  unitPrice: number
  totalAmount: number
  gstCode: string
  claimType: string
  cancellationReason?: string
  fundingType: 'agency'
  ageDays: number
  ageBand: AgeBand
  nextAttempt: number
  problems: HubProblemDto[]
}

export interface RejectedLineDto extends HubLineDto {
  batchLineId: string
  batchId: string
  fileName: string
  rejectCode: string
  rejectMessage?: string
  needsDecision: boolean
  hint: string
  rejectedAt: string
}

export interface ManagedInvoiceDto {
  invoiceId: string
  number?: string
  status: string
  total: number
  issuedAt?: string
}

export interface ManagedClaimDto {
  claimId: string
  claimReference: string
  participantId: string
  participantName: string
  fundingType: 'plan' | 'self'
  claimStatus: string
  totalAmount: number
  ageDays: number
  ageBand: AgeBand
  invoices: ManagedInvoiceDto[]
}

export interface HubLinesDto {
  ready: HubLineDto[]
  rejected: RejectedLineDto[]
  managed: ManagedClaimDto[]
  registrationProblem?: string
}

export type BatchStatus = 'Built' | 'Uploaded' | 'ResultsImported' | 'Discarded'

export interface BatchDto {
  id: string
  fileName: string
  status: BatchStatus
  createdAt: string
  createdByName: string
  uploadedAt?: string
  uploadedByName?: string
  resultsImportedAt?: string
  discardedAt?: string
  lineCount: number
  totalAmount: number
  pending: number
  successful: number
  rejected: number
  withdrawn: number
  paid: number
  paidAmount: number
}

export type BatchLineOutcome = 'Pending' | 'Successful' | 'Rejected' | 'Withdrawn'

export interface BatchLineDto {
  batchLineId: string
  claimLineItemId?: string
  claimId?: string
  claimReference?: string
  participantName?: string
  supportNumber: string
  from: string
  to: string
  amount: number
  attempt: number
  rowReference: string
  outcome: BatchLineOutcome
  rejectCode?: string
  rejectMessage?: string
  hint?: string
  needsDecision?: boolean
  resultAmount?: number
  lineStatus?: string
  paidAmount?: number
  dismissedAt?: string
}

export interface BatchDetailDto extends BatchDto {
  lines: BatchLineDto[]
}

export interface BuildBatchRequestDto {
  lineIds?: string[]
  claimIds?: string[]
  confirmedLineIds?: string[]
}

export interface BuildProblemDto {
  lineId: string
  claimReference: string
  rule: string
  message: string
}

export interface ResultsImportDto {
  successful: number
  rejected: number
  unchanged: number
  leftAlone: number
  conflicts: { rowReference: string; current: string; incoming: string }[]
  unknownReferences: string[]
  unreadRows: { row: number; value: string; note: string }[]
  batch: BatchDto
}

export interface MarkPaidRequestDto {
  lines?: { batchLineId: string; amount?: number }[]
}
