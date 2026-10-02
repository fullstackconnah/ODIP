import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every minute and whenever the tab comes back to the front, so a greeting or a date left on screen does not go
 * stale (the dashboard open from the morning, or across midnight). A component that only needs "now" once keeps calling `new Date()`.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const refresh = () => setNow(new Date())
    const timer = window.setInterval(refresh, intervalMs)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [intervalMs])

  return now
}
