import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQueueRecords } from '@/api/hooks/portal'
import { isStillTrying, offlineQueue } from '@/lib/offline/queue'

/** How long "All sent" stays before the row leaves (SHAPE 4b). */
const ALL_SENT_MS = 4000

export type SyncSummary =
  | { state: 'idle' }
  | { state: 'waiting'; waiting: number; stillOffline: boolean; stuck: number }
  | { state: 'sending'; waiting: number }
  | { state: 'allSent'; at: number }
  | { state: 'notSent'; notSent: number; waiting: number }

/** What the row says right now, from every shift's unsent changes. */
export function useSyncSummary(): SyncSummary {
  const records = useQueueRecords()
  const sync = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getSyncState)
  const [now, setNow] = useState(() => Date.now())
  const waiting = records.filter((r) => r.status === 'waiting').length
  const notSent = records.length - waiting
  const showAllSent = sync.allSentAt !== null && now - sync.allSentAt < ALL_SENT_MS
  useEffect(() => {
    if (sync.allSentAt === null) return
    const left = ALL_SENT_MS - (Date.now() - sync.allSentAt)
    if (left <= 0) return
    const t = setTimeout(() => setNow(Date.now()), left + 20)
    return () => clearTimeout(t)
  }, [sync.allSentAt])
  if (sync.sending) return { state: 'sending', waiting }
  if (notSent > 0) return { state: 'notSent', notSent, waiting }
  if (waiting > 0) return { state: 'waiting', waiting, stillOffline: sync.stillOffline, stuck: records.filter(isStillTrying).length }
  if (showAllSent && sync.allSentAt !== null) return { state: 'allSent', at: sync.allSentAt }
  return { state: 'idle' }
}

/** True when the sync row has something to show (the SyncBar and the install prompt ask). */
export const syncRowVisible = (s: SyncSummary) => s.state !== 'idle'

/** Whether a SyncBar would show right now: the install prompt steps aside for it. */
export function useSyncBarVisible(): boolean {
  return syncRowVisible(useSyncSummary())
}
