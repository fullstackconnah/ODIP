import { useSyncExternalStore } from 'react'

/** Tailwind's `md` breakpoint in its own unit (48rem = 768px), so this switch and the `md:` classes flip together (see useIsBelowLg). */
const MD_UP_QUERY = '(min-width: 48rem)'

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(notify: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const mql = window.matchMedia(MD_UP_QUERY)
  mql.addEventListener('change', notify)
  return () => mql.removeEventListener('change', notify)
}

/** Where matchMedia does not exist (jsdom) assume a phone: no drag and drop. */
function getBelowMd(): boolean {
  return hasMatchMedia() ? !window.matchMedia(MD_UP_QUERY).matches : true
}

/** Whether the viewport is narrower than Tailwind's `md`: the roster board offers drag and drop from md up only (decision 10); phones keep the tap menus. */
export function useIsBelowMd(): boolean {
  return useSyncExternalStore(subscribe, getBelowMd, () => true)
}
