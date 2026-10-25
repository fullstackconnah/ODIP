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
  /** Drops empty rows and names them in one "Not recorded: A, B …" foot line (up to 6, then "and n more"). */
  hideEmpty?: boolean
  /** With hideEmpty: a ghost "Add" button on the foot line of a part-recorded list. An all-empty list has none: the card header Edit is its one action. */
  onAdd?: () => void
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
export function FactList({ items, emptyMessage = 'Not recorded', onEdit, hideEmpty, onAdd, className }: FactListProps) {
  const allEmpty = items.length === 0 || items.every(item => isEmptyValue(item.value))

  if (allEmpty) {
    return (
      <div className={`flex items-center justify-between gap-2 ${className ?? ''}`}>
        <p className="text-sm text-[var(--color-muted-foreground)]">{emptyMessage}</p>
        {!(hideEmpty && onAdd) && onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
    )
  }

  const shown = hideEmpty ? items.filter(item => !isEmptyValue(item.value)) : items
  const missing = hideEmpty ? items.filter(item => isEmptyValue(item.value)).map(item => item.label) : []
  const names = missing.slice(0, 6).join(', ') + (missing.length > 6 ? ` and ${missing.length - 6} more` : '')

  const rows = (
    <dl className={`grid grid-cols-[10rem_1fr] gap-x-4 ${hideEmpty ? '' : className ?? ''}`}>
      {shown.map((item, idx) => (
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
  if (!hideEmpty || missing.length === 0) return rows

  return (
    <div className={className}>
      {rows}
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-[13px] leading-6 text-[var(--color-muted-foreground)]">Not recorded: {names}</p>
        {onAdd && (
          <Button variant="ghost" size="sm" className="min-h-[var(--tap-min)]" onClick={onAdd}>
            Add
          </Button>
        )}
      </div>
    </div>
  )
}
