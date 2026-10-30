/**
 * The send-later queue. A worker's writes made without a connection are kept here, on the phone, and sent in order
 * when the connection returns. Records never expire; only the worker (Discard) or a successful send removes one.
 *
 * Ids ride EVERY send, live and replay (a break's `breakId`, a note's `id` and `createdAt`), because the common
 * failure is the server committing and the response being lost; the replay must then find the same row, not make
 * a second. Client times (`startedAt`, `finishedAt`, `endedAt`) ride the replay only: a live send happens at the
 * moment of the tap, so the server's clock is already right.
 */
import { apiClient } from '@/api/client'
import { apiErrorCode, apiErrorData, apiErrorStatus } from '@/lib/shiftPackageErrors'
import { newCompletionRequestId } from '@/lib/completionRequestId'
import { OFFLINE_PREFIX, readSaved, readSession, writeSaved, wipeOffline, type OfflineSession } from './store'

export type QueueKind = 'start' | 'note' | 'breakStart' | 'breakEnd' | 'tick' | 'untick' | 'ack' | 'finish'

export interface QueueRecord {
  /** newCompletionRequestId(); doubles as the break id / note id. */
  id: string
  userId: string
  viewAsTenant: string | null
  viewAsUser: string | null
  shiftId: string
  kind: QueueKind
  path: string
  method: 'POST' | 'PUT' | 'DELETE'
  /** The body as sent live. Replay adds `clientTimeField: clientTime` to it. */
  body: unknown
  clientTimeField?: string
  /** The routine, break or note this record is about (a tick's routine id, a break end's break id). */
  target?: string
  /** ISO, stamped at the tap. */
  clientTime: string
  createdAt: number
  status: 'waiting' | 'notSent'
  /** What the server answered when it refused this record. */
  httpStatus?: number
  code?: string
  /** For a refused Finish: the blocker codes the server listed. */
  blockers?: string[]
  /** Replays the server answered 5xx, at least a minute apart. The record is kept whatever the count ("Still trying"). */
  attempts?: number
  lastFailedAt?: number
  label: { participant: string; serviceDate: string; rostered: string; routine?: string }
}

export type NewRecord = Pick<QueueRecord, 'shiftId' | 'kind' | 'path' | 'method' | 'body' | 'label'> & { id?: string; clientTimeField?: string; target?: string }

export type SendResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'offline'; status?: number }
  | { kind: 'refused'; status: number; code?: string; blockers?: string[]; error: unknown }

export type SendOrQueueResult = { queued: false; data: unknown } | { queued: true; record: QueueRecord }

export interface ReplayResult { sent: number; notSent: number; waiting: number; offline: boolean }

const RANK: Record<QueueKind, number> = { start: 0, note: 1, breakStart: 2, breakEnd: 2, tick: 3, untick: 3, ack: 4, finish: 5 }

/** On a weak signal navigator.onLine stays true and a request can stall; give up so the record is queued and a replay never hangs. */
const REQUEST_TIMEOUT_MS = 15_000
/** The Finish commit does more on the server than any other write, so it gets longer before it reads as offline. */
export const FINISH_TIMEOUT_MS = 45_000
/** A second tab's replay is ignored while this lease is younger than this: one record's status lookup (15 s) plus its Finish (45 s), with margin. */
export const LEASE_MS = 75_000
/** After a live send fails with a server blip, one more try this long after. */
export const RETRY_AFTER_MS = 30_000
/** Failed tries (server 5xx, a minute apart) before the worker sees "Still trying". */
export const STILL_TRYING_AFTER = 5
/** Replays come from many triggers, so a fault counts as one try per this long. */
const TRY_SPACING_MS = 60_000

export const isStillTrying = (r: QueueRecord) => r.status === 'waiting' && (r.attempts ?? 0) >= STILL_TRYING_AFTER

/** No response, a server blip, throttling, or a 401 that survived the refresh: the record stays Waiting. */
const isTransient = (status: number | undefined) => status === undefined || status >= 500 || status === 408 || status === 429 || status === 401

export const replayBody = (rec: QueueRecord, asReplay: boolean): unknown =>
  asReplay && rec.clientTimeField ? { ...(rec.body as object), [rec.clientTimeField]: rec.clientTime } : rec.body

export async function apiSend(rec: QueueRecord, asReplay: boolean): Promise<SendResult> {
  try {
    // A timeout has no response, so it reads as offline and the record is queued under the same id.
    const res = await apiClient.request({ url: rec.path, method: rec.method, data: replayBody(rec, asReplay), timeout: rec.kind === 'finish' ? FINISH_TIMEOUT_MS : REQUEST_TIMEOUT_MS })
    return { kind: 'ok', data: (res.data as { data?: unknown } | undefined)?.data }
  } catch (error) {
    const status = apiErrorStatus(error)
    if (isTransient(status)) return { kind: 'offline', status }
    const blockers = apiErrorData<{ finishBlockers?: { code: string }[] }>(error)?.finishBlockers?.map((b) => b.code)
    return { kind: 'refused', status: status as number, code: apiErrorCode(error), blockers, error }
  }
}

export type DetailLookup = { kind: 'ok'; status: string } | { kind: 'offline'; status?: number } | { kind: 'refused'; status: number }

export async function apiShiftStatus(shiftId: string): Promise<DetailLookup> {
  try {
    const res = await apiClient.get<{ data: { status: string } }>(`/portal/shifts/${shiftId}`, { timeout: REQUEST_TIMEOUT_MS })
    return { kind: 'ok', status: res.data.data.status }
  } catch (error) {
    const status = apiErrorStatus(error)
    return isTransient(status) ? { kind: 'offline', status } : { kind: 'refused', status: status as number }
  }
}

export interface QueueDeps {
  send: (rec: QueueRecord, asReplay: boolean) => Promise<SendResult>
  shiftStatus: (shiftId: string) => Promise<DetailLookup>
  session: () => OfflineSession
  now: () => number
  newId: () => string
  isOnline: () => boolean
}

const defaultDeps: QueueDeps = {
  send: apiSend,
  shiftStatus: apiShiftStatus,
  session: readSession,
  now: () => Date.now(),
  newId: newCompletionRequestId,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
}

export interface SyncState { sending: boolean; allSentAt: number | null; stillOffline: boolean }

export function createQueue(overrides: Partial<QueueDeps> = {}) {
  const deps: QueueDeps = { ...defaultDeps, ...overrides }
  const listeners = new Set<() => void>()
  const sentListeners = new Set<() => void>()
  let running = false
  // A replay asked for while one runs is not dropped: the running one goes round again.
  let again = false
  /** This tab's own lease stamp, so a release never removes a lease another tab took over. */
  let myStamp = ''
  let leaseRetry: ReturnType<typeof setTimeout> | undefined
  let sync: SyncState = { sending: false, allSentAt: null, stillOffline: false }
  // useSyncExternalStore needs the same array back until something changes, so parse only when the raw text changed.
  let memoRaw: string | null | undefined
  let memoKey = ''
  let memoList: QueueRecord[] = []
  let mineKey = ''
  let mineList: QueueRecord[] = []
  const EMPTY: QueueRecord[] = []

  const keyFor = (userId: string) => `${OFFLINE_PREFIX}${userId}:queue`
  const sameView = (r: QueueRecord, s: OfflineSession) => r.userId === s.userId && r.viewAsTenant === s.viewAsTenant && r.viewAsUser === s.viewAsUser

  function loadAll(userId: string): QueueRecord[] {
    let raw: string | null = null
    try { raw = localStorage.getItem(keyFor(userId)) } catch { /* unreadable */ }
    if (memoKey === userId && raw === memoRaw) return memoList
    memoKey = userId
    memoRaw = raw
    try {
      const parsed = raw ? (JSON.parse(raw) as QueueRecord[]) : []
      memoList = Array.isArray(parsed) && parsed.length ? parsed : EMPTY
    } catch { memoList = EMPTY }
    return memoList
  }

  function notify() { listeners.forEach((l) => l()) }
  const setSync = (next: Partial<SyncState>) => { sync = { ...sync, ...next }; notify() }

  function saveAll(userId: string, list: QueueRecord[]) {
    try {
      if (list.length) localStorage.setItem(keyFor(userId), JSON.stringify(list))
      else localStorage.removeItem(keyFor(userId))
    } catch { /* full or blocked */ }
    notify()
  }

  /** Records for the signed-in (or viewed) user and the view-as headers in force right now. */
  function mine(): QueueRecord[] {
    const s = deps.session()
    if (!s.userId) return EMPTY
    const all = loadAll(s.userId)
    const filtered = all.filter((r) => sameView(r, s))
    if (filtered.length === all.length) return all
    // Stable identity while the underlying list is unchanged.
    const key = `${s.userId}|${s.viewAsTenant}|${s.viewAsUser}|${memoRaw}`
    if (key !== mineKey) { mineKey = key; mineList = filtered }
    return mineList
  }

  function mutate(userId: string, fn: (list: QueueRecord[]) => QueueRecord[]) {
    saveAll(userId, fn([...loadAll(userId)]))
  }
  const patch = (rec: QueueRecord, change: Partial<QueueRecord>) => mutate(rec.userId, (list) => list.map((r) => (r.id === rec.id ? { ...r, ...change } : r)))
  const remove = (rec: QueueRecord) => mutate(rec.userId, (list) => list.filter((r) => r.id !== rec.id))

  function build(input: NewRecord, s: OfflineSession): QueueRecord {
    const t = deps.now()
    return {
      ...input,
      id: input.id ?? deps.newId(),
      userId: s.userId ?? '',
      viewAsTenant: s.viewAsTenant,
      viewAsUser: s.viewAsUser,
      clientTime: new Date(t).toISOString(),
      createdAt: t,
      status: 'waiting',
    }
  }

  function enqueue(input: NewRecord): QueueRecord {
    const s = deps.session()
    if (!s.userId) throw new Error('No signed-in user to queue a change for.')
    const rec = build(input, s)
    mutate(s.userId, (list) => [...list, rec])
    return rec
  }

  async function sendOrQueue(input: NewRecord): Promise<SendOrQueueResult> {
    const s = deps.session()
    const chain = !!s.userId && mine().some((r) => r.shiftId === input.shiftId)
    if (chain || !deps.isOnline()) {
      const record = enqueue(input)
      if (chain && deps.isOnline()) void replay()
      return { queued: true, record }
    }
    const rec = build(input, s)
    const out = await deps.send(rec, false)
    if (out.kind === 'ok') return { queued: false, data: out.data }
    if (out.kind === 'refused') throw out.error
    // The live attempt may have reached the server; the id on the record makes the replay find the same row.
    const record = enqueue({ ...input, id: rec.id })
    setTimeout(() => { void replay() }, RETRY_AFTER_MS)
    return { queued: true, record }
  }

  const alreadyKey = (shiftId: string) => `already:${shiftId}`

  const leaseKey = (userId: string) => `${OFFLINE_PREFIX}${userId}:replay-lock`
  const stored = (r: QueueRecord) => loadAll(r.userId).find((x) => x.id === r.id)

  /**
   * One tab replays at a time: the lease is a timestamp in localStorage, refreshed before each record and taken over once
   * it is LEASE_MS old (the tab that held it died). Not navigator.locks: live is plain HTTP, and locks need a secure context.
   */
  // shortcut: check-then-set is not atomic across tabs; the stored-record re-check before each send covers the gap.
  function stampLease(userId: string) {
    try {
      myStamp = String(deps.now())
      localStorage.setItem(leaseKey(userId), myStamp)
    } catch { /* storage blocked */ }
  }
  function takeLease(userId: string): boolean {
    try {
      const held = Number(localStorage.getItem(leaseKey(userId)))
      if (held && deps.now() - held < LEASE_MS) return false
    } catch { /* storage blocked: replay anyway */ }
    stampLease(userId)
    return true
  }

  async function replay(): Promise<ReplayResult> {
    const result: ReplayResult = { sent: 0, notSent: 0, waiting: 0, offline: false }
    if (running) { again = true; return result }
    const s = deps.session()
    if (!s.userId) return result
    if (!takeLease(s.userId)) {
      // Whoever holds the lease cannot see what was queued after it started, so look again once the lease has lapsed.
      leaseRetry ??= setTimeout(() => { leaseRetry = undefined; void replay() }, RETRY_AFTER_MS)
      return result
    }
    running = true
    setSync({ sending: true, stillOffline: false })
    try {
      do {
        again = false
        const groups = new Map<string, QueueRecord[]>()
        for (const r of mine()) groups.set(r.shiftId, [...(groups.get(r.shiftId) ?? []), r])
        outer: for (const [shiftId, recs] of groups) {
          if (recs.some((r) => r.status === 'notSent')) continue
          const ordered = [...recs].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.createdAt - b.createdAt)
          for (const r of ordered) {
            stampLease(s.userId)
            // The snapshot can be stale: another tab may have sent, discarded or failed this record since.
            if (stored(r)?.status !== 'waiting') continue
            if (r.kind === 'finish') {
              const look = await deps.shiftStatus(shiftId)
              if (look.kind === 'offline') {
                // Same rules as the send, but this lookup never counts a try.
                if (look.status === undefined) { result.offline = true; break outer }
                if (look.status < 500) break outer
                break
              }
              if (stored(r)?.status !== 'waiting') continue
              if (look.kind === 'refused' && look.status === 404) { patch(r, { status: 'notSent', httpStatus: 404, code: undefined }); result.notSent++; break }
              if (look.kind === 'ok' && (look.status === 'PendingReview' || look.status === 'Completed')) {
                writeSaved(s.userId, alreadyKey(shiftId), true)
                remove(r)
                result.sent++
                continue
              }
            }
            const out = await deps.send(r, true)
            if (out.kind === 'offline') {
              if (out.status === undefined) { result.offline = true; break outer }
              // 401, 408 and 429: signed out or throttled, so stop the whole replay without reading as offline; never a try.
              if (out.status < 500) break outer
              // A 5xx: the server is reachable, so skip only this shift, and count a try.
              const cur = stored(r)
              if (cur && (cur.lastFailedAt === undefined || deps.now() - cur.lastFailedAt >= TRY_SPACING_MS)) patch(r, { attempts: (cur.attempts ?? 0) + 1, lastFailedAt: deps.now() })
              break
            }
            if (out.kind === 'ok') {
              const now = stored(r)
              if (now && JSON.stringify(now.body) !== JSON.stringify(r.body)) {
                // The worker edited this note while its POST was in flight: keep the edit as a PUT of the new text.
                const text = (now.body as { body?: string }).body
                patch(r, { path: `/portal/notes/${r.id}`, method: 'PUT', body: { body: text }, attempts: undefined, lastFailedAt: undefined })
                again = true
              } else remove(r)
              result.sent++
              continue
            }
            patch(r, { status: 'notSent', httpStatus: out.status, code: out.code, blockers: out.blockers })
            result.notSent++
            break
          }
        }
      } while (again && !result.offline)
    } finally {
      running = false
      again = false
      // Not another tab's lease, if it took over after this one lapsed.
      try { if (localStorage.getItem(leaseKey(s.userId)) === myStamp) localStorage.removeItem(leaseKey(s.userId)) } catch { /* storage blocked */ }
      const left = mine()
      result.waiting = left.filter((r) => r.status === 'waiting').length
      setSync({ sending: false, stillOffline: result.offline, allSentAt: !result.offline && result.sent > 0 && left.length === 0 ? deps.now() : sync.allSentAt })
      if (result.sent > 0) sentListeners.forEach((l) => l())
    }
    return result
  }

  async function retry(id: string) {
    const rec = mine().find((r) => r.id === id)
    if (!rec || rec.status !== 'notSent') return
    patch(rec, { status: 'waiting', attempts: undefined, lastFailedAt: undefined, httpStatus: undefined, code: undefined, blockers: undefined })
    await replay()
  }

  function discard(id: string) {
    const rec = mine().find((r) => r.id === id)
    if (rec) remove(rec)
  }

  /** A queued note's body can still be edited before it is sent. */
  function rewriteBody(id: string, body: unknown) {
    const rec = mine().find((r) => r.id === id && r.status === 'waiting')
    if (rec) patch(rec, { body })
  }

  /** The Finish for this shift reached a shift already submitted from elsewhere (SHAPE 3e). */
  function wasAlreadySubmitted(shiftId: string): boolean {
    const s = deps.session()
    return !!s.userId && !!readSaved<boolean>(s.userId, alreadyKey(shiftId))
  }

  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    getSnapshot: mine,
    getSyncState: () => sync,
    /** Called once at the end of any replay that sent something; returns the unsubscribe. */
    onReplaySent: (l: () => void) => { sentListeners.add(l); return () => { sentListeners.delete(l) } },
    enqueue,
    sendOrQueue,
    replay,
    retry,
    discard,
    rewriteBody,
    pendingCount: () => mine().length,
    wasAlreadySubmitted,
    /** A different person signing in must not inherit the previous person's unsent changes. */
    dropOtherUsers: (userId: string) => { wipeOffline({ exceptUser: userId }); notify() },
    /** Explicit sign out with the queue deleted. */
    wipeAll: () => { wipeOffline({}); notify() },
  }
}

export const offlineQueue = createQueue()
