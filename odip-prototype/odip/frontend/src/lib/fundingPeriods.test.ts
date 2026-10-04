import { describe, expect, it } from 'vitest'
import { addMonthsIso, MAX_PLAN_DAYS, periodLengthLabel, proposePeriods, spreadSetAside, sumAmounts, toCents } from './fundingPeriods'

// The editor proposes a pool's release periods from the plan's dates and the period length; the server only checks the invariants. Expected figures below are worked out by hand
// from the rule (not by running the function): amounts split in proportion to the days each period covers, each rounded to the cent, the remainder on the last period.

describe('proposePeriods: the periods', () => {
  it('splits a 12-month plan into four 3-month periods that run end to start and end on the plan end', () => {
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 3, planAmount: 0 })

    expect(periods.map(p => [p.periodStart, p.periodEnd])).toEqual([
      ['2026-07-01', '2026-09-30'],
      ['2026-10-01', '2026-12-31'],
      ['2027-01-01', '2027-03-31'],
      ['2027-04-01', '2027-06-30'],
    ])
  })

  it('gives a 13-month plan on 12-month periods a short last period for the remainder', () => {
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-07-31', lengthMonths: 12, planAmount: 0 })

    expect(periods.map(p => [p.periodStart, p.periodEnd])).toEqual([
      ['2026-07-01', '2027-06-30'],
      ['2027-07-01', '2027-07-31'],
    ])
  })

  it('is one period equal to the plan when the plan has no funding periods', () => {
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: null, planAmount: 8000, setAside: 6000 })

    expect(periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 8000, setAside: 6000 }])
  })

  it('is one period when the plan is shorter than the period length', () => {
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2026-08-15', lengthMonths: 3, planAmount: 500 })

    expect(periods.map(p => [p.periodStart, p.periodEnd, p.planAmount])).toEqual([['2026-07-01', '2026-08-15', 500]])
  })

  it('makes twelve monthly periods for a monthly 12-month plan, each ending on the last day of its month', () => {
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 1, planAmount: 0 })

    expect(periods).toHaveLength(12)
    expect(periods.map(p => p.periodEnd)).toEqual([
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30',
    ])
  })

  it('counts every period from the plan start day, so a plan that starts on the 31st does not drift', () => {
    const periods = proposePeriods({ planStart: '2026-01-31', planEnd: '2026-05-30', lengthMonths: 1, planAmount: 0 })

    // 31 Jan + 1 month = 28 Feb (clamped), + 2 = 31 Mar, + 3 = 30 Apr, + 4 = 31 May: each period starts the day after the last ended.
    expect(periods.map(p => [p.periodStart, p.periodEnd])).toEqual([
      ['2026-01-31', '2026-02-27'],
      ['2026-02-28', '2026-03-30'],
      ['2026-03-31', '2026-04-29'],
      ['2026-04-30', '2026-05-30'],
    ])
  })

  it('runs across a leap day: 1 Mar 2027 to 29 Feb 2028 is 366 days in four periods', () => {
    const periods = proposePeriods({ planStart: '2027-03-01', planEnd: '2028-02-29', lengthMonths: 3, planAmount: 0 })

    expect(periods.map(p => [p.periodStart, p.periodEnd])).toEqual([
      ['2027-03-01', '2027-05-31'],
      ['2027-06-01', '2027-08-31'],
      ['2027-09-01', '2027-11-30'],
      ['2027-12-01', '2028-02-29'],
    ])
  })

  it('makes the periods contiguous, from the first day to the last, for every period length and a spread of plan lengths', () => {
    for (const lengthMonths of [1, 3, 6, 12] as const) {
      for (const [planStart, planEnd] of [['2026-07-01', '2027-06-30'], ['2026-07-15', '2027-07-14'], ['2026-02-28', '2027-04-17'], ['2028-02-29', '2029-02-28'], ['2026-10-04', '2026-10-04']]) {
        const periods = proposePeriods({ planStart, planEnd, lengthMonths, planAmount: 1000 })
        expect(periods[0].periodStart).toBe(planStart)
        expect(periods[periods.length - 1].periodEnd).toBe(planEnd)
        periods.slice(1).forEach((p, i) => expect(p.periodStart, `${planStart} ${lengthMonths}`).toBe(nextDay(periods[i].periodEnd)))
      }
    }
  })

  it('proposes nothing for dates it cannot read, a plan that ends before it starts, or a length the NDIS does not use', () => {
    expect(proposePeriods({ planStart: '', planEnd: '2027-06-30', lengthMonths: 3, planAmount: 1 })).toEqual([])
    expect(proposePeriods({ planStart: '2027-06-30', planEnd: '2026-07-01', lengthMonths: 3, planAmount: 1 })).toEqual([])
    expect(proposePeriods({ planStart: '2026-02-30', planEnd: '2027-06-30', lengthMonths: 3, planAmount: 1 })).toEqual([])
    expect(proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 2, planAmount: 1 })).toEqual([])
  })
})

describe('proposePeriods: the amounts', () => {
  it('splits in proportion to days, rounds each to the cent, and puts the remainder on the last period', () => {
    // 365 days: 92, 92, 90 and 91 of them. $8,000 x 92/365 = 2016.4383 -> 2016.44 (twice), x 90/365 = 1972.6027 -> 1972.60, and the last is what is left: 8000 - 6005.48.
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 3, planAmount: 8000 })

    expect(periods.map(p => p.planAmount)).toEqual([2016.44, 2016.44, 1972.6, 1994.52])
    expect(sumAmounts(periods.map(p => p.planAmount))).toBe(8000)
  })

  it('splits a 13-month plan by days: a 365-day first period and a 31-day last one', () => {
    // 396 days. $1,000 x 365/396 = 921.7172 -> 921.72; the last is 1000 - 921.72.
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-07-31', lengthMonths: 12, planAmount: 1000 })

    expect(periods.map(p => p.planAmount)).toEqual([921.72, 78.28])
  })

  it('leaves the remainder cent on the last period: $100.00 over 31, 28 and 31 days', () => {
    // 90 days. 100 x 31/90 = 34.4444 -> 34.44; 100 x 28/90 = 31.1111 -> 31.11; the last is 100 - 65.55 = 34.45 (not the 34.44 its own share rounds to).
    const periods = proposePeriods({ planStart: '2027-01-01', planEnd: '2027-03-31', lengthMonths: 1, planAmount: 100 })

    expect(periods.map(p => p.planAmount)).toEqual([34.44, 31.11, 34.45])
    expect(sumAmounts(periods.map(p => p.planAmount))).toBe(100)
  })

  it('splits the set-aside the same way, and gives none when none is asked for', () => {
    const withSetAside = proposePeriods({ planStart: '2027-01-01', planEnd: '2027-03-31', lengthMonths: 1, planAmount: 100, setAside: 50 })
    expect(withSetAside.map(p => p.setAside)).toEqual([17.22, 15.56, 17.22])   // 50 x 31/90 = 17.2222 -> 17.22, x 28/90 = 15.5556 -> 15.56, the last 50 - 32.78
    expect(sumAmounts(withSetAside.map(p => p.setAside ?? 0))).toBe(50)

    const without = proposePeriods({ planStart: '2027-01-01', planEnd: '2027-03-31', lengthMonths: 1, planAmount: 100 })
    expect(without.every(p => p.setAside === undefined)).toBe(true)
  })

  it('never makes a negative amount: a total of a few cents over many periods still adds up', () => {
    // 3 cents over five equal-ish periods rounds each share (0.6 of a cent) up to 1: the first four would use 4 cents. It falls back to whole cents rounded down, and the last takes the rest.
    const periods = proposePeriods({ planStart: '2026-01-01', planEnd: '2026-05-31', lengthMonths: 1, planAmount: 0.03 })

    expect(periods.every(p => p.planAmount >= 0)).toBe(true)
    expect(sumAmounts(periods.map(p => p.planAmount))).toBe(0.03)
  })

  it('handles a zero total (a pool recorded but not used) and a total with cents', () => {
    expect(proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 3, planAmount: 0 }).map(p => p.planAmount)).toEqual([0, 0, 0, 0])

    const odd = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 6, planAmount: 12345.67 })
    expect(sumAmounts(odd.map(p => p.planAmount))).toBe(12345.67)
    expect(odd).toHaveLength(2)
  })
})

describe('the helpers', () => {
  it('adds calendar months and clamps to the end of a shorter month', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonthsIso('2026-07-01', 12)).toBe('2027-07-01')
    expect(addMonthsIso('2028-02-29', 12)).toBe('2029-02-28')
  })

  it('works in whole cents, so $0.10 + $0.20 is $0.30', () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(30)
    expect(sumAmounts([0.1, 0.2])).toBe(0.3)
    expect(sumAmounts([])).toBe(0)
    expect(toCents(0.29)).toBe(29)
    expect(toCents(12.34)).toBe(1234)
  })

  it('names the period length as the plan prints it', () => {
    expect(periodLengthLabel(null)).toBe('No funding periods')
    expect(periodLengthLabel(1)).toBe('Monthly')
    expect(periodLengthLabel(3)).toBe('3-monthly')
    expect(periodLengthLabel(6)).toBe('6-monthly')
    expect(periodLengthLabel(12)).toBe('12-monthly')
  })
})

describe('proposePeriods: a plan the server would refuse is not drawn', () => {
  it('proposes nothing beyond the 800 days a plan may run, the way the server refuses it (a year typed digit by digit passes through 0002)', () => {
    // Typing "2026" into a date input fires a change per digit: the start is 0002-07-01, then 0020-07-01, then 0202-07-01, before it is 2026-07-01.
    for (const planStart of ['0002-07-01', '0020-07-01', '0202-07-01', '1026-07-01']) {
      expect(proposePeriods({ planStart, planEnd: '2027-06-30', lengthMonths: 3, planAmount: 8000 }), planStart).toEqual([])
      expect(proposePeriods({ planStart, planEnd: '2027-06-30', lengthMonths: 1, planAmount: 8000 }), planStart).toEqual([])
      expect(proposePeriods({ planStart, planEnd: '2027-06-30', lengthMonths: null, planAmount: 8000 }), planStart).toEqual([])
    }
  })

  it('still proposes for a plan of exactly 800 days, and stops at 801', () => {
    // 800 days from 1 Jul 2026 (both ends counted) end on 7 Sep 2028.
    expect(MAX_PLAN_DAYS).toBe(800)
    expect(proposePeriods({ planStart: '2026-07-01', planEnd: '2028-09-07', lengthMonths: 12, planAmount: 100 }).length).toBeGreaterThan(0)
    expect(proposePeriods({ planStart: '2026-07-01', planEnd: '2028-09-08', lengthMonths: 12, planAmount: 100 })).toEqual([])
  })
})

describe('proposePeriods: a set-aside is never above its period\'s plan amount', () => {
  it('moves the cent that rounding put on the last period onto an earlier one with room (11 cents and a 10 cent set-aside over three months)', () => {
    // July, August, September: 31, 31 and 30 days. 11 cents split by days is 4, 4, 3 and 10 cents is 3, 3, 4: the last set-aside would be a cent above its plan amount.
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2026-09-30', lengthMonths: 1, planAmount: 0.11, setAside: 0.1 })

    expect(periods.map(p => p.planAmount)).toEqual([0.04, 0.04, 0.03])
    expect(periods.map(p => p.setAside)).toEqual([0.03, 0.04, 0.03])
    for (const period of periods) expect(toCents(period.setAside!)).toBeLessThanOrEqual(toCents(period.planAmount))
    expect(sumAmounts(periods.map(p => p.setAside!))).toBe(0.1)
  })

  it('holds for every pair of small totals over four quarters, and the set-aside always adds up to what was asked for', () => {
    for (let total = 1; total <= 40; total++) {
      for (let aside = 0; aside <= total; aside++) {
        const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2027-06-30', lengthMonths: 3, planAmount: total / 100, setAside: aside / 100 })

        expect(periods.reduce((sum, p) => sum + toCents(p.planAmount), 0), `${total}/${aside}`).toBe(total)
        expect(periods.reduce((sum, p) => sum + toCents(p.setAside ?? 0), 0), `${total}/${aside}`).toBe(aside)
        for (const period of periods) expect(toCents(period.setAside ?? 0), `${total}/${aside}`).toBeLessThanOrEqual(toCents(period.planAmount))
      }
    }
  })

  it('leaves a set-aside that is above the plan amount as it is (the editor says so beside the field)', () => {
    const periods = proposePeriods({ planStart: '2026-07-01', planEnd: '2026-09-30', lengthMonths: 3, planAmount: 100, setAside: 150 })

    expect(periods).toEqual([{ periodStart: '2026-07-01', periodEnd: '2026-09-30', planAmount: 100, setAside: 150 }])
  })
})

describe('spreadSetAside: a set-aside over periods whose amounts were set by hand', () => {
  it('sets aside the same share of every period, to the cent', () => {
    expect(spreadSetAside(80000, [100000, 200000, 50000, 50000])).toEqual([20000, 40000, 10000, 10000])
    expect(spreadSetAside(10, [4, 4, 3])).toEqual([4, 4, 2])   // 10 cents over 4, 4 and 3: 4, 4, and the 2 left, never above a period's amount
  })

  it('never puts more on a period than its plan amount, and the parts add up to the set-aside', () => {
    for (let aside = 0; aside <= 30; aside++) {
      const shares = spreadSetAside(aside, [11, 7, 5, 7])   // 30 cents of plan amounts
      expect(shares.reduce((sum, share) => sum + share, 0), String(aside)).toBe(aside)
      shares.forEach((share, i) => expect(share, `${aside} #${i}`).toBeLessThanOrEqual([11, 7, 5, 7][i]))
    }
  })

  it('splits plainly a set-aside above the plan amount (nothing fits it; the editor says it is too much)', () => {
    expect(spreadSetAside(500, [100, 100])).toEqual([250, 250])
  })

  it('is all zeros when there is nothing to weigh by', () => {
    expect(spreadSetAside(500, [])).toEqual([])
    expect(spreadSetAside(500, [0, 0])).toEqual([0, 0])
  })
})

/** The day after an ISO date, written out in the test so it does not borrow the code under test. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}
