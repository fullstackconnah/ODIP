// The presentational view-model for budget warnings, private to `src/pages/budgets/components/`.
//
// This is NOT a server DTO and deliberately duplicates nothing from `@/api/types`. It is the narrow, stable shape the Budgets list and the agreement budget bar render: what a server-derived
// answer looks like AFTER the adapters (`../budgetRows.ts`, `../agreementBudgetView.ts`) have resolved it. The adapters own the mapping from the DTOs; the components render what they are given.
// Nothing here re-derives money, a status or a forecast: the server's decision is passed through as the server stated it.
//
// Money is in WHOLE DOLLARS, the shape the funding endpoints already serve (`FundingPeriodDto.planAmount: number`). A display string is never accepted from the server: the components format the
// number themselves, so one figure cannot be spelled two ways.

import type { Tone } from '@/lib/tone'

// ── The one status vocabulary these surfaces share ──────────────────────────────────────────────────────────────────────

/**
 * How a pool stands against its budget for the current funding period. The three the owner named, plus `OnTrack` and `NoBudget` so a surface can be honest about the two facts that are not risk.
 *
 * The server is the authority: a component never decides a status, never compares two figures to make one, and never reorders or re-ranks rows. `NoBudget` is the "no budget recorded" state
 * (SHAPE-BRIEF §5): nothing ever warns or blocks on it, so it renders quietly.
 */
export type BudgetRiskStatus = 'Over' | 'ForecastOver' | 'Approaching' | 'OnTrack' | 'NoBudget'

/** The word a status is printed as, and the tone it is printed in. A `Record`, so a status added without a row fails to compile. */
export const BUDGET_RISK_STATUS: Record<BudgetRiskStatus, { label: string; tone: Tone }> = {
  Over: { label: 'Over', tone: 'danger' },
  ForecastOver: { label: 'Forecast over', tone: 'warning' },
  Approaching: { label: 'Approaching', tone: 'warning' },
  OnTrack: { label: 'On track', tone: 'success' },
  NoBudget: { label: 'No budget recorded', tone: 'neutral' },
}

/**
 * The one risk order, stated once: Over, then Forecast over, then Approaching, then On track, then no budget recorded (SPEC-P2B item 3). It is an index, not a label, so a status cannot be added
 * to the vocabulary without being placed in it.
 *
 * The table's Status column sorts on `budgetRiskRank`, which is built from this. Nothing else re-derives it: the server's own ordering still arrives as `rows` in the order the server sent, and this rank only decides where a
 * user-placed sort puts things.
 */
export const BUDGET_RISK_ORDER: Record<BudgetRiskStatus, number> = {
  Over: 0,
  ForecastOver: 1,
  Approaching: 2,
  OnTrack: 3,
  NoBudget: 4,
}

/**
 * Where a ROW stands in the one risk order, for the Status column's sort: the same rule the server ranks the list by (`BudgetListService.Rank`). Over is first; a pool the NDIA has refused for want of
 * funds comes straight after it (the NDIA's word outranks ODIP's forecast and approaching, and ODIP's own status can say On track beside it); then Forecast over, Approaching, On track, and no budget
 * recorded last. Declared here, once, so the header's sort and the list's own order cannot drift apart.
 */
export function budgetRiskRank(row: Pick<BudgetRiskRow, 'status' | 'ndiaWord'>): number {
  if (row.status === 'Over') return 0
  if (row.ndiaWord) return 1
  return BUDGET_RISK_ORDER[row.status] + 1
}

// ── Null semantics, stated once, honoured by every component ───────────────────────────────────────────────────────────

/**
 * What a component is allowed to do with a missing figure, in one place:
 *
 * - `number` (including `0`) is a real, server-derived figure. Zero is a REAL answer: a pool recorded at $0, a claim of nothing, a forecast of $0. It is printed as $0.00 and never as a dash, and
 *   a component never treats it as "missing".
 * - `null` is "the server could not give a number": a forecast it could not compute, an amount its privacy contract withheld. It is printed as the en dash (NO_FIGURE) with the reason's own
 *   words beside it, never as $0.00 and never as an error.
 * - `undefined` is never accepted anywhere in this view-model. A prop that can be absent is `T | null`, so "the caller forgot" is a compile error rather than a silent dash. (The one exception
 *   is an OPTIONAL prop, e.g. an optional figure, which is omitted from the object entirely rather than set to `undefined`.)
 *
 * The adapter's obligation: a DTO member that is absent on the wire becomes `null` here, never `0` and never left out. A configured zero stays `0`. That is the whole contract that keeps
 * "unknown" from being drawn as "nothing".
 */
export type BudgetAmount = number | null

/** A link or a callback a component offers. Navigation is the caller's: no component here routes. */
export type BudgetAttentionAction = { label: string; to: string } | { label: string; onSelect: () => void }

/**
 * Whether a viewer may see money. An EXPLICIT contract, never inferred from a role reaching the data: receiving a row says nothing about what may be displayed in it. A caller that cannot answer
 * passes `visible: false` and the row renders its labels, its status and its dates with every amount withheld (and, see the component, withheld from `title` and `aria` too, so no figure is
 * recoverable from the DOM).
 */
export type BudgetFigureVisibility = { visible: true } | { visible: false; reason: string }

// ── 1. The Budgets list ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One participant-and-pool row for the current funding period.
 *
 * `status` is the server's word for this row (see `BudgetRiskStatus`). The figures are the server's, in whole dollars, with `null` meaning "not available" (see `BudgetAmount`).
 */
export type BudgetRiskRow = {
  /** Stable for the row (participant + pool + period). The DataTable's `keyField`, so a re-sort keeps each row's own state. */
  id: string
  /** Who the row is about. Never empty: a row with no participant label is not renderable and must not be sent. */
  participantLabel: string
  /** The pool, as the plan prints it ("Core", "Improved Daily Living Skills"). */
  poolLabel: string
  /** The funding period, as "YYYY-MM-DD" calendar days, both inclusive. */
  periodStart: string
  periodEnd: string
  status: BudgetRiskStatus
  /** What may be shown in this row. Required: there is no default of "visible". */
  figures: BudgetFigureVisibility
  /** What the period has: the limit plus what earlier periods left unspent (the server's figure). */
  available: BudgetAmount
  /** How much of `available` is rolled over from earlier periods (the server's figure): not confirmed, because somebody else may have used it. 0 when none. */
  carried: BudgetAmount
  /** What has been used against it: claimed plus pending. */
  used: BudgetAmount
  /** Available minus used, the server's: what is left, or, below zero, how far over the period already is. Nothing here subtracts. */
  remaining: BudgetAmount
  /** What is already booked ahead to the end of this period. */
  bookedAhead?: BudgetAmount
  /** Used plus booked ahead, as the server computed it. `null` when it could not compute one. */
  forecast: BudgetAmount
  /** How many shifts of this period the forecast leaves out because no price can be worked out for them yet (a sleepover, a passive night, a group shift). Omitted when there are none: the figures are then complete. */
  unpricedShifts?: number
  /**
   * The NDIA's own word that this pool's funds ran out (a claim of the pool refused for want of funds, V17, V18, V27 or V28), the day it was refused and the code. ODIP's own status can say On track
   * beside it, so the row says it in its own pill. Omitted when the NDIA has said nothing.
   */
  ndiaWord?: { date: string; code: string }
  /** Why a figure or the forecast is missing, in the server's words. Shown beside the dash; never a generic "error". */
  unavailableReason?: string
  /** Where this row's next action goes. Omitted entirely when the viewer may not act on the row. */
  action?: BudgetAttentionAction
}

/** An NDIS-funded participant with no budget in force: a name and the way to record one, and never a figure or a warning. */
export type NoBudgetEntry = {
  id: string
  participantLabel: string
  /** Why there is no row: "No budget recorded", or that the plan ended on a day. */
  reason: string
  action?: BudgetAttentionAction
}

/** What the table is doing. `ready` is the only state in which rows are drawn. */
export type BudgetRiskTableState =
  | { status: 'loading' }
  | { status: 'failed'; /** Asks again: the list is read by a query, and a failure is not the end of the page. */ onRetry?: () => void }
  | { status: 'empty' }
  | { status: 'ready'; rows: BudgetRiskRow[]; /** The participants with no budget in force, kept at the end behind a count. */ noBudget?: NoBudgetEntry[] }

// ── 2. The agreement budget bar's check ─────────────────────────────────────────────────────────────────────────────────

/**
 * One pool and one funding period the agreement touches: what the agreement costs there, what the period has left, and whether it fits. All three are the server's (the cost is the pricing
 * engine's, the remaining is the ledger's available minus used, the verdict is the server's over-by); the component only draws them.
 */
export type AgreementBudgetLine = {
  periodStart: string
  periodEnd: string
  /** What the agreement costs in this period. */
  cost: BudgetAmount
  /** What the period has left: available minus used. May be below zero. */
  remaining: BudgetAmount
  /** The server's verdict for this line: it fits, or it passes what is left by `overBy`. */
  withinLimit: boolean
  /** How far over, when it is. Positive dollars. `null` when it is within. */
  overBy: BudgetAmount
}

/** One pool the agreement touches, and its periods in date order. */
export type AgreementBudgetPool = {
  poolLabel: string
  lines: AgreementBudgetLine[]
  /** What the agreement costs in this pool over all the periods it touches: the pricing engine's sum, for the one line a pool that spans several periods gets in the dock. */
  cost: BudgetAmount
  /** How far the agreement passes what the pool has across those periods (the server's sum of the periods' over-bys). `null` when every period fits. */
  overBy: BudgetAmount
  /**
   * The part of `overBy` the pool was already over before the agreement (the server's sum of the periods' negative remainders): a period over already counts that excess in its own over-by, so
   * `overBy` can pass the agreement's cost, and the line says how much of it was there. `null` when none was.
   */
  alreadyOverBy: BudgetAmount
}

/**
 * The whole check, already computed. The component computes NOTHING: it is handed the server's per-pool, per-period split and verdicts.
 *
 * WARNING ONLY, in every mode: an owner decision. Nothing here can block a save or an approval, and the view holds no callback that could refuse one.
 */
export type AgreementBudgetBreakdownView = {
  /** `loading`: the first answer is on its way. `failed`: it could not be read (the plan can still be saved). `none`: no budget is recorded. `ready`: pools to show. */
  status: 'loading' | 'failed' | 'none' | 'ready'
  failureMessage?: string
  /** A newer answer is on the way while the last is on screen. */
  refreshing?: boolean
  /** What may be shown at all. When false every amount is withheld, exactly as in the table. */
  figures: BudgetFigureVisibility
  pools: AgreementBudgetPool[]
  /** The part of the agreement whose category no recorded pool covers: shown, never dropped. 0 or null when there is none. */
  notInARecordedPool: BudgetAmount
  /** The part delivered outside the plan's dates: shown, never dropped. */
  outsideThePlan: BudgetAmount
  /** Why there is none, when `status` is `none`: nothing is recorded, the recorded plan ended on `planEnd`, or a plan is recorded for later and starts on `planStart`. Omitted means nothing is recorded. */
  noBudgetReason?: 'NotRecorded' | 'PlanEnded' | 'NotStarted'
  /** The last day of the plan that ended, when `noBudgetReason` is `PlanEnded`. */
  planEnd?: string
  /** The first day of the plan recorded for later, when `noBudgetReason` is `NotStarted`. */
  planStart?: string
  /** Where the viewer records a budget when there is none. Omitted when there is nothing to point at. */
  noBudgetAction?: BudgetAttentionAction
  /** Asks again after a failure. Omitted when there is nothing to ask. */
  onRetry?: () => void
}
