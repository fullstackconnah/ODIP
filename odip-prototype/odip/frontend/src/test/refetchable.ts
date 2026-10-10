import { useSyncExternalStore } from 'react'

/**
 * A stand-in for a query result that a test can replace later with a new object, as a background refetch does (window refocus, the 30 s stale time):
 * `useValue` is the hook the component under test reads, `refetchWith` delivers the new object and re-renders it.
 */
export function refetchable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    useValue: () => useSyncExternalStore((onChange) => { listeners.add(onChange); return () => { listeners.delete(onChange) } }, () => value),
    refetchWith(next: T) {
      value = next
      listeners.forEach(notify => notify())
    },
  }
}
