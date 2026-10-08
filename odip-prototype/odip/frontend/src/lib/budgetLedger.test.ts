import { describe, expect, it } from 'vitest'
import { chipToneOf, claimBudgetLine, focusPeriodOf, money, poolSentence, quietEstimateLine, rowsByGroup, unpricedShiftSentence } from './budgetLedger'
import { formatDayMonth } from './dateRange'
import { ledgerPeriod, ledgerPool, ledgerRow } from '@/test/fixtures/ledger'

// How the ledger reads in words and figures: the strip's money, the one sentence per pool (over, to spare, with and without a set-aside), which period the strip is about, the rows in their
// three groups, and the claim's budget line. Pure, so the Funding tab, the claim modals and the claim page say the same thing.

describe('money', () => {
  it('writes whole dollars without cents and anything else with them, in the Australian format', () => {
    expect(money(8000)).toBe('$8,000')
    expect(money(3120.5)).toBe('$3,120.50')
    expect(money(0)).toBe('$0')
    expect(money(250000)).toBe('$250,000')
    expect(money(1234567.89)).toBe('$1,234,567.89')
  })

  it('writes a negative as a minus and never as "-$0"', () => {
    expect(money(-80)).toBe('-$80')
    expect(money(-0)).toBe('$0')
    expect(money(-0.001)).toBe('$0')
  })
})

describe('formatDayMonth', () => {
  it('is the day and the abbreviated month, with no year, from fixed abbreviations', () => {
    expect(formatDayMonth('2026-12-31')).toBe('31 Dec')
    expect(formatDayMonth('2026-09-01')).toBe('1 Sep')   // never "Sept"
    expect(formatDayMonth('')).toBe('')
    expect(formatDayMonth(undefined)).toBe('')
    expect(formatDayMonth('not a date')).toBe('')
  })
})

describe('the sentence of a pool', () => {
  const core = (overrides = {}) => ledgerPool({ hasSetAside: true, ...overrides })
  // No carry by default: the fixture's own period carries $500, and a sentence that names the roll-over is tested on its own below.
  const q2 = (overrides = {}) => ledgerPeriod({ periodStart: '2026-10-01', periodEnd: '2026-12-31', isCurrent: true, carried: 0, available: 8000, used: 4880, remaining: 3120, bookedAhead: 3760, forecast: 8640, forecastRemaining: -640, ...overrides })

  it('says what is left, of what, to when, and that the booked shifts would finish over', () => {
    expect(poolSentence(core(), q2())).toBe('Core: $3,120 left of the $8,000 set aside this period (to 31 Dec). Booked shifts would finish $640 over.')
  })

  it('says the booked shifts would finish with some to spare', () => {
    expect(poolSentence(core(), q2({ bookedAhead: 3000, forecast: 7880, forecastRemaining: 120 }))).toBe('Core: $3,120 left of the $8,000 set aside this period (to 31 Dec). Booked shifts would finish with $120 to spare.')
    expect(poolSentence(core(), q2({ bookedAhead: 3000, forecast: 7590, forecastRemaining: 410 }))).toContain('would finish with $410 to spare.')
  })

  it('says "of the plan\'s" when the pool has no set-aside', () => {
    expect(poolSentence(core({ hasSetAside: false }), q2())).toBe('Core: $3,120 left of the plan\'s $8,000 this period (to 31 Dec). Booked shifts would finish $640 over.')
  })

  it('says over, not a negative left, once what is used is past what is available, and still says where the booked shifts take it', () => {
    const over = q2({ available: 4000, used: 4640, remaining: -640, forecast: 5000, forecastRemaining: -1000, bookedAhead: 360 })

    expect(poolSentence(core(), over)).toBe('Core: $640 over the $4,000 set aside this period (to 31 Dec). Booked shifts would finish $1,000 over.')
    expect(poolSentence(core({ hasSetAside: false }), over)).toContain('Core: $640 over the plan\'s $4,000 this period')
  })

  it('says nothing about the future when nothing is booked ahead', () => {
    expect(poolSentence(core(), q2({ bookedAhead: 0, forecast: 4880, forecastRemaining: 3120 }))).toBe('Core: $3,120 left of the $8,000 set aside this period (to 31 Dec).')
  })

  it('names what was rolled over, when something was', () => {
    expect(poolSentence(core(), q2({ carried: 1000 }))).toContain('(to 31 Dec), including $1,000 rolled over, not confirmed. Booked shifts')
  })

  it('names a stated pool by its name, and says "the last period" for a period that is not this one', () => {
    const stated = ledgerPool({ kind: 'Stated', paceCategory: 15, name: 'Improved Daily Living Skills', hasSetAside: false })

    expect(poolSentence(stated, q2({ available: 500, used: 100, remaining: 400, bookedAhead: 0, forecast: 100, forecastRemaining: 400 }))).toBe('Improved Daily Living Skills: $400 left of the plan\'s $500 this period (to 31 Dec).')
    expect(poolSentence(core(), q2({ isCurrent: false, bookedAhead: 0, forecast: 4880, forecastRemaining: 3120 }))).toBe('Core: $3,120 left of the $8,000 set aside in the last period (to 31 Dec).')
  })

  it('says when booked trip days carry no catalogue rate, because the forecast above is then low by exactly those days', () => {
    // One trip day the catalogue cannot price: it contributes $0, so nothing is invented, but the reader is told the figure is short.
    expect(poolSentence(core(), q2({ bookedAhead: 1152, forecast: 6032, forecastRemaining: 1968, unpricedTripDayCount: 1 })))
      .toBe('Core: $3,120 left of the $8,000 set aside this period (to 31 Dec). Booked shifts would finish with $1,968 to spare. 1 booked trip day no catalogue rate covers, so they are counted at $0 and the forecast above is low by that much until the catalogue has a rate for them.')
  })

  it('pluralises the unpriced trip days and says nothing about them when there are none', () => {
    expect(poolSentence(core(), q2({ unpricedTripDayCount: 2 }))).toContain('2 booked trip days no catalogue rate covers')
    expect(poolSentence(core(), q2({ unpricedTripDayCount: 0 }))).not.toContain('no catalogue rate')
  })

  it('says the gap even when nothing is booked ahead in money, because the days themselves are booked', () => {
    expect(poolSentence(core(), q2({ bookedAhead: 0, forecast: 4880, forecastRemaining: 3120, unpricedTripDayCount: 3 })))
      .toBe('Core: $3,120 left of the $8,000 set aside this period (to 31 Dec). 3 booked trip days no catalogue rate covers, so they are counted at $0 and the forecast above is low by that much until the catalogue has a rate for them.')
  })
})

describe('the period the strip is about', () => {
  it('is the current period, else the last one (a plan that has ended)', () => {
    const periods = [ledgerPeriod({ id: 'a', position: 0, isCurrent: false }), ledgerPeriod({ id: 'b', position: 1, isCurrent: true }), ledgerPeriod({ id: 'c', position: 2, isCurrent: false })]

    expect(focusPeriodOf(ledgerPool({ periods }))?.id).toBe('b')
    expect(focusPeriodOf(ledgerPool({ periods: periods.map(p => ({ ...p, isCurrent: false })) }))?.id).toBe('c')
    expect(focusPeriodOf(ledgerPool({ periods: [] }))).toBeUndefined()
  })
})

describe('the status chip', () => {
  it('has the tone of its state: on track success, approaching and forecast over warning, over danger, none neutral', () => {
    expect(chipToneOf('OnTrack')).toBe('success')
    expect(chipToneOf('Approaching')).toBe('warning')
    expect(chipToneOf('ForecastOver')).toBe('warning')
    expect(chipToneOf('Over')).toBe('danger')
    expect(chipToneOf('None')).toBe('neutral')
  })
})

describe('the rows in their three groups', () => {
  it('keeps the three groups in their order, each with the rows it was given in the order they came, and leaves a group out only by it being empty', () => {
    const rows = [
      ledgerRow({ id: '1', group: 'BookedAhead' }), ledgerRow({ id: '2', group: 'Claimed' }), ledgerRow({ id: '3', group: 'Pending' }), ledgerRow({ id: '4', group: 'Claimed' }),
    ]

    const groups = rowsByGroup(rows)

    expect(groups.map(g => [g.group, g.rows.map(r => r.id)])).toEqual([['Claimed', ['2', '4']], ['Pending', ['3']], ['BookedAhead', ['1']]])
    expect(rowsByGroup([]).map(g => [g.group, g.rows.length])).toEqual([['Claimed', 0], ['Pending', 0], ['BookedAhead', 0]])
  })
})

describe('the quiet estimate line', () => {
  it('says what the estimates use, that shift claims price community access only, and which shifts are therefore not counted', () => {
    expect(quietEstimateLine).toBe(
      'Estimates use the rates ODIP will claim with; shift claims price community access only for now, so sleepover, passive-night and group shifts are not counted yet.',
    )
  })
})

describe('the sentence for shifts the claim cannot price yet', () => {
  it('counts them, names why, and says the figures leave them out', () => {
    expect(unpricedShiftSentence(2, ['a 1:3 group shift', 'a sleepover'])).toBe('2 shifts are not priced yet (a 1:3 group shift and a sleepover), so the figures above leave them out.')
  })

  it('keeps the singular for one shift', () => {
    expect(unpricedShiftSentence(1, ['a sleepover'])).toBe('1 shift is not priced yet (a sleepover), so the figures above leave it out.')
  })

  it('lists three reasons the Australian way, with no serial comma', () => {
    expect(unpricedShiftSentence(5, ['a sleepover', 'a passive night', 'no catalogue rate for the date'])).toBe(
      '5 shifts are not priced yet (a sleepover, a passive night and no catalogue rate for the date), so the figures above leave them out.',
    )
  })

  it('still says it when no reason came with the count', () => {
    expect(unpricedShiftSentence(3, [])).toBe('3 shifts are not priced yet, so the figures above leave them out.')
  })
})

describe('the budget line of a claim', () => {
  it('says what the claim uses of a pool and period, and what is left after', () => {
    const line = claimBudgetLine({ placement: 'Pool', poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 2000, usedBefore: 300, thisClaim: 600, usedAfter: 900, leftAfter: 1100, statusAfter: 'OnTrack' })

    expect(line).toEqual({ text: 'Uses $600 of Core (flexible) (1 Oct – 31 Dec 2026); $1,100 left after.', over: false })
  })

  it('says over after, as a warning, when the claim takes the period past what is available', () => {
    const line = claimBudgetLine({ placement: 'Pool', poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 400, usedBefore: 0, thisClaim: 480, usedAfter: 480, leftAfter: -80, statusAfter: 'Over' })

    expect(line).toEqual({ text: 'Uses $480 of Core (flexible) (1 Oct – 31 Dec 2026); $80 over after.', over: true })
  })

  it('says a part in no pool uses none of the budget, and a part outside the plan\'s dates likewise', () => {
    expect(claimBudgetLine({ placement: 'NotInAPool', poolName: 'Not in a recorded pool', thisClaim: 75 })).toEqual({ text: '$75 is not in a recorded pool, so it uses none of the budget.', over: false })
    expect(claimBudgetLine({ placement: 'OutsideThePlan', poolName: 'Outside the plan dates', thisClaim: 75.5 })).toEqual({ text: '$75.50 is outside the plan\'s dates, so it uses none of the budget.', over: false })
  })
})
