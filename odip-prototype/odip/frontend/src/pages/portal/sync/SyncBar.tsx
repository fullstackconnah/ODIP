import { SyncRow } from './SyncRow'
import { syncRowVisible, useSyncSummary } from './syncState'

/**
 * My shifts has no action bar, so unsent changes get their own: the same sticky bar as ActionBar (SHAPE 4a), a labelled region, last on the page.
 * While the row has nothing to say the wrapper is display: contents (no region, no box, so no spacing from a space-y parent), so the row's status span stays mounted and nothing shifts.
 */
export function SyncBar({ className = '' }: { className?: string }) {
  const visible = syncRowVisible(useSyncSummary())
  return (
    <div role={visible ? 'region' : undefined} aria-label={visible ? 'Sending' : undefined} className={visible ? `sticky bottom-[var(--mobile-nav-h)] lg:bottom-0 z-20 -mx-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 lg:mx-0 lg:rounded-lg lg:border ${className}` : 'contents'}>
      <SyncRow />
    </div>
  )
}
