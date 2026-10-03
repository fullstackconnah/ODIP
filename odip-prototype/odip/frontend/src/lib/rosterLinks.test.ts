import { describe, expect, it } from 'vitest'
import { rosterLink } from './rosterLinks'

describe('rosterLink', () => {
  it('opens the roster board at the Monday of the week the day is in, for that participant', () => {
    expect(rosterLink('2026-10-14', 'p-1')).toBe('/rostering?date=2026-10-12&participant=p-1')
    expect(rosterLink('2026-10-12', 'p-1')).toBe('/rostering?date=2026-10-12&participant=p-1')
    expect(rosterLink('2026-10-18', 'p-1')).toBe('/rostering?date=2026-10-12&participant=p-1')       // a Sunday belongs to the week before it
  })

  it('can ask for the open shifts only, which is what an approval made', () => {
    expect(rosterLink('2026-10-12', 'p-1', { unfilled: true })).toBe('/rostering?date=2026-10-12&participant=p-1&unfilled=1')
  })

  it('writes the participant as a URL value, whatever it is', () => {
    expect(rosterLink('2026-10-12', 'a b&c')).toBe('/rostering?date=2026-10-12&participant=a%20b%26c')
  })
})
