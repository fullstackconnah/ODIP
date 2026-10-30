import { useCallback, useSyncExternalStore } from 'react'

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** Whether `query` matches. `fallback` is used where matchMedia does not exist and as the server snapshot. */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (!hasMatchMedia()) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', notify)
    return () => mql.removeEventListener('change', notify)
  }, [query])
  const getSnapshot = useCallback(() => (hasMatchMedia() ? window.matchMedia(query).matches : fallback), [query, fallback])
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback)
}
