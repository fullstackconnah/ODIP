/**
 * Saved portal data for working without a connection. Everything lives in localStorage under
 * `odip_offline:<userId>:<part>`, where <userId> is the EFFECTIVE user (the one being viewed as, when set), so a
 * coordinator viewing a worker never reads or writes the worker's copy under their own name. Saved shift data
 * expires 48 hours after it was saved (the queue, a separate key, never expires). Every storage call is guarded:
 * a private window or a full disk degrades to "nothing saved", never to a crash.
 */
import { currentProfile, getViewAs } from '@/lib/viewAs'

// shortcut: localStorage caps near 5 MB per origin, so a very large week could fail to save; move to IndexedDB if that bites.
export const OFFLINE_PREFIX = 'odip_offline:'
export const SAVED_TTL_MS = 48 * 3_600_000

export type OfflineSession = { userId: string | null; viewAsTenant: string | null; viewAsUser: string | null }

const get = (k: string): string | null => {
  try { return localStorage.getItem(k) } catch { return null }
}

export function readSession(): OfflineSession {
  const viewAsTenant = getViewAs('odip_viewing_tenant')
  const viewAsUser = getViewAs('odip_viewing_user')
  let own: string | null = null
  try {
    const id = currentProfile().id
    own = typeof id === 'string' ? id : null
  } catch { /* unreadable user record */ }
  return { userId: viewAsUser || own, viewAsTenant, viewAsUser }
}

const keyOf = (userId: string, part: string) => `${OFFLINE_PREFIX}${userId}:${part}`

export function writeSaved(userId: string, part: string, data: unknown): void {
  try { localStorage.setItem(keyOf(userId, part), JSON.stringify({ savedAt: Date.now(), data })) } catch { /* full or blocked */ }
}

export function readSaved<T>(userId: string, part: string): { data: T; savedAt: number } | null {
  const key = keyOf(userId, part)
  const raw = get(key)
  if (!raw) return null
  try {
    const rec = JSON.parse(raw) as { savedAt?: number; data?: T }
    if (typeof rec.savedAt === 'number' && Date.now() - rec.savedAt <= SAVED_TTL_MS && 'data' in rec) return { data: rec.data as T, savedAt: rec.savedAt }
  } catch { /* corrupt */ }
  try { localStorage.removeItem(key) } catch { /* ignore */ }
  return null
}

/** Removes saved shifts (and the queue unless `keepQueue`); `exceptUser` leaves that user's keys alone. */
export function wipeOffline(opts: { keepQueue?: boolean; exceptUser?: string }): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(OFFLINE_PREFIX)) continue
      const [user, ...rest] = k.slice(OFFLINE_PREFIX.length).split(':')
      if (opts.exceptUser && user === opts.exceptUser) continue
      if (opts.keepQueue && rest.join(':') === 'queue') continue
      doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch { /* ignore */ }
}

/** Reads every saved copy once, so any past 48 h is removed even if nobody opens that shift again. The queue and the replay lease are not saved copies. */
export function sweepExpired(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i) ?? '')
    for (const k of keys) {
      if (!k.startsWith(OFFLINE_PREFIX)) continue
      const [user, ...rest] = k.slice(OFFLINE_PREFIX.length).split(':')
      const part = rest.join(':')
      if (part !== 'queue' && part !== 'replay-lock') readSaved(user, part)
    }
  } catch { /* ignore */ }
}
