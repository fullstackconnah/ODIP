import { describe, it, expect } from 'vitest'
import { datedLimit, maxFrom, nextMonday, spanEnd, spanLine } from './upcomingShifts'

describe('upcoming shifts horizon', () => {
  it('nextMonday is the Monday after today, even from a Sunday or a Monday', () => {
    expect(nextMonday('2026-10-26')).toBe('2026-11-02')
    expect(nextMonday('2026-11-01')).toBe('2026-11-02')
    expect(nextMonday('2026-10-28')).toBe('2026-11-02')
  })

  it('a pattern runs weeks*7 days from its start, the dated limit is 83 days out, a pattern may start 28 days out', () => {
    expect(spanEnd('2026-11-02', 12)).toBe('2027-01-24')
    expect(spanEnd('2026-11-02', 1)).toBe('2026-11-08')
    expect(maxFrom('2026-10-26')).toBe('2026-11-23')
    expect(datedLimit('2026-10-26')).toBe('2027-01-17')
  })

  it('says the span in the house day format', () => {
    expect(spanLine('2026-11-02', 12)).toBe('Makes shifts from Mon 2 Nov to Sun 24 Jan.')
  })
})
