import { describe, expect, it } from 'vitest'
import type { PortalShiftDetailDto, ShiftNoteDto } from '@/api/types'
import type { QueueRecord } from './queue'
import { applyQueued, applyQueuedNotes } from './overlay'

const rec = (extra: Partial<QueueRecord>): QueueRecord => ({
  id: 'r1', userId: 'u1', viewAsTenant: null, viewAsUser: null, shiftId: 's1', kind: 'start', path: '/p', method: 'POST', body: {},
  clientTime: '2026-10-28T00:02:00Z', createdAt: 1, status: 'waiting', label: { participant: 'J', serviceDate: '2026-10-28', rostered: '9:00 am' }, ...extra,
})

const detail = {
  id: 's1', status: 'Published', timeZoneId: 'Australia/Sydney', completion: null, breaks: [],
  shiftRoutines: [{ id: 'rt1', isChecked: false, checkedAt: null, checkedByName: null }, { id: 'rt2', isChecked: true, checkedAt: 'x', checkedByName: 'Sam' }],
  handover: { isRead: false, readAt: null }, finishBlockers: [{ code: 'BREAK_RUNNING' }],
} as unknown as PortalShiftDetailDto

describe('applyQueued', () => {
  it('a queued start shows In progress with the tapped time as the start', () => {
    const out = applyQueued(detail, [rec({ body: { geolocationDeclined: true } })])
    expect(out.status).toBe('InProgress')
    expect(out.completion).toMatchObject({ actualStart: '2026-10-28T00:02:00Z', startedAt: '2026-10-28T00:02:00Z', geolocationDeclined: true })
  })

  it('a queued tick shows as done and a queued untick as not done', () => {
    const out = applyQueued(detail, [rec({ kind: 'tick', target: 'rt1' }), rec({ id: 'r2', kind: 'untick', target: 'rt2' })])
    expect(out.shiftRoutines.map((r) => r.isChecked)).toEqual([true, false])
  })

  it('a queued handover read shows as read', () => {
    expect(applyQueued(detail, [rec({ kind: 'ack' })]).handover).toMatchObject({ isRead: true, readAt: '2026-10-28T00:02:00Z' })
  })

  it('a queued break start is running, and a queued end closes it and clears the blocker', () => {
    const started = applyQueued(detail, [rec({ id: 'b1', kind: 'breakStart' })])
    expect(started.breaks).toMatchObject([{ id: 'b1', isRunning: true, endedAt: null }])
    const ended = applyQueued(detail, [rec({ id: 'b1', kind: 'breakStart' }), rec({ id: 'e1', kind: 'breakEnd', target: 'b1', clientTime: '2026-10-28T00:27:00Z' })])
    expect(ended.breaks).toMatchObject([{ id: 'b1', isRunning: false, minutes: 25 }])
    expect(ended.finishBlockers).toEqual([])
  })

  it('records for another shift, and Not sent records, change nothing', () => {
    expect(applyQueued(detail, [rec({ shiftId: 's2' }), rec({ status: 'notSent' })])).toBe(detail)
  })
})

describe('applyQueuedNotes', () => {
  const sent = { id: 'n0', body: 'old' } as ShiftNoteDto
  it('lists a queued note with the waiting flag and no "edited" gap', () => {
    const out = applyQueuedNotes([sent], [rec({ id: 'n1', kind: 'note', body: { id: 'n1', createdAt: '2026-10-28T00:05:00Z', body: 'new' } })], 's1')
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: 'n1', body: 'new', waiting: true, createdAt: '2026-10-28T00:05:00Z', updatedAt: '2026-10-28T00:05:00Z' })
  })

  it('does not list a note the server already has', () => {
    expect(applyQueuedNotes([sent], [rec({ id: 'n0', kind: 'note', body: { body: 'old' } })], 's1')).toHaveLength(1)
  })
})
