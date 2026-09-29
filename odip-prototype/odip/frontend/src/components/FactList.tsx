import type { ReactNode } from 'react'
import { Button } from './Button'

export type FactListItem = {
  label: string
  value: ReactNode
}

export type FactListProps = {
  items: FactListItem[]
  /** Shown as a single muted line in place of the rows when every item's value is empty.
   * Defaults to "Not recorded". */
  emptyMessage?: string
  /** Renders a ghost "Edit" button next to the empty-state message when every value is empty. */
  onEdit?: () => void
  className?: string
}

function isEmptyValue(value: ReactNode): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

/**
 * Semantic `<dl>` for a section's key/value facts (density-redesign §5). Label column is a
 * fixed 10rem, muted 13px; value column flows at 14px; rows keep a 24px pitch via `leading-6`
 * with no extra padding, so a page of short facts doesn't read as ten rows of dead air. An
 * individually empty value renders as a muted em dash so the row stays in place for scannability.
 *
 * When every item's value is empty, the whole list collapses to a single muted line (avoiding a
 * "wall of dashes") with an optional ghost `onEdit` action.
 */
export function FactList({ items, emptyMessage = 'Not recorded', onEdit, className }: FactListProps) {
  const allEmpty = items.length === 0 || items.every(item => isEmptyValue(item.value))

  if (allEmpty) {
    return (
      <div className={`flex items-center justify-between gap-2 ${className ?? ''}`}>
        <p className="text-sm text-[var(--color-muted-foreground)]">{emptyMessage}</p>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
    )
  }

  return (
    <dl className={`grid grid-cols-[10rem_1fr] gap-x-4 ${className ?? ''}`}>
      {items.map((item, idx) => (
        // display:contents lets each label/value pair participate directly in the parent grid
        // as its own row, without an extra wrapping box breaking the two-column alignment.
        <div key={idx} className="contents">
          <dt className="text-[13px] leading-6 text-[var(--color-muted-foreground)]">{item.label}</dt>
          <dd className="text-sm leading-6 text-[var(--color-foreground)]">
            {isEmptyValue(item.value) ? <span className="text-[var(--color-muted-foreground)]">—</span> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
