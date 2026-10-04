import type { BillingSourcesHintDto, BudgetEvidenceSource, FundingPlanDto, FundingPoolKind, PaceCategoryDto, SaveFundingPlanDto } from '@/api/types'
import type { PlanType } from '@/api/types/enums'
import { addMonthsIso, MAX_PLAN_DAYS, proposePeriods, spreadSetAside, sumAmounts, toCents } from '@/lib/fundingPeriods'
import { formatDayNumber, parseDateOnly } from '@/lib/dateOnly'

// The plan budget editor's form, as plain data: what the person typed (money stays text until it is saved, so clearing a box to type another figure does not snap to 0), how the
// periods follow the plan's dates and the typed totals, what is wrong in plain words, and the request body. No React in here, so every rule has a test. The server checks the same
// rules again and is the authority; these only say so earlier, beside the field.

export { MAX_PLAN_DAYS }
/** The largest amount one period may hold: the server's own ceiling, a guard against a slipped decimal point. */
export const MAX_AMOUNT = 99_999_999.99

export interface EditorPeriod {
  periodStart: string
  periodEnd: string
  /** What the person typed (dollars and cents), or what the proposal worked out. */
  planAmount: string
  /** '' = none. A pool has a set-aside on every period or on none. */
  setAside: string
}

export interface EditorPool {
  /** Stable for the life of the form, so a row keeps its place and its focus when others change. */
  key: string
  kind: FundingPoolKind
  /** 0 for Core (flexible). */
  paceCategory: number
  managementType: PlanType
  /** '' = the plan prints no name for it: the server names it for the category. */
  name: string
  notes: string
  /** Typed: this pool's amount for the whole plan. */
  totalText: string
  /** Typed: the organisation's share of it. '' = none. */
  setAsideText: string
  /**
   * The person confirmed that a typed zero set-aside is meant: nothing may be claimed against the pool. A typed 0 is ambiguous ("none" or "$0 allowed") and a set-aside is the pool's LIMIT,
   * so without this a zero in the box is read as blank. It belongs to the zero that was in front of the person: another figure in the box takes it back.
   */
  setAsideZeroConfirmed: boolean
  periods: EditorPeriod[]
  /** The amounts are not a plain proposal: they were read from a saved plan, or changed by hand. The proposal no longer rewrites them, until the person asks for it again. */
  edited: boolean
  /** The periods were read from a saved plan, not worked out here (so they are what the plan says, not a split by days). */
  fromPlan: boolean
  /** An amount was changed by hand in this session. Only then is the proposal's "edited" note true, and only then is "Split again" worth offering by itself. */
  touched: boolean
  /**
   * A set-aside on the periods is the person's own (typed into a period, or read from a saved plan), not a share worked out from the set-aside box. The box then leaves the periods as they
   * are when it is retyped, and says they no longer add up to it, as the plan amount's box does; "Split again" applies the box. Shares worked out from the box keep following it as it is typed.
   */
  setAsideByHand: boolean
}

export interface EditorState {
  planStart: string
  planEnd: string
  reassessmentDate: string
  /** 1, 3, 6 or 12; null = the plan has no funding periods. */
  periodLengthMonths: number | null
  evidence: BudgetEvidenceSource
  confirmedOn: string
  confirmedByName: string
  notes: string
  pools: EditorPool[]
  /** The revision the plan was loaded at (editing a stored plan); a save carries it so a change made in the meantime is a 409, not a silent overwrite. */
  revision?: number
}

// ── Money ───────────────────────────────────────────────────────────────

const MONEY = /^\d+(\.\d{1,2})?$/

/** Dollars and cents typed by a person ("1,234.50", "$80", "80.5") as a number; null for nothing typed or something that is not an amount. */
export function moneyOf(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '').trim()
  return MONEY.test(cleaned) ? Number(cleaned) : null
}

export const isBlank = (text: string): boolean => text.trim() === ''

/** A figure as the box shows it: 8000 is "8000.00". */
export const moneyText = (amount: number): string => amount.toFixed(2)

/** Whether the set-aside box holds a zero ("0", "0.00", "$0"): the one figure that could mean "none" or "$0 allowed". */
export const isZeroSetAside = (pool: Pick<EditorPool, 'setAsideText'>): boolean => moneyOf(pool.setAsideText) === 0

/**
 * The set-aside the box holds, as the pool should use it: null for a blank or unreadable box, and for a typed zero nobody confirmed (it is read as blank, and a deliberate $0 needs the person's
 * word, because the set-aside is the limit a claim is held against and a zero limit would make every claim "over").
 */
export function setAsideOf(pool: Pick<EditorPool, 'setAsideText' | 'setAsideZeroConfirmed'>): number | null {
  const typed = moneyOf(pool.setAsideText)
  return typed === 0 && !pool.setAsideZeroConfirmed ? null : typed
}

/** The box says "no set-aside": it is blank, or holds a zero nobody confirmed. (Unreadable text is neither: it is a mistake with a message of its own.) */
const sayingNone = (pool: Pick<EditorPool, 'setAsideText' | 'setAsideZeroConfirmed'>): boolean => isBlank(pool.setAsideText) || (isZeroSetAside(pool) && !pool.setAsideZeroConfirmed)

// ── Making a state ──────────────────────────────────────────────────────

let poolCounter = 0
export const newPoolKey = (): string => `pool-${++poolCounter}`

export function emptyEditorState(): EditorState {
  return {
    planStart: '', planEnd: '', reassessmentDate: '', periodLengthMonths: 3, evidence: 'PlanCopy',
    confirmedOn: '', confirmedByName: '', notes: '', pools: [],
  }
}

/**
 * The form for recording the next plan: the day after the last one ended, a year long, with the same funding period length. Pools and amounts are left for the person to fill in:
 * a reassessment is a new set of figures, not a copy of the old ones. A FIRST plan (nothing recorded before it) starts from the plan dates the profile already holds when it has both,
 * so a coordinator who typed them at intake does not type them again; the plan after that follows the plan before it, never the profile.
 */
export function nextPlanState(previous: Pick<FundingPlanDto, 'planEnd' | 'periodLengthMonths'> | undefined, profileDates?: { start?: string; end?: string }): EditorState {
  const state = emptyEditorState()
  if (!previous) {
    const readable = profileDates?.start && profileDates.end && parseDateOnly(profileDates.start) !== null && parseDateOnly(profileDates.end) !== null
    return readable ? { ...state, planStart: profileDates.start as string, planEnd: profileDates.end as string } : state
  }
  const endDay = parseDateOnly(previous.planEnd)
  if (endDay === null) return state
  const start = formatDayNumber(endDay + 1)
  const yearOn = parseDateOnly(addMonthsIso(start, 12))
  return { ...state, planStart: start, planEnd: yearOn === null ? '' : formatDayNumber(yearOn - 1), periodLengthMonths: previous.periodLengthMonths ?? null }
}

/** A stored plan as a form: every amount as text, the totals as the sum of the periods, and the periods as saved (a stored plan's periods are never rewritten by a proposal). */
export function editorStateFromPlan(plan: FundingPlanDto): EditorState {
  return {
    planStart: plan.planStart, planEnd: plan.planEnd, reassessmentDate: plan.reassessmentDate ?? '', periodLengthMonths: plan.periodLengthMonths ?? null,
    evidence: plan.evidence, confirmedOn: plan.confirmedOn ?? '', confirmedByName: plan.confirmedByName ?? '', notes: plan.notes ?? '', revision: plan.revision,
    pools: plan.pools.map(pool => ({
      key: newPoolKey(), kind: pool.kind, paceCategory: pool.paceCategory, managementType: pool.managementType, name: pool.name, notes: pool.notes ?? '',
      totalText: moneyText(pool.planTotal), setAsideText: pool.setAsideTotal === undefined ? '' : moneyText(pool.setAsideTotal),
      // A saved set-aside of $0 on every period is what was saved: it is shown with its confirmation given, for the person to take back if it was never meant.
      setAsideZeroConfirmed: pool.setAsideTotal === 0,
      periods: pool.periods.map(period => ({
        periodStart: period.periodStart, periodEnd: period.periodEnd, planAmount: moneyText(period.planAmount), setAside: period.setAside === undefined ? '' : moneyText(period.setAside),
      })),
      edited: true, fromPlan: true, touched: false, setAsideByHand: pool.periods.some(period => period.setAside !== undefined),
    })),
  }
}

// ── The periods follow the dates and the typed totals ───────────────────

/**
 * The proposal for one pool: periods from the plan's dates and length, amounts split from the typed totals (blank while a total is blank or not an amount). A typed zero set-aside is a set-aside
 * only when `zeroConfirmed` says the person meant it; otherwise it is read as blank.
 */
export function proposedPeriods(state: Pick<EditorState, 'planStart' | 'planEnd' | 'periodLengthMonths'>, totalText: string, setAsideText: string, zeroConfirmed = false): EditorPeriod[] {
  const total = moneyOf(totalText)
  const setAside = setAsideOf({ setAsideText, setAsideZeroConfirmed: zeroConfirmed })
  const proposal = proposePeriods({
    planStart: state.planStart, planEnd: state.planEnd, lengthMonths: state.periodLengthMonths, planAmount: total ?? 0,
    setAside: setAside === null ? undefined : setAside,
  })
  return proposal.map(period => ({
    periodStart: period.periodStart, periodEnd: period.periodEnd,
    planAmount: total === null ? '' : moneyText(period.planAmount),
    setAside: setAside === null || period.setAside === undefined ? '' : moneyText(period.setAside),
  }))
}

/**
 * Why a pool shows no periods: the plan's dates are missing or not real days, the plan ends before it starts, or it runs longer than the server accepts (so none are proposed: a year typed
 * digit by digit passes through years like 0002). Said in the table, so an empty one is never a puzzle.
 */
export function noPeriodsReason(state: Pick<EditorState, 'planStart' | 'planEnd'>): string {
  const start = parseDateOnly(state.planStart)
  const end = parseDateOnly(state.planEnd)
  if (start === null || end === null) return 'Give the plan’s dates to see its periods.'
  if (end < start) return 'The plan ends before it starts, so there are no periods to show.'
  if (end - start + 1 > MAX_PLAN_DAYS) return `A plan can run at most ${MAX_PLAN_DAYS} days, so no periods are shown. Check the plan’s dates.`
  return 'Give the plan’s dates to see its periods.'
}

/** The pool with its periods worked out again from the plan's dates and the totals it holds. */
export function resplit(state: EditorState, pool: EditorPool): EditorPool {
  return { ...pool, periods: proposedPeriods(state, pool.totalText, pool.setAsideText, pool.setAsideZeroConfirmed), edited: false, fromPlan: false, touched: false, setAsideByHand: false }
}

/** Every pool's periods worked out again (the plan's dates or funding period length changed). True in `rewroteEdits` when some pool had amounts typed by hand that this replaced. */
export function resplitAll(state: EditorState): { state: EditorState; rewroteEdits: boolean } {
  const rewroteEdits = state.pools.some(pool => pool.edited && pool.periods.length > 0)
  return { state: { ...state, pools: state.pools.map(pool => resplit(state, pool)) }, rewroteEdits }
}

const sameDates = (a: EditorState, b: EditorState) => a.planStart === b.planStart && a.planEnd === b.planEnd && a.periodLengthMonths === b.periodLengthMonths

/** Applies a change to the plan's fields. A change to its dates or period length works every pool's periods out again. */
export function withPlanFields(state: EditorState, patch: Partial<EditorState>): { state: EditorState; rewroteEdits: boolean } {
  const next = { ...state, ...patch }
  return sameDates(state, next) ? { state: next, rewroteEdits: false } : resplitAll(next)
}

/**
 * A change to what was typed for a pool's totals. Until a period has been edited by hand (or the periods were read from a saved plan) the periods follow the totals. After that the
 * plan amounts are left as they are, but the SET-ASIDE box still has to agree with the periods, or the figure typed would silently not be saved (a pool's limit is its set-aside when
 * it has one, so a lost set-aside would make the limit the whole plan amount): typing a set-aside spreads it over the periods in proportion to their plan amounts when no period holds
 * one the person typed or the plan stored (the shares worked out from the box follow it as it is typed), and clearing the box clears it from every period (a pool has a set-aside on every
 * period or on none). Over set-asides that are the person's own the box leaves the periods alone, as the plan amount's box does, and `poolSums` says they no longer add up to it.
 * A half-typed amount ("4.") changes nothing until it is a whole one.
 */
export function withPoolTotals(state: EditorState, key: string, patch: Partial<Pick<EditorPool, 'totalText' | 'setAsideText'>>): EditorState {
  return {
    ...state,
    pools: state.pools.map(pool => {
      if (pool.key !== key) return pool
      const next = { ...pool, ...patch }
      // A confirmed zero belongs to the zero that was in front of the person: any other figure in the box takes the confirmation back.
      if (patch.setAsideText !== undefined && !isZeroSetAside(next)) next.setAsideZeroConfirmed = false
      if (!next.edited) return resplit(state, next)
      return patch.setAsideText === undefined ? next : agreeSetAside(pool, next)
    }),
  }
}

/**
 * The person's answer to "a set-aside of $0 means nothing may be claimed against this pool": yes (the zero is a set-aside, on every period) or no (it is read as blank again, and the zeros it put on
 * the periods are cleared). Only a box holding a zero can be confirmed.
 */
export function withSetAsideZeroConfirmed(state: EditorState, key: string, confirmed: boolean): EditorState {
  return {
    ...state,
    pools: state.pools.map(pool => {
      if (pool.key !== key || !isZeroSetAside(pool) || pool.setAsideZeroConfirmed === confirmed) return pool
      const next = { ...pool, setAsideZeroConfirmed: confirmed }
      return next.edited ? agreeSetAside(pool, next) : resplit(state, next)
    }),
  }
}

/** The set-aside box of an edited pool, as the periods should read once it changed. */
function agreeSetAside(before: EditorPool, next: EditorPool): EditorPool {
  if (sayingNone(next)) {
    // Cleared (or a zero nobody confirmed, which says the same): no set-aside, on every period too (the person said none). A box that was saying none already, with set-asides typed into the
    // periods, is not "cleared": they are the person's own.
    return sayingNone(before) ? next : { ...next, setAsideByHand: false, periods: next.periods.map(period => ({ ...period, setAside: '' })) }
  }
  const typed = setAsideOf(next)
  const amounts = next.periods.map(period => moneyOf(period.planAmount))
  if (typed === null || next.periods.length === 0 || amounts.some(amount => amount === null)) return next
  // The person's own set-asides are never overwritten by typing in the box: they stay, and the mismatch is said. With none on the periods (or only shares of the box's earlier digits) it spreads.
  if (next.setAsideByHand && next.periods.some(period => !isBlank(period.setAside))) return next
  const shares = spreadSetAside(toCents(typed), amounts.map(amount => toCents(amount as number)))
  return { ...next, setAsideByHand: false, periods: next.periods.map((period, index) => ({ ...period, setAside: moneyText(shares[index] / 100) })) }
}

/** A period's amount changed by hand: the pool's periods stop following the typed totals, and a set-aside typed into a period is the person's own from then on. */
export function withPeriodEdit(state: EditorState, key: string, index: number, patch: Partial<Pick<EditorPeriod, 'planAmount' | 'setAside'>>): EditorState {
  return {
    ...state,
    pools: state.pools.map(pool => (pool.key !== key
      ? pool
      : { ...pool, edited: true, touched: true, setAsideByHand: pool.setAsideByHand || patch.setAside !== undefined, periods: pool.periods.map((period, i) => (i === index ? { ...period, ...patch } : period)) })),
  }
}

// ── Pools ───────────────────────────────────────────────────────────────

export const poolIdentity = (pool: Pick<EditorPool, 'paceCategory' | 'managementType'>): string => `${pool.paceCategory}|${pool.managementType}`

/** Whether the plan already holds this category under this management type (a plan holds each once). */
export function hasPool(state: EditorState, paceCategory: number, managementType: PlanType): boolean {
  return state.pools.some(pool => pool.paceCategory === paceCategory && pool.managementType === managementType)
}

function addPool(state: EditorState, pool: Omit<EditorPool, 'key' | 'periods' | 'edited' | 'fromPlan' | 'touched' | 'setAsideByHand' | 'setAsideZeroConfirmed' | 'totalText' | 'setAsideText' | 'notes'> & Partial<Pick<EditorPool, 'totalText' | 'setAsideText'>>): EditorState {
  if (hasPool(state, pool.paceCategory, pool.managementType)) return state
  const base: EditorPool = { totalText: '', setAsideText: '', ...pool, key: newPoolKey(), notes: '', periods: [], edited: false, fromPlan: false, touched: false, setAsideByHand: false, setAsideZeroConfirmed: false }
  return { ...state, pools: [...state.pools, resplit(state, base)] }
}

export function addCorePool(state: EditorState, managementType: PlanType, totals: Partial<Pick<EditorPool, 'totalText' | 'setAsideText'>> = {}): EditorState {
  return addPool(state, { kind: 'CoreFlexible', paceCategory: 0, managementType, name: '', ...totals })
}

export function addStatedPool(state: EditorState, category: Pick<PaceCategoryDto, 'number'>, managementType: PlanType): EditorState {
  return addPool(state, { kind: 'Stated', paceCategory: category.number, managementType, name: '' })
}

export const removePool = (state: EditorState, key: string): EditorState => ({ ...state, pools: state.pools.filter(pool => pool.key !== key) })

export const updatePool = (state: EditorState, key: string, patch: Partial<Pick<EditorPool, 'name' | 'notes'>>): EditorState => ({
  ...state, pools: state.pools.map(pool => (pool.key === key ? { ...pool, ...patch } : pool)),
})

/**
 * "Start from Billing funding sources": the dates the sources carry (when they carry any) and one Core (flexible) pool holding their total, for the person to review. A starting point
 * only: the sources are never changed.
 */
export function startFromBilling(state: EditorState, hint: BillingSourcesHintDto, fallbackManagement: PlanType): EditorState {
  const dated: EditorState = { ...state, planStart: hint.planStart ?? state.planStart, planEnd: hint.planEnd ?? state.planEnd }
  const reproposed = resplitAll(dated).state
  return addCorePool(reproposed, hint.managementType ?? fallbackManagement, { totalText: moneyText(hint.total) })
}

// ── What the periods add up to ──────────────────────────────────────────

export interface PoolSums {
  /** What the periods add up to (null while an amount in them is blank or not an amount). */
  periodsPlan: number | null
  periodsSetAside: number | null
  typedPlan: number | null
  typedSetAside: number | null
  /** The periods no longer add up to what was typed for the pool. The save sends the periods: the server keeps no pool total. */
  planMismatch: boolean
  setAsideMismatch: boolean
  /** The box holds an amount but no period carries a set-aside, so a save would record none: the box was typed while an amount in the periods was blank, so there was nothing to spread over. */
  setAsideMissing: boolean
}

function sumOf(texts: string[]): number | null {
  const values = texts.map(moneyOf)
  return values.every((value): value is number => value !== null) ? sumAmounts(values) : null
}

export function poolSums(pool: EditorPool): PoolSums {
  const periodsPlan = pool.periods.length === 0 ? null : sumOf(pool.periods.map(period => period.planAmount))
  const withSetAside = pool.periods.filter(period => !isBlank(period.setAside))
  const periodsSetAside = withSetAside.length === 0 ? null : sumOf(withSetAside.map(period => period.setAside))
  const typedPlan = moneyOf(pool.totalText)
  const typedSetAside = setAsideOf(pool)
  return {
    periodsPlan, periodsSetAside, typedPlan, typedSetAside,
    planMismatch: periodsPlan !== null && typedPlan !== null && toCents(periodsPlan) !== toCents(typedPlan),
    setAsideMismatch: periodsSetAside !== null && typedSetAside !== null && toCents(periodsSetAside) !== toCents(typedSetAside),
    setAsideMissing: typedSetAside !== null && pool.periods.length > 0 && withSetAside.length === 0,
  }
}

// ── What is wrong, in plain words ───────────────────────────────────────

export interface PoolProblems {
  name?: string
  notes?: string
  total?: string
  setAside?: string
  /** By period index. */
  periods: Record<number, { planAmount?: string; setAside?: string }>
  general: string[]
}

export interface Problems {
  planStart?: string
  planEnd?: string
  confirmedByName?: string
  notes?: string
  /** Problems with the plan as a whole ("Add at least one pool"). */
  general: string[]
  pools: Record<string, PoolProblems>
  /** True when there is anything to put right before the plan can be saved. */
  any: boolean
}

const NOT_AN_AMOUNT = 'Enter dollars and cents, like 8000.00.'
const TOO_LARGE = 'The most a plan amount can be is $99,999,999.99.'
/** A set-aside typed in the box that no period carries (the periods are what is saved, so it would be saved as none). Also said live, beside the periods, as soon as it is so. */
export const SET_ASIDE_NOT_APPLIED = 'The set-aside is not on any period yet. Split again from the plan amount to apply it.'

function amountProblem(text: string, required: boolean, requiredMessage: string): string | undefined {
  if (isBlank(text)) return required ? requiredMessage : undefined
  const value = moneyOf(text)
  if (value === null) return NOT_AN_AMOUNT
  return value > MAX_AMOUNT ? TOO_LARGE : undefined
}

function dayProblem(text: string, missing: string): string | undefined {
  if (isBlank(text)) return missing
  return parseDateOnly(text) === null ? 'That is not a real date.' : undefined
}

export function validate(state: EditorState): Problems {
  const problems: Problems = { general: [], pools: {}, any: false }

  problems.planStart = dayProblem(state.planStart, 'Give the day the plan starts.')
  problems.planEnd = dayProblem(state.planEnd, 'Give the day the plan ends.')
  const start = parseDateOnly(state.planStart)
  const end = parseDateOnly(state.planEnd)
  if (!problems.planEnd && start !== null && end !== null) {
    if (end < start) problems.planEnd = 'The plan cannot end before it starts.'
    else if (end - start + 1 > MAX_PLAN_DAYS) problems.planEnd = `A plan can run at most ${MAX_PLAN_DAYS} days.`
  }
  if (state.confirmedByName.trim().length > 200) problems.confirmedByName = 'At most 200 characters.'
  if (state.notes.trim().length > 2000) problems.notes = 'At most 2000 characters.'
  if (state.pools.length === 0) problems.general.push('Add at least one pool from the plan.')

  for (const pool of state.pools) {
    const found: PoolProblems = { periods: {}, general: [] }
    if (pool.name.trim().length > 200) found.name = 'At most 200 characters.'
    if (pool.notes.trim().length > 1000) found.notes = 'At most 1000 characters.'
    found.total = amountProblem(pool.totalText, true, 'Give the plan amount for the whole plan.')
    found.setAside = amountProblem(pool.setAsideText, false, '')
    const total = moneyOf(pool.totalText)
    const setAside = setAsideOf(pool)
    if (!found.setAside && total !== null && setAside !== null && toCents(setAside) > toCents(total)) found.setAside = 'The set-aside cannot be more than the plan amount.'

    // With funding periods each one carries its own amounts, and they are what is saved. With none the single period is the totals themselves, so there is nothing more to check.
    if (state.periodLengthMonths !== null) {
      const anySetAside = pool.periods.some(period => !isBlank(period.setAside))
      pool.periods.forEach((period, index) => {
        const row: { planAmount?: string; setAside?: string } = {}
        row.planAmount = amountProblem(period.planAmount, true, 'Enter an amount.')
        if (anySetAside && isBlank(period.setAside)) row.setAside = 'Give a set-aside for every period, or for none.'
        else row.setAside = amountProblem(period.setAside, false, '')
        const planValue = moneyOf(period.planAmount)
        const asideValue = moneyOf(period.setAside)
        if (!row.setAside && planValue !== null && asideValue !== null && toCents(asideValue) > toCents(planValue)) row.setAside = 'More than the plan amount.'
        if (row.planAmount || row.setAside) found.periods[index] = row
      })
      if (!found.setAside && poolSums(pool).setAsideMissing) found.general.push(SET_ASIDE_NOT_APPLIED)
    }

    if (found.name || found.notes || found.total || found.setAside || found.general.length > 0 || Object.keys(found.periods).length > 0) problems.pools[pool.key] = found
  }

  problems.any = Boolean(problems.planStart || problems.planEnd || problems.confirmedByName || problems.notes || problems.general.length > 0 || Object.keys(problems.pools).length > 0)
  return problems
}

// ── The request ─────────────────────────────────────────────────────────

const clean = (text: string): string | undefined => (text.trim() === '' ? undefined : text.trim())

/** The body of the save: the plan's fields and every pool with its periods. Only for a state `validate` found nothing wrong with. */
export function toSaveBody(state: EditorState): SaveFundingPlanDto {
  return {
    planStart: state.planStart,
    planEnd: state.planEnd,
    ...(clean(state.reassessmentDate) ? { reassessmentDate: state.reassessmentDate } : {}),
    ...(state.periodLengthMonths === null ? {} : { periodLengthMonths: state.periodLengthMonths }),
    evidence: state.evidence,
    ...(clean(state.confirmedOn) ? { confirmedOn: state.confirmedOn } : {}),
    ...(clean(state.confirmedByName) ? { confirmedByName: clean(state.confirmedByName) } : {}),
    ...(clean(state.notes) ? { notes: clean(state.notes) } : {}),
    ...(state.revision === undefined ? {} : { revision: state.revision }),
    pools: state.pools.map(pool => ({
      kind: pool.kind,
      paceCategory: pool.paceCategory,
      managementType: pool.managementType,
      ...(clean(pool.name) ? { name: clean(pool.name) } : {}),
      ...(clean(pool.notes) ? { notes: clean(pool.notes) } : {}),
      periods: state.periodLengthMonths === null
        ? [{ periodStart: state.planStart, periodEnd: state.planEnd, planAmount: moneyOf(pool.totalText) as number, ...(setAsideOf(pool) === null ? {} : { setAside: setAsideOf(pool) as number }) }]
        : pool.periods.map(period => ({
          periodStart: period.periodStart, periodEnd: period.periodEnd, planAmount: moneyOf(period.planAmount) as number,
          ...(isBlank(period.setAside) ? {} : { setAside: moneyOf(period.setAside) as number }),
        })),
    })),
  }
}
