import { afterEach, describe, expect, it } from 'vitest'
import { formatAge, formatDateTimeAu, formatNoteTimestamp, formatRatio, formatRelative, glanceRatio, joinList, plural } from './format'
import { restoreZone, setZone } from '@/test/timeZone'

afterEach(restoreZone)

describe('plural', () => {
  // [n, singular, plural?, expected]
  it.each<[number, string, string | undefined, string]>([
    [0, 'day', undefined, '0 days'],
    [1, 'day', undefined, '1 day'],
    [2, 'day', undefined, '2 days'],
    [11, 'day', undefined, '11 days'],
    [100, 'issue', undefined, '100 issues'],
    [1.5, 'hour', undefined, '1.5 hours'],
    [0, 'person', 'people', '0 people'],
    [1, 'person', 'people', '1 person'],
    [2, 'person', 'people', '2 people'],
    [1, 'batch', 'batches', '1 batch'],
    [3, 'batch', 'batches', '3 batches'],
    [1, 'entry', 'entries', '1 entry'],
    [2, 'entry', 'entries', '2 entries'],
    [2, 'upcoming trip', undefined, '2 upcoming trips'],
  ])('plural(%s, %j, %j) is "%s"', (n, singular, pluralForm, expected) => {
    expect(pluralForm === undefined ? plural(n, singular) : plural(n, singular, pluralForm)).toBe(expected)
  })
})

describe('joinList', () => {
  it.each<[string[], string]>([
    [[], ''],
    [['Overdue'], 'Overdue'],
    [['Overdue', 'QSC Overdue'], 'Overdue and QSC Overdue'],
    [['Missing Vehicles', 'Open Incidents', 'QSC Overdue'], 'Missing Vehicles, Open Incidents and QSC Overdue'],
    [['a', 'b', 'c', 'd'], 'a, b, c and d'],
  ])('joinList(%j) is "%s"', (items, expected) => {
    expect(joinList(items)).toBe(expected)
  })
})

describe('formatRatio', () => {
  it.each<[number | string, number | string, string]>([
    [12, 14, '12 / 14'],
    [5, 3, '5 / 3'],
    [0, 0, '0 / 0'],
    ['4', 5, '4 / 5'],
    [3, '—', '3 / —'],
    [2, '?', '2 / ?'],
  ])('formatRatio(%j, %j) is "%s"', (a, b, expected) => {
    expect(formatRatio(a, b)).toBe(expected)
  })

  it('always has a space each side of the slash', () => {
    for (const [a, b] of [[1, 2], [10, 20], [100, 3]]) expect(formatRatio(a, b)).toMatch(/^\d+ \/ \d+$/)
  })

  it('keeps glanceRatio as the same function', () => {
    expect(glanceRatio).toBe(formatRatio)
  })
})

// 1 Oct 2026, 03:40 in Sydney (UTC+10) = 30 Sep 17:40 UTC. The instants below are offsets from it, so they read the same in every zone.
const NOW = new Date('2026-10-01T03:40:00+10:00')
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

describe('formatRelative: an instant', () => {
  // [offset from now, compact, long]
  const ROWS: [string, number, string, string][] = [
    ['right now', 0, 'Just now', 'just now'],
    ['20 seconds ago', -20 * SEC, 'Just now', 'just now'],
    ['59 seconds ago', -59 * SEC, 'Just now', 'just now'],
    ['60 seconds ago', -60 * SEC, '1m ago', '1 min ago'],
    ['5 min 40 s ago (rounds down)', -(5 * MIN + 40 * SEC), '5m ago', '5 min ago'],
    ['59 min 59 s ago', -(59 * MIN + 59 * SEC), '59m ago', '59 min ago'],
    ['60 minutes ago', -60 * MIN, '1h ago', '1 hr ago'],
    ['90 minutes ago (rounds down)', -90 * MIN, '1h ago', '1 hr ago'],
    ['119 minutes ago', -119 * MIN, '1h ago', '1 hr ago'],
    ['120 minutes ago', -120 * MIN, '2h ago', '2 hrs ago'],
    ['23 h 59 min ago', -(23 * HOUR + 59 * MIN), '23h ago', '23 hrs ago'],
    ['24 hours ago', -24 * HOUR, '1d ago', '1 day ago'],
    ['36 hours ago (rounds down)', -36 * HOUR, '1d ago', '1 day ago'],
    ['48 hours ago', -48 * HOUR, '2d ago', '2 days ago'],
    ['5 days ago', -5 * DAY, '5d ago', '5 days ago'],
    ['29 days ago', -29 * DAY, '29d ago', '29 days ago'],
    ['30 days ago (long switches to months)', -30 * DAY, '30d ago', '1 month ago'],
    ['45 days ago', -45 * DAY, '45d ago', '1 month ago'],
    ['59 days ago', -59 * DAY, '59d ago', '1 month ago'],
    ['60 days ago', -60 * DAY, '60d ago', '2 months ago'],
    ['400 days ago', -400 * DAY, '400d ago', '13 months ago'],
    ['30 seconds ahead', 30 * SEC, 'Just now', 'just now'],
    ['4 min 59 s ahead (clock skew)', 4 * MIN + 59 * SEC, 'Just now', 'just now'],
    ['5 minutes ahead', 5 * MIN, 'in 5m', 'in 5 min'],
    ['3 hours ahead', 3 * HOUR, 'in 3h', 'in 3 hrs'],
    ['1 hour ahead', HOUR, 'in 1h', 'in 1 hr'],
    ['2 days ahead', 2 * DAY, 'in 2d', 'in 2 days'],
    ['45 days ahead', 45 * DAY, 'in 45d', 'in 1 month'],
  ]
  it.each(ROWS)('%s', (_name, offset, compact, long) => {
    expect(formatRelative(at(offset), { style: 'compact', now: NOW })).toBe(compact)
    expect(formatRelative(at(offset), { style: 'long', now: NOW })).toBe(long)
  })

  it('takes `now` as a Date or as epoch milliseconds', () => {
    expect(formatRelative(at(-5 * MIN), { style: 'compact', now: NOW.getTime() })).toBe('5m ago')
    expect(formatRelative(at(-5 * MIN), { style: 'compact', now: NOW })).toBe('5m ago')
  })

  it('takes a Date the caller has already parsed (parseApiDate) as well as a string', () => {
    expect(formatRelative(new Date(NOW.getTime() - 3 * HOUR), { style: 'long', now: NOW })).toBe('3 hrs ago')
  })

  it('reads the same in every zone, because an instant has no zone', () => {
    for (const zone of ['UTC', 'Australia/Sydney', 'America/New_York']) {
      if (!setZone(zone)) continue
      expect(formatRelative(at(-5 * DAY), { style: 'compact', now: NOW })).toBe('5d ago')
    }
  })

  it('reads "Never" / "never" when no moment was recorded', () => {
    for (const value of [null, undefined, '']) {
      expect(formatRelative(value, { style: 'compact', now: NOW })).toBe('Never')
      expect(formatRelative(value, { style: 'long', now: NOW })).toBe('never')
    }
  })

  it('reads an en dash for a value that is not a date', () => {
    expect(formatRelative('not-a-date', { style: 'compact', now: NOW })).toBe('—')
    expect(formatRelative(new Date('nope'), { style: 'long', now: NOW })).toBe('—')
  })
})

describe('formatRelative: a date-only value is a calendar day', () => {
  // "now" is built from LOCAL parts (1 Oct 2026, 03:40 on the viewer's wall clock), so the local day is the 1st in any zone.
  const LOCAL_NOW = new Date(2026, 9, 1, 3, 40)

  // [date, compact, long]. A due date of 30 Sep used to read "17h ago" (counted from UTC midnight), and 1 Oct read "upcoming".
  it.each<[string, string, string]>([
    ['2026-10-01', 'Today', 'today'],
    ['2026-09-30', '1d ago', '1 day ago'],
    ['2026-09-28', '3d ago', '3 days ago'],
    ['2026-09-01', '30d ago', '1 month ago'],
    ['2026-10-02', 'in 1d', 'in 1 day'],
    ['2026-10-11', 'in 10d', 'in 10 days'],
    ['2027-10-01', 'in 365d', 'in 12 months'],
    ['2026-02-30', '—', '—'],
  ])('%s', (date, compact, long) => {
    expect(formatRelative(date, { style: 'compact', now: LOCAL_NOW })).toBe(compact)
    expect(formatRelative(date, { style: 'long', now: LOCAL_NOW })).toBe(long)
  })

  it('gives the same answer in every zone', () => {
    for (const zone of ['UTC', 'Australia/Sydney', 'Australia/Brisbane', 'America/New_York', 'Pacific/Auckland']) {
      if (!setZone(zone)) continue
      const now = new Date(2026, 9, 1, 3, 40)
      expect(formatRelative('2026-09-28', { style: 'compact', now })).toBe('3d ago')
      expect(formatRelative('2026-10-01', { style: 'compact', now })).toBe('Today')
    }
  })

  it('treats a date with a time as an instant, not a day', () => {
    expect(formatRelative('2026-09-30T00:00:00Z', { style: 'compact', now: NOW })).toBe('17h ago')
  })
})

describe('formatAge', () => {
  // [offset from now, expected]
  it.each<[string, number, string]>([
    ['right now', 0, '<1h'],
    ['30 seconds ago', -30 * SEC, '<1h'],
    ['59 min 59 s ago', -(59 * MIN + 59 * SEC), '<1h'],
    ['60 minutes ago', -60 * MIN, '1h'],
    ['119 minutes ago (rounds down)', -119 * MIN, '1h'],
    ['5 hours ago', -5 * HOUR, '5h'],
    ['23 h 59 min ago', -(23 * HOUR + 59 * MIN), '23h'],
    ['24 hours ago', -24 * HOUR, '1d'],
    ['47 hours ago (rounds down)', -47 * HOUR, '1d'],
    ['5 days ago', -5 * DAY, '5d'],
    ['400 days ago', -400 * DAY, '400d'],
    ['2 hours ahead (clock skew)', 2 * HOUR, '<1h'],
  ])('%s is %s', (_name, offset, expected) => {
    expect(formatAge(at(offset), { now: NOW })).toBe(expected)
  })

  it('reads an en dash for nothing or for a value that is not a date', () => {
    for (const value of [null, undefined, '', 'not-a-date', new Date('nope')]) expect(formatAge(value, { now: NOW })).toBe('—')
  })

  it('takes a Date and epoch milliseconds for now', () => {
    expect(formatAge(new Date(NOW.getTime() - 3 * HOUR), { now: NOW.getTime() })).toBe('3h')
  })
})

describe('formatDateTimeAu', () => {
  it('reads an en dash for nothing', () => {
    for (const value of [null, undefined, '']) expect(formatDateTimeAu(value)).toBe('—')
  })

  it('prints day/month/year, then the time, in the viewer zone (the pages this came from printed the same)', () => {
    setZone('UTC')
    // The space before "pm" is an ordinary space or U+202F depending on the ICU build, so match any whitespace.
    expect(formatDateTimeAu('2026-03-27T13:45:00Z')).toMatch(/^27\/03\/2026, 01:45\spm$/)
    expect(formatDateTimeAu('2026-03-27T00:05:00Z')).toMatch(/^27\/03\/2026, 12:05\sam$/)
  })
})

describe('formatNoteTimestamp', () => {
  it('prints the medium date and short time in the viewer zone', () => {
    setZone('UTC')
    // "Sept" or "Sep" depending on the ICU build, like every en-AU medium date.
    expect(formatNoteTimestamp('2026-09-08T19:30:00Z')).toMatch(/^8 Sept? 2026, 7:30\spm$/)
  })
})
