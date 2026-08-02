import { type ReactNode, useState, useMemo, useRef, useEffect } from 'react'
import { formatDateAu, formatCurrency } from '@/lib/utils'
import { StatusBadge } from '@/components/StatusBadge'
import { ChevronUp, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'

// ── Types ────────────────────────────────────────────────────────

export type ColumnType = 'text' | 'date' | 'currency' | 'boolean' | 'badge' | 'custom'

type ColumnBase<T> = {
  header: string | ReactNode
  type?: ColumnType
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  hidden?: boolean
  editable?: {
    render: (row: T, onChange: (value: unknown) => void) => ReactNode
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
  onEditChange?: (row: T, key: string, value: unknown) => void
  className?: string
  compact?: boolean
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
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
  onEditChange,
  className,
  compact = false,
  selectable = false,
  selectedRows,
  onSelectionChange,
}: DataTableProps<T>) {
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

  return (
    <div className={className ?? 'relative bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] overflow-x-auto'}>
      {loading && data.length > 0 && (
        <div className="absolute inset-0 bg-[var(--color-card)]/50 flex items-center justify-center z-10 rounded-2xl">
          <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-accent)]">
          <tr>
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
                  className="rounded border-[var(--color-border)] accent-[#396200] cursor-pointer"
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
                  role={isSortable ? 'button' : undefined}
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
                          colorClass="bg-[#396200]/15 text-[#396200]"
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
            const isEditing = editingRow != null && rowKey === String(editingRow)
            const extraClass = rowClassName?.(row) ?? ''
            const isClickable = onRowClick && !loading

            return (
              <tr
                key={rowKey}
                className={`hover:bg-[var(--color-accent)]/50 transition-colors ${isClickable ? 'cursor-pointer' : ''} ${extraClass}`}
                onClick={isClickable ? () => onRowClick(row) : undefined}
                onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row) } } : undefined}
                tabIndex={isClickable ? 0 : undefined}
                role={isClickable ? 'button' : undefined}
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
                      className="rounded border-[var(--color-border)] accent-[#396200] cursor-pointer"
                      aria-label={`Select row ${rowKey}`}
                    />
                  </td>
                )}
                {visibleColumns.map(col => {
                  const alignClass = col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''

                  if (isEditing && col.editable) {
                    return (
                      <td key={col.key} className={`${cellPadding} ${alignClass} ${col.className ?? ''}`}>
                        {col.editable.render(row, (value) => onEditChange?.(row, col.key, value))}
                      </td>
                    )
                  }

                  return (
                    <td key={col.key} className={`${cellPadding} ${alignClass} ${col.className ?? ''}`}>
                      {renderCell(row, col, rowIndex)}
                    </td>
                  )
                })}
              </tr>
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
