import { useCallback, useState } from 'react'
import { useNotices } from '@/hooks/useNotices'
import type { GroupKey } from './quickGroupModel'

/**
 * What the decision section remembers across its groups: the rows decided here (they leave at once, before the refetch), the consequence notices (a
 * notice's subject is its group's key), and the one sentence for the page's AnnouncementRegion. The page holds it, so a group can leave the page while
 * the announcement and the all-clear logic still know about it.
 */
export function useDecisionState() {
  // No cap: the section holds only consequence notices (an approval that overlaps the roster), and each must stay until it is dismissed. useNotices'
  // default cap of 3 successes would drop the oldest unseen when a fourth leave overlaps (SHAPE call 5: a consequence is never swallowed).
  const { notices, notify, dismiss } = useNotices(Number.MAX_SAFE_INTEGER)
  // key -> when it was marked: only a read of its OWN group that finished later may unmark it (NeedsYourDecision).
  const [gone, setGone] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [announcement, announce] = useState('')
  const markGone = useCallback((key: string) => setGone((prev) => new Map(prev).set(key, Date.now())), [])
  // A fresh read that lists a row again says it is not decided after all: the mark must not hide it for good.
  const unmarkGone = useCallback((keys: string[]) => setGone((prev) => {
    const next = new Map(prev)
    for (const key of keys) next.delete(key)
    return next
  }), [])
  // The groups with a bulk run in flight: each keeps its tab until its run's notice lands (isPresent).
  const [running, setRunningSet] = useState<ReadonlySet<GroupKey>>(() => new Set())
  const setRunning = useCallback((key: GroupKey, on: boolean) => setRunningSet((prev) => {
    const next = new Set(prev)
    if (on) next.add(key)
    else next.delete(key)
    return next
  }), [])
  return { notices, notify, dismiss, gone, markGone, unmarkGone, announcement, announce, running, setRunning }
}

export type DecisionState = ReturnType<typeof useDecisionState>
