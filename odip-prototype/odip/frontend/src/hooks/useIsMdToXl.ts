import { useSyncExternalStore } from 'react'

/** Tailwind's `md` up to just under `xl` (48rem to 80rem) in rem, so this switch and the `md:` classes flip together (see useIsBelowMd). */
const MD_TO_XL_QUERY = '(min-width: 48rem) and (max-width: 79.99rem)'

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(notify: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const mql = window.matchMedia(MD_TO_XL_QUERY)
  mql.addEventListener('change', notify)
  return () => mql.removeEventListener('change', notify)
}

/** Where matchMedia does not exist (jsdom, the server) assume the full layout. */
const getMdToXl = (): boolean => hasMatchMedia() && window.matchMedia(MD_TO_XL_QUERY).matches

/** Whether the viewport is from Tailwind's `md` up to below `xl`: the Leave table merges two pairs of columns there (Staff · Type, Dates · Requested). */
export function useIsMdToXl(): boolean {
  return useSyncExternalStore(subscribe, getMdToXl, () => false)
}
