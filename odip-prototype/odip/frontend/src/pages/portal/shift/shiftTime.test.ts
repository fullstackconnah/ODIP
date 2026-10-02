import { describe, it, expect } from 'vitest'
import { providerLocalToUtcInstant, utcInstantToProviderLocal, minutesBetween } from './shiftTime'

const SYD = 'Australia/Sydney'

describe('providerLocalToUtcInstant: a datetime-local value becomes a UTC instant with Z', () => {
  it('reads the digits in the provider zone (AEST, UTC+10)', () => {
    expect(providerLocalToUtcInstant('2026-07-01T09:00', SYD)).toBe('2026-06-30T23:00:00Z')
  })
  it('uses AEDT (UTC+11) in summer', () => {
    expect(providerLocalToUtcInstant('2026-10-05T09:00', SYD)).toBe('2026-10-04T22:00:00Z')
  })
  it('handles the first morning after daylight saving starts (2026-10-04)', () => {
    expect(providerLocalToUtcInstant('2026-10-04T09:00', SYD)).toBe('2026-10-03T22:00:00Z')
  })
  it('does not depend on the browser zone', () => {
    expect(providerLocalToUtcInstant('2026-10-05T00:30', 'Australia/Perth')).toBe('2026-10-04T16:30:00Z')
  })
  it('never returns a zone-less string', () => {
    expect(providerLocalToUtcInstant('2026-07-01T09:00', SYD)).toMatch(/Z$/)
  })
  it('returns null for an empty or malformed value', () => {
    expect(providerLocalToUtcInstant('', SYD)).toBeNull()
    expect(providerLocalToUtcInstant('nope', SYD)).toBeNull()
  })
})

describe('utcInstantToProviderLocal', () => {
  it('round-trips with providerLocalToUtcInstant', () => {
    const iso = providerLocalToUtcInstant('2026-10-05T14:25', SYD)!
    expect(utcInstantToProviderLocal(iso, SYD)).toBe('2026-10-05T14:25')
  })
  it('shows an instant in the provider zone', () => {
    expect(utcInstantToProviderLocal('2026-06-30T23:00:00Z', SYD)).toBe('2026-07-01T09:00')
  })
})

describe('minutesBetween', () => {
  it('floors whole minutes', () => {
    expect(minutesBetween('2026-07-01T00:00:00Z', '2026-07-01T00:10:59Z')).toBe(10)
  })
})
