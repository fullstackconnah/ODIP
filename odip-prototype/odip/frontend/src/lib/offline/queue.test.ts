import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { apiSend, apiShiftStatus, createQueue, FINISH_TIMEOUT_MS, LEASE_MS, RETRY_AFTER_MS, replayBody, type NewRecord, type QueueRecord, type SendResult } from './queue'

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
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-b')
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

describe('offline queue: replay under load', () => {
  const LOCK = 'odip_offline:u1:replay-lock'
  const tick = () => new Promise((r) => setTimeout(r, 0))
  let gate: Promise<void>
  let release: () => void
  /** A queue whose first send waits for release(); later sends answer at once. */
  function gated(onFirst?: () => void) {
    gate = new Promise<void>((r) => { release = r })
    return createQueue({
      send: async (rec, asReplay) => {
        sent.push({ rec, asReplay, body: replayBody(rec, asReplay) })
        if (sent.length === 1) { onFirst?.(); await gate }
        return ok
      },
      shiftStatus: async () => status,
      now: () => (clock += 1000),
      newId: () => `id-${++ids}`,
      isOnline: () => online,
    })
  }
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('M1: onReplaySent fires once after a replay that sent something, not after one that sent nothing, and unsubscribes', async () => {
    const q = make()
    const cb = vi.fn()
    const off = q.onReplaySent(cb)
    online = true
    await q.replay()
    expect(cb).not.toHaveBeenCalled()
    q.enqueue(rec('note')); q.enqueue(rec('tick'))
    await q.replay()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    q.enqueue(rec('note'))
    await q.replay()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('S1: a record queued while a replay is sending goes out in the same run', async () => {
    const q = gated()
    q.enqueue(rec('note', { id: 'n1' }))
    online = true
    const first = q.replay()
    await tick()
    await q.sendOrQueue(rec('note', { id: 'n2' }))
    release()
    await first
    expect(sent.map((s) => s.rec.id)).toEqual(['n1', 'n2'])
    expect(q.pendingCount()).toBe(0)
  })

  it('S1: a live send that fails with a server blip is tried again 30 seconds later', async () => {
    vi.useFakeTimers()
    const q = make()
    online = true
    answer = () => ({ kind: 'offline' })
    const out = await q.sendOrQueue(rec('note', { id: 'n1' }))
    expect(out.queued).toBe(true)
    expect(sent).toHaveLength(1)
    answer = () => ok
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sent.map((s) => s.asReplay)).toEqual([false, true])
    expect(q.pendingCount()).toBe(0)
  })

  it('S2: requests carry a 15 s timeout, and a timed-out live send is queued under the same id', async () => {
    const request = vi.spyOn(apiClient, 'request').mockRejectedValue({ code: 'ECONNABORTED' })
    const get = vi.spyOn(apiClient, 'get').mockRejectedValue({ code: 'ECONNABORTED' })
    const q = createQueue({ send: apiSend, shiftStatus: apiShiftStatus, now: () => (clock += 1000), newId: () => `id-${++ids}`, isOnline: () => true })
    const out = await q.sendOrQueue(rec('note', { id: 'n1' }))
    expect(out).toMatchObject({ queued: true, record: { id: 'n1', status: 'waiting' } })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeout: 15_000 }))
    expect(await apiShiftStatus('s1')).toEqual({ kind: 'offline' })
    expect(get).toHaveBeenCalledWith('/portal/shifts/s1', expect.objectContaining({ timeout: 15_000 }))
  })

  it('S3: a second tab replaying while the first is sending sends nothing; a tick then an untick arrive in that order, each once', async () => {
    const a = gated()
    const b = make()
    online = true
    a.enqueue(rec('tick', { target: 'r1' }))
    const first = a.replay()
    await tick()
    await a.sendOrQueue(rec('untick', { target: 'r1' }))
    expect(await b.replay()).toMatchObject({ sent: 0 })
    release()
    await first
    expect(sent.map((s) => s.rec.kind)).toEqual(['tick', 'untick'])
    expect(localStorage.getItem(LOCK)).toBeNull()
  })

  it('S3: a stale lease is taken over; a younger one is respected', async () => {
    const q = make()
    online = true
    q.enqueue(rec('note'))
    localStorage.setItem(LOCK, String(clock - 1000))
    expect(await q.replay()).toMatchObject({ sent: 0 })
    localStorage.setItem(LOCK, String(clock - LEASE_MS - 1000))
    expect(await q.replay()).toMatchObject({ sent: 1 })
    expect(localStorage.getItem(LOCK)).toBeNull()
  })

  it('Should 3: a replay the lease refuses is looked at again after RETRY_AFTER_MS, with one timer however often it is refused', async () => {
    vi.useFakeTimers()
    const q = make()
    online = true
    q.enqueue(rec('note'))
    localStorage.setItem(LOCK, String(clock))
    const before = vi.getTimerCount()
    expect(await q.replay()).toMatchObject({ sent: 0 })
    expect(await q.replay()).toMatchObject({ sent: 0 })
    expect(vi.getTimerCount() - before).toBe(1)
    clock += LEASE_MS
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS - 1)
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(sent).toHaveLength(1)
    expect(q.pendingCount()).toBe(0)
  })

  it('Nit 2: a replay releases only its own lease, not one another tab took over', async () => {
    const a = gated(() => localStorage.setItem(LOCK, 'other-tab'))
    a.enqueue(rec('note'))
    online = true
    const run = a.replay()
    await tick()
    release()
    await run
    expect(localStorage.getItem(LOCK)).toBe('other-tab')
  })

  it('Nit 3: a Finish is sent with the 45 s timeout and any other request with 15 s', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: { data: {} } })
    const row = (kind: string) => ({ id: `r-${kind}`, kind, path: `/portal/shifts/s1/${kind}`, method: 'POST', body: {} }) as unknown as QueueRecord
    await apiSend(row('finish'), false)
    await apiSend(row('note'), false)
    expect(request.mock.calls.map(([c]) => c.timeout)).toEqual([FINISH_TIMEOUT_MS, 15_000])
    expect(FINISH_TIMEOUT_MS).toBe(45_000)
  })

  it('S3: a record another tab removed after this replay took its snapshot is not sent', async () => {
    const b = make()
    const a = gated(() => b.discard('n2'))
    a.enqueue(rec('start', { id: 'n1' })); a.enqueue(rec('note', { id: 'n2' }))
    online = true
    release()
    await a.replay()
    expect(sent.map((s) => s.rec.id)).toEqual(['n1'])
  })

  it('S5: a note edited while its POST is in flight is sent again as a PUT with the new text', async () => {
    const q = gated(() => q.rewriteBody('n1', { id: 'n1', createdAt: 'c', body: 'new' }))
    q.enqueue(rec('note', { id: 'n1', body: { id: 'n1', createdAt: 'c', body: 'old' } }))
    online = true
    release()
    await q.replay()
    expect(sent.map((s) => [s.rec.method, s.rec.path, s.body])).toEqual([
      ['POST', '/portal/shifts/s1/note', { id: 'n1', createdAt: 'c', body: 'old' }],
      ['PUT', '/portal/notes/n1', { body: 'new' }],
    ])
    expect(q.pendingCount()).toBe(0)
  })
})
