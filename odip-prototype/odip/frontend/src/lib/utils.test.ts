import { afterEach, describe, expect, it } from 'vitest'
import { formatDateAu } from './utils'
import { restoreZone, setZone } from '@/test/timeZone'

afterEach(restoreZone)

describe('formatDateAu', () => {
  it('reads an en dash for nothing', () => {
    for (const value of [null, undefined, '']) expect(formatDateAu(value)).toBe('—')
  })

  it('prints day/month/year with both parts zero-padded', () => {
    expect(formatDateAu('2026-08-04')).toBe('04/08/2026')
    expect(formatDateAu('2026-12-31')).toBe('31/12/2026')
  })

  // A date-only value is a calendar day. `new Date("2026-08-14")` is UTC midnight, which is the 13th in any zone west of UTC
  // (the ItineraryPdf copy of this function read the day as written; the shared one now does too).
  it.each(['UTC', 'Australia/Sydney', 'Australia/Brisbane', 'Pacific/Auckland', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu'])(
    'reads 2026-08-14 as the 14th in %s',
    (zone) => {
      if (!setZone(zone)) return
      expect(formatDateAu('2026-08-14')).toBe('14/08/2026')
    },
  )

  it('still converts a timestamp to the viewer\'s own date', () => {
    if (!setZone('Australia/Sydney')) return
    expect(formatDateAu('2026-08-13T20:00:00Z')).toBe('14/08/2026') // 06:00 on the 14th in Sydney
    if (!setZone('America/New_York')) return
    expect(formatDateAu('2026-08-14T02:00:00Z')).toBe('13/08/2026') // 22:00 on the 13th in New York
  })
})
