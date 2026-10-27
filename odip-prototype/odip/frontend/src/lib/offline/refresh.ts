import type { QueryClient } from '@tanstack/react-query'
import { offlineQueue } from './queue'

/**
 * Once a replay has sent something, the screen must show the server's copy: the saved copy it fell back to while offline
 * no longer has the overlay of the sent records, and a reconnect refetch can land before the replay's writes do.
 * Returns the unsubscribe.
 */
export function refreshPortalAfterReplay(qc: QueryClient, queue: Pick<typeof offlineQueue, 'onReplaySent'> = offlineQueue): () => void {
  return queue.onReplaySent(() => {
    for (const key of ['portal-shift-detail', 'portal-shift-notes', 'portal-my-shifts']) void qc.invalidateQueries({ queryKey: [key] })
  })
}
