import { type ReactNode, Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { formatDateAu, formatCurrency } from '@/lib/utils'
import { StatusBadge } from '@/components/StatusBadge'
import { ChevronUp, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { useUiPreferences } from '@/hooks/useUiPreferences'

// ── Types ────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'date' | 'currency' | 'boolean' | 'badge' | 'custom'

type ColumnBase<T> = {
  header: string | ReactNode
  type?: ColumnType
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  hidden?: boolean
  editable?: {
    /**
     * `ctx.errorId` is the id of the row's error message element (see `rowError` on
     * `DataTableProps`) — defined only when that row currently has an error to show, `undefined`
     * otherwise, so a caller never wires `aria-describedby` to an id that isn't actually
     * rendered. Wire it (and `aria-invalid`) onto the rendered control for a screen-reader user
     * to get the same "this field failed validation" signal a sighted user gets from the error
     * text appearing under the row.
     */
    render: (row: T, onChange: (value: unknown) => void, ctx: { errorId?: string }) => ReactNode
  }
  bulkEditable?: {
    items: DropdownItem[]
    onBulkChange: (selectedIds: string[], value: string) => void
  }
  sortFn?: (a: T, b: T) => number
  className?: string
}

export type Column<T> =
  | (ColumnBase<T> & { key: keyof T & string; render?: (row: T, rowIndex: number) => ReactNode })
  | (ColumnBase<T> & { key: string; render?: (row: T, rowIndex: number) => ReactNode })

export type SortState = {
  key: string
  direction: 'asc' | 'desc'
}

export type DataTableProps<T> = {
  data: T[]
  columns: Column<T>[]
  keyField: keyof T & string
  sortable?: boolean
  defaultSort?: SortState
  sort?: SortState
  onSortChange?: (sort: SortState | null) => void
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  emptyMessage?: string
  footer?: ReactNode
  loading?: boolean
  editingRow?: string | number | null
  /**
   * Row keys currently in "every editable column open at once" mode — the shape DS-01's
   * DataTable docs deferred for a consumer needing N freeform rows all editable simultaneously
   * (RP-01's bulk-add table), as opposed to `editingRow`'s one-row-at-a-time inline edit. A row
   * whose key is in this set renders every `editable` column's edit control instead of the
   * display cell. Independent of `editingRow` — a row can be in edit mode via either (or, for an
   * unusual caller, both at once has no special meaning beyond "editing").
   */
  editingRows?: Set<string>
  onEditChange?: (row: T, key: string, value: unknown) => void
  /**
   * Per-row validation error shown as its own row directly beneath a row currently in edit mode
   * (`editingRow` or `editingRows`) — return `undefined`/`''` for a row with nothing to show.
   * Rendered with `role="alert"` (so a save-attempt's validation failures are announced) at a
   * stable, deterministic id (`${rowKey}-row-error`) that's handed to that row's `editable.render`
   * calls as `ctx.errorId` — wire it onto the failed row's inputs via `aria-describedby` (and set
   * `aria-invalid`) so the association reaches assistive tech, not just sighted users.
   */
  rowError?: (row: T) => string | undefined
  className?: string
  compact?: boolean
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  /** Adds a vertical border between every column (header + body cells), for tables dense enough
   * that scanning across a row benefits from a rule to track against. When omitted, falls back
   * to the user's `tableVerticalDividers` preference (GEN-2, see `useUiPreferences`) — pass an
   * explicit `true`/`false` here to override that preference for this table specifically. */
  verticalDividers?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────

function getValue(obj: any, key: string): any {
  return obj?.[key]
}

function defaultComparator(type: ColumnType | undefined, a: any, b: any): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  switch (type) {
    case 'date':
      return new Date(a).getTime() - new Date(b).getTime()
    case 'currency':
      return Number(a) - Number(b)
    case 'boolean':
      return (b ? 1 : 0) - (a ? 1 : 0)
    default:
      return String(a).localeCompare(String(b), 'en-AU')
  }
}

// ── Built-in cell renderers ──────────────────────────────────────

function renderCell<T>(row: T, col: Column<T>, rowIndex: number): ReactNode {
  if (col.render) return col.render(row, rowIndex)

  const value = getValue(row, col.key)

  switch (col.type) {
    case 'date':
      return formatDateAu(value)
    case 'currency':
      return formatCurrency(value)
    case 'boolean':
      return value ? <Check className="w-4 h-4 text-[var(--color-primary)] mx-auto" /> : null
    case 'badge':
      return value ? <StatusBadge status={String(value)} /> : '—'
    default:
      return value != null ? String(value) : '—'
  }
}

// ── Component ────────────────────────────────────────────────────

export function DataTable<T>({
  data,
  columns,
  keyField,
  sortable = false,
  defaultSort,
  sort: controlledSort,
  onSortChange,
  onRowClick,
  rowClassName,
  emptyMessage = 'No data',
  footer,
  loading = false,
  editingRow,
  editingRows,
  onEditChange,
  rowError,
  className,
  compact = false,
  selectable = false,
  selectedRows,
  onSelectionChange,
  verticalDividers,
}: DataTableProps<T>) {
  const { prefs } = useUiPreferences()
  const showVerticalDividers = verticalDividers ?? prefs.tableVerticalDividers
  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort ?? null)
  const isControlled = controlledSort !== undefined
  const activeSort = isControlled ? controlledSort ?? null : internalSort

  const visibleColumns = useMemo(() => columns.filter(c => !c.hidden), [columns])

  const sortedData = useMemo(() => {
    if (!activeSort) return data
    const col = columns.find(c => c.key === activeSort.key)
    if (!col) return data

    const sorted = [...data].sort((a, b) => {
      const cmp = col.sortFn
        ? col.sortFn(a, b)
        : defaultComparator(col.type, getValue(a, col.key), getValue(b, col.key))
      return activeSort.direction === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [data, activeSort, columns])

  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selectAllRef.current || !selectable || !sortedData.length) return
    const selectedCount = sortedData.filter(row =>
      selectedRows?.has(String((row as any)[keyField]))
    ).length
    selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < sortedData.length
  }, [selectedRows, sortedData, keyField, selectable])

  function handleSort(key: string) {
    if (!sortable) return
    const col = columns.find(c => c.key === key)
    if (!col?.sortable) return

    let next: SortState | null
    if (!activeSort || activeSort.key !== key) {
      next = { key, direction: 'asc' }
    } else if (activeSort.direction === 'asc') {
      next = { key, direction: 'desc' }
    } else {
      next = null
    }

    if (isControlled) {
      onSortChange?.(next)
    } else {
      setInternalSort(next)
      onSortChange?.(next)
    }
  }

  const cellPadding = compact ? 'px-2 py-1.5' : 'p-3'
  const dividerClass = showVerticalDividers ? 'divide-x divide-[var(--color-border)]' : ''

  return (
    <div className={className ?? 'relative bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] overflow-x-auto'}>
      {loading && data.length > 0 && (
        <div className="absolute inset-0 bg-[var(--color-card)]/50 flex items-center justify-center z-10 rounded-2xl">
          <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <table className="w-full text-sm mobile-card-table">
        <thead className="bg-[var(--color-accent)]">
          <tr className={dividerClass}>
            {selectable && (
              <th className={`${cellPadding} w-10`}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={
                    sortedData.length > 0 &&
                    sortedData.every(row =>
                      selectedRows?.has(String((row as any)[keyField]))
                    )
                  }
                  onChange={e => {
                    if (e.target.checked) {
                      onSelectionChange?.(
                        new Set(sortedData.map(row => String((row as any)[keyField])))
                      )
                    } else {
                      onSelectionChange?.(new Set())
                    }
                  }}
                  className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
                  aria-label="Select all rows"
                />
              </th>
            )}
            {visibleColumns.map(col => {
              const isSortable = sortable && col.sortable
              const isSorted = activeSort?.key === col.key
              const alignClass = col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'

              return (
                <th
                  key={col.key}
                  className={`${alignClass} ${cellPadding} text-xs font-medium text-[var(--color-muted-foreground)] whitespace-nowrap ${isSortable ? 'cursor-pointer select-none' : ''}`}
                  aria-sort={isSortable ? (isSorted ? (activeSort!.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  onClick={isSortable ? () => handleSort(col.key) : undefined}
                  onKeyDown={isSortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(col.key) } } : undefined}
                  tabIndex={isSortable ? 0 : undefined}
                >
                  <span className="inline-flex items-center gap-1 flex-wrap">
                    {col.header}
                    {isSortable && (
                      isSorted
                        ? activeSort!.direction === 'asc'
                          ? <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5" />
                        : <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />
                    )}
                    {col.bulkEditable && selectedRows && selectedRows.size > 0 && (
                      <span onClick={e => e.stopPropagation()}>
                        <Dropdown
                          variant="pill"
                          items={col.bulkEditable.items}
                          label={`${selectedRows.size} row${selectedRows.size === 1 ? '' : 's'}`}
                          colorClass="bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                          onChange={value => col.bulkEditable!.onBulkChange(Array.from(selectedRows), value)}
                        />
                      </span>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {loading && data.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className={`${cellPadding} py-8 text-center text-[var(--color-muted-foreground)]`}>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              </td>
            </tr>
          )}
          {!loading && sortedData.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className={`${cellPadding} py-6 text-center text-[var(--color-muted-foreground)]`} aria-live="polite">
                {emptyMessage}
              </td>
            </tr>
          )}
          {sortedData.map((row, rowIndex) => {
            const rowKey = String((row as any)[keyField])
            const isEditing = (editingRow != null && rowKey === String(editingRow)) || (editingRows?.has(rowKey) ?? false)
            const extraClass = rowClassName?.(row) ?? ''
            const isClickable = onRowClick && !loading
            const errorMessage = isEditing ? rowError?.(row) : undefined
            // Stable per-row id, only handed to editable.render (as ctx.errorId) when there's
            // actually an error <p> rendered at it — never a dangling aria-describedby reference.
            const rowErrorId = errorMessage ? `${rowKey}-row-error` : undefined

            return (
              <Fragment key={rowKey}>
                <tr
                  className={`hover:bg-[var(--color-accent)]/50 transition-colors ${dividerClass} ${isClickable ? 'group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]' : ''} ${extraClass}`}
                  onClick={isClickable ? () => onRowClick(row) : undefined}
                  onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row) } } : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                >
                  {selectable && (
                    <td
                      className={`${cellPadding} w-10`}
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRows?.has(rowKey) ?? false}
                        onChange={e => {
                          const next = new Set(selectedRows ?? [])
                          if (e.target.checked) {
                            next.add(rowKey)
                          } else {
                            next.delete(rowKey)
                          }
                          onSelectionChange?.(next)
                        }}
                        className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
                        aria-label={`Select row ${rowKey}`}
                      />
                    </td>
                  )}
                  {visibleColumns.map(col => {
                    const alignClass = col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''

                    if (isEditing && col.editable) {
                      return (
                        <td key={col.key} className={`${cellPadding} ${alignClass} ${col.className ?? ''}`} data-label={typeof col.header === 'string' ? col.header : ''}>
                          {col.editable.render(row, (value) => onEditChange?.(row, col.key, value), { errorId: rowErrorId })}
                        </td>
                      )
                    }

                    return (
                      <td key={col.key} className={`${cellPadding} ${alignClass} ${col.className ?? ''}`} data-label={typeof col.header === 'string' ? col.header : ''}>
                        {renderCell(row, col, rowIndex)}
                      </td>
                    )
                  })}
                </tr>
                {errorMessage && (
                  <tr className={dividerClass}>
                    <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className={`${cellPadding} pt-0`}>
                      <p id={rowErrorId} role="alert" className="text-xs text-[var(--color-destructive)]">{errorMessage}</p>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
        {footer && (
          <tfoot className="border-t-2 border-[var(--color-border)]">
            {footer}
          </tfoot>
        )}
      </table>
    </div>
  )
}
