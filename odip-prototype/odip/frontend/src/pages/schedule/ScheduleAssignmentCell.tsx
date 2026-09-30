import { Plus } from 'lucide-react'

// ── Status Pill Styles ──

const statusStyles: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  Available:   { bg: 'bg-[var(--color-surface-container)]', dot: 'bg-[var(--color-border)]', text: 'text-[var(--color-muted-foreground)]', label: 'Available' },
  Unavailable: { bg: 'bg-[var(--color-error-container)]/50', dot: 'bg-[var(--color-destructive)]', text: 'text-[var(--color-destructive)]', label: 'Unavailable' },
  // The dot keeps the --color-warning hue; the label uses on-warning-container because --color-warning
  // (#f59e0b) on this pale amber fill is ~2:1, far below the 4.5:1 floor for 14px text.
  Tentative:   { bg: 'bg-[var(--color-warning-container)]/50', dot: 'bg-[var(--color-warning)]', text: 'text-[var(--color-on-warning-container)]', label: 'Tentative' },
  Assigned:    { bg: 'bg-[var(--color-primary-fixed)]/25', dot: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]', label: 'Assigned' },
  Conflict:    { bg: 'bg-[var(--color-error-container)]/50', dot: 'bg-[var(--color-destructive)]', text: 'text-[var(--color-destructive)]', label: 'Conflict' },
  Maintenance: { bg: 'bg-[var(--color-secondary-container)]/40', dot: 'bg-[var(--color-secondary)]', text: 'text-[var(--color-secondary)]', label: 'Maintenance' },
}

/**
 * Shared pill geometry. Height is the schedule row (--row-h, 34px) less 3px of cell padding a side, so
 * the chip is 28px at a fine pointer and grows with the row under `pointer: coarse` (row 48px ->
 * chip 42px) instead of re-declaring a pixel value. Label is 14px (text-sm); the role beside it is
 * secondary text at 13px and truncates rather than widening the trip column.
 */
const PILL = 'inline-flex h-[calc(var(--row-h)_-_6px)] min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap'
const ROLE = 'min-w-0 max-w-[9rem] truncate text-[13px] opacity-80'

export default function ScheduleAssignmentCell({ status, role, clickable, onClick, onUnassign, assignLabel, unassignLabel }: {
  status: string
  role?: string
  clickable?: boolean
  onClick?: () => void
  onUnassign?: () => void
  /** PP-9: accessible name for the "click to assign" state — pass whatever name/trip context the caller has (e.g. `Assign ${staffName} to ${tripName}`). Falls back to a generic label when omitted. */
  assignLabel?: string
  /** PP-9: accessible name for the "click to unassign" state — same convention as `assignLabel`. */
  unassignLabel?: string
}) {
  const s = statusStyles[status] || statusStyles.Available
  const isUnassignable = !!(onUnassign && status === 'Assigned')

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={assignLabel ?? 'Assign'}
        className={`${PILL} bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)] cursor-pointer hover:bg-[var(--color-primary-fixed)]/20 hover:text-[var(--color-primary)] transition-all group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2`}
        title="Click to assign"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-border)] group-hover:bg-[var(--color-primary)] flex-shrink-0 transition-colors" />
        <span>Available</span>
        <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  if (isUnassignable) {
    return (
      <button
        type="button"
        onClick={onUnassign}
        aria-label={unassignLabel ?? 'Unassign'}
        className={`${PILL} group relative cursor-pointer transition-all bg-[var(--color-primary-fixed)]/25 text-[var(--color-primary)] hover:bg-[var(--color-error-container)] hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2`}
        title="Click to unassign"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] group-hover:invisible flex-shrink-0 transition-colors" />
        <span className="group-hover:invisible">{s.label}</span>
        {role && <span className={`${ROLE} group-hover:invisible`}>{role}</span>}
        <span className="absolute inset-0 hidden group-hover:flex items-center justify-center text-sm font-medium text-[var(--color-destructive)]">Unassign</span>
      </button>
    )
  }

  return (
    <div className={`${PILL} ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      <span>{s.label}</span>
      {role && <span className={ROLE} title={role}>· {role}</span>}
    </div>
  )
}
