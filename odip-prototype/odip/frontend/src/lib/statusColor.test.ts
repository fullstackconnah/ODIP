import { describe, it, expect } from 'vitest'
import { getStatusColor } from './utils'
import { TONE } from './tone'

// getStatusColor is the generic pill colour for booking, task, vehicle and insurance statuses. It is the same table as StatusBadge
// (lib/tone.ts STATUS_TONE), so a word has one colour wherever it is printed, and a status nobody listed is neutral, never amber.
describe('getStatusColor', () => {
  it.each([
    [['Confirmed', 'Completed', 'Available'], 'success'],
    [['Draft', 'Proposed', 'None', 'NotStarted'], 'neutral'],
    [['Cancelled', 'Unavailable', 'NoLongerAttending', 'Expired', 'Overdue', 'Conflict'], 'danger'],
    [['Pending', 'Enquiry', 'Held', 'Waitlist', 'Requested'], 'warning'],
    [['InProgress'], 'info'],
  ] as const)('gives %j the %s tone', (statuses, tone) => {
    for (const status of statuses) expect(getStatusColor(status), status).toBe(TONE[tone].solid)
  })

  it('is neutral for a status nobody listed, not amber', () => {
    for (const status of ['something new', 'Waitlisted']) expect(getStatusColor(status), status).toBe(TONE.neutral.solid)
  })

  it('returns tone classes only: no raw hex', () => {
    for (const status of ['Confirmed', 'Draft', 'Cancelled', 'Pending']) expect(getStatusColor(status)).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})
