import { useState } from 'react'
import { Plus } from 'lucide-react'

// ── Status Pill Styles ──

export const statusStyles: Record<string, { bg: string; dot: string; text: string; label: string }> = {
  Available:   { bg: 'bg-[var(--color-surface-container)]', dot: 'bg-[#c3c9b5]', text: 'text-[var(--color-muted-foreground)]', label: 'Available' },
  Unavailable: { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Unavailable' },
  Assigned:    { bg: 'bg-[var(--color-primary-fixed)]/25', dot: 'bg-[var(--color-primary)]', text: 'text-[var(--color-primary)]', label: 'Assigned' },
  Conflict:    { bg: 'bg-[#ffdad6]/50', dot: 'bg-[#ba1a1a]', text: 'text-[#ba1a1a]', label: 'Conflict' },
  Maintenance: { bg: 'bg-[var(--color-secondary-container)]/40', dot: 'bg-[var(--color-secondary)]', text: 'text-[var(--color-secondary)]', label: 'Maintenance' },
}

export default function StatusBadge({ status, role, clickable, onClick, onUnassign }: {
  status: string
  role?: string
  clickable?: boolean
  onClick?: () => void
  onUnassign?: () => void
}) {
  const s = statusStyles[status] || statusStyles.Available
  const isUnassignable = !!(onUnassign && status === 'Assigned')
  const [justUnassigned, setJustUnassigned] = useState(false)

  const handleUnassign = () => {
    setJustUnassigned(true)
    setTimeout(() => {
      onUnassign?.()
      setJustUnassigned(false)
    }, 1000)
  }

  if (justUnassigned) {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-primary-fixed)]/25 text-[var(--color-primary)] text-xs font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] flex-shrink-0" />
        <span>Unassigned</span>
      </div>
    )
  }

  if (clickable) {
    return (
      <div
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)] text-xs font-medium cursor-pointer hover:bg-[var(--color-primary-fixed)]/20 hover:text-[var(--color-primary)] transition-all group"
        title="Click to assign"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#c3c9b5] group-hover:bg-[var(--color-primary)] flex-shrink-0 transition-colors" />
        <span>Available</span>
        <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    )
  }

  if (isUnassignable) {
    return (
      <div
        onClick={handleUnassign}
        className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer transition-all bg-[var(--color-primary-fixed)]/25 text-[var(--color-primary)] hover:bg-rose-100 hover:text-rose-600"
        title="Click to unassign"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] group-hover:invisible flex-shrink-0 transition-colors" />
        <span className="text-xs font-medium group-hover:invisible">{s.label}</span>
        {role && <span className="text-[10px] opacity-75 group-hover:invisible">{role}</span>}
        <span className="absolute inset-0 hidden group-hover:flex items-center justify-center text-xs font-medium text-rose-600">Unassign</span>
      </div>
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
