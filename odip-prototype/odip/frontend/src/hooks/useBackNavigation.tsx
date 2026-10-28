/**
 * History-aware Back.
 *
 * Back goes to the page the user was on before this one. React-router's browser history numbers every entry
 * (`window.history.state.idx`, 0 = the first entry of the tab), so "there is an earlier in-app page" is `idx > 0`. That
 * survives a reload. When there is one, Back runs `navigate(-1)`; otherwise (a deep link, a new tab) it goes to the page's
 * fallback. `navigate(-1)` is a router navigation, so the unsaved-changes blocker still asks first.
 *
 * The tracker (mounted once in AppLayout) remembers the pathname + search of each entry by idx, only to NAME the control
 * ("Back to Trips"). The map is kept in sessionStorage so a reload still names the page; when an entry is still unknown the
 * name is "Go back", never the page's own label (the click does not go there).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// --- module state (re-initialised on every fresh full page load) ---------------------------

type Listener = () => void
const listeners = new Set<Listener>()
const STORE_KEY = 'odip.backPaths'
/** pathname + search of the entry at each history idx, written on every location change; restored from sessionStorage after a reload. */
const pathByIdx = new Map<number, string>(
  (() => {
    try {
      // Valid JSON that is not a list of [number, string] pairs must not throw at import (a blank app).
      const stored: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]')
      return (stored as unknown[]).filter(
        (e): e is [number, string] => Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'string',
      )
    } catch {
      return []
    }
  })(),
)
function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify([...pathByIdx]))
  } catch {
    // storage full or blocked: the name just falls back to "Go back" after a reload
  }
}
/** Test seam: MemoryRouter writes no `history.state.idx`. */
let idxOverride: number | null = null

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const notify = () => {
  for (const listener of listeners) listener()
}

/** idx of the current history entry; 0 when the router has not numbered it (first load, MemoryRouter). */
function currentIdx(): number {
  if (idxOverride !== null) return idxOverride
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}

/** The entry before this one, when the tracker saw it. */
function getPrevSnapshot(): string | null {
  const idx = currentIdx()
  return idx > 0 ? (pathByIdx.get(idx - 1) ?? null) : null
}

const getServerSnapshot = (): string | null => null

const pathnameOf = (path: string): string => path.split('?')[0]

/** Exported so tests can reset module state and stand in for `history.state.idx`. */
export const __testHooks = {
  subscribe,
  getPrevSnapshot,
  recordAt: (idx: number, path: string) => {
    pathByIdx.set(idx, path)
    notify()
  },
  /** The user visited these pages in order and is on the last one. */
  seedHistory: (...paths: string[]) => {
    paths.forEach((p, i) => pathByIdx.set(i, p))
    idxOverride = paths.length - 1
    notify()
  },
  setIdx: (idx: number | null) => {
    idxOverride = idx
    notify()
  },
  reset: () => {
    pathByIdx.clear()
    try {
      sessionStorage.removeItem(STORE_KEY)
    } catch {
      // nothing to clear
    }
    idxOverride = null
    notify()
  },
}

// --- public hooks --------------------------------------------------------------------------

/** Remember where each history entry points. Mount ONCE in the authenticated shell (AppLayout). */
export function usePreviousAppPathTracker(): null {
  const location = useLocation()
  useEffect(() => {
    // pathname + search, not pathname alone: the Participants hub keeps its tab in `?tab=`, and Back must name it.
    pathByIdx.set(currentIdx(), location.pathname + location.search)
    persist()
    notify()
  }, [location.key, location.pathname, location.search])
  return null
}

/** The page one history entry back (or `null` if there is none or it was not seen). */
export function usePreviousAppPath(): string | null {
  return useSyncExternalStore(subscribe, getPrevSnapshot, getServerSnapshot)
}

/**
 * Back for a page. `to` is the fallback (the link's href); `onBack` goes back when there is an earlier entry, else to the
 * fallback; `onLinkClick` is the click handler for a real link (a plain left click goes back, a modified click opens the href);
 * `leave` is the same after a save (the fallback replaces the finished form).
 */
export function useBackTarget(fallbackTo: string): {
  to: string
  previousPath: string | null
  /** An earlier in-app entry exists, so a click runs navigate(-1) even when the tracker could not name it. */
  goesBack: boolean
  onBack: () => void
  onLinkClick: (e: MouseEvent) => void
  leave: () => void
  ariaLabel: string
} {
  const previousPath = usePreviousAppPath()
  const navigate = useNavigate()
  const location = useLocation()
  const here = location.pathname + location.search
  const onBack = useCallback(() => {
    if (currentIdx() > 0) navigate(-1)
    else navigate(fallbackTo)
  }, [navigate, fallbackTo])
  const leave = useCallback(() => {
    if (currentIdx() > 0) navigate(-1)
    else navigate(fallbackTo, { replace: true })
  }, [navigate, fallbackTo])
  const onLinkClick = useCallback(
    (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      onBack()
    },
    [onBack],
  )
  const known = previousPath && previousPath !== here ? previousPath : null
  return { to: fallbackTo, previousPath: known, goesBack: currentIdx() > 0, onBack, onLinkClick, leave, ariaLabel: buildAriaLabel(known ?? '', here) }
}

// --- aria-label helpers --------------------------------------------------------------------

/**
 * Build a screen-reader-friendly label for the back control. Falls back to "Go back" if the
 * previous path can't be turned into a useful noun. We deliberately keep this lookup small
 * (no full route table) — the brief is "if the previous screen has no human label available,
 * return a plain 'Go back'", so a missing entry → 'Go back' rather than a guessed label.
 */
const KNOWN_SCREEN_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/participants': 'Participants',
  '/trips': 'Trips',
  '/invoices': 'Invoices',
  '/medications': 'Medications',
}

/**
 * Resolve the human label for the hub's lifecycle tabs (which live under the
 * /participants URL with a `tab=` query param). The Participants hub mirrors its active
 * tab into the URL — and the standalone /onboarding + /inquiries list pages now redirect
 * there too — so a back target like `/participants?tab=onboarding` should still read as
 * "Back to Onboarding" rather than the generic "Go back".
 */
function hubTabLabel(targetPath: string): string | null {
  const tab = new URLSearchParams(targetPath.split('?')[1] ?? '').get('tab')
  if (targetPath.split('?')[0] !== '/participants') return null
  if (tab === 'onboarding') return 'Onboarding'
  if (tab === 'enquiries') return 'Enquiries'
  return null
}

function buildAriaLabel(targetPath: string, currentPath: string): string {
  if (targetPath === currentPath) return 'Go back'
  // Hub tab on /participants?tab=… → use the stage name.
  const tabLabel = hubTabLabel(targetPath)
  if (tabLabel) return `Back to ${tabLabel}`
  // A known screen, on any of its tabs (/medications?tab=register is still Medications).
  const known = KNOWN_SCREEN_LABELS[pathnameOf(targetPath)]
  if (known) return `Back to ${known}`
  // Detail page patterns like /participants/5 or /onboarding/5 — we don't try to fetch the
  // record name from a hook here (that would couple this primitive to every page's data
  // fetching), so fall back to the resource noun.
  if (/^\/trips\/[^/?]+/.exec(targetPath)) return 'Back to trip'
  const participantsMatch = /^\/participants\/[^/]+$/.exec(targetPath)
  if (participantsMatch) return 'Back to participant'
  const onboardingMatch = /^\/onboarding\/[^/]+$/.exec(targetPath)
  if (onboardingMatch) return 'Back to onboarding'
  const inquiriesMatch = /^\/inquiries\/[^/]+$/.exec(targetPath)
  if (inquiriesMatch) return 'Back to enquiry'
  return 'Go back'
}
