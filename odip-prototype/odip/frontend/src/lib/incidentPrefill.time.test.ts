import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildIncidentDateTime, buildIncidentDescriptionSkeleton, type MarIncidentPrefillState } from './incidentPrefill'
import { restoreZone, setZone } from '@/test/timeZone'

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
})

function state(overrides: Partial<MarIncidentPrefillState> = {}): MarIncidentPrefillState {
  return {
    source: 'mar-administration', outcome: 'Missed', participantId: 'p1', participantName: 'Sophie Brown',
    medicationName: 'Levetiracetam', medicationAdministrationId: 'admin-1', ...overrides,
  }
}

const ZONES = ['Australia/Sydney', 'UTC', 'America/New_York'] as const

// L4-06, the round trip. The incident form's "Date & Time" is a datetime-local field: provider-local digits, stored verbatim. Reporting a
// missed 8 pm dose from the MAR prefilled it from the slot, which is ALSO a provider-local wall-clock value, but the helper treated the slot
// as a UTC instant and converted it (8 pm became 6 am the next day in Sydney).
describe.each(ZONES)('MAR -> incident prefill in %s', zone => {
  it('a missed dose with only its slot prefills the slot digits', () => {
    if (!setZone(zone)) return
    expect(buildIncidentDateTime(state({ scheduledAt: '2026-10-03T20:00:00' }))).toBe('2026-10-03T20:00')
  })

  it('a dose given at 10:05Z recorded in Sydney prefills 20:05 (an instant, shown in the zone it was recorded in)', () => {
    if (!setZone(zone)) return
    expect(buildIncidentDateTime(state({
      outcome: 'WrongMedication', administeredAt: '2026-10-03T10:05:00Z', administeredAtTimeZone: 'Australia/Sydney',
    }))).toBe('2026-10-03T20:05')
  })

  it('with nothing known it prefills the local clock, not the UTC clock', () => {
    if (!setZone(zone)) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 3, 8, 5)) // 08:05 on the viewer's wall clock (22:05Z the day before in Sydney)
    expect(buildIncidentDateTime(state())).toBe('2026-10-03T08:05')
  })

  it('the description says the slot time as written', () => {
    if (!setZone(zone)) return
    expect(buildIncidentDescriptionSkeleton(state({ scheduledAt: '2026-10-03T20:00:00' }))).toMatch(/\(scheduled for 3 Oct 2026,? 8:00\s?(pm|PM)\)/)
  })
})
