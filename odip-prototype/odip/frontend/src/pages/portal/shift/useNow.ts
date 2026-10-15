import { useCallback, useEffect, useState } from 'react'

/**
 * The current time as state, read again every `everyMs` and whenever `refresh()` is called from an event handler. Render must not read the clock
 * itself (react-hooks purity); the live shift figures tick every 30 s and are never a live region.
 */
export function useNow(everyMs: number): [Date, () => void] {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  const refresh = useCallback(() => setNow(new Date()), [])
  return [now, refresh]
}
