import { useEffect, useState } from 'react'

/**
 * A value that follows `value` only once it has stopped changing for `delayMs`: a quote is asked for when a coordinator pauses, not on every keystroke.
 * `value` is compared by its JSON, so a new array with the same contents (a re-render) restarts nothing.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState<{ key: string; value: T }>(() => ({ key: JSON.stringify(value), value }))
  const key = JSON.stringify(value)
  useEffect(() => {
    if (key === settled.key) return undefined
    const timer = setTimeout(() => setSettled({ key, value }), delayMs)
    return () => clearTimeout(timer)
  }, [key, value, delayMs, settled.key])
  return settled.value
}
