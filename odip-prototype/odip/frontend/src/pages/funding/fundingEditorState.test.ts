import { describe, expect, it } from 'vitest'
import type { FundingPlanDto } from '@/api/types'
import {
  addCorePool, addStatedPool, editorStateFromPlan, emptyEditorState, hasPool, moneyOf, moneyText, nextPlanState, noPeriodsReason, poolSums, removePool, resplit, startFromBilling, toSaveBody, validate,
  withPeriodEdit, withPlanFields, withPoolTotals, type EditorState,
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

  it('re-spreads when the box is retyped, even over set-asides that were typed into the periods by hand: the box is the pool\'s set-aside', () => {
    let state = byHand(['1000.00', '1000.00', '1000.00', '1000.00'], '400')
    state = withPeriodEdit(state, state.pools[0].key, 0, { setAside: '10.00' })
    expect(poolSums(state.pools[0]).setAsideMismatch).toBe(true)   // the box says 400, the periods add up to 310: said in words

    state = withPoolTotals(state, state.pools[0].key, { setAsideText: '200' })

    expect(asides(state)).toEqual(['50.00', '50.00', '50.00', '50.00'])
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

describe('what the form remembers about a pool\'s periods', () => {
  it('knows periods read from a saved plan from periods worked out here, and whether an amount was changed by hand since', () => {
    const proposed = addCorePool(yearPlan(), 'PlanManaged', { totalText: '8000' })
    expect(proposed.pools[0]).toMatchObject({ edited: false, fromPlan: false, touched: false })

    const changed = withPeriodEdit(proposed, proposed.pools[0].key, 0, { planAmount: '1.00' })
    expect(changed.pools[0]).toMatchObject({ edited: true, fromPlan: false, touched: true })

    const again = resplit(changed, changed.pools[0])
    expect(again).toMatchObject({ edited: false, fromPlan: false, touched: false })
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
