import { describe, expect, it } from 'vitest'
import type { FundingPlanDto } from '@/api/types'
import {
  addCorePool, addStatedPool, editorStateFromPlan, emptyEditorState, hasPool, moneyOf, moneyText, nextPlanState, noPeriodsReason, poolSums, removePool, resplit, SET_ASIDE_NOT_APPLIED, setAsideOf,
  startFromBilling, toSaveBody, validate, withPeriodEdit, withPlanFields, withPoolTotals, withSetAsideZeroConfirmed, type EditorState,
} from './fundingEditorState'

// The editor's form as plain data: what the person typed, how the periods follow the dates and the totals, what is wrong in plain words, and the body that is saved.

const yearPlan = (): EditorState => ({ ...emptyEditorState(), planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3 })

describe('money as typed', () => {
  it('reads dollars and cents however a person writes them, and nothing else', () => {
    expect(moneyOf('8000')).toBe(8000)
    expect(moneyOf('8,000.50')).toBe(8000.5)
    expect(moneyOf(' $1,234.5 ')).toBe(1234.5)
    expect(moneyOf('0')).toBe(0)
    expect(['', ' ', 'abc', '12.345', '-5', '1e3', '$', '1.', '.5'].map(moneyOf)).toEqual([null, null, null, null, null, null, null, null, null])
    expect(moneyText(8000)).toBe('8000.00')
  })
})

describe('adding pools', () => {
  it('adds a Core (flexible) pool and works its periods out from the plan dates', () => {
    const state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })

    const pool = state.pools[0]
    expect(pool).toMatchObject({ kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: '', totalText: '8000', edited: false })
    expect(pool.periods.map(p => [p.periodStart, p.periodEnd, p.planAmount])).toEqual([
      ['2026-07-01', '2026-09-30', '2016.44'], ['2026-10-01', '2026-12-31', '2016.44'], ['2027-01-01', '2027-03-31', '1972.60'], ['2027-04-01', '2027-06-30', '1994.52'],
    ])
  })

  it('adds a stated pool for a category, with periods but no amounts until one is typed', () => {
    const state = addStatedPool(yearPlan(), { number: 15 }, 'AgencyManaged')

    expect(state.pools[0]).toMatchObject({ kind: 'Stated', paceCategory: 15, managementType: 'AgencyManaged' })
    expect(state.pools[0].periods).toHaveLength(4)
    expect(state.pools[0].periods.every(p => p.planAmount === '')).toBe(true)
  })

  it('holds each category once per management type: a second of the same is refused, a different management type is a different pool', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged')
    state = addCorePool(state, 'PlanManaged')
    expect(state.pools).toHaveLength(1)
    expect(hasPool(state, 0, 'PlanManaged')).toBe(true)

    state = addCorePool(state, 'AgencyManaged')
    state = addStatedPool(state, { number: 15 }, 'PlanManaged')
    state = addStatedPool(state, { number: 15 }, 'AgencyManaged')
    state = addStatedPool(state, { number: 15 }, 'AgencyManaged')
    expect(state.pools).toHaveLength(4)
  })

  it('removes a pool by its key, leaving the others', () => {
    const state = addStatedPool(addCorePool(yearPlan(), 'PlanManaged'), { number: 9 }, 'PlanManaged')

    expect(removePool(state, state.pools[0].key).pools.map(p => p.paceCategory)).toEqual([9])
  })
})

describe('the periods follow the plan until a person edits them', () => {
  it('re-splits when the typed total changes, while no period has been edited', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    state = withPoolTotals(state, state.pools[0].key, { totalText: '4000', setAsideText: '2000' })

    expect(state.pools[0].periods.map(p => p.planAmount)).toEqual(['1008.22', '1008.22', '986.30', '997.26'])
    expect(state.pools[0].periods.map(p => p.setAside)).toEqual(['504.11', '504.11', '493.15', '498.63'])
  })

  it('leaves every period alone once one has been edited, and says the periods no longer add up to the total', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    state = withPeriodEdit(state, state.pools[0].key, 3, { planAmount: '2500.00' })
    state = withPoolTotals(state, state.pools[0].key, { totalText: '9000' })

    expect(state.pools[0].edited).toBe(true)
    expect(state.pools[0].periods[3].planAmount).toBe('2500.00')
    expect(state.pools[0].periods[0].planAmount).toBe('2016.44')
    const sums = poolSums(state.pools[0])
    expect(sums).toMatchObject({ periodsPlan: 8505.48, typedPlan: 9000, planMismatch: true })
  })

  it('shows no mismatch while the periods add up to the typed total', () => {
    const state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })

    expect(poolSums(state.pools[0])).toMatchObject({ periodsPlan: 8000, typedPlan: 8000, planMismatch: false, setAsideMismatch: false })
  })

  it('re-splits from the totals on request, which clears the edit', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    state = withPeriodEdit(state, state.pools[0].key, 0, { planAmount: '1.00' })

    const fresh = resplit(state, state.pools[0])

    expect(fresh.edited).toBe(false)
    expect(fresh.periods[0].planAmount).toBe('2016.44')
  })

  it('works every pool out again when the plan dates or the period length change, and reports when that overwrote amounts someone typed', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    const untouched = withPlanFields(state, { periodLengthMonths: 6 })
    expect(untouched.rewroteEdits).toBe(false)
    expect(untouched.state.pools[0].periods).toHaveLength(2)

    state = withPeriodEdit(state, state.pools[0].key, 0, { planAmount: '100.00' })
    const rewrote = withPlanFields(state, { planEnd: '2027-03-31' })
    expect(rewrote.rewroteEdits).toBe(true)
    expect(rewrote.state.pools[0].periods.map(p => p.periodEnd)).toEqual(['2026-09-30', '2026-12-31', '2027-03-31'])
    expect(rewrote.state.pools[0].edited).toBe(false)
  })

  it('does not rewrite anything for a change that is not to the dates or the length', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    state = withPeriodEdit(state, state.pools[0].key, 0, { planAmount: '100.00' })

    const { state: next, rewroteEdits } = withPlanFields(state, { notes: 'a note', evidence: 'PlanManager' })

    expect(rewroteEdits).toBe(false)
    expect(next.pools[0].periods[0].planAmount).toBe('100.00')
  })

  it('is one period for a plan with no funding periods, equal to the totals', () => {
    const state = addCorePool({ ...yearPlan(), periodLengthMonths: null }, 'PlanManaged', { totalText: '8000', setAsideText: '6000' })

    expect(state.pools[0].periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: '8000.00', setAside: '6000.00' }])
  })
})

describe('start from Billing funding sources', () => {
  it('takes the sources dates and adds one Core (flexible) pool holding their total, for review', () => {
    const state = startFromBilling(emptyEditorState(), { total: 25100.5, planStart: '2026-07-01', planEnd: '2027-06-30', managementType: 'PlanManaged', rows: [] }, 'SelfManaged')

    expect(state).toMatchObject({ planStart: '2026-07-01', planEnd: '2027-06-30' })
    expect(state.pools).toHaveLength(1)
    expect(state.pools[0]).toMatchObject({ kind: 'CoreFlexible', managementType: 'PlanManaged', totalText: '25100.50' })
    expect(state.pools[0].periods).toHaveLength(4)
  })

  it('keeps the dates already typed when the sources carry none, and falls back to the participant’s plan type', () => {
    const start = { ...emptyEditorState(), planStart: '2026-08-01', planEnd: '2027-07-31' }

    const state = startFromBilling(start, { total: 1000, rows: [] }, 'SelfManaged')

    expect(state).toMatchObject({ planStart: '2026-08-01', planEnd: '2027-07-31' })
    expect(state.pools[0].managementType).toBe('SelfManaged')
  })
})

describe('recording the next plan', () => {
  it('starts the day after the last one ended, runs a year, and keeps the period length', () => {
    expect(nextPlanState({ planEnd: '2027-06-30', periodLengthMonths: 3 })).toMatchObject({ planStart: '2027-07-01', planEnd: '2028-06-30', periodLengthMonths: 3, pools: [] })
    expect(nextPlanState({ planEnd: '2027-06-30', periodLengthMonths: undefined })).toMatchObject({ periodLengthMonths: null })
    expect(nextPlanState({ planEnd: '2027-02-28', periodLengthMonths: 1 })).toMatchObject({ planStart: '2027-03-01', planEnd: '2028-02-29' })
  })

  it('starts empty for a participant with no plan yet', () => {
    expect(nextPlanState(undefined)).toMatchObject({ planStart: '', planEnd: '', periodLengthMonths: 3, evidence: 'PlanCopy', pools: [] })
  })
})

describe('editing a stored plan', () => {
  const stored: FundingPlanDto = {
    id: 'plan-1', participantId: 'p1', planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3, reassessmentDate: '2027-05-01', evidence: 'PlanManager',
    confirmedOn: '2026-09-20', confirmedByName: 'Priya', notes: 'From the plan manager.', revision: 4, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
    pools: [{
      id: 'pool-1', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', planTotal: 8000, setAsideTotal: 5000,
      periods: [
        { id: 'a', position: 0, periodStart: '2026-07-01', periodEnd: '2026-12-31', planAmount: 5000, setAside: 3000 },
        { id: 'b', position: 1, periodStart: '2027-01-01', periodEnd: '2027-06-30', planAmount: 3000, setAside: 2000 },
      ],
    }],
  }

  it('shows every figure as text, keeps the periods as saved, and carries the revision it was loaded at', () => {
    const state = editorStateFromPlan(stored)

    expect(state).toMatchObject({ planStart: '2026-07-01', evidence: 'PlanManager', confirmedByName: 'Priya', revision: 4, reassessmentDate: '2027-05-01' })
    expect(state.pools[0]).toMatchObject({ name: 'Core (flexible)', totalText: '8000.00', setAsideText: '5000.00', edited: true })
    expect(state.pools[0].periods.map(p => [p.planAmount, p.setAside])).toEqual([['5000.00', '3000.00'], ['3000.00', '2000.00']])
  })

  it('sends the same plan back unchanged: the body of an untouched edit is the stored plan, with its revision', () => {
    expect(toSaveBody(editorStateFromPlan(stored))).toEqual({
      planStart: '2026-07-01', planEnd: '2027-06-30', reassessmentDate: '2027-05-01', periodLengthMonths: 3, evidence: 'PlanManager', confirmedOn: '2026-09-20', confirmedByName: 'Priya',
      notes: 'From the plan manager.', revision: 4,
      pools: [{
        kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)',
        periods: [
          { periodStart: '2026-07-01', periodEnd: '2026-12-31', planAmount: 5000, setAside: 3000 },
          { periodStart: '2027-01-01', periodEnd: '2027-06-30', planAmount: 3000, setAside: 2000 },
        ],
      }],
    })
  })
})

describe('what is wrong, in plain words', () => {
  const good = (): EditorState => addStatedPool(addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' }), { number: 15 }, 'AgencyManaged')
  const withTotal = (state: EditorState, index: number, totalText: string) => withPoolTotals(state, state.pools[index].key, { totalText })

  it('finds nothing wrong with a complete plan', () => {
    const state = withTotal(good(), 1, '1200')

    const found = validate(state)
    expect(found.any).toBe(false)
    expect(found.general).toEqual([])
    expect(Object.keys(found.pools)).toEqual([])
  })

  it('asks for the plan dates, and says when they are the wrong way round or too far apart', () => {
    expect(validate(emptyEditorState())).toMatchObject({ planStart: 'Give the day the plan starts.', planEnd: 'Give the day the plan ends.', any: true })
    expect(validate({ ...yearPlan(), planStart: '2027-06-30', planEnd: '2026-07-01' }).planEnd).toBe('The plan cannot end before it starts.')
    expect(validate({ ...yearPlan(), planEnd: '2028-09-08' }).planEnd).toBe('A plan can run at most 800 days.')
    expect(validate({ ...yearPlan(), planEnd: '2028-09-07' }).planEnd).toBeUndefined()   // exactly 800 days
    expect(validate({ ...yearPlan(), planStart: '2026-02-30' }).planStart).toBe('That is not a real date.')
  })

  it('wants a pool', () => {
    expect(validate(yearPlan()).general).toEqual(['Add at least one pool from the plan.'])
  })

  it('wants an amount for each pool, in dollars and cents, and not more than a plan amount can be', () => {
    let state = good()
    state = withTotal(state, 0, '')
    state = withTotal(state, 1, '12.345')
    expect(validate(state).pools[state.pools[0].key].total).toBe('Give the plan amount for the whole plan.')
    expect(validate(state).pools[state.pools[1].key].total).toBe('Enter dollars and cents, like 8000.00.')
    const big = withTotal(good(), 0, '100000000')
    expect(validate(big).pools[big.pools[0].key].total).toBe('The most a plan amount can be is $99,999,999.99.')
  })

  it('says a set-aside cannot be more than the plan amount, at the pool and on a period', () => {
    let state = withTotal(good(), 1, '1000')
    state = withPoolTotals(state, state.pools[1].key, { setAsideText: '1500' })
    expect(validate(state).pools[state.pools[1].key].setAside).toBe('The set-aside cannot be more than the plan amount.')

    let edited = withTotal(good(), 1, '1000')
    edited = withPeriodEdit(edited, edited.pools[1].key, 0, { setAside: '999999' })
    const row = validate(edited).pools[edited.pools[1].key].periods
    expect(row[0].setAside).toBe('More than the plan amount.')
    expect(row[1].setAside).toBe('Give a set-aside for every period, or for none.')   // the others have none: all or none
  })

  it('says what is wrong with a period amount that was edited into nothing', () => {
    let state = withTotal(good(), 1, '1000')
    state = withPeriodEdit(state, state.pools[1].key, 2, { planAmount: '' })

    expect(validate(state).pools[state.pools[1].key].periods[2].planAmount).toBe('Enter an amount.')
  })

  it('does not look at periods for a plan with no funding periods, whose single period is the totals', () => {
    const state = addCorePool({ ...yearPlan(), periodLengthMonths: null }, 'PlanManaged', { totalText: '8000' })

    expect(validate(state).any).toBe(false)
  })

  it('limits the lengths of the free-text fields', () => {
    const state = { ...good(), notes: 'x'.repeat(2001), confirmedByName: 'y'.repeat(201) }

    expect(validate(state)).toMatchObject({ notes: 'At most 2000 characters.', confirmedByName: 'At most 200 characters.' })
  })
})

/** A typed amount as a number, 0 for none, for comparing two columns of figures. */
const toNumber = (text: string): number => moneyOf(text) ?? 0

describe('the set-aside box agrees with the periods, in whichever order it is typed', () => {
  /** A Core (flexible) pool whose four periods were all set by hand, to the amounts given, so the expected set-asides are exact. */
  const byHand = (amounts: string[], setAsideText = ''): EditorState => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000' })
    amounts.forEach((planAmount, index) => { state = withPeriodEdit(state, state.pools[0].key, index, { planAmount }) })
    return withPoolTotals(state, state.pools[0].key, { setAsideText })
  }
  const asides = (state: EditorState) => state.pools[0].periods.map(period => period.setAside)

  it('spreads a set-aside typed AFTER a period was edited over every period, in proportion to their plan amounts', () => {
    const state = byHand(['1000.00', '2000.00', '500.00', '500.00'], '800')

    expect(asides(state)).toEqual(['200.00', '400.00', '100.00', '100.00'])
    expect(poolSums(state.pools[0])).toMatchObject({ periodsSetAside: 800, typedSetAside: 800, setAsideMismatch: false })
    expect(toSaveBody(state).pools[0].periods.map(p => p.setAside)).toEqual([200, 400, 100, 100])   // the box is what is saved: never dropped
  })

  it('keeps a set-aside typed BEFORE a period was edited, and spreads a new one over the amounts as they are now', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000', setAsideText: '800' })
    state = withPeriodEdit(state, state.pools[0].key, 1, { planAmount: '3000.00' })

    expect(poolSums(state.pools[0]).periodsSetAside).toBe(800)   // the edit changed an amount, not the set-aside
    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '600' })

    expect(poolSums(state.pools[0])).toMatchObject({ periodsSetAside: 600, typedSetAside: 600, setAsideMismatch: false })
    expect(state.pools[0].periods.every(p => toNumber(p.setAside) <= toNumber(p.planAmount))).toBe(true)
  })

  it('leaves set-asides typed into the periods by hand alone when the box is retyped, says they no longer add up to it, and lets "Split again" apply the box (the plan-amount box does the same)', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'], '400')
    state = withPeriodEdit(state, state.pools[0].key, 0, { setAside: '10.00' })
    expect(poolSums(state.pools[0])).toMatchObject({ periodsSetAside: 310, typedSetAside: 400, setAsideMismatch: true })   // the box says 400, the periods add up to 310: said in words

    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '200' })

    expect(asides(state)).toEqual(['10.00', '100.00', '100.00', '100.00'])   // the person's own figure and the rest as they were: nothing overwritten
    expect(poolSums(state.pools[0])).toMatchObject({ periodsSetAside: 310, typedSetAside: 200, setAsideMismatch: true })
    expect(poolSums(state.pools[0]).setAsideMissing).toBe(false)

    const applied = resplit(state, state.pools[0])   // "Split again from the plan amount": the box is applied (and the amounts are split by days again)
    expect(poolSums(applied)).toMatchObject({ periodsPlan: 4000, periodsSetAside: 200, typedSetAside: 200, planMismatch: false, setAsideMismatch: false, setAsideMissing: false })
    expect(applied.periods.map(period => period.setAside)).toEqual(['50.41', '50.41', '49.32', '49.86'])   // 200 over 92, 92, 90 and 91 days
  })

  it('keeps the uneven set-asides of a saved plan when its box is corrected, and says they no longer add up to it', () => {
    const stored: FundingPlanDto = {
      id: 'plan-1', participantId: 'p1', planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 6, evidence: 'PlanCopy', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      pools: [{
        id: 'pool-1', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', planTotal: 10000, setAsideTotal: 8000,
        periods: [
          { id: 'a', position: 0, periodStart: '2026-07-01', periodEnd: '2026-12-31', planAmount: 6000, setAside: 5000 },
          { id: 'b', position: 1, periodStart: '2027-01-01', periodEnd: '2027-06-30', planAmount: 4000, setAside: 3000 },
        ],
      }],
    }
    const loaded = editorStateFromPlan(stored)

    const corrected = withPoolTotals(loaded, loaded.pools[0].key, { setAsideText: '8100' })   // or just backspaced and retyped

    expect(corrected.pools[0].periods.map(period => period.setAside)).toEqual(['5000.00', '3000.00'])   // the plan's own release schedule survives
    expect(poolSums(corrected.pools[0])).toMatchObject({ periodsSetAside: 8000, typedSetAside: 8100, setAsideMismatch: true })
    expect(validate(corrected).any).toBe(false)   // a mismatch is said, not refused: the periods are what is saved
  })

  it('lets the cells that came from the box follow it as it is typed, digit by digit', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'])

    for (const typed of ['8', '80', '800']) state = withPoolTotals(state, state.pools[0].key, { setAsideText: typed })

    expect(asides(state)).toEqual(['200.00', '200.00', '200.00', '200.00'])   // not left at the first digit's 2.00 with a message
    expect(poolSums(state.pools[0])).toMatchObject({ periodsSetAside: 800, typedSetAside: 800, setAsideMismatch: false })
  })

  it('follows the box again once every set-aside the person typed has been cleared away by hand', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'])
    for (const index of [0, 1, 2, 3]) state = withPeriodEdit(state, state.pools[0].key, index, { setAside: '10.00' })
    for (const index of [0, 1, 2, 3]) state = withPeriodEdit(state, state.pools[0].key, index, { setAside: '' })   // none left: nothing of the person's to protect

    for (const typed of ['8', '80']) state = withPoolTotals(state, state.pools[0].key, { setAsideText: typed })

    expect(asides(state)).toEqual(['20.00', '20.00', '20.00', '20.00'])
  })

  it('clears the cells when the box is cleared, whether they came from the box or were typed by hand (the person said none)', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'], '400')
    state = withPeriodEdit(state, state.pools[0].key, 1, { setAside: '10.00' })   // one is now the person's own

    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '' })

    expect(asides(state)).toEqual(['', '', '', ''])
    expect(state.pools[0].setAsideByHand).toBe(false)
  })

  it('removes the set-aside from every period of an edited pool when the box is cleared, and from a pool that still follows its totals', () => {
    const edited = byHand(['1000.00', '2000.00', '500.00', '500.00'], '800')
    expect(asides(edited)).toEqual(['200.00', '400.00', '100.00', '100.00'])   // there is something to clear
    const cleared = withPoolTotals(edited, edited.pools[0].key, { setAsideText: '' })
    expect(asides(cleared)).toEqual(['', '', '', ''])
    expect(poolSums(cleared.pools[0])).toMatchObject({ periodsSetAside: null, typedSetAside: null, setAsideMismatch: false })
    expect(toSaveBody(cleared).pools[0].periods.some(p => 'setAside' in p)).toBe(false)   // the saved plan has no set-aside, which is what clearing the box says

    const following = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000', setAsideText: '800' })
    const followingCleared = withPoolTotals(following, following.pools[0].key, { setAsideText: '' })
    expect(asides(followingCleared)).toEqual(['', '', '', ''])
  })

  it('leaves set-asides typed into the periods alone while the box was never filled in', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'])
    state = [0, 1, 2, 3].reduce((next, index) => withPeriodEdit(next, next.pools[0].key, index, { setAside: '100.00' }), state)

    const same = withPoolTotals(state, state.pools[0].key, { setAsideText: '' })   // blank to blank: nothing was cleared

    expect(asides(same)).toEqual(['100.00', '100.00', '100.00', '100.00'])
    expect(poolSums(same.pools[0])).toMatchObject({ periodsSetAside: 400, typedSetAside: null, setAsideMismatch: false })
  })

  it('waits for a whole amount: a half-typed one changes nothing, and the finished one is applied', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'])

    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '4.' })
    expect(asides(state)).toEqual(['', '', '', ''])
    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '4.5' })
    expect(asides(state)).toEqual(['1.13', '1.13', '1.13', '1.11'])   // 450 cents over four equal amounts: each but the last rounds to 113, the last takes the 111 left
    expect(poolSums(state.pools[0]).periodsSetAside).toBe(4.5)
  })

  it('says a set-aside above the plan amount is too much, and never puts more on a period than its plan amount when it is not', () => {
    const tooMuch = byHand(['1000.00', '1000.00', '1000.00', '1000.00'], '5000')
    expect(validate(tooMuch).pools[tooMuch.pools[0].key].setAside).toBe('The set-aside cannot be more than the plan amount.')

    const all = byHand(['1000.00', '1000.00', '1000.00', '1000.00'], '4000')
    expect(asides(all)).toEqual(['1000.00', '1000.00', '1000.00', '1000.00'])
    expect(validate(all).any).toBe(false)
  })

  it('spreads a set-aside typed on a stored pool over the periods as saved', () => {
    const stored: FundingPlanDto = {
      id: 'plan-1', participantId: 'p1', planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 6, evidence: 'PlanCopy', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      pools: [{
        id: 'pool-1', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', planTotal: 8000,
        periods: [
          { id: 'a', position: 0, periodStart: '2026-07-01', periodEnd: '2026-12-31', planAmount: 5000 },
          { id: 'b', position: 1, periodStart: '2027-01-01', periodEnd: '2027-06-30', planAmount: 3000 },
        ],
      }],
    }
    const loaded = editorStateFromPlan(stored)
    expect(loaded.pools[0].periods.map(p => p.setAside)).toEqual(['', ''])   // the plan records none

    const typed = withPoolTotals(loaded, loaded.pools[0].key, { setAsideText: '4000' })

    expect(typed.pools[0].periods.map(p => p.setAside)).toEqual(['2500.00', '1500.00'])   // 4000 in proportion to 5000 and 3000
  })
})

describe('a set-aside typed where no period can carry it', () => {
  /** An edited pool whose second period's amount was cleared to retype it, with the box typed meanwhile (so there was nothing to spread over), then the amount retyped. */
  const typedOverABlank = (): EditorState => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000' })
    state = withPeriodEdit(state, state.pools[0].key, 1, { planAmount: '' })
    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '4000' })
    return withPeriodEdit(state, state.pools[0].key, 1, { planAmount: '1008.22' })
  }

  it('is said in plain words once the box holds an amount and no period carries a set-aside (a save would record none)', () => {
    const state = typedOverABlank()
    const pool = state.pools[0]

    expect(pool.periods.map(period => period.setAside)).toEqual(['', '', '', ''])
    expect(poolSums(pool)).toMatchObject({ periodsSetAside: null, typedSetAside: 4000, setAsideMissing: true })
    expect(validate(state).pools[pool.key].general).toEqual([SET_ASIDE_NOT_APPLIED])
    expect(validate(state).any).toBe(true)
    expect(SET_ASIDE_NOT_APPLIED).toBe('The set-aside is not on any period yet. Split again from the plan amount to apply it.')
  })

  it('goes away when "Split again" applies the box, and when the box is cleared', () => {
    const state = typedOverABlank()
    const applied: EditorState = { ...state, pools: [resplit(state, state.pools[0])] }
    expect(poolSums(applied.pools[0]).setAsideMissing).toBe(false)
    expect(validate(applied).any).toBe(false)
    expect(toSaveBody(applied).pools[0].periods.map(p => p.setAside)).toEqual([1008.22, 1008.22, 986.3, 997.26])   // the box is what is saved: 4000 is the whole plan amount

    const cleared = withPoolTotals(state, state.pools[0].key, { setAsideText: '' })
    expect(poolSums(cleared.pools[0]).setAsideMissing).toBe(false)
    expect(validate(cleared).any).toBe(false)
  })

  it('says nothing while the box is blank or unreadable (that has its own message), and nothing when a period carries one', () => {
    const state = typedOverABlank()
    const key = state.pools[0].key

    expect(poolSums(withPoolTotals(state, key, { setAsideText: '' }).pools[0]).setAsideMissing).toBe(false)
    const unreadable = withPoolTotals(state, key, { setAsideText: 'lots' })
    expect(poolSums(unreadable.pools[0]).setAsideMissing).toBe(false)
    expect(validate(unreadable).pools[key]).toEqual({ periods: {}, general: [], setAside: 'Enter dollars and cents, like 8000.00.' })
    const carried = withPeriodEdit(state, key, 0, { setAside: '100.00' })
    expect(poolSums(carried.pools[0]).setAsideMissing).toBe(false)

    // Over the plan amount, and still on no period: the message beside the box says so, and the second message does not pile on.
    let tooMuch = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000' })
    tooMuch = withPeriodEdit(tooMuch, tooMuch.pools[0].key, 1, { planAmount: '' })
    tooMuch = withPoolTotals(tooMuch, tooMuch.pools[0].key, { setAsideText: '9000' })
    expect(poolSums(tooMuch.pools[0]).setAsideMissing).toBe(true)
    expect(validate(tooMuch).pools[tooMuch.pools[0].key]).toMatchObject({ setAside: 'The set-aside cannot be more than the plan amount.', general: [], periods: { 1: { planAmount: 'Enter an amount.' } } })
  })

  it('does not apply when the whole plan is one period: the box is the set-aside itself', () => {
    const wholePlan = addCorePool({ ...yearPlan(), periodLengthMonths: null }, 'PlanManaged', { totalText: '4000', setAsideText: '400' })

    expect(validate(wholePlan).any).toBe(false)
    expect(toSaveBody(wholePlan).pools[0].periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 4000, setAside: 400 }])
  })
})

describe('what the form remembers about a pool\'s periods', () => {
  it('knows periods read from a saved plan from periods worked out here, and whether an amount was changed by hand since', () => {
    const proposed = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    expect(proposed.pools[0]).toMatchObject({ edited: false, fromPlan: false, touched: false })

    const changed = withPeriodEdit(proposed, proposed.pools[0].key, 0, { planAmount: '1.00' })
    expect(changed.pools[0]).toMatchObject({ edited: true, fromPlan: false, touched: true })

    const again = resplit(changed, changed.pools[0])
    expect(again).toMatchObject({ edited: false, fromPlan: false, touched: false })
  })

  it('knows a set-aside typed into a period (or stored with the plan) from shares worked out from the box', () => {
    const proposed = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000', setAsideText: '800' })
    expect(proposed.pools[0].setAsideByHand).toBe(false)   // worked out from the box

    const amountOnly = withPeriodEdit(proposed, proposed.pools[0].key, 0, { planAmount: '1.00' })
    expect(amountOnly.pools[0].setAsideByHand).toBe(false)   // an amount is not a set-aside

    const typed = withPeriodEdit(amountOnly, proposed.pools[0].key, 1, { setAside: '5.00' })
    expect(typed.pools[0].setAsideByHand).toBe(true)
    expect(withPeriodEdit(typed, proposed.pools[0].key, 1, { planAmount: '9.00' }).pools[0].setAsideByHand).toBe(true)   // and stays so

    expect(resplit(typed, typed.pools[0]).setAsideByHand).toBe(false)   // "Split again" works them out from the box again
    expect(withPoolTotals(typed, typed.pools[0].key, { setAsideText: '' }).pools[0].setAsideByHand).toBe(false)   // as does clearing the box

    const stored = (setAside?: number) => editorStateFromPlan({
      id: 'plan-1', participantId: 'p1', planStart: '2026-07-01', planEnd: '2027-06-30', evidence: 'PlanCopy', revision: 1, createdAt: '', updatedAt: '',
      pools: [{ id: 'pool-1', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', planTotal: 100, periods: [{ id: 'a', position: 0, periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 100, setAside }] }],
    } as FundingPlanDto)
    expect(stored(40).pools[0].setAsideByHand).toBe(true)
    expect(stored(undefined).pools[0].setAsideByHand).toBe(false)
  })

  it('loads a stored pool as edited (its amounts are the plan\'s own) but not touched, until an amount is changed', () => {
    const stored = { id: 'plan-1', participantId: 'p1', planStart: '2026-07-01', planEnd: '2027-06-30', evidence: 'PlanCopy', revision: 1, createdAt: '', updatedAt: '', pools: [{
      id: 'pool-1', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', planTotal: 100,
      periods: [{ id: 'a', position: 0, periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 100 }],
    }] } as FundingPlanDto

    const loaded = editorStateFromPlan(stored)
    expect(loaded.pools[0]).toMatchObject({ edited: true, fromPlan: true, touched: false })
    expect(withPeriodEdit(loaded, loaded.pools[0].key, 0, { planAmount: '90.00' }).pools[0]).toMatchObject({ edited: true, fromPlan: true, touched: true })
  })
})

describe('why a pool shows no periods', () => {
  it('says the dates are missing, backwards, or more than a plan may run', () => {
    expect(noPeriodsReason({ planStart: '', planEnd: '2027-06-30' })).toBe('Give the plan’s dates to see its periods.')
    expect(noPeriodsReason({ planStart: '2026-02-30', planEnd: '2027-06-30' })).toBe('Give the plan’s dates to see its periods.')
    expect(noPeriodsReason({ planStart: '2027-06-30', planEnd: '2026-07-01' })).toBe('The plan ends before it starts, so there are no periods to show.')
    expect(noPeriodsReason({ planStart: '0002-07-01', planEnd: '2027-06-30' })).toBe('A plan can run at most 800 days, so no periods are shown. Check the plan’s dates.')
    expect(noPeriodsReason({ planStart: '2026-07-01', planEnd: '2028-09-08' })).toBe('A plan can run at most 800 days, so no periods are shown. Check the plan’s dates.')
  })
})

describe('a first plan starts from the dates the profile already holds', () => {
  it('prefills the plan dates from the profile when it has both, and not otherwise', () => {
    expect(nextPlanState(undefined, { start: '2026-07-01', end: '2027-06-30' })).toMatchObject({ planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3, pools: [] })
    expect(nextPlanState(undefined, { start: '2026-07-01' })).toMatchObject({ planStart: '', planEnd: '' })
    expect(nextPlanState(undefined, { end: '2027-06-30' })).toMatchObject({ planStart: '', planEnd: '' })
    expect(nextPlanState(undefined, {})).toMatchObject({ planStart: '', planEnd: '' })
    expect(nextPlanState(undefined, { start: 'soon', end: '2027-06-30' })).toMatchObject({ planStart: '', planEnd: '' })
  })

  it('lets the next plan follow the last one instead: the profile\'s dates are for a first plan only', () => {
    expect(nextPlanState({ planEnd: '2027-06-30', periodLengthMonths: 3 }, { start: '2020-01-01', end: '2020-12-31' })).toMatchObject({ planStart: '2027-07-01', planEnd: '2028-06-30' })
  })

  it('then proposes the periods as soon as a pool is added, with no dates typed', () => {
    const state = addCorePool(nextPlanState(undefined, { start: '2026-07-01', end: '2027-06-30' }), 'PlanManaged', { totalText: '8000' })

    expect(state.pools[0].periods).toHaveLength(4)
  })
})

describe('the request body', () => {
  it('sends the periods the form holds, one pool at a time, with the optional fields left out when blank', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    state = { ...state, confirmedByName: '  Priya  ', notes: '' }

    const body = toSaveBody(state)

    expect(body).toEqual({
      planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3, evidence: 'PlanCopy', confirmedByName: 'Priya',
      pools: [{
        kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged',
        periods: [
          { periodStart: '2026-07-01', periodEnd: '2026-09-30', planAmount: 2016.44 }, { periodStart: '2026-10-01', periodEnd: '2026-12-31', planAmount: 2016.44 },
          { periodStart: '2027-01-01', periodEnd: '2027-03-31', planAmount: 1972.6 }, { periodStart: '2027-04-01', periodEnd: '2027-06-30', planAmount: 1994.52 },
        ],
      }],
    })
  })

  it('sends periods only: edited amounts that no longer add up to the typed total go as they are', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    state = withPeriodEdit(state, state.pools[0].key, 0, { planAmount: '3000' })

    const periods = toSaveBody(state).pools[0].periods

    expect(periods.map(p => p.planAmount)).toEqual([3000, 2016.44, 1972.6, 1994.52])
    expect(JSON.stringify(toSaveBody(state))).not.toContain('8000')   // the typed total is not part of the request
  })

  it('sends the set-aside on every period, and one whole-plan period when there are no funding periods', () => {
    const periodic = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000', setAsideText: '2000' })
    expect(toSaveBody(periodic).pools[0].periods.every(p => typeof p.setAside === 'number')).toBe(true)

    const whole = addCorePool({ ...yearPlan(), periodLengthMonths: null }, 'PlanManaged', { totalText: '8000', setAsideText: '6000' })
    const body = toSaveBody(whole)
    expect(body).not.toHaveProperty('periodLengthMonths')
    expect(body.pools[0].periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 8000, setAside: 6000 }])
  })
})

describe('a typed zero in the set-aside box: "none", or "$0 allowed"?', () => {
  const zeroTyped = (): EditorState => {
    const state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000' })
    return withPoolTotals(state, state.pools[0].key, { setAsideText: '0' })
  }
  const confirmedZero = (): EditorState => {
    const state = zeroTyped()
    return withSetAsideZeroConfirmed(state, state.pools[0].key, true)
  }
  const asides = (state: EditorState) => state.pools[0].periods.map(period => period.setAside)

  it('is no set-aside at all until the person confirms it: no period carries one, nothing is sent and nothing is refused', () => {
    const state = zeroTyped()

    expect(state.pools[0].setAsideText).toBe('0')
    expect(asides(state)).toEqual(['', '', '', ''])
    expect(poolSums(state.pools[0])).toMatchObject({ typedSetAside: null, setAsideMissing: false, setAsideMismatch: false })
    expect(validate(state).any).toBe(false)
    expect(toSaveBody(state).pools[0].periods.every(period => !('setAside' in period))).toBe(true)
  })

  it('is read the same however the zero is written', () => {
    for (const text of ['0', '0.00', '$0', ' 0.0 ']) {
      const state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000' })
      const typed = withPoolTotals(state, state.pools[0].key, { setAsideText: text })
      expect(setAsideOf(typed.pools[0]), text).toBeNull()
    }
  })

  it('is a deliberate $0 once confirmed: every period carries 0.00 and every period is sent with a set-aside of 0', () => {
    const confirmed = confirmedZero()

    expect(asides(confirmed)).toEqual(['0.00', '0.00', '0.00', '0.00'])
    expect(setAsideOf(confirmed.pools[0])).toBe(0)
    expect(poolSums(confirmed.pools[0])).toMatchObject({ typedSetAside: 0, periodsSetAside: 0, setAsideMismatch: false, setAsideMissing: false })
    expect(validate(confirmed).any).toBe(false)
    expect(toSaveBody(confirmed).pools[0].periods.map(period => period.setAside)).toEqual([0, 0, 0, 0])
  })

  it('goes back to none when the confirmation is taken back: the zeros it spread are cleared', () => {
    const confirmed = confirmedZero()

    const undone = withSetAsideZeroConfirmed(confirmed, confirmed.pools[0].key, false)

    expect(asides(undone)).toEqual(['', '', '', ''])
    expect(toSaveBody(undone).pools[0].periods.every(period => !('setAside' in period))).toBe(true)
  })

  it('has to be confirmed again after the box held another figure (a confirmation is for the zero that was in front of the person)', () => {
    let state = confirmedZero()
    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '500' })
    expect(state.pools[0].setAsideZeroConfirmed).toBe(false)
    expect(poolSums(state.pools[0]).typedSetAside).toBe(500)

    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '0' })

    expect(setAsideOf(state.pools[0])).toBeNull()
    expect(asides(state)).toEqual(['', '', '', ''])   // the 500's shares were cleared, as when the box is cleared, and the zero is not yet a figure
  })

  it('stays confirmed while the box is still a zero, however it is written on the way', () => {
    let state = confirmedZero()
    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '0.00' })

    expect(state.pools[0].setAsideZeroConfirmed).toBe(true)
    expect(asides(state)).toEqual(['0.00', '0.00', '0.00', '0.00'])
  })

  it('applies to a pool whose periods were edited by hand: confirmed, it spreads over them without touching their amounts', () => {
    let state = addCorePool(yearPlan(), 'PlanManaged', { totalText: '4000' })
    state = withPeriodEdit(state, state.pools[0].key, 0, { planAmount: '3000.00' })
    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '0' })
    expect(asides(state)).toEqual(['', '', '', ''])

    state = withSetAsideZeroConfirmed(state, state.pools[0].key, true)

    expect(asides(state)).toEqual(['0.00', '0.00', '0.00', '0.00'])
    expect(state.pools[0].periods[0].planAmount).toBe('3000.00')
  })

  it('reads a saved plan whose set-asides are all $0 as a confirmed $0 (it is what was saved), and one with none or another figure as not', () => {
    const stored = (setAside?: number): FundingPlanDto => ({
      id: 'plan-1', participantId: 'p1', planStart: '2026-07-01', planEnd: '2026-12-31', periodLengthMonths: 6, evidence: 'PlanCopy', revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      pools: [{
        id: 'pool-1', position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', planTotal: 6000, ...(setAside === undefined ? {} : { setAsideTotal: setAside }),
        periods: [{ id: 'a', position: 0, periodStart: '2026-07-01', periodEnd: '2026-12-31', planAmount: 6000, ...(setAside === undefined ? {} : { setAside }) }],
      }],
    })

    const zero = editorStateFromPlan(stored(0))
    expect(zero.pools[0].setAsideZeroConfirmed).toBe(true)
    expect(toSaveBody(zero).pools[0].periods[0].setAside).toBe(0)
    expect(editorStateFromPlan(stored()).pools[0].setAsideZeroConfirmed).toBe(false)
    expect(editorStateFromPlan(stored(500)).pools[0].setAsideZeroConfirmed).toBe(false)
  })

  it('does the same for a plan with no funding periods, whose single period is the box itself', () => {
    const whole = addCorePool({ ...yearPlan(), periodLengthMonths: null }, 'PlanManaged', { totalText: '8000', setAsideText: '0' })

    expect(toSaveBody(whole).pools[0].periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 8000 }])
    const confirmed = withSetAsideZeroConfirmed(whole, whole.pools[0].key, true)
    expect(toSaveBody(confirmed).pools[0].periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 8000, setAside: 0 }])
  })
})
