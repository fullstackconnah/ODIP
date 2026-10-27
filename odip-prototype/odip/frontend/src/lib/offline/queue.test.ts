import { beforeEach, describe, expect, it } from 'vitest'
import { createQueue, replayBody, type NewRecord, type QueueRecord, type SendResult } from './queue'

const label = { participant: 'Jordan Smith', serviceDate: '2026-10-28', rostered: '9:00 am - 1:00 pm' }
const ok: SendResult = { kind: 'ok', data: {} }
const refused = (status: number, code?: string, blockers?: string[]): SendResult => ({ kind: 'refused', status, code, blockers, error: new Error(`refused ${status}`) })

let clock: number
let ids: number
let sent: { rec: QueueRecord; asReplay: boolean; body: unknown }[]
let answer: (rec: QueueRecord, asReplay: boolean) => SendResult
let status: { kind: 'ok'; status: string } | { kind: 'offline' } | { kind: 'refused'; status: number }
let online: boolean

function make() {
  return createQueue({
    send: async (rec, asReplay) => { sent.push({ rec, asReplay, body: replayBody(rec, asReplay) }); return answer(rec, asReplay) },
    shiftStatus: async () => status,
    now: () => (clock += 1000),
    newId: () => `id-${++ids}`,
    isOnline: () => online,
  })
}

const rec = (kind: NewRecord['kind'], extra: Partial<NewRecord> = {}, shiftId = 's1'): NewRecord => ({
  shiftId, kind, path: `/portal/shifts/${shiftId}/${kind}`, method: 'POST', body: {}, label, ...extra,
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
  clock = Date.parse('2026-10-28T00:00:00Z')
  ids = 0
  sent = []
  answer = () => ok
  status = { kind: 'ok', status: 'InProgress' }
  online = false
})

describe('offline queue', () => {
  it('replay order: start, note, breaks (in tap order), tick, finish regardless of tap order', async () => {
    const q = make()
    for (const k of ['finish', 'note', 'tick', 'start', 'breakEnd', 'breakStart'] as const) q.enqueue(rec(k))
    online = true
    await q.replay()
    expect(sent.map((s) => s.rec.kind)).toEqual(['start', 'note', 'breakEnd', 'breakStart', 'tick', 'finish'])
  })

  it('break start and end keep tap order within their rank', async () => {
    const q = make()
    for (const k of ['breakStart', 'breakEnd', 'breakStart', 'breakEnd'] as const) q.enqueue(rec(k))
    online = true
    await q.replay()
    expect(sent.map((s) => s.rec.kind)).toEqual(['breakStart', 'breakEnd', 'breakStart', 'breakEnd'])
  })

  it('replay bodies carry the client time; live bodies carry the ids but no client time', async () => {
    const q = make()
    online = true
    await q.sendOrQueue(rec('start', { body: { geolocationDeclined: true }, clientTimeField: 'startedAt' }))
    await q.sendOrQueue(rec('breakStart', { body: { breakId: 'b1' }, clientTimeField: 'startedAt' }, 's2'))
    await q.sendOrQueue(rec('note', { body: { id: 'n1', createdAt: '2026-10-28T00:00:09Z', body: 'hi' } }, 's3'))
    await q.sendOrQueue(rec('breakEnd', { clientTimeField: 'endedAt' }, 's4'))
    await q.sendOrQueue(rec('finish', { body: { kilometres: 3 }, clientTimeField: 'finishedAt' }, 's5'))
    expect(sent.map((s) => s.body)).toEqual([
      { geolocationDeclined: true },
      { breakId: 'b1' },
      { id: 'n1', createdAt: '2026-10-28T00:00:09Z', body: 'hi' },
      {},
      { kilometres: 3 },
    ])
    sent = []
    online = false
    const r1 = q.enqueue(rec('start', { body: { geolocationDeclined: true }, clientTimeField: 'startedAt' }, 's6'))
    const r2 = q.enqueue(rec('breakStart', { body: { breakId: 'b9' }, clientTimeField: 'startedAt' }, 's6'))
    const r3 = q.enqueue(rec('finish', { body: { kilometres: 3, nothingToNote: true }, clientTimeField: 'finishedAt' }, 's6'))
    online = true
    await q.replay()
    expect(sent.map((s) => s.body)).toEqual([
      { geolocationDeclined: true, startedAt: r1.clientTime },
      { breakId: 'b9', startedAt: r2.clientTime },
      { kilometres: 3, nothingToNote: true, finishedAt: r3.clientTime },
    ])
  })

  it('live attempt with a lost response, then replay reuses the same id', async () => {
    const q = make()
    online = true
    answer = () => ({ kind: 'offline' })
    const out = await q.sendOrQueue(rec('breakStart', { body: { breakId: 'b1' }, clientTimeField: 'startedAt' }))
    expect(out.queued).toBe(true)
    answer = () => ok
    await q.replay()
    expect(sent.map((s) => (s.body as { breakId: string }).breakId)).toEqual(['b1', 'b1'])
    expect(sent[0].rec.id).toBe(sent[1].rec.id)
    expect(q.getSnapshot()).toEqual([])
  })

  it('a tick after a waiting Start is queued, not sent live', async () => {
    const q = make()
    q.enqueue(rec('start'))
    online = true
    answer = () => ({ kind: 'offline' })
    const out = await q.sendOrQueue(rec('tick'))
    expect(out.queued).toBe(true)
    expect(sent.filter((s) => !s.asReplay)).toEqual([])
    expect(q.getSnapshot().map((r) => r.kind)).toEqual(['start', 'tick'])
  })

  it('a write behind a Not sent record is queued', async () => {
    const q = make()
    online = true
    answer = () => refused(409, 'SHIFT_CANCELLED')
    q.enqueue(rec('note'))
    await q.replay()
    sent = []
    const out = await q.sendOrQueue(rec('tick'))
    expect(out.queued).toBe(true)
    expect(sent).toEqual([])
  })

  it('a live 4xx is rethrown for the screen to handle', async () => {
    const q = make()
    online = true
    answer = () => refused(409, 'SHIFT_NOT_IN_PROGRESS')
    await expect(q.sendOrQueue(rec('tick'))).rejects.toThrow('refused 409')
    expect(q.getSnapshot()).toEqual([])
  })

  it('retry: 422 gives Not sent, retry sends once with the same body, and a second concurrent retry does not double-send', async () => {
    const q = make()
    online = true
    answer = () => refused(422, 'SHIFT_FINISH_BLOCKED', ['DOSE_OUTCOME_MISSING'])
    const f = q.enqueue(rec('finish', { body: { kilometres: 2 }, clientTimeField: 'finishedAt' }))
    await q.replay()
    expect(q.getSnapshot()[0]).toMatchObject({ status: 'notSent', httpStatus: 422, code: 'SHIFT_FINISH_BLOCKED', blockers: ['DOSE_OUTCOME_MISSING'] })
    sent = []
    answer = () => ok
    await Promise.all([q.retry(f.id), q.retry(f.id)])
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ kilometres: 2, finishedAt: f.clientTime })
    expect(q.getSnapshot()).toEqual([])
  })

  it('queue survives reload', () => {
    const a = make()
    a.enqueue(rec('note', { body: { id: 'n1', body: 'x' } }))
    const b = make()
    expect(b.getSnapshot()).toHaveLength(1)
    expect(b.getSnapshot()[0]).toMatchObject({ kind: 'note', status: 'waiting', userId: 'u1' })
  })

  it('already done counts as sent: a 200 replay of start, break and note removes the record', async () => {
    const q = make()
    online = true
    for (const k of ['start', 'breakStart', 'note'] as const) q.enqueue(rec(k))
    const r = await q.replay()
    expect(r.sent).toBe(3)
    expect(q.getSnapshot()).toEqual([])
  })

  it('Finish already submitted: no POST, the callout flag is set and the record goes', async () => {
    const q = make()
    online = true
    status = { kind: 'ok', status: 'PendingReview' }
    q.enqueue(rec('finish', { clientTimeField: 'finishedAt' }))
    await q.replay()
    expect(sent).toEqual([])
    expect(q.getSnapshot()).toEqual([])
    expect(q.wasAlreadySubmitted('s1')).toBe(true)
  })

  it('Finish whose shift 404s is Not sent; a detail network error stops and leaves it waiting', async () => {
    const q = make()
    online = true
    q.enqueue(rec('finish'))
    status = { kind: 'refused', status: 404 }
    await q.replay()
    expect(q.getSnapshot()[0]).toMatchObject({ status: 'notSent', httpStatus: 404 })
    const q2 = make()
    localStorage.clear()
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    q2.enqueue(rec('finish'))
    status = { kind: 'offline' }
    const r = await q2.replay()
    expect(r.offline).toBe(true)
    expect(sent).toEqual([])
    expect(q2.getSnapshot()[0].status).toBe('waiting')
  })

  it('Not sent holds the chain; another shift still sends', async () => {
    const q = make()
    online = true
    q.enqueue(rec('note'))
    q.enqueue(rec('tick'))
    q.enqueue(rec('finish'))
    q.enqueue(rec('start', {}, 's2'))
    answer = (r) => (r.kind === 'note' ? refused(409, 'SHIFT_CANCELLED') : ok)
    await q.replay()
    expect(sent.map((s) => s.rec.kind)).toEqual(['note', 'start'])
    expect(q.getSnapshot().map((r) => `${r.kind}:${r.status}`)).toEqual(['note:notSent', 'tick:waiting', 'finish:waiting'])
    sent = []
    await q.replay()
    expect(sent).toEqual([])
  })

  it('a refusal is recorded with its status and code', async () => {
    const q = make()
    online = true
    answer = () => refused(400, 'SHIFT_CLIENT_TIME_TOO_OLD')
    q.enqueue(rec('start'))
    await q.replay()
    expect(q.getSnapshot()[0]).toMatchObject({ status: 'notSent', httpStatus: 400, code: 'SHIFT_CLIENT_TIME_TOO_OLD' })
  })

  it('5xx, 408, 429 and no response stay waiting and stop the replay', async () => {
    const q = make()
    online = true
    q.enqueue(rec('start'))
    q.enqueue(rec('note', {}, 's2'))
    answer = () => ({ kind: 'offline' })
    const r = await q.replay()
    expect(r).toMatchObject({ offline: true, sent: 0, notSent: 0, waiting: 2 })
    expect(sent).toHaveLength(1)
    expect(q.getSnapshot().every((x) => x.status === 'waiting')).toBe(true)
  })

  it('user or view-as mismatch holds: another session sends nothing of this one', async () => {
    const q = make()
    online = true
    q.enqueue(rec('start'))
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u2' }))
    await q.replay()
    expect(sent).toEqual([])
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('odip_viewing_tenant', 'tenant-b')
    expect(q.getSnapshot()).toEqual([])
    await q.replay()
    expect(sent).toEqual([])
  })

  it('no double replay: two triggers at once give one send', async () => {
    const q = make()
    online = true
    q.enqueue(rec('start'))
    await Promise.all([q.replay(), q.replay()])
    expect(sent).toHaveLength(1)
  })

  it('discard removes only that record', () => {
    const q = make()
    const a = q.enqueue(rec('note'))
    q.enqueue(rec('tick'))
    q.discard(a.id)
    expect(q.getSnapshot().map((r) => r.kind)).toEqual(['tick'])
  })

  it('rewriteBody changes a still-waiting record only', () => {
    const q = make()
    const a = q.enqueue(rec('note', { body: { id: 'n', body: 'old' } }))
    q.rewriteBody(a.id, { id: 'n', body: 'new' })
    expect(q.getSnapshot()[0].body).toEqual({ id: 'n', body: 'new' })
  })

  it('the snapshot is the same array until something changes', () => {
    const q = make()
    q.enqueue(rec('note'))
    expect(q.getSnapshot()).toBe(q.getSnapshot())
  })

  it('all sent: the sync state records when the last one went', async () => {
    const q = make()
    online = true
    q.enqueue(rec('start'))
    await q.replay()
    expect(q.getSyncState()).toMatchObject({ sending: false, stillOffline: false })
    expect(q.getSyncState().allSentAt).not.toBeNull()
  })

  it('dropOtherUsers keeps the same user and removes another', () => {
    const q = make()
    q.enqueue(rec('start'))
    localStorage.setItem('odip_offline:u0:queue', '[]')
    q.dropOtherUsers('u1')
    expect(localStorage.getItem('odip_offline:u0:queue')).toBeNull()
    expect(q.getSnapshot()).toHaveLength(1)
    q.dropOtherUsers('u9')
    expect(q.getSnapshot()).toHaveLength(0)
  })
})
