import type { DraftBlock, PlanQuote, PlannedLineFlags } from './plan-pricing'

export type AgreementState = 'ACT' | 'NSW' | 'NT' | 'QLD' | 'SA' | 'TAS' | 'VIC' | 'WA'

/**
 * A non-binding, server-priced service-agreement draft revision. It is never a signed agreement, and a revision is never edited: every save is a new
 * version. A revision made with the plan builder has `blocks` and its lines and `pricing` come from them; one typed by hand before the builder
 * existed has no blocks and no `pricing` (it is shown read-only, with a note to rebuild it from blocks).
 */
export interface ServiceAgreementDraftDto {
  id: string
  participantId: string
  version: number
  status: string
  templateVersion: string
  templateDocxSha256: string
  templatePdfSha256: string
  state: AgreementState
  planStartDate: string
  planEndDate: string
  agreementStartDate: string
  agreementEndDate: string
  representative?: string
  /** The blocks the revision was priced from, in plan order. Empty on a hand-typed draft. */
  blocks: DraftBlock[]
  /** What the engine answered when the revision was saved: totals, issues, notices, holiday occurrences and open questions, with no per-occurrence lines. */
  pricing?: PlanQuote
  lines: ServiceAgreementDraftLineDto[]
  /**
   * True on an older revision in the list: its blocks, lines and answer are left out (a long onboarding is many revisions) and `GET .../{id}` has them. The newest revision, the one a
   * plan is started from, is always in full.
   */
  isSummary: boolean
  blockCount: number
  lineCount: number
  /** What the revision's lines add up to over the agreement. */
  total: number
  /** What a reader must not miss, a sentence each, counted in shifts: shifts with a part not priced, public holiday shifts to decide, and provisional rates. Empty for a revision priced in full or typed by hand. */
  caveats: string[]
}

export interface ServiceAgreementDraftLineDto {
  serviceType: string
  /** The quantity in `unit`: hours for a line priced by the hour. */
  hours: number
  itemCode: string
  unitPrice: number
  catalogueVersion: string
  catalogueEffectiveFrom: string
  catalogueEffectiveTo: string | null
  /** The block the line was generated from; absent on a hand-typed line. */
  blockId?: string
  /** The time band or kind of companion, in the engine's words; absent on a hand-typed line. */
  band?: string
  /** H hour, E each, D night. */
  unit: string
  /** What the line claims for the agreement period (authoritative, never hours x unit price). */
  total: number
  occurrences: number
  flags: PlannedLineFlags
}

/**
 * A save from blocks (the plan builder): the server prices them and generates the lines, so the client sends no price and no code. The older
 * hand-typed `lines` are still accepted by the server for callers that predate the builder, never together with blocks, and the screen does not send them.
 */
export interface CreateServiceAgreementDraftDto {
  planStartDate: string
  planEndDate: string
  agreementStartDate: string
  agreementEndDate: string
  state: AgreementState
  serviceTypes: string[]
  representative?: string
  blocks: DraftBlock[]
  /**
   * The version of the newest revision the plan was started from (0 when there was none). If somebody saved a newer one in the meantime the server refuses with 409 and the newer
   * version number, instead of making this plan the newest over their work.
   */
  baseVersion?: number
}

/** The body of the 409 a save answers when somebody else saved a newer version first (`code` is "draft-version-conflict"). */
export interface DraftVersionConflictDto {
  currentVersion: number
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

/** A server-validated, non-persistent manual-test walkthrough. */
export interface DemoJourneySimulationDto {
  banner: 'SIMULATED — NOT A LEGAL AGREEMENT / NO CLAIM'
  signing: string
  activation: string
  booking: string
  rateLabel: string
}
