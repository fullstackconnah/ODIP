import { useEffect, useRef } from 'react'

/**
 * Runs `fill(record)` the first time each record (by id) arrives. A later copy of the same record (a refetch: window refocus, the 30 s stale time) fills again
 * only while `pristine`, i.e. while the form still shows what the last fill put there. Once the person has typed, a refetch must not replace their typing; before
 * that, the app may have opened the form from a cached copy, and the fresh one must win or a save puts the cached values back over another user's change.
 */
export function useFillOnce<T extends { id: string }>(record: T | undefined, fill: (record: T) => void, pristine = false) {
  const filled = useRef<T | null>(null)
  useEffect(() => {
    if (!record || filled.current === record) return
    if (filled.current?.id === record.id && !pristine) return
    filled.current = record
    fill(record)
  }, [record, fill, pristine])
}
