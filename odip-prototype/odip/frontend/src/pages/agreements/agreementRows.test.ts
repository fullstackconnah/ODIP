import { describe, expect, it } from 'vitest'
import type { AgreementRevisionRef, AgreementRow } from '@/api/types'
import { approveTargets, bulkSkipCount, bulkSkipNotes, filterRows, latestEnd, listOptions, parseShow, statusBadge, termView } from './agreementRows'

const rev = (n: number, start: string, end: string, total = 1000): AgreementRevisionRef => ({ draftId: `d${n}`, version: n, agreementStartDate: start, agreementEndDate: end, total })
const row = (over: Partial<AgreementRow> & { participantName: string }): AgreementRow => ({
  participantId: over.participantName, status: 'Active', endingState: 'None', hasWaitingDraft: false, current: rev(1, '2026-01-01', '2026-12-31'),
  waiting: null, daysLeft: null, termStart: '2026-01-01', priceList: { version: '2025-26', start: '2025-07-01' }, newerPriceList: null, ...over,
})

const rows = [
  row({ participantName: 'Ana Lee' }),
  row({ participantName: 'Ben Ng', status: 'Ending', endingState: 'Ending', daysLeft: 12 }),
  row({ participantName: 'Cal Ox', status: 'Ended', endingState: 'Ended', daysLeft: -3 }),
  // A draft waiting hides "ending" in the status word, never in the facts.
  row({ participantName: 'Dee Ray', status: 'DraftWaiting', endingState: 'Ending', hasWaitingDraft: true, waiting: rev(2, '2027-01-01', '2027-12-31'), daysLeft: 5 }),
  row({ participantName: 'Eve Fox', status: 'NotApproved', current: null, waiting: rev(1, '2026-03-01', '2027-02-28'), hasWaitingDraft: true, termStart: null, priceList: null }),
  row({ participantName: 'Fay Kim', priceList: { version: '2026-27', start: '2026-07-01' }, newerPriceList: { version: '2027-28', start: '2027-07-01' } }),
]
const names = (r: AgreementRow[]) => r.map(x => x.participantName)

describe('filterRows', () => {
  const f = { show: 'all' as const, list: '', q: '' }
  it('reads the facts, not the status word', () => {
    expect(names(filterRows(rows, { ...f, show: 'ending' }))).toEqual(['Ben Ng', 'Cal Ox', 'Dee Ray'])
    expect(names(filterRows(rows, { ...f, show: 'ended' }))).toEqual(['Cal Ox'])
    expect(names(filterRows(rows, { ...f, show: 'draft' }))).toEqual(['Dee Ray', 'Eve Fox'])
    expect(names(filterRows(rows, { ...f, show: 'new-price-list' }))).toEqual(['Fay Kim'])
  })
  it('narrows by price list and by name together', () => {
    expect(names(filterRows(rows, { ...f, list: '2025-26', q: ' ana ' }))).toEqual(['Ana Lee'])
    expect(filterRows(rows, f)).toHaveLength(6)
  })
})

describe('parseShow, listOptions', () => {
  it('falls back to all', () => { expect(parseShow('nope')).toBe('all'); expect(parseShow(null)).toBe('all'); expect(parseShow('draft')).toBe('draft') })
  it('lists the lists in use, newest first', () => expect(listOptions(rows).map(l => l.version)).toEqual(['2026-27', '2025-26']))
})

describe('statusBadge', () => {
  it('words each status', () => {
    expect(statusBadge(rows[0])).toEqual({ tone: 'success', label: 'Active' })
    expect(statusBadge(rows[1])).toEqual({ tone: 'warning', label: 'Ends in 12 days' })
    expect(statusBadge(rows[2])).toEqual({ tone: 'danger', label: 'Ended' })
    expect(statusBadge(rows[3])).toEqual({ tone: 'warning', label: 'Draft waiting' })
    expect(statusBadge(rows[4])).toEqual({ tone: 'neutral', label: 'Not approved yet' })
  })
})

describe('approveTargets', () => {
  it('takes only ticked rows that have a draft waiting', () =>
    expect(approveTargets(rows, new Set(['Ana Lee', 'Dee Ray', 'Eve Fox']))).toEqual([{ participantId: 'Dee Ray', draftId: 'd2' }, { participantId: 'Eve Fox', draftId: 'd1' }]))
})

describe('termView', () => {
  it('shows the term from its first revision and a "from" line for a mid-term change', () => {
    const v = termView(row({ participantName: 'X', current: rev(3, '2026-06-01', '2026-12-31', 500), termStart: '2026-01-01' }))
    expect(v).toMatchObject({ total: 500, from: '2026-06-01', draftLine: null })
    expect(v.range).toBe('1 Jan – 31 Dec 2026')
  })
  it('names the waiting draft, and a never-approved one', () => {
    expect(termView(rows[3]).draftLine).toBe('Draft v2: 1 Jan – 31 Dec 2027')
    expect(termView(rows[4])).toMatchObject({ draftLine: 'Draft v1, never approved', from: null })
  })
})

describe('bulkSkipNotes', () => {
  const list = { version: '2026-27', start: '2026-07-01' }
  it('counts each row once, by the first reason that skips it', () => {
    expect(bulkSkipNotes(rows, 'renew')).toEqual(['2 have a draft waiting and will be skipped.'])
    expect(bulkSkipNotes([rows[3]], 'extend')).toEqual(['1 has a draft waiting and will be skipped.'])
    expect(bulkSkipNotes(rows, 'reprice', list)).toEqual([
      '2 have a draft waiting and will be skipped.', '1 has ended and will be skipped.', '1 is already on 2026-27 or a newer price list and will be skipped.',
    ])
  })
  it('says nothing when nothing is skipped, and ended rows are renewed', () => {
    expect(bulkSkipNotes([rows[0], rows[2]], 'renew')).toEqual([])
    expect(bulkSkipNotes([rows[0]], 'reprice', list)).toEqual([])
  })
})

describe('bulkSkipCount', () => {
  const list = { version: '2026-27', start: '2026-07-01' }
  it('adds up every row the notes name, once each', () => {
    expect(bulkSkipCount(rows, 'renew')).toBe(2)
    expect(bulkSkipCount(rows, 'reprice', list)).toBe(4)
    expect(bulkSkipCount([rows[0]], 'extend')).toBe(0)
  })
})

describe('latestEnd', () => {
  it('is the latest end among the approved agreements, or null', () => {
    expect(latestEnd([rows[0], rows[1]])).toBe('2026-12-31')
    expect(latestEnd([rows[4]])).toBeNull()
  })
})
