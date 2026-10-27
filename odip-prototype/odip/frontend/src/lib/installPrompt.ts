/**
 * "Add Bunya Support to your phone": the pure visibility rule, the per-user dismissal record and the captured
 * `beforeinstallprompt` event. Chromium fires that event at page load, often on /login before AppLayout mounts,
 * so main.tsx starts the capture before render and the prompt component only subscribes.
 */
export const INSTALL_SNOOZE_MS = 30 * 86_400_000

/** The two landing routes: every other route has a sticky bottom bar or is mid-task. */
const LANDING_PATHS = ['/', '/portal']

export type InstallPromptEnv = {
  belowMd: boolean
  coarse: boolean
  secure: boolean
  standalone: boolean
  installed: boolean
  dismissedUntil: number
  now: number
  hasDeferred: boolean
  iosSafari: boolean
  path: string
  /** Unsent changes own the bottom of the screen (SHAPE 4a): the prompt waits. */
  syncBarVisible: boolean
}

export function installPromptMode(e: InstallPromptEnv): 'android' | 'ios' | null {
  const eligible = e.belowMd && e.coarse && e.secure && !e.standalone && !e.installed && !(e.dismissedUntil > e.now) && LANDING_PATHS.includes(e.path) && !e.syncBarVisible
  if (!eligible) return null
  if (e.hasDeferred) return 'android'
  return e.iosSafari ? 'ios' : null
}

/** iPhone or iPad Safari only: other iOS browsers cannot add to the Home Screen. iPadOS reports a Mac UA, told apart by touch points. */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)
}

export type InstallRecord = { dismissedUntil: number; installed: boolean }

const key = (userId: string) => `odip_install_prompt:${userId}`
const NONE: InstallRecord = { dismissedUntil: 0, installed: false }

/** Never throws: a throwing localStorage or corrupt JSON reads as "not dismissed". */
export function readInstallRecord(userId: string): InstallRecord {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return NONE
    const { dismissedUntil, installed } = parsed as Record<string, unknown>
    return { dismissedUntil: typeof dismissedUntil === 'number' ? dismissedUntil : 0, installed: installed === true }
  } catch {
    return NONE
  }
}

function write(userId: string, value: object) {
  try { localStorage.setItem(key(userId), JSON.stringify(value)) } catch { /* private mode: the prompt returns next visit, which is harmless */ }
}

export const snoozeInstallPrompt = (userId: string, now: number) => write(userId, { dismissedUntil: now + INSTALL_SNOOZE_MS })
export const markInstalled = (userId: string) => write(userId, { installed: true })

/** The signed-in (or viewed-as) user's id, read the way useUiPreferences reads it. */
export function currentUserId(): string | null {
  try {
    const id = (JSON.parse(localStorage.getItem('odip_user') || '{}') as { id?: unknown })?.id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

export type BeforeInstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export type InstallSnapshot = { deferred: BeforeInstallPromptEvent | null; installed: boolean }

let snapshot: InstallSnapshot = { deferred: null, installed: false }
const listeners = new Set<() => void>()
const publish = (next: InstallSnapshot) => { snapshot = next; listeners.forEach((l) => l()) }

/** Starts the capture (once, before render). The event is single use, so `consumeDeferred` drops it when the native dialog opens. */
export function captureInstallEvents(win: EventTarget = window): void {
  snapshot = { deferred: null, installed: false }
  win.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); publish({ ...snapshot, deferred: e as BeforeInstallPromptEvent }) })
  win.addEventListener('appinstalled', () => publish({ deferred: null, installed: true }))
}

export const consumeDeferred = () => publish({ ...snapshot, deferred: null })
export const subscribeInstall = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getInstallSnapshot = () => snapshot
