import { Plus } from 'lucide-react'

// ── Status Pill Styles ──

export const statusStyles: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  Available:   { bg: 'bg-[var(--color-surface-container)]', dot: 'bg-[#c3c9b5]', text: 'text-[var(--color-muted-foreground)]', label: 'Available' },
  Unavailable: { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Unavailable' },
  Tentative:   { bg: 'bg-[var(--color-warning-container)]/50', dot: 'bg-[var(--color-warning)]', text: 'text-[var(--color-warning)]', label: 'Tentative' },
  Assigned:    { bg: 'bg-[var(--color-primary-fixed)]/25', dot: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]', label: 'Assigned' },
  Conflict:    { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Conflict' },
  Maintenance: { bg: 'bg-[var(--color-secondary-container)]/40', dot: 'bg-[var(--color-secondary)]', text: 'text-[var(--color-secondary)]', label: 'Maintenance' },
}

export default function StatusBadge({ status, role, clickable, onClick, onUnassign, assignLabel, unassignLabel }: {
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)] text-xs font-medium cursor-pointer hover:bg-[var(--color-primary-fixed)]/20 hover:text-[var(--color-primary)] transition-all group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
        title="Click to assign"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#c3c9b5] group-hover:bg-[var(--color-primary)] flex-shrink-0 transition-colors" />
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
        className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer transition-all bg-[var(--color-primary-fixed)]/25 text-[var(--color-primary)] hover:bg-rose-100 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
        title="Click to unassign"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] group-hover:invisible flex-shrink-0 transition-colors" />
        <span className="text-xs font-medium group-hover:invisible">{s.label}</span>
        {role && <span className="text-[10px] opacity-75 group-hover:invisible">{role}</span>}
        <span className="absolute inset-0 hidden group-hover:flex items-center justify-center text-xs font-medium text-rose-600">Unassign</span>
      </button>
    )
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ${s.bg} ${s.text} text-xs font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      <span>{s.label}</span>
      {role && <span className="text-[10px] opacity-75">· {role}</span>}
    </div>
  )
}
