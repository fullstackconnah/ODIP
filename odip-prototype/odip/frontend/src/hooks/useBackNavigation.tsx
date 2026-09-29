/**
 * CORE-02 history-aware back-navigation.
 *
 * Why this exists: the page-header back control on the Intake/Profile wizards used to be a
 * hardcoded `<Link>` pointing at `/participants` or `/participants/:id` — so if the user
 * arrived at the wizard from the onboarding detail screen (or any other entry point) and
 * then hit "Back", they were teleported somewhere unrelated to where they came from.
 *
 * The fix is a tiny piece of in-app state — the LAST in-app pathname the user was on — that
 * lives in this module (re-initialised on every fresh full page load, so deep-linking still
 * falls back to the supplied fallback exactly once per session).
 *
 * The tracker is mounted exactly once at the authenticated shell (`src/components/layout/
 * AppLayout.tsx`) and writes the latest pathname on every route change. The hook
 * `useBackTarget(fallbackTo)` reads that state and returns the destination the back control
 * should go to, the click handler that performs the navigation (so the unsaved-changes
 * blocker still trips for dirty forms — we never use `window.history.back()` here, that
 * bypasses the blocker), and an accessible name derived from the previous screen.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// --- module state (re-initialised on every fresh full page load) ---------------------------

type Listener = () => void
const listeners = new Set<Listener>()
/** Previous in-app pathname the user was on. `null` until at least one route change has
 *  happened, or until we land somewhere without a recorded predecessor. */
let prevPath: string | null = null
/** Pathname the tracker most recently wrote. Used to compute the next prevPath. */
let curPath = ''

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Snapshot of the previous-path store. Stable identity is critical — useSyncExternalStore
 *  re-reads it on every render, and a fresh object each call would force a re-render loop. */
function getPrevSnapshot(): string | null {
  return prevPath
}

/** Server snapshot for SSR — irrelevant here (this app is CSR-only), but required by the
 *  useSyncExternalStore type signature so the hook stays portable. */
function getServerSnapshot(): string | null {
  return null
}

/** Records a new current pathname and rolls the previous one forward. Module-state mutation
 *  only — no React state — so the react-hooks/set-state-in-effect rule doesn't apply. */
function recordCurrentPath(nextPath: string): void {
  if (nextPath === curPath) return
  // First navigation after a fresh page load: there is no meaningful "previous" path, so the
  // first thing we observe becomes curPath with prevPath still null. After that, the path we
  // were just on becomes prevPath.
  if (curPath === '') {
    curPath = nextPath
  } else {
    prevPath = curPath
    curPath = nextPath
  }
  for (const listener of listeners) listener()
}

/** Exported so tests can reset module state between cases without smuggling globals out via
 *  vi.stubGlobal. */
export const __testHooks = {
  subscribe,
  getPrevSnapshot,
  recordCurrentPath,
  reset: () => {
    prevPath = null
    curPath = ''
    for (const listener of listeners) listener()
  },
}

// --- public hooks --------------------------------------------------------------------------

/** Track the previous in-app pathname. Must be mounted ONCE in the authenticated shell
 *  (AppLayout). Calling this more than once is harmless — both trackers would write the
 *  same value — but only one instance is the convention. */
export function usePreviousAppPathTracker(): null {
  const location = useLocation()
  useEffect(() => {
    recordCurrentPath(location.pathname)
  }, [location.pathname])
  return null
}

/** Read the previous in-app pathname (or `null` if there isn't one yet). Re-renders the
 *  caller whenever the tracker records a new pathname. */
export function usePreviousAppPath(): string | null {
  return useSyncExternalStore(subscribe, getPrevSnapshot, getServerSnapshot)
}

/** Returns the destination for a page-header back control, preferring real in-app history
 *  over the supplied fallback. */
export function useBackTarget(fallbackTo: string): {
  to: string
  onBack: () => void
  ariaLabel: string
} {
  const previousPath = usePreviousAppPath()
  const navigate = useNavigate()
  const location = useLocation()
  const to = previousPath && previousPath !== location.pathname ? previousPath : fallbackTo
  const onBack = useCallback(() => {
    navigate(to)
  }, [navigate, to])
  const ariaLabel = buildAriaLabel(to, location.pathname)
  return { to, onBack, ariaLabel }
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
  '/onboarding': 'Onboarding',
  '/inquiries': 'Inquiries',
  '/trips': 'Trips',
}

function buildAriaLabel(targetPath: string, currentPath: string): string {
  if (targetPath === currentPath) return 'Go back'
  // Exact known screen.
  const known = KNOWN_SCREEN_LABELS[targetPath]
  if (known) return `Back to ${known}`
  // Detail page patterns like /participants/5 or /onboarding/5 — we don't try to fetch the
  // record name from a hook here (that would couple this primitive to every page's data
  // fetching), so fall back to the resource noun.
  const participantsMatch = /^\/participants\/[^/]+$/.exec(targetPath)
  if (participantsMatch) return 'Back to participant'
  const onboardingMatch = /^\/onboarding\/[^/]+$/.exec(targetPath)
  if (onboardingMatch) return 'Back to onboarding'
  const inquiriesMatch = /^\/inquiries\/[^/]+$/.exec(targetPath)
  if (inquiriesMatch) return 'Back to enquiry'
  return 'Go back'
}
