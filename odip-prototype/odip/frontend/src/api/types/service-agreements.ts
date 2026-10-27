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
}
