import React from 'react'

export default function QualBadge({ active, icon: Icon, title }: { active: boolean; icon: React.ElementType; title: string }) {
  if (!active) return null
  return (
    <span title={title} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-fixed)]/30 text-[var(--color-primary)]">
      <Icon className="h-3 w-3" />
    </span>
  )
}

export type Qualification = { active: boolean; icon: React.ElementType; title: string }

/**
 * Most chip slots (a trailing "+N" counts as one) the qualification strip may occupy. A staff row is
 * a single 34px line, so five 20px chips beside the name and role would crowd them out; past this
 * the strip shows the first (MAX_SLOTS - 1) chips plus "+N", with the full list in a tooltip.
 */
const MAX_SLOTS = 4

/**
 * The staff row's qualification chips on one line. Every chip is 20px (the "≤20px" ceiling for a
 * chip inside a 34px row); when more than MAX_SLOTS qualifications apply the rest collapse into a
 * "+N" chip whose title (and screen-reader text) carries the FULL qualification list.
 */
export function QualBadgeList({ items, className }: { items: Qualification[]; className?: string }) {
  const active = items.filter(q => q.active)
  if (active.length === 0) return null

  const collapsed = active.length > MAX_SLOTS
  const shown = collapsed ? active.slice(0, MAX_SLOTS - 1) : active
  const hiddenCount = active.length - shown.length
  const fullList = active.map(q => q.title).join(', ')

  return (
    <span className={`flex shrink-0 items-center gap-1 ${className ?? ''}`}>
      {shown.map(q => (
        <QualBadge key={q.title} active icon={q.icon} title={q.title} />
      ))}
      {hiddenCount > 0 && (
        <span
          title={fullList}
          className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container)] px-1 text-xs font-semibold text-[var(--color-muted-foreground)]"
        >
          +{hiddenCount}
          <span className="sr-only"> more qualifications: {fullList}</span>
        </span>
      )}
    </span>
  )
}
