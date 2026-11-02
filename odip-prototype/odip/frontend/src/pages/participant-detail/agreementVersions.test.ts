import { afterEach, describe, expect, it } from 'vitest'
import type { ServiceAgreementDraftDto } from '@/api/types'
import { localIsoDate } from '@/lib/dateOnly'
import { restoreZone, setZone } from '@/test/timeZone'
import { versionRows } from './agreementVersions'

afterEach(restoreZone)

const approval = { approvedAt: '2026-06-20T01:00:00Z', approvedByName: 'Sam Lee', patternsCreated: 2, patternsEnded: 0, shiftsCreated: 0 }

const version = (n: number, start: string, end: string, changes: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto => ({
  id: `d-${n}`, participantId: 'p-1', version: n, state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: start, agreementEndDate: end,
  blocks: [], lines: [], isSummary: true, blockCount: 1, lineCount: 1, total: 1000 * n, caveats: [], approval, ...changes,
}) as ServiceAgreementDraftDto

const TODAY = '2026-10-12'
const byVersion = (rows: ReturnType<typeof versionRows>, n: number) => rows.find(r => r.version === n)!

describe('versionRows: the status of each version, from the date', () => {
  it('Draft: no approval, and no approved line', () => {
    const [row] = versionRows([version(1, '2026-10-01', '2027-06-30', { approval: undefined })], TODAY)
    expect(row).toMatchObject({ status: 'Draft', newest: true, approvedLine: '—' })
  })

  it('Approved while it runs today, with the approval line "date · name"', () => {
    const [row] = versionRows([version(1, '2026-07-01', '2027-06-30')], TODAY)
    expect(row.status).toBe('Approved')
    expect(row.approvedLine).toBe('20 Jun 2026 · Sam Lee')
  })

  it('Ended when it ended before today, and Ended early when its signed end was moved up', () => {
    const rows = versionRows([version(2, '2026-07-01', '2026-09-30', { originalAgreementEndDate: '2027-06-30' }), version(1, '2025-07-01', '2026-06-30')], TODAY)
    expect(byVersion(rows, 1)).toMatchObject({ status: 'Ended', endedEarly: false })
    expect(byVersion(rows, 2)).toMatchObject({ status: 'Ended early', endedEarly: true })
  })

  it('stays Approved until the last day has passed, but the term already says what changed', () => {
    const [row] = versionRows([version(1, '2026-07-01', '2026-10-12', { originalAgreementEndDate: '2027-06-30' })], TODAY)
    expect(row.status).toBe('Approved')
    expect(row.term).toContain('was 30 Jun 2027')
  })

  it('Replaced: a newer approved revision started on or before its end, and that start has passed', () => {
    const rows = versionRows([version(4, '2026-09-01', '2027-06-30'), version(3, '2026-07-01', '2027-06-30')], TODAY)
    expect(byVersion(rows, 3)).toMatchObject({ status: 'Replaced', takesOverOn: '2026-09-01' })
    expect(byVersion(rows, 4).status).toBe('Approved')
  })

  it('v4 running with an approved renewal v5: v4 Approved, v5 Upcoming', () => {
    const rows = versionRows([version(5, '2027-07-01', '2028-06-30'), version(4, '2026-07-01', '2027-06-30')], TODAY)
    expect(byVersion(rows, 4)).toMatchObject({ status: 'Approved', takesOverOn: null })
    expect(byVersion(rows, 5).status).toBe('Upcoming')
    expect(byVersion(rows, 5).term).toMatch(/^from 1 Jul 2027/)
  })

  it('v3 running with a pattern change v4 from next month: v3 Approved (it still runs today), v4 Upcoming', () => {
    const rows = versionRows([version(4, '2026-11-01', '2027-06-30'), version(3, '2026-07-01', '2027-06-30')], TODAY)
    expect(byVersion(rows, 3)).toMatchObject({ status: 'Approved', takesOverOn: '2026-11-01' })
    expect(byVersion(rows, 4)).toMatchObject({ status: 'Upcoming', newest: true })
  })

  it('an older Draft stays a Draft, and only the highest version is the newest', () => {
    const rows = versionRows([version(3, '2026-10-01', '2027-06-30', { approval: undefined }), version(2, '2026-10-01', '2027-06-30', { approval: undefined })], TODAY)
    expect(rows.map(r => [r.version, r.status, r.newest])).toEqual([[3, 'Draft', true], [2, 'Draft', false]])
  })

  it('an Ongoing agreement says Ongoing instead of the stored end', () => {
    const [row] = versionRows([version(1, '2026-07-01', '2027-06-30', { isOngoing: true })], TODAY)
    expect(row.term).toBe('1 Jul 2026 – Ongoing')
  })

  it('the Term is one range, with the signed end after a dot when ended early', () => {
    const [row] = versionRows([version(1, '2026-07-01', '2026-11-15', { originalAgreementEndDate: '2027-06-30' })], TODAY)
    expect(row.term).toBe('1 Jul – 15 Nov 2026 · was 30 Jun 2027')
  })

  it('reads "today" in the viewer zone: 11 Oct 23:30 UTC is already 12 Oct in Sydney, so an agreement ended on the 11th is Ended there and Approved in UTC', () => {
    const instant = new Date('2026-10-11T23:30:00Z')
    const drafts = [version(1, '2026-07-01', '2026-10-11')]
    if (setZone('Australia/Sydney')) expect(versionRows(drafts, localIsoDate(instant))[0].status).toBe('Ended')
    if (setZone('UTC')) expect(versionRows(drafts, localIsoDate(instant))[0].status).toBe('Approved')
  })
})
