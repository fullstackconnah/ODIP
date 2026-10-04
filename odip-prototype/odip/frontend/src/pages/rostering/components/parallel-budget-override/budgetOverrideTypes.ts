// The view model for the budget override / emergency lane, and the pure rules over it.
//
// This file is the lane's OWN contract (README.md beside it is the prose version). It holds no
// JSX, reads no hook, and does no money arithmetic: every figure here is a value the server
// computed and the caller handed down (SHAPE-BRIEF §3, "no surface does sums of its own").
//
// It exists so `ShiftSlideOver` can import types and a value or two from one place when the
// integration owner wires it in, without this lane having to touch that file.

import type { RosterFindingDto } from '@/api/types'

/**
 * The budget finding this lane renders. Deliberately the app's own
 * `RosterFindingDto` and NOT a new DTO: the phase-3 server already returns
 * BUDGET_APPROACHING / BUDGET_OVER / BUDGET_FORECAST_OVER as roster findings, and inventing a
 * parallel shape here would be a second contract the integration has to translate and keep in
 * step. Narrowing is by CODE, never by message text.
 */
export type BudgetFindingView = RosterFindingDto

/** The three budget codes phase 3 raises, plus the emergency acknowledgement code. */
export const BUDGET_FINDING_CODES = {
  approaching: 'BUDGET_APPROACHING',
  over: 'BUDGET_OVER',
  forecastOver: 'BUDGET_FORECAST_OVER',
  /** Acknowledgement code the server records for a shift saved through the emergency path. */
  emergency: 'BUDGET_EMERGENCY',
} as const

/**
 * A money figure the server sent, or a reason it is not showing one.
 *
 * `null` and `unknown` are different facts and this type keeps them apart deliberately:
 *  - `null`    the server said this is not recorded (no set-aside on the pool, for instance);
 *  - `unknown` the request has not answered, or failed, so nothing is known yet.
 *
 * A missing forecast is NOT a zero, and a recorded allowance of $0.00 is NOT "unrecorded"
 * (SHAPE-BRIEF §2, DESIGN.md "Loading and failure are not zero"). Collapsing either into 0
 * would tell a coordinator a period has no money when in fact nothing is known about it.
 */
export type BudgetFigure =
  | { kind: 'value'; amount: number }
  | { kind: 'notRecorded' }
  | { kind: 'unknown' }

/** The authoritative figures for one pool in one funding period, as the server computed them. */
export type BudgetPeriodFigures = {
  /** Pool label as the plan prints it ("Core (flexible)", "Improved Daily Living Skills"). */
  pool: string
  /** Funding period label, or the period's end date, in the server's own words. */
  period: string
  /**
   * Oassist's share for the period: the set-aside when one is recorded, otherwise the plan
   * amount (owner decision, shape round 1: "Both, ours enforced"). Null when neither is known.
   */
  available: BudgetFigure
  /** What the period has left after what is already committed. Not derivable here. */
  remaining: BudgetFigure
  /** The server's estimate of the shift being added/edited. */
  shiftCost: BudgetFigure
  /**
   * What the period would stand at with this shift in it. `unknown` when the server did not
   * compute a forecast — which is NOT the same as a forecast of nothing.
   */
  projectedTotal: BudgetFigure
  /** How far the projected total is past `available`, when the server says it is over. */
  projectedOverrun: BudgetFigure
  /**
   * A privacy-restricted viewer (SupportWorker, ReadOnly — SHAPE-BRIEF §5) may see that a budget
   * warning exists without any money in it. When true, every figure renders as "hidden" and no
   * amount reaches the DOM.
   */
  restricted?: boolean
}

/**
 * Who is acting, expressed as the CALLER's answer. This lane never reads a session, a role from
 * a hook, or a permission table: the integration owner knows the caller's role and says so. A
 * presentational component that guessed would be a second source of truth about permissions.
 */
export type BudgetOverrideCapabilities = {
  /**
   * Admin or SuperAdmin: may record an ordinary override with a written reason. The reason is
   * audited (owner decision, shape round 1).
   */
  canOverrideAsAdmin: boolean
  /**
   * Any Coordinator, and always: may record an "Emergency or safety" reason. This is NOT a
   * switchable capability — the owner decided it "cannot be switched off" (shape round 3), so
   * this prop states what the caller authorises for display, and there is deliberately no prop,
   * setting or toggle anywhere in this lane that could turn the path off.
   */
  canRecordEmergency: boolean
}

/**
 * Which of the two ways through an over-budget shift the user has chosen. Both require a written
 * reason. `none` is the state before a choice.
 */
export type BudgetOverrideChoice = 'none' | 'adminOverride' | 'emergency'

/** The shortest reason this lane accepts, in trimmed characters (DECISIONS: "a required description (min 10 characters)"). */
export const MIN_REASON_LENGTH = 10

/**
 * A reason counts only when it has something in it. Whitespace-only is not a reason, and neither
 * is a bare newline or tab run: this trims every whitespace class, not just spaces.
 */
export function isMeaningfulReason(reason: string): boolean {
  return reason.trim().length > 0
}

/** The reason as it goes to the server: trimmed, or null when there is nothing to send. */
export function normalisedReason(reason: string): string | null {
  const trimmed = reason.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Whether the reason satisfies the emergency description's own minimum. The check is on the
 * TRIMMED text, so ten spaces of padding is not ten characters of explanation.
 */
export function meetsEmergencyMinimum(reason: string): boolean {
  return reason.trim().length >= MIN_REASON_LENGTH
}

/**
 * The two ways through, and whether this caller may take each one. Returns ONLY the choices the
 * caller authorises — an unauthorised path is not rendered disabled, it is not rendered at all,
 * so a hidden radio can never be submitted and never implies the path is off.
 */
export function availableChoices(caps: BudgetOverrideCapabilities): BudgetOverrideChoice[] {
  const choices: BudgetOverrideChoice[] = []
  if (caps.canOverrideAsAdmin) choices.push('adminOverride')
  if (caps.canRecordEmergency) choices.push('emergency')
  return choices
}

/**
 * The problem with the reason as it stands, in the words the field should show, or null when
 * there is none. Pure so the tests can pin every state without a DOM.
 */
export function reasonError(choice: BudgetOverrideChoice, reason: string, submitted: boolean): string | null {
  if (!submitted || choice === 'none') return null
  if (!isMeaningfulReason(reason)) return 'Write why this shift should go ahead. A reason is recorded in the audit log.'
  if (choice === 'emergency' && !meetsEmergencyMinimum(reason)) {
    return `Describe the emergency or safety reason in at least ${MIN_REASON_LENGTH} characters.`
  }
  return null
}

/**
 * Whether a save may go ahead. Two rules only, both the owner's: a choice must be made when
 * there is a choice to make, and a reason must be written. This never inspects the budget — the
 * server decides what is over budget, and a client-side money check would be a second,
 * disagreeable one.
 */
export function canSubmit(choice: BudgetOverrideChoice, reason: string): boolean {
  if (choice === 'none') return false
  return isMeaningfulReason(reason) && (choice !== 'emergency' || meetsEmergencyMinimum(reason))
}

/**
 * The label the emergency path is saved under, exactly as the server prefixes it. Exported so an
 * integration or a test can assert the stored string without duplicating the wording.
 */
export const EMERGENCY_REASON_PREFIX = 'Emergency or safety: '

/** The reason text as it is stored: the emergency prefix for the emergency path, raw for an override. */
export function storedReason(choice: BudgetOverrideChoice, reason: string): string | null {
  const trimmed = normalisedReason(reason)
  if (trimmed === null) return null
  return choice === 'emergency' ? `${EMERGENCY_REASON_PREFIX}${trimmed}` : trimmed
}

/** The marker a shift saved through either path carries on the board and in the slide-over. */
export const OVER_BUDGET_MARKER = {
  emergency: 'Over budget: emergency',
  adminOverride: 'Over budget: Admin override',
} as const

export type OverBudgetMarkerKind = keyof typeof OVER_BUDGET_MARKER

/**
 * Which marker a shift carries, decided by the codes the SERVER acknowledged — never by reading
 * the stored reason text, and never by the shape of a code's name.
 *
 * This is a mandatory contract rule, not a style choice. `Shift.OverrideReason` is free text that
 * the server prefixes with "Emergency or safety: " on the emergency path, but nothing stops a
 * coordinator typing those same words into an ordinary Admin override. A marker derived from the
 * stored string would then show a shift as an emergency that never was, and that is a false entry
 * in an audit record the organisation keeps for compliance.
 *
 * So the integration owner passes the shift's `acknowledgedFindingCodes` in here, and the answer
 * comes from the acknowledged CODES themselves.
 *
 * The Admin override marker is gated on `BUDGET_FORECAST_OVER` and nothing else. An override is
 * an ADMIN'S ACT with an audited written reason behind it, so it can only have happened on a shift
 * that was actually over its recorded budget and the caller answered to it. `BUDGET_APPROACHING`
 * and `BUDGET_OVER` are no-reason warnings: a shift that is merely approaching, or that the server
 * says is over but nobody pushed past, can never have been overridden. Treating "any code that
 * starts with BUDGET_" as an override therefore put "Over budget: Admin override" on shifts nobody
 * overrode — a false entry in the same compliance record, and the same class of defect as reading
 * the reason string. Only the exact forecast-over code earns the marker.
 *
 * A code this lane does not know is likewise not evidence of anything. A prefix match let an
 * unknown or future server code forge the marker, so the test is equality against the one
 * constant, not a pattern.
 *
 * When the emergency code is present the emergency marker wins — it is the stronger, later fact,
 * and an Admin override acknowledged on the same save is the administrative shadow of the
 * emergency. No other budget code can outvote it.
 */
export function markerForAcknowledgedCodes(codes: readonly string[] | null | undefined): OverBudgetMarkerKind | null {
  if (!codes || codes.length === 0) return null
  if (codes.includes(BUDGET_FINDING_CODES.emergency)) return 'emergency'
  return codes.includes(BUDGET_FINDING_CODES.forecastOver) ? 'adminOverride' : null
}

/** How far an emergency review obligation has got. There is no 'approved' state here. */
export type EmergencyReviewState = 'pending' | 'reviewed'

/**
 * Everything known about a shift that went over budget on purpose. The reviewer fields are the
 * server's record, never an assumption made here: an emergency saves at once and is REVIEWED
 * afterwards, so before a reviewer has touched it there is no reviewer and no review time, and
 * this type has to be able to say that without inventing them.
 */
export type EmergencyReviewDetails = {
  kind: OverBudgetMarkerKind
  state: EmergencyReviewState
  /** The reason as it was stored (server's record, including the emergency prefix). */
  reason: string
  /** When the shift was saved through the path, when the server recorded it. */
  recordedAt?: string | null
  /** The reviewer's name, once a reviewer has been assigned or has acted. Null while pending. */
  reviewedBy?: string | null
  /** When the review happened. Null while pending — never "now", never an estimate. */
  reviewedAt?: string | null
  /** A line to the review task, when the caller has one. Rendered as text, not as a link here. */
  reviewTaskTitle?: string | null
  /**
   * A privacy-restricted viewer sees that the shift carries a marker and nothing else: no
   * participant money, no reason text, no reviewer's name. SupportWorker and ReadOnly never see
   * money (SHAPE-BRIEF §5).
   */
  restricted?: boolean
}

/**
 * What a review marker says while nobody has looked at it yet. It must never read as an approval,
 * and the "pending" word is the point: the emergency saved at once and an Admin reviews it
 * afterwards (owner decision, shape round 3). There is no state in which this component invents
 * a reviewer.
 */
export function emergencyReviewBadge(state: EmergencyReviewState): { label: string; tone: 'warning' | 'success' } {
  return state === 'reviewed'
    ? { label: 'Reviewed', tone: 'success' }
    : { label: 'Admin review pending', tone: 'warning' }
}
