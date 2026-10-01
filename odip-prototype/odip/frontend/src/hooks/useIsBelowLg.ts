import { useSyncExternalStore } from 'react'

/**
 * Tailwind's `lg` breakpoint, in the same rem unit its `lg:` variants compile to (64rem = 1024px at the default font size), so this
 * switch and the `lg:` classes of the app shell always flip together. A `max-width: 1023px` query would leave a gap at a fractional
 * width (a zoomed window of 1023.5px matches neither it nor `lg:`).
 */
const LG_UP_QUERY = '(min-width: 64rem)'

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(notify: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const mql = window.matchMedia(LG_UP_QUERY)
  mql.addEventListener('change', notify)
  return () => mql.removeEventListener('change', notify)
}

/** Where matchMedia does not exist (jsdom) assume a phone: the drawer behaviours stay on. */
function getBelowLg(): boolean {
  return hasMatchMedia() ? !window.matchMedia(LG_UP_QUERY).matches : true
}

/**
 * Whether the viewport is narrower than Tailwind's `lg`, where the sidebar is a drawer; from `lg` up it is the permanent sidebar.
 * The drawer's dialog behaviour (Escape, Tab trap, scroll lock) must run only while it IS a drawer, or a stale "open" after a resize
 * would lock the page scroll and trap Tab on a desktop where the sidebar is just there. See components/README.md, useDialogBehavior.
 */
export function useIsBelowLg(): boolean {
  return useSyncExternalStore(subscribe, getBelowLg, () => true)
}
