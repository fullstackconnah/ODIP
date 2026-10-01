import { afterEach, describe, expect, it } from 'vitest'
import { datetimeInputNow, formatWallClock, toDatetimeInputValue } from './wallClock'
import { restoreZone, setZone } from '@/test/timeZone'

// A provider-local WALL-CLOCK value (an incident time typed into the form, a MAR dose slot) travels with no zone: "2026-10-03T08:00:00".
// Its digits are the answer. Reading it as UTC and converting to the viewer's zone is the L4-06 bug (Sydney showed 6:00 pm for 08:00).
afterEach(restoreZone)

const ZONES = ['UTC', 'Australia/Sydney', 'America/New_York', 'Australia/Lord_Howe'] as const
const MEDIUM = { dateStyle: 'medium', timeStyle: 'short' } as const

describe.each(ZONES)('wall-clock values in %s', zone => {
  it('prints the stored digits, never a converted time', () => {
    if (!setZone(zone)) return
    expect(formatWallClock('2026-10-03T08:00:00', MEDIUM)).toMatch(/^3 Oct 2026,? 8:00\s?(am|AM)$/)
    expect(formatWallClock('2026-10-03T20:15:00.1234567', MEDIUM)).toMatch(/^3 Oct 2026,? 8:15\s?(pm|PM)$/)
  })

  it('ignores a zone suffix: the digits are what somebody typed', () => {
    if (!setZone(zone)) return
    expect(formatWallClock('2026-10-03T08:00:00Z', MEDIUM)).toMatch(/8:00\s?(am|AM)$/)
    expect(formatWallClock('2026-10-03T08:00:00+10:00', MEDIUM)).toMatch(/8:00\s?(am|AM)$/)
  })

  it('prints a time that does not exist on the wall clock (the Sydney spring-forward gap) as written', () => {
    if (!setZone(zone)) return
    expect(formatWallClock('2026-10-04T02:30:00', { hour: 'numeric', minute: '2-digit' })).toMatch(/^2:30\s?(am|AM)$/)
  })

  it('feeds a datetime-local input the same digits it was given', () => {
    if (!setZone(zone)) return
    expect(toDatetimeInputValue('2026-10-03T08:00:00')).toBe('2026-10-03T08:00')
    expect(toDatetimeInputValue('2026-10-03T08:00:00.1234567')).toBe('2026-10-03T08:00')
    expect(toDatetimeInputValue('2026-10-03T08:00')).toBe('2026-10-03T08:00')
  })

  it('defaults a new datetime-local input to the local clock, not the UTC clock', () => {
    if (!setZone(zone)) return
    // 08:05 on the viewer's own wall clock, whatever the UTC date is (in Sydney this instant is 22:05Z the day before).
    expect(datetimeInputNow(new Date(2026, 9, 3, 8, 5))).toBe('2026-10-03T08:05')
  })
})

describe('missing or unusable values', () => {
  it('reads a dash for nothing and for garbage', () => {
    expect(formatWallClock(null, MEDIUM)).toBe('—')
    expect(formatWallClock(undefined, MEDIUM)).toBe('—')
    expect(formatWallClock('', MEDIUM)).toBe('—')
    expect(formatWallClock('not a time', MEDIUM)).toBe('—')
    expect(toDatetimeInputValue(null)).toBe('')
    expect(toDatetimeInputValue('not a time')).toBe('')
  })
})
