import { useCallback, useState } from 'react'
import { useNotices } from '@/hooks/useNotices'

/**
 * What the decision section remembers across its groups: the rows decided here (they leave at once, before the refetch), the consequence notices (a
 * notice's subject is its group's key), and the one sentence for the page's AnnouncementRegion. The page holds it, so a group can leave the page while
 * the announcement and the all-clear logic still know about it.
 */
export function useDecisionState() {
  // No cap: the section holds only consequence notices (an approval that overlaps the roster), and each must stay until it is dismissed. useNotices'
  // default cap of 3 successes would drop the oldest unseen when a fourth leave overlaps (SHAPE call 5: a consequence is never swallowed).
  const { notices, notify, dismiss } = useNotices(Number.MAX_SAFE_INTEGER)
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [announcement, announce] = useState('')
  const markGone = useCallback((key: string) => setGone((prev) => new Set(prev).add(key)), [])
  return { notices, notify, dismiss, gone, markGone, announcement, announce }
}

export type DecisionState = ReturnType<typeof useDecisionState>
