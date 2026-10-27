import { SyncRow, syncRowVisible, useSyncSummary } from './SyncRow'

/**
 * My shifts has no action bar, so unsent changes get their own: the same sticky bar as ActionBar (SHAPE 4a), a labelled region, last on the page.
 * It renders nothing at all while the row has nothing to say.
 */
export function SyncBar({ className = '' }: { className?: string }) {
  const summary = useSyncSummary()
  if (!syncRowVisible(summary)) return null
  return (
    <div role="region" aria-label="Sending" className={`sticky bottom-[var(--mobile-nav-h)] lg:bottom-0 z-20 -mx-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 lg:mx-0 lg:rounded-lg lg:border ${className}`}>
      <SyncRow />
    </div>
  )
}

/** Whether a SyncBar would show right now: the install prompt steps aside for it. */
export function useSyncBarVisible(): boolean {
  return syncRowVisible(useSyncSummary())
}
