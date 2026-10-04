// The presentational view-model for budget warnings, private to `src/pages/budgets/components/parallel-warnings/`.
//
// This is NOT a server DTO and deliberately duplicates nothing from `@/api/types`. It is the narrow, stable shape these three components
// render: what a server-derived answer looks like AFTER the API adapter has resolved it. The future adapter (budget phase 2b) owns the DTO, the
// endpoints and every financial rule; it maps its answer onto these types and hands them to the components. Nothing here re-derives money,
// a status, or a forecast: the server's decision is passed through as the server stated it.
//
// Money is in WHOLE DOLLARS, the shape the funding endpoints already serve (`FundingPeriodDto.planAmount: number`). A display string is
// never accepted from the server: the components format the number themselves, so one figure cannot be spelled two ways.

import type { Tone } from '@/lib/tone'

// ── The one status vocabulary these surfaces share ──────────────────────────────────────────────────────────────────────

/**
 * How a pool stands against its budget for the current funding period. The three the owner named, plus `OnTrack` and `NoBudget` so a
 * surface can be honest about the two facts that are not risk.
 *
 * The server is the authority: a component never decides a status, never compares two figures to make one, and never reorders or re-ranks
 * rows. `NoBudget` is the "no budget recorded" state (SHAPE-BRIEF §5): nothing ever warns or blocks on it, so it renders quietly.
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

/** The three statuses the attention band counts: the ones somebody must act on. `OnTrack` and `NoBudget` are deliberately absent. */
export type BudgetRiskLevel = Extract<BudgetRiskStatus, 'Over' | 'ForecastOver' | 'Approaching'>

export const BUDGET_RISK_LEVELS: readonly BudgetRiskLevel[] = ['Over', 'ForecastOver', 'Approaching']

/**
 * The one risk order, stated once: Over, then Forecast over, then Approaching, then On track, then no budget recorded
 * (SPEC-P2B item 3). It is an index, not a label, so a status cannot be added to the vocabulary without being placed in it.
 *
 * The table's Status column sorts on this. Nothing else re-derives it: the server's own ordering still arrives as `rows` in the order
 * the server sent, and this rank only decides where a user-placed sort puts things.
 */
export const BUDGET_RISK_ORDER: Record<BudgetRiskStatus, number> = {
  Over: 0,
  ForecastOver: 1,
  Approaching: 2,
  OnTrack: 3,
  NoBudget: 4,
}

/** How many participants the server says are in each state. The adapter supplies every key, so "zero" and "not known" are different props. */
export type BudgetRiskCounts = Record<BudgetRiskLevel, number>

/**
 * How many participants the counts are counted FROM, so the band can name the denominator (F-18: the tile takes no icon and no
 * chip, so its words are the only cue). The adapter supplies the count of participants who have a RECORDED budget: a participant with
 * no budget recorded is not in it, because a missing budget is not a risk to warn about (SHAPE-BRIEF §5) and counting them would
 * present them as one.
 *
 * `null` when the server has not said. That is not zero: a band with counts and no denominator says both halves of the count and no
 * base, and the component then says the counts without a base rather than inventing "of 0".
 */
export type BudgetRiskDenominator = number | null

// ── Null semantics, stated once, honoured by every component ───────────────────────────────────────────────────────────

/**
 * What a component is allowed to do with a missing figure, in one place:
 *
 * - `number` (including `0`) is a real, server-derived figure. Zero is a REAL answer: a pool recorded at $0, a claim of nothing, a forecast
 *   of $0. It is printed as $0.00 and never as a dash, and a component never treats it as "missing".
 * - `null` is "the server could not give a number": a forecast it could not compute, an amount its privacy contract withheld, an estimate it
 *   declined to make. It is printed as the en dash (NO_FIGURE) with the reason's own words beside it, never as $0.00 and never as an error.
 * - `undefined` is never accepted anywhere in this view-model. A prop that can be absent is `T | null`, so "the caller forgot" is a compile
 *   error rather than a silent dash. (The one exception is an OPTIONAL prop, e.g. an optional estimate, which is omitted from the object
 *   entirely rather than set to `undefined`.)
 *
 * The adapter's obligation: a DTO member that is absent on the wire becomes `null` here, never `0` and never left out. A configured zero stays
 * `0`. That is the whole contract that keeps "unknown" from being drawn as "nothing".
 */
export type BudgetAmount = number | null

// ── 1. The attention band ──────────────────────────────────────────────────────────────────────────────────────────────

/** A link or a callback the band calls. Navigation is the caller's: this component never routes. */
export type BudgetAttentionAction = { label: string; to: string } | { label: string; onSelect: () => void }

/**
 * What the band shows.
 *
 * Exactly one of `loading`, `failed` and `counts` is meaningful at a time, and the band never blends them:
 * - `loading`: the request is in flight. There is no figure, so there is no count, no tint and no all-clear.
 * - `failed`: the request failed. NOT the same as zero and NOT the same as healthy: the band says it could not read the figures and never
 *   paints an all-clear.
 * - `counts`: the server's answer. All three keys are present (see `BudgetRiskCounts`); a zero is a real zero.
 */
export type BudgetAttentionBandView = {
  /** Shown while `loading` or `failed`: what is being counted, e.g. "budgets at risk". Default "Budgets". */
  label?: string
  /** A newer answer is on the way while the last one is still on screen. Marks the band busy without clearing the figure. */
  refreshing?: boolean
  loading?: boolean
  failed?: boolean
  /** Why the load failed, in the server's or the caller's own words. Only shown with `failed`. */
  failureMessage?: string
  counts?: BudgetRiskCounts
  /**
   * How many participants have a recorded budget, the base the counts are counted from (F-18). Omitted or `null` when the server has
   * not said, and the band then gives both halves of the count with no base rather than a made-up one.
   */
  denominator?: BudgetRiskDenominator
  /** Whether the viewer may see the figures at all. When false the band states the counts only as words, never as amounts. */
  showAmounts?: boolean
  /** The one action that opens the list. Optional: a band with no destination shows the counts and no button. */
  action?: BudgetAttentionAction
}

// ── 2. The risk table ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether a viewer may see this row's money. An EXPLICIT contract, never inferred from a role reaching the row: receiving a row says nothing
 * about what may be displayed in it. A caller that cannot answer passes `visible: false` and the row renders its labels, its status and its
 * dates with every amount withheld (and, see the component, withheld from `title` and `aria` too, so no figure is recoverable from the DOM).
 */
export type BudgetFigureVisibility = { visible: true } | { visible: false; reason: string }

/**
 * One participant-and-pool row for the current funding period.
 *
 * `status` is the server's word for this row (see `BudgetRiskStatus`). The figures are the server's, in whole dollars, with `null` meaning
 * "not available" (see `BudgetAmount`). `estimate` is OPTIONAL and is the server's own coarse indication of a figure it could not compute
 * exactly — it is present only when the server sent one, and it is never presented as the figure it stands in for.
 */
export type BudgetRiskRow = {
  /** Stable for the row (participant + pool + period). The DataTable's `keyField`, so a re-sort keeps each row's own state. */
  id: string
  /** Who the row is about. Never empty: a row with no participant label is not renderable and must not be sent. */
  participantLabel: string
  /** The pool, as the plan prints it ("Core (flexible)", "Improved Daily Living Skills"). */
  poolLabel: string
  /** The funding period, as "YYYY-MM-DD" calendar days, both inclusive. */
  periodStart: string
  periodEnd: string
  status: BudgetRiskStatus
  /** What may be shown in this row. Required: there is no default of "visible". */
  figures: BudgetFigureVisibility
  /** What the period has: the limit (the set-aside where one is recorded, otherwise the plan amount — the server's decision). */
  available: BudgetAmount
  /** What has been used against it. */
  used: BudgetAmount
  /** What is committed but not yet billed. */
  committed?: BudgetAmount
  /** What is already booked ahead to the end of this period. */
  bookedAhead?: BudgetAmount
  /** Used + committed + booked ahead, as the server computed it. `null` when it could not compute one. */
  forecast: BudgetAmount
  /**
   * The server's coarse indication, e.g. "about $2k over", shown ONLY beside a `null` forecast and only when the server sent one. It is never
   * shown as a figure, so it can never be read as one.
   */
  estimate?: string
  /** Why a figure or the forecast is missing, in the server's words. Shown beside the dash; never a generic "error". */
  unavailableReason?: string
  /** Where this row's next action goes. Omitted entirely when the viewer may not act on the row. */
  action?: BudgetAttentionAction
}

/** What the table is doing. `ready` is the only state in which rows are drawn. */
export type BudgetRiskTableState =
  | { status: 'loading' }
  | { status: 'failed'; message?: string }
  | { status: 'empty' }
  | { status: 'ready'; rows: BudgetRiskRow[]; /** "No budget recorded" rows, kept at the end behind this count. */ hiddenNoBudgetCount?: number; onShowNoBudget?: () => void }

// ── 3. The agreement budget breakdown ────────────────────────────────────────────────────────────────────────────────

/** The provider's own recorded allowance for a pool and period, against the whole-plan amount. Never the same figure, never conflated. */
export type AgreementBudgetAllowance = {
  /** The whole-plan amount for this pool in this period, as the plan prints it. `null` when the server has none. */
  planAmount: BudgetAmount
  /** The part recorded as this provider's set-aside. `null` when none is recorded, which is NOT the same as $0. */
  setAside: BudgetAmount
  /** Which of the two the limit is taken from. The server's decision (owner decision 1: the set-aside when there is one, else the plan amount). */
  limitSource: 'setAside' | 'planAmount'
}

/**
 * One pool and period of the agreement's cost.
 *
 * `committed` and `forecast` are kept apart on purpose: the committed figure is what is signed or already saved against the period, and the
 * forecast is what the booked work would come to. This component shows both and never adds them together.
 */
export type AgreementBudgetLine = {
  poolLabel: string
  periodStart: string
  periodEnd: string
  allowance: AgreementBudgetAllowance
  /** What is signed or already committed against this pool and period. */
  committed: BudgetAmount
  /** What the agreement's work is forecast to come to. `null` when the server could not compute one. */
  forecast: BudgetAmount
  /** The server's verdict for this line: within, or over by the amount in `overBy`. */
  withinLimit: boolean
  /** How far over, when it is. Positive dollars. `null` when it is within. */
  overBy: BudgetAmount
}

/**
 * The whole breakdown, already computed. This component computes NOTHING: it is handed the pricing engine's per-pool, per-period split and
 * the server's own within/over verdicts (budget phase 2b owns the agreement-check endpoint and the forecast rules).
 */
export type AgreementBudgetBreakdownView = {
  /** The state the plan builder is in when the breakdown is read. Only `ready` and `failed` draw figures. */
  status: 'loading' | 'failed' | 'ready'
  failureMessage?: string
  /** A newer answer is on the way while the last is on screen. */
  refreshing?: boolean
  /** What may be shown at all. When false every amount is withheld, exactly as in the table. */
  figures: BudgetFigureVisibility
  lines: AgreementBudgetLine[]
  /** Where the viewer records a budget when there is none. Omitted when there is nothing to point at. */
  noBudgetAction?: BudgetAttentionAction
}
