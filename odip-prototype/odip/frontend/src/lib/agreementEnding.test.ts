import { describe, expect, it } from 'vitest'
import { endingWords } from './agreementEnding'

// Fix round 2 (finish 2): the screens say the server's ending rule in the house's dates, never the ISO ones the alert carries.
describe('endingWords', () => {
  it('says ending in days, today and tomorrow in words, and an ended agreement with its date as the screens show dates', () => {
    expect(endingWords(20, '2026-11-01')).toBe('Agreement ends in 20 days')
    expect(endingWords(1, '2026-10-13')).toBe('Agreement ends in 1 day')
    expect(endingWords(0, '2026-10-12')).toBe('Agreement ends today')
    expect(endingWords(-1, '2026-10-11')).toBe('Agreement ended Sun 11 Oct 2026: shifts stop after it')
  })

  it('adds the renewal waiting after an ended agreement', () => {
    expect(endingWords(-3, '2026-10-07', 2)).toBe('Agreement ended Wed 7 Oct 2026: shifts stop after it. Renewal v2 is waiting for approval')
    expect(endingWords(-3, '2026-10-07', null)).toBe('Agreement ended Wed 7 Oct 2026: shifts stop after it')
  })
})
