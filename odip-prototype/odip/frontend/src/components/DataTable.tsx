import { type CSSProperties, type ReactNode, Children, Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { formatDateAu, formatCurrency } from '@/lib/utils'
import { StatusBadge } from '@/components/StatusBadge'
import { ChevronUp, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import { TAP_AREA_LINKS } from './tapArea'
import { plural } from '@/lib/format'

// ── Types ────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'date' | 'currency' | 'boolean' | 'badge' | 'custom'

/**
 * How early a column is dropped when the desktop table runs out of room. Only the table (md+)
 * drops columns; the mobile card view (below md) always keeps every field.
 *  - `'high'` (default): always shown.
 *  - `'medium'`: hidden below xl (1280px).
 *  - `'low'`: hidden below 2xl (1536px).
 *  - `'lowest'`: hidden below 1792px.
 */
export type ColumnPriority = 'high' | 'medium' | 'low' | 'lowest'

type ColumnBase<T> = {
  header: string | ReactNode
  type?: ColumnType
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  hidden?: boolean
  /**
   * Narrowest this column is ever laid out at (md+): a px number or any CSS length (`'10.25rem'`),
   * border-box, so it includes the cell's horizontal padding. Reserve room for content that changes
   * size in place (a status pill whose label swaps between "Draft" and "Open For Bookings") so the
   * column doesn't jump when it changes.
   */
  minWidth?: number | string
  /**
   * Cap for a plain-string cell (md+): a px number or any CSS length. Text longer than this is cut
   * with an ellipsis and its full text goes in the cell's `title`. Defaults to 24rem, so a free-text
   * column can never widen the table without bound. It applies only to cells DataTable renders as
   * text (no `render`, or a `render` that returns a string); a cell that returns elements limits
   * itself, see `CellText`.
   */
  maxWidth?: number | string
  /** Which viewports keep this column (md+); see `ColumnPriority`. Default `'high'`: always. */
  priority?: ColumnPriority
  /** Let this column's cells wrap onto several lines (prose such as notes). The row then grows past
   * `--row-h`. Default: body cells never wrap, so every row is exactly `--row-h` at any width. */
  wrap?: boolean
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
  /**
   * Extra-tight rows: the `--row-h` token minus 4px (30px on a mouse, 44px on a touch screen —
   * it never drops below a usable coarse-pointer row). Default rows are exactly `--row-h`.
   */
  compact?: boolean
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  /** Adds a vertical border between every column (header + body cells), for tables dense enough
   * that scanning across a row benefits from a rule to track against. When omitted, falls back
   * to the user's `tableVerticalDividers` preference (GEN-2, see `useUiPreferences`) — pass an
   * explicit `true`/`false` here to override that preference for this table specifically. */
  verticalDividers?: boolean
  /**
   * Signals that `data` is one server-paged slice of `totalCount`, not the full result set.
   * Its presence is the sole switch: when provided, `DataTable` renders "Showing X-Y of Z" +
   * Previous/Next controls (same pattern as `UsersTab.tsx`'s pager) and stops re-sorting `data`
   * client-side (see `sortedData` below) — sorting one page of N would silently misrepresent the
   * dataset's true order while still claiming (via the sort chevrons/`aria-sort`) that the whole
   * table is sorted. A paginated caller that wants sortable columns must pass a controlled
   * `sort`/`onSortChange` pair and turn `onSortChange` into a server-side query param itself;
   * `DataTable`'s existing controlled-sort path already does the right thing mechanically once
   * `pagination` stops the second, wrong, client-side sort on top of it. Omitted by every
   * existing caller today, so no existing table's rendering or behavior changes.
   */
  pagination?: {
    page: number
    pageSize: number
    totalCount: number
    onPageChange: (page: number) => void
  }
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

// ── Responsive columns and single-line cells ─────────────────────

// Tailwind only emits classes it can read as whole literals, so each level is spelled out. Every
// one starts at `md:`: below 768px `.mobile-card-table` (index.css) turns rows into cards and every
// field stays. `max-xl` / `max-2xl` are strict (`width < 1280px` / `< 1536px`), so a column is
// still there at exactly 1280 (medium) or 1536 (low).
const PRIORITY_HIDDEN_CLASS: Record<ColumnPriority, string> = {
  high: '',
  medium: 'md:max-xl:hidden',
  low: 'md:max-2xl:hidden',
  lowest: 'md:max-[1792px]:hidden',
}

/** A number is px, a string is passed through as a CSS length. */
function cssLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value
}

/**
 * The text of a cell that is just a string, or null when it isn't one. Only real strings get a
 * `title` and the ellipsis cap: an element the caller rendered limits itself, a formatted
 * date/currency is never long, and a number or the empty-cell dash has nothing to reveal.
 */
function plainTextOf<T>(row: T, col: Column<T>, content: ReactNode): string | null {
  if (typeof content !== 'string' || content === '' || content === '—') return null
  if (col.render) return content
  if (col.type === 'date' || col.type === 'currency') return null
  return typeof getValue(row, col.key) === 'string' ? content : null
}

/**
 * One line of text for a custom-rendered cell, cut with an ellipsis at whatever `md:max-w-*` the
 * caller gives it, with the full text in `title` (taken from `children` when that is a string).
 * DataTable does the same for plain-string cells on its own; reach for this inside `render` when a
 * cell needs its own cap. Let the cap grow with the room by stacking named breakpoints
 * (`md:max-w-[9rem] 2xl:max-w-[16rem]`), but not with an arbitrary `min-[1792px]:max-w-*` on top of
 * them: Tailwind emits arbitrary min-width variants BEFORE the named ones, so at 1792+ the named
 * cap wins. Use ranges that don't overlap instead (`md:max-2xl:max-w-* 2xl:max-[1792px]:max-w-*
 * min-[1792px]:max-w-*`). For a link, put the truncation on the link itself, not on a wrapper: the
 * wrapper's `overflow: hidden` would clip the link's focus ring.
 */
export function CellText({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  const full = title ?? (typeof children === 'string' ? children : undefined)
  return <span className={`block md:truncate ${className}`} title={full}>{children}</span>
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
  pagination,
}: DataTableProps<T>) {
  const { prefs } = useUiPreferences()
  const showVerticalDividers = verticalDividers ?? prefs.tableVerticalDividers
  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort ?? null)
  const isControlled = controlledSort !== undefined
  const activeSort = isControlled ? controlledSort ?? null : internalSort

  const visibleColumns = useMemo(() => columns.filter(c => !c.hidden), [columns])

  const sortedData = useMemo(() => {
    // Once a caller pages server-side, `data` is only one slice of the full result set — sorting
    // just that slice client-side would sort *within the page* while the chevrons/aria-sort keep
    // claiming the whole table is sorted, silently misrepresenting the true order. Trust the
    // server's order exactly as returned; a paginated caller wires sort server-side instead via
    // the existing controlled sort/onSortChange props.
    if (pagination) return data
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
  }, [data, activeSort, columns, pagination])

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

  // Row geometry comes from the density tokens (spec §1/§4) and never from vertical padding:
  //  - body rows: `height: var(--row-h)` on the <tr> (34px fine / 48px coarse). A table row's
  //    height is a minimum, so a row only grows past the token if a cell gets taller than it. Cells
  //    never wrap (below), so that can't happen from a narrow window; 24px row actions, pills and
  //    32px inline editors all fit inside 34px (36/44px inside 48px on coarse pointers, where those
  //    controls grow with their own tokens).
  //  - header row: `height: var(--table-head-h)` (32px / 40px).
  //  - cells get --cell-px horizontally, no vertical padding, and `align-middle`, so content is
  //    centred in the row instead of stacking padding on top of it (which is what made rows 43px).
  //  - body cells are `whitespace-nowrap` (unless the column opts in with `wrap`), so a narrower
  //    window costs a column, not a row height: a plain string is cut with an ellipsis at its cap
  //    (`maxWidth`, full text in `title`), a custom cell limits itself (`CellText`), and a column
  //    that is low `priority` is dropped below its breakpoint instead of being squeezed.
  //  - `md:` on the body row, the nowrap, the truncation and the column-width vars: below 768px
  //    `.mobile-card-table` (index.css) turns each <tr> into a padded flex card, where a fixed
  //    height would clip it and text has to be free to wrap inside the card.
  //  - `compact` is the same token minus 4px (30px fine, 44px coarse), so it stays extra-tight on
  //    a mouse without dropping below a usable row on a touch screen.
  const cellPaddingX = 'px-[var(--cell-px)]'
  const cellClass = `${cellPaddingX} align-middle`
  // Per-column classes shared by the header and body cells: which viewports keep the column, and
  // its `minWidth` (via a custom property so it, too, only applies from md up).
  const columnClass = (col: Column<T>) =>
    `${PRIORITY_HIDDEN_CLASS[col.priority ?? 'high']} ${col.minWidth != null ? 'md:min-w-[var(--col-min)]' : ''}`
  const columnStyle = (col: Column<T>): CSSProperties | undefined =>
    col.minWidth != null ? ({ '--col-min': cssLength(col.minWidth) } as CSSProperties) : undefined
  const bodyRowHeight = compact ? 'md:h-[calc(var(--row-h)-4px)]' : 'md:h-[var(--row-h)]'
  const headerRowHeight = 'h-[var(--table-head-h)]'
  const dividerClass = showVerticalDividers ? 'divide-x divide-[var(--color-border)]' : ''

  return (
    <div className={className ?? 'relative bg-[var(--color-card)] rounded-md border border-[var(--color-border)] overflow-x-auto'}>
      {loading && data.length > 0 && (
        <div className="absolute inset-0 bg-[var(--color-card)]/50 flex items-center justify-center z-10 rounded-md">
          <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <table className="w-full text-sm tabular-nums mobile-card-table">
        <thead className="sticky top-0 z-[1] bg-[var(--color-card)]">
          <tr className={`${dividerClass} ${headerRowHeight}`}>
            {selectable && (
              <th className={`${cellClass} w-10`}>
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
                  className={`${alignClass} ${cellClass} text-xs font-medium text-[var(--color-muted-foreground)] whitespace-nowrap ${columnClass(col)} ${isSortable ? 'cursor-pointer select-none' : ''}`}
                  style={columnStyle(col)}
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
                          label={plural(selectedRows.size, 'row')}
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
              <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className={`${cellPaddingX} py-6 text-center text-[var(--color-muted-foreground)]`}>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              </td>
            </tr>
          )}
          {!loading && sortedData.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className={`${cellPaddingX} py-6 text-center text-[var(--color-muted-foreground)]`} aria-live="polite">
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
                  className={`group/row ${bodyRowHeight} hover:bg-[var(--color-accent)]/50 transition-colors ${dividerClass} ${isClickable ? 'group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]' : ''} ${extraClass}`}
                  onClick={isClickable ? () => onRowClick(row) : undefined}
                  onKeyDown={isClickable ? (e) => {
                    // Only the row itself activates it. Enter/Space on a control inside the row (a
                    // row action, a status pill, a checkbox) bubbles up here too, and must keep doing
                    // its own job — not navigate away with its default action cancelled.
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row) }
                  } : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                >
                  {selectable && (
                    <td
                      className={`${cellClass} w-10`}
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
                        <td key={col.key} className={`${cellClass} ${alignClass} ${columnClass(col)} ${col.className ?? ''}`} style={columnStyle(col)} data-label={typeof col.header === 'string' ? col.header : ''}>
                          {col.editable.render(row, (value) => onEditChange?.(row, col.key, value), { errorId: rowErrorId })}
                        </td>
                      )
                    }

                    const content = renderCell(row, col, rowIndex)
                    const text = col.wrap ? null : plainTextOf(row, col, content)

                    // TAP_AREA_LINKS: under a coarse pointer every link in a body cell (a name, a trip, "Open")
                    // gets a 44px hit area from a transparent ::before, so a caller's `render` needs nothing and
                    // a 19px link is not a 19px target on a phone. Nothing at all on a mouse.
                    return (
                      <td
                        key={col.key}
                        className={`${cellClass} ${col.wrap ? '' : 'md:whitespace-nowrap'} ${alignClass} ${columnClass(col)} ${col.className ?? ''} ${TAP_AREA_LINKS}`}
                        style={columnStyle(col)}
                        data-label={typeof col.header === 'string' ? col.header : ''}
                      >
                        {text != null ? (
                          <span
                            className="block md:truncate md:max-w-[var(--cell-max,24rem)]"
                            style={col.maxWidth != null ? ({ '--cell-max': cssLength(col.maxWidth) } as CSSProperties) : undefined}
                            title={text}
                          >
                            {text}
                          </span>
                        ) : content}
                      </td>
                    )
                  })}
                </tr>
                {errorMessage && (
                  <tr className={dividerClass}>
                    <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className={`${cellPaddingX} pb-2`}>
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
      {pagination && pagination.totalCount > 0 && (
        <div className={`flex min-h-[var(--row-h)] items-center justify-between text-sm ${cellPaddingX} border-t border-[var(--color-border)]`}>
          <span className="text-[var(--color-muted-foreground)]" aria-live="polite">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}-
            {Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of {pagination.totalCount}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-muted-foreground)]" aria-current="page">
              Page {pagination.page} of {Math.max(1, Math.ceil(pagination.totalCount / pagination.pageSize))}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              aria-label="Previous page"
              className="h-[var(--control-h-sm)] pointer-coarse:h-[var(--control-h)] px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= Math.ceil(pagination.totalCount / pagination.pageSize)}
              aria-label="Next page"
              className="h-[var(--control-h-sm)] pointer-coarse:h-[var(--control-h)] px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Row actions ──────────────────────────────────────────────────

// Reveal is opacity only — never display:none / visibility:hidden — so every control stays in the
// tab order and in the accessibility tree; keyboard focus lands on it and `focus-within` shows it.
// Deliberately no `pointer-events: none` while hidden either: voice-control and switch tools click
// an element by its coordinates, and would hit the cell underneath instead. Coarse pointers
// (touch) have no hover, so the actions are always shown there.
const ROW_ACTIONS_REVEAL = [
  'opacity-0 transition-opacity',
  'group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-within:opacity-100',
  '[@media(pointer:coarse)]:opacity-100',
].join(' ')

// Bridge for the hand-rolled icon group in `ActionButtons` (what `useArchiveRestore().actionButtons`
// renders): its <a>/<button> children are p-1.5 (28px), which would out-size the 24px row actions
// beside them. Pinning them to the same --control-h-sm square as `Button iconOnly` keeps a row's
// actions one height. Targets only ActionButtons' direct icon children, so text buttons in the
// same cluster are untouched. Drop it once ActionButtons itself renders `Button iconOnly`. (Under a
// coarse pointer ActionButtons agrees with this pin on its own: it is 36px there wherever it sits, with
// TAP_AREA's 44px hit area and the 8px gap `RowActions` and ActionButtons both open.)
const ROW_ACTIONS_LEGACY_ICONS = [
  '[&>div>:is(a,button)]:inline-flex [&>div>:is(a,button)]:items-center [&>div>:is(a,button)]:justify-center',
  '[&>div>:is(a,button)]:h-[var(--control-h-sm)] [&>div>:is(a,button)]:w-[var(--control-h-sm)] [&>div>:is(a,button)]:p-0',
].join(' ')

// Overlay mode: on a mouse (`pointer-fine`) at md+ the cluster leaves the table's flow and sits on
// top of the row's last data cells, so its column costs no width — a cluster with "Change status"
// in it reserved ~200px of every row and was what squeezed the other columns at 1280-1440. It is
// anchored to the left edge of the cell it lives in (`right-full`, that cell being `relative`) and
// hides what it covers: the row's own background, solid under the buttons and fading out over its
// 24px left padding. `--row-bg` is the card colour, switched to the hover row's tint (accent at 50%
// over card) while the row is hovered, so the patch never shows against the row. Touch
// (`pointer: coarse`, no hover to reveal it) and the mobile card view keep it in the flow, where it
// is always shown and covers nothing.
const ROW_ACTIONS_OVERLAY = [
  'md:pointer-fine:absolute md:pointer-fine:right-full md:pointer-fine:inset-y-0 md:pointer-fine:pl-6 md:pointer-fine:pr-1.5',
  'md:pointer-fine:[--row-bg:var(--color-card)] md:pointer-fine:group-hover/row:[--row-bg:color-mix(in_srgb,var(--color-accent)_50%,var(--color-card))]',
  'md:pointer-fine:bg-[linear-gradient(to_left,var(--row-bg)_calc(100%_-_1.5rem),transparent)]',
].join(' ')

/**
 * A table row's action cluster (edit / archive / quick links / status change). Right-aligned,
 * shown while its row is hovered or holds keyboard focus and always shown on coarse pointers
 * (spec §4). Render it inside a `DataTable` cell — the reveal keys off the `group/row` class
 * DataTable puts on every body row, so outside a row it would stay hidden. Content should be
 * `Button size="sm"` / `iconOnly` (24px) so the row keeps its `--row-h` height. Keep an action
 * that must always be visible (a row's status pill, a queue's only call to action) out of it.
 * Under `pointer: coarse` those buttons are 36px with a 44px hit area (TAP_AREA, 4px past each edge),
 * so the gap opens from 6px to 8px: neighbouring hit areas touch and never overlap.
 *
 * `overlay` takes the cluster out of the flow on a mouse (see ROW_ACTIONS_OVERLAY): use it for a
 * cluster wide enough to matter, in a `relative` cell (`className: 'relative'` on the column) that
 * holds only what must stay visible, such as the chevron. It renders nothing when it has no children,
 * so an empty cluster never leaves a blank patch over its neighbours on hover.
 */
export function RowActions({ children, overlay = false }: { children: ReactNode; overlay?: boolean }) {
  if (overlay && Children.toArray(children).length === 0) return null
  return (
    <div className={`flex items-center justify-end gap-1.5 pointer-coarse:gap-2 ${ROW_ACTIONS_REVEAL} ${ROW_ACTIONS_LEGACY_ICONS} ${overlay ? ROW_ACTIONS_OVERLAY : ''}`}>
      {children}
    </div>
  )
}
