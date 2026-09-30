import { describe, it, expect } from 'vitest'
import { getStatusColor } from './utils'
import { TONE } from './tone'

// getStatusColor is the generic pill colour for booking, task, vehicle and insurance statuses. It used to return raw hex pairs; it now
// returns the tone classes of the same four colours, so nothing on those screens changes colour.
describe('getStatusColor', () => {
  it.each([
    [['Confirmed', 'Completed', 'Available'], 'success'],
    [['Draft', 'Proposed', 'None'], 'neutral'],
    [['Cancelled', 'Unavailable', 'NoLongerAttending', 'Expired', 'Overdue', 'Conflict'], 'danger'],
  ] as const)('gives %j the %s tone', (statuses, tone) => {
    for (const status of statuses) expect(getStatusColor(status), status).toBe(TONE[tone].solid)
  })

  it('is warning for every other status (Pending, Not Started, In Progress, Waitlisted, ...)', () => {
    for (const status of ['Pending', 'NotStarted', 'InProgress', 'Waitlisted', 'something new']) expect(getStatusColor(status), status).toBe(TONE.warning.solid)
  })

  it('returns tone classes only: no raw hex', () => {
    for (const status of ['Confirmed', 'Draft', 'Cancelled', 'Pending']) expect(getStatusColor(status)).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})
