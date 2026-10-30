import type { ApprovalActivationDto } from './service-agreement-drafts'

export interface PriceList { version: string; start: string }

export interface AgreementRevisionRef {
  draftId: string
  version: number
  agreementStartDate: string
  agreementEndDate: string
  total: number
}

export type AgreementStatus = 'Active' | 'Ending' | 'Ended' | 'DraftWaiting' | 'NotApproved'
export type AgreementEndingState = 'None' | 'Ending' | 'Ended'

export interface AgreementRow {
  participantId: string
  participantName: string
  status: AgreementStatus
  /** The current agreement's own state, apart from the one status word: the filters read this, not `status`. */
  endingState: AgreementEndingState
  hasWaitingDraft: boolean
  current: AgreementRevisionRef | null
  waiting: AgreementRevisionRef | null
  daysLeft: number | null
  termStart: string | null
  priceList: PriceList | null
  newerPriceList: PriceList | null
}

export interface AgreementList { canApprove: boolean; rows: AgreementRow[] }

export interface AgreementDraftRef { participantId: string; draftId: string }

export type AgreementApproveOutcome = 'Approved' | 'AlreadyApproved' | 'NeedsReview' | 'Superseded' | 'Ended' | 'Busy' | 'NotAnApprover' | 'NotFound' | 'Failed'

export interface AgreementApproveResult {
  participantId: string
  draftId: string
  participantName: string
  outcome: AgreementApproveOutcome
  reasons: string[]
  /** Approved only: whether it also moved the participant to Active (the organisation's setting). */
  activation?: ApprovalActivationDto | null
}

export type AgreementBulkAction = 'renew' | 'extend' | 'reprice'

export interface AgreementBulkRequest {
  action: AgreementBulkAction
  participantIds: string[]
  /** Extend: the new end date. */
  endDate?: string
  /** Reprice: the catalogue version to price from. */
  priceList?: string
}

/** One agreement's term and what it adds up to. */
export interface AgreementTerm { start: string; end: string; total: number }

export type AgreementBulkOutcome = 'Created' | 'Skipped' | 'Failed' | 'Busy'

export interface AgreementBulkResult {
  participantId: string
  name: string
  outcome: AgreementBulkOutcome
  reason: string | null
  sourceDraftId: string | null
  newDraftId: string | null
  before: AgreementTerm | null
  after: AgreementTerm | null
  /** A draft was made but has findings to look at before it can be approved. */
  hasIssues: boolean
}
