import { describe, expect, it } from 'vitest'
import { instantDay } from './claimHubSteps'

describe('instantDay', () => {
  // 13:30Z on 1 March is already 2 March in Sydney (AEDT), whatever zone the device is in.
  it("is the day of the instant in the zone it is given (the provider's)", () => {
    expect(instantDay('2026-03-01T13:30:00Z', 'Australia/Sydney')).toBe('2 Mar 2026')
    expect(instantDay('2026-03-01T13:30:00Z', 'America/Los_Angeles')).toBe('1 Mar 2026')
  })

  it('is a dash when there is no instant', () => {
    expect(instantDay(null, 'Australia/Sydney')).toBe('—')
  })
})
