import { useUiPreferences } from '@/hooks/useUiPreferences'

/**
 * Skeleton loader that mirrors DataTable's outer chrome (rounded-2xl card, border,
 * overflow-x-auto) exactly, so swapping it out for the real DataTable once data
 * arrives causes no layout jump. Used instead of a spinner for table loading states.
 */
export type TableSkeletonProps = {
  columns: number
  rows?: number
}

export function TableSkeleton({ columns, rows = 6 }: TableSkeletonProps) {
  const { prefs } = useUiPreferences()
  const dividerClass = prefs.tableVerticalDividers ? 'divide-x divide-[var(--color-border)]' : ''

  return (
    <div
      className="relative bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] overflow-x-auto"
      aria-hidden="true"
    >
      <span className="sr-only" role="status" aria-live="polite">Loading…</span>
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-accent)]">
          <tr className={dividerClass}>
            {Array.from({ length: columns }).map((_, c) => (
              <th key={c} className="p-3">
                <div className="h-3 rounded bg-[var(--color-border)]/60 animate-pulse" style={{ width: '60%' }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className={dividerClass}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c} className="p-3">
                  <div
                    className="h-4 rounded bg-[var(--color-accent)] animate-pulse"
                    style={{ width: `${55 + ((r * 13 + c * 29) % 35)}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
