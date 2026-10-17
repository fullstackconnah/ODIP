import { useSyncExternalStore } from 'react'

/** Tailwind's `xl` breakpoint in the rem unit its `xl:` variants compile to (80rem = 1280px), so this switch and the `xl:` classes flip together. */
const XL_UP_QUERY = '(min-width: 80rem)'

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(notify: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const mql = window.matchMedia(XL_UP_QUERY)
  mql.addEventListener('change', notify)
  return () => mql.removeEventListener('change', notify)
}

/** Where matchMedia does not exist (jsdom) assume below xl: the cards are the default look. */
function getBelowXl(): boolean {
  return hasMatchMedia() ? !window.matchMedia(XL_UP_QUERY).matches : true
}

/** Whether the viewport is narrower than Tailwind's `xl`, where the dashboard's decision list is cards in place; from `xl` it is the side column's list. */
export function useIsBelowXl(): boolean {
  return useSyncExternalStore(subscribe, getBelowXl, () => true)
}
