import type { DraftBlock, PlanQuote, PlannedLineFlags } from './plan-pricing'
import type { BudgetWarningDto } from './rostering'
import type { ShiftStatus, SleepoverType, SupportRatio } from './enums'

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
  /**
   * Who approved this revision for rostering, when, and what that did. Absent until somebody has. Approving
   * makes the weekly roster patterns and the unfilled shifts, and is separate from signing.
   */
  approval?: DraftApprovalDto
  /** Only in the answer to an approval: the previous revision's shifts on or after this one starts, which stay on the roster. */
  oldShiftsRemaining?: OldShiftsRemainingDto
}

/** The record of an approval. There is no un-approving: a change is a new revision, approved in its turn. */
export interface DraftApprovalDto {
  /** An instant (UTC, with a Z). */
  approvedAt: string
  approvedByName: string
  patternsCreated: number
  patternsEnded: number
  /** The unfilled shifts generated at once; none for a participant who was not active yet. */
  shiftsCreated: number
  /** The last day shifts were generated to; absent when none were. */
  horizonEnd?: string
  /** The first day it made a shift for; absent when it made none. */
  firstShiftDate?: string
}

/** The shifts of the previous approved revisions from the day the new one starts (or today): approval removes the unfilled Draft ones, carries those of a support that did not change, and lists the rest. */
export interface OldShiftsRemainingDto {
  /** Kept with nobody on them (published, or with a note or a record). */
  open: number
  /** Kept with a worker on them. */
  assigned: number
  /** Unfilled Draft shifts approval removes (a preview) or removed (an approval's answer). Absent from an older server. */
  removed?: number
  /** Shifts that move to the new patterns because their support did not change. Absent when there are none to say. */
  carried?: number
  firstDate?: string
  /** The version they came from. */
  fromVersion?: number
  /** The kept ones by day and time, at most 50 (open and assigned count them all). */
  shifts?: OldShiftDto[]
}

/** A shift of a replaced revision that approval leaves for a coordinator to move or cancel. */
export interface OldShiftDto {
  id: string
  serviceDate: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  status: ShiftStatus
  /** Absent when nobody is on it. */
  workerName?: string
}

/** One reason an approval is refused, in plain words. `code` is a pricing issue reason (NoItem, BlocksOverlap, ...) or one of the approval's own (HolidayUndecided, ReviewFlag, HandTyped, TimeZoneMismatch, ...). */
export interface ApprovalReasonDto {
  code: string
  message: string
  /** The block it is about (`PlanBlock.id`); absent when it is about the whole revision. */
  blockId?: string
  count?: number
  firstDate?: string
}

/** A hand-made pattern of the participant that overlaps one the approval would make; approval never ends or changes it. */
export interface OverlappingPatternDto {
  id: string
  dayOfWeek: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  effectiveFrom: string
  effectiveTo?: string
  notes?: string
}

/** What approving a revision would do, with nothing done (`GET .../approval-preview`). */
export interface DraftApprovalPreviewDto {
  canApprove: boolean
  alreadyApproved: boolean
  reasons: ApprovalReasonDto[]
  patternsToCreate: number
  patternsToEnd: number
  /** The new patterns no ended pattern matches (a changed support): they start with no default staff. Absent from an older server. */
  changedPatterns?: number
  /** Ended patterns a coordinator edited by hand (their times, ratio or night type are not their block's) that approving puts back to the agreement's times. Absent from an older server. */
  handEditedPatterns?: number
  /** The version whose patterns would end, and the day they would end (the day before this revision starts). */
  endsFromVersion?: number
  endsOn?: string
  /** The unfilled shifts approval would generate at once: none while the participant is not active, and then `shiftsNote` says when they will come. */
  shiftsToCreate: number
  shiftsNote?: string
  oldShiftsRemaining: OldShiftsRemainingDto
  overlappingPatterns: OverlappingPatternDto[]
  /** The provider's today plus the horizon (56 days), held to the end of the agreement. */
  horizonEnd?: string
  /** Where the shifts approval would make take a pool past its funding for a period (budget phase 3), one entry for each pool and period. A warning only: approving is never refused for a budget. Omitted when there is nothing to say. */
  budgetWarnings?: BudgetWarningDto[]
}

/** The body of `POST .../approve`. */
export interface ApproveDraftDto {
  /** Required (true) when hand-made patterns overlap the ones the approval makes. */
  acknowledgeOverlaps: boolean
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

/** One row of GET /service-agreements/ending (agreement PR 2): an active participant's newest approved agreement ending within 60 days, or ended with no successor approved. No money. */
export interface AgreementEndingDto {
  participantId: string
  participantName: string
  /** The approved revision that ends. */
  draftId: string
  version: number
  agreementEndDate: string
  /** Days from the provider's today; below 0 once it has ended. */
  daysLeft: number
  /** The renewal waiting for approval after an ended agreement, if any. */
  renewalVersion?: number | null
  /** The participant alert's words, such as "Agreement ends in 20 days". */
  status: string
}

/** The body of POST .../{draftId}/pattern-change: what one roster pattern of the approved revision should become, and from when (agreement PR 1). */
export interface PatternChangeDto {
  patternId: string
  dayOfWeek: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  ratio: SupportRatio
  nightType: SleepoverType
  /** Change every day of the pattern's block (no split); the day cannot change with it. */
  allDays: boolean
  /** The first day of the change, yyyy-MM-dd. Absent: the server's default, tomorrow or the agreement's start when that is later. */
  fromDate?: string
  /** Work out the revision and its price, and save nothing. */
  preview: boolean
}

/** What a pattern change saved (or, on a preview, would save): the revision, its dates, and the price of its period before and after. Same dates and prices, so the difference is the change alone. */
export interface PatternChangeResultDto {
  /** The revision saved; absent on a preview. */
  draftId?: string
  version: number
  agreementStartDate: string
  agreementEndDate: string
  oldTotal: number
  newTotal: number
  difference: number
  /** The revision's pricing needs a look before it can be approved. */
  needsReview: boolean
}
