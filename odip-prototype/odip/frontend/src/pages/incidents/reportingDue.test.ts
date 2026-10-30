import { describe, it, expect } from 'vitest'
import { defaultReportableClass, formatDueWhen, formatGap, reportingDueLines, type ReportingDueInput } from './reportingDue'

describe('defaultReportableClass (same rows as the server DefaultClass table)', () => {
  it.each([
    ['Critical', 'Injury', null, 'Within24h'],
    ['Minor', 'Injury', null, 'None'],
    ['Minor', 'Abuse', null, 'Within24h'],
    ['Minor', 'Neglect', undefined, 'Within24h'],
    ['Minor', 'Death', true, 'Within24h'],
    ['Minor', 'MissingPerson', null, 'Within24h'],
    ['Minor', 'RestrictivePracticeUse', true, 'Within24h'],
    ['Minor', 'Injury', false, 'Within24h'],
    ['Minor', 'Injury', true, 'None'],
    ['Major', 'Other', null, 'None'],
  ] as const)('%s %s rp=%s gives %s', (severity, type, rp, expected) => {
    expect(defaultReportableClass(severity, type, rp)).toBe(expected)
  })
})

describe('formatDueWhen', () => {
  it('reads like "Fri 30 Oct 2026, 3:15 pm" in the provider zone', () => {
    expect(formatDueWhen('2026-10-30T04:15:00Z', 'Australia/Sydney')).toBe('Fri 30 Oct 2026, 3:15 pm')
    expect(formatDueWhen('2026-10-30T04:15:00Z', 'Australia/Perth')).toBe('Fri 30 Oct 2026, 12:15 pm')
  })
})

describe('formatGap', () => {
  it.each([
    [0, 'less than a minute'],
    [59_000, 'less than a minute'],
    [60_000, '1 minute'],
    [45 * 60_000, '45 minutes'],
    [60 * 60_000, '1 hour'],
    [5 * 3_600_000, '5 hours'],
    [47 * 3_600_000, '47 hours'],
    [48 * 3_600_000, '2 days'],
    [-3 * 24 * 3_600_000, '3 days'],
  ])('%i ms reads %s', (ms, text) => expect(formatGap(ms)).toBe(text))
})

const base: ReportingDueInput = {
  reportableClass: 'Within24h',
  qscReportingStatus: 'Required',
  qscReportedAt: null,
  notifyDueAt: '2026-10-30T04:15:00Z',
  detailedReportDueAt: '2026-11-06T12:59:59Z',
  commissionDetailedReportedAt: null,
  dueCountedWithoutHolidays: false,
  timeZoneId: 'Australia/Sydney',
}
const texts = (i: ReportingDueInput, now: string) => reportingDueLines(i, new Date(now)).map((l) => l.text)

describe('reportingDueLines', () => {
  it('class None is just "Not reportable"', () => {
    expect(texts({ ...base, reportableClass: 'None', qscReportingStatus: 'NotRequired', notifyDueAt: null, detailedReportDueAt: null }, '2026-10-30T00:00:00Z')).toEqual(['Not reportable'])
  })
  it('before the deadline: tell by, with the gap', () => {
    expect(texts(base, '2026-10-29T23:15:00Z')).toEqual([
      'Tell the NDIS Commission by Fri 30 Oct 2026, 3:15 pm (in 5 hours)',
      '5-day report due by Fri 6 Nov 2026, 11:59 pm',
    ])
  })
  it('at or after the deadline: overdue by', () => {
    expect(texts(base, '2026-10-30T04:15:00Z')[0]).toBe('Overdue by less than a minute')
    expect(texts(base, '2026-10-31T04:15:00Z')[0]).toBe('Overdue by 24 hours')
    expect(reportingDueLines(base, new Date('2026-10-30T06:15:00Z'))[0]).toEqual({ text: 'Overdue by 2 hours', tone: 'overdue' })
  })
  it('met and met late', () => {
    expect(texts({ ...base, qscReportingStatus: 'ReportedWithin24h', qscReportedAt: '2026-10-30T10:00:00' }, '2026-11-01T00:00:00Z')[0]).toBe('Reported on time')
    expect(texts({ ...base, qscReportingStatus: 'ReportedLate', qscReportedAt: '2026-10-30T16:00:00' }, '2026-11-01T00:00:00Z')[0]).toBe('Reported late')
  })
  it('the 5-day report: overdue, then sent', () => {
    expect(texts(base, '2026-11-06T14:59:59Z')[1]).toBe('5-day report overdue by 2 hours')
    expect(texts({ ...base, commissionDetailedReportedAt: '2026-11-03T14:05:00' }, '2026-11-06T14:59:59Z')[1]).toBe('5-day report sent Tue 3 Nov 2026, 2:05 pm')
  })
  it('a Within5BusinessDays incident has no 5-day line', () => {
    expect(texts({ ...base, reportableClass: 'Within5BusinessDays', detailedReportDueAt: null }, '2026-10-29T23:15:00Z')).toHaveLength(1)
  })
  it('says when the days were counted without public holidays', () => {
    const lines = reportingDueLines({ ...base, dueCountedWithoutHolidays: true }, new Date('2026-10-29T23:15:00Z'))
    expect(lines.at(-1)).toEqual({ text: 'Counted without public holidays', tone: 'muted' })
  })
})
