import { describe, it, expect } from 'vitest'
import { hasEnded, pickCurrentShift, portalStatusLabel, rosteredInstants } from './portal'
import { formatMinutesSpan } from '@/pages/rostering/lib/roster'
import type { PortalShiftSummaryDto } from '@/api/types'

const shift = (over: Partial<PortalShiftSummaryDto> = {}): PortalShiftSummaryDto => ({
  id: 's', participantId: 'p', participantName: 'Mia Chen', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00',
  endsNextDay: false, durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null, returnCount: 0, ...over,
})
// Wall clock in the provider's zone, Brisbane (UTC+10, no DST): the list judges today and ended there, whatever the device's zone.
const TZ = 'Australia/Brisbane'
const at = (local: string) => new Date(`${local}+10:00`)

describe('the list rules', () => {
  it('labels statuses in worker words, and a returned Rostered shift as Returned', () => {
    expect(portalStatusLabel(shift())).toBe('Rostered')
    expect(portalStatusLabel(shift({ returnCount: 2 }))).toBe('Returned')
    expect(portalStatusLabel(shift({ status: 'PendingReview' }))).toBe('Submitted')
    expect(portalStatusLabel(shift({ status: 'Completed' }))).toBe('Approved')
    expect(portalStatusLabel(shift({ status: 'InProgress' }))).toBe('In progress')
  })
  it('ends a Rostered shift at its end time, an overnight one the next day, and never one in progress', () => {
    expect(hasEnded(shift(), at('2026-08-17T16:59:00'), TZ)).toBe(false)
    expect(hasEnded(shift(), at('2026-08-17T17:00:00'), TZ)).toBe(true)
    expect(hasEnded(shift({ endTime: '07:00:00', endsNextDay: true }), at('2026-08-18T06:00:00'), TZ)).toBe(false)
    expect(hasEnded(shift({ status: 'InProgress' }), at('2026-08-20T00:00:00'), TZ)).toBe(false)
    expect(hasEnded(shift({ status: 'PendingReview' }), at('2026-08-17T10:00:00'), TZ)).toBe(true)
  })
  it('picks a shift in progress first, else the soonest of today that has not ended, else none', () => {
    const late = shift({ id: 'late', startTime: '15:00:00', endTime: '20:00:00' })
    const early = shift({ id: 'early', startTime: '06:00:00', endTime: '08:00:00' })
    const mid = shift({ id: 'mid', startTime: '11:00:00', endTime: '14:00:00' })
    const sundayNight = shift({ id: 'night', serviceDate: '2026-08-16', endTime: '07:00:00', endsNextDay: true, status: 'InProgress' })
    expect(pickCurrentShift([late, early, mid], at('2026-08-17T09:00:00'), TZ)?.id).toBe('mid')
    expect(pickCurrentShift([late, early, mid, sundayNight], at('2026-08-17T09:00:00'), TZ)?.id).toBe('night')
    expect(pickCurrentShift([early], at('2026-08-17T09:00:00'), TZ)).toBeNull()
    expect(pickCurrentShift([shift({ serviceDate: '2026-08-18' })], at('2026-08-17T09:00:00'), TZ)).toBeNull()
  })
  it("judges today and ended in the provider's zone, not the device's (review CR-B Should 2)", () => {
    const now = new Date('2026-08-17T06:45:00Z')   // 16:45 in Sydney, 14:45 in Perth
    const s = shift({ endTime: '16:30:00' })
    expect(hasEnded(s, now, 'Australia/Sydney')).toBe(true)
    expect(hasEnded(s, now, 'Australia/Perth')).toBe(false)
    const late = new Date('2026-08-17T15:30:00Z')   // 01:30 on the 18th in Sydney, 23:30 on the 17th in Perth
    const tomorrow = shift({ serviceDate: '2026-08-18' })
    expect(pickCurrentShift([tomorrow], late, 'Australia/Sydney')?.id).toBe('s')
    expect(pickCurrentShift([tomorrow], late, 'Australia/Perth')).toBeNull()
  })
  it('spells a span of minutes', () => {
    expect(formatMinutesSpan(40)).toBe('40 min')
    expect(formatMinutesSpan(190)).toBe('3h 10m')
    expect(formatMinutesSpan(-5)).toBe('0 min')
  })
})

it('reads the rostered times in the provider zone, the end on the next day overnight', () => {
  expect(rosteredInstants({ serviceDate: '2026-08-17', startTime: '22:00:00', endTime: '07:00:00', endsNextDay: true, timeZoneId: 'Australia/Brisbane' }))
    .toEqual({ start: '2026-08-17T12:00:00Z', end: '2026-08-17T21:00:00Z' })
})
