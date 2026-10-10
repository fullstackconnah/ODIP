import { useEffect, useRef } from 'react'

/**
 * Runs `fill(record)` the first time each record (by id) arrives, and not again when the same record is fetched again. An edit form that fills itself from a
 * query result on every change of that result loses what the person typed whenever the query refetches (window refocus, the 30 s stale time).
 */
export function useFillOnce<T extends { id: string }>(record: T | undefined, fill: (record: T) => void) {
  const filledId = useRef<string | null>(null)
  useEffect(() => {
    if (!record || filledId.current === record.id) return
    filledId.current = record.id
    fill(record)
  }, [record, fill])
}
