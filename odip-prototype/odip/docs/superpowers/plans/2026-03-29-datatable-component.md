# DataTable Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a reusable `DataTable<T>` component and migrate all 16 tables across the Trip Planner frontend to use it, standardizing visual appearance and adding opt-in sorting.

**Architecture:** Generic React component with declarative column config, built-in type renderers (text, date, currency, boolean, badge), opt-in sorting with controlled/uncontrolled modes, editable cell support, and optional footer. CSS variables for theming. Migrated page-by-page in 3 phases.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, CSS variables

**Spec:** `docs/superpowers/specs/2026-03-29-datatable-component-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `frontend/src/lib/utils.ts` | Add `formatCurrency()` utility |
| Create | `frontend/src/components/DataTable.tsx` | DataTable component + exported types |
| — | `frontend/src/index.css` | No changes needed — existing CSS vars (`--color-card`, `--color-accent`, `--color-border`, `--color-muted-foreground`) are used directly. Spec's `--color-table-*` aliases are skipped as they map 1:1. |
| Modify | `frontend/src/pages/ParticipantDetailPage.tsx` | Migrate bookings tab table |
| Modify | `frontend/src/pages/BookingsPage.tsx` | Migrate bookings registry table |
| Modify | `frontend/src/pages/ParticipantsPage.tsx` | Migrate participant roster table |
| Modify | `frontend/src/pages/StaffPage.tsx` | Migrate staff roster table |
| Modify | `frontend/src/pages/TasksPage.tsx` | Migrate task list table |
| Modify | `frontend/src/pages/IncidentsPage.tsx` | Migrate incident reports table |
| Modify | `frontend/src/pages/SettingsPage.tsx` | Migrate 3 tables (activities, catalogue, holidays) |
| Modify | `frontend/src/pages/TripDetailPage.tsx` | Migrate 4 tables (claims, bookings, staff, tasks) |
| Modify | `frontend/src/pages/ClaimDetailPage.tsx` | Migrate line items table (with footer) |
| Modify | `frontend/src/components/GenerateClaimModal.tsx` | Migrate preview summary table |
| Modify | `frontend/src/pages/QualificationsPage.tsx` | Migrate nested editable tables |

---

## Task 1: Add `formatCurrency` utility

**Files:**
- Modify: `frontend/src/lib/utils.ts:27` (append after `getStatusColor`)

- [ ] **Step 1: Add formatCurrency to utils.ts**

Append after the `getStatusColor` function (line ~27):

```typescript
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
}
```

- [ ] **Step 2: Verify the build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/utils.ts
git commit -m "feat: add formatCurrency utility to lib/utils"
```

---

## Task 2: Create the DataTable component

**Files:**
- Create: `frontend/src/components/DataTable.tsx`

This is the core task. The component must match the Dropdown export pattern: named export, co-located types, inline Tailwind.

- [ ] **Step 1: Create DataTable.tsx with types and component**

Create `frontend/src/components/DataTable.tsx` with the following content:

```tsx
import { type ReactNode, useState, useMemo } from 'react'
import { formatDateAu, getStatusColor, formatCurrency } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'

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
  sortFn?: (a: T, b: T) => number
  className?: string
}

export type Column<T> =
  | (ColumnBase<T> & { key: keyof T & string; render?: (row: T, rowIndex: number) => ReactNode })
  | (ColumnBase<T> & { key: string; render: (row: T, rowIndex: number) => ReactNode })

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
      return value ? (
        <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(String(value))}`}>
          {String(value)}
        </span>
      ) : '—'
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
            {visibleColumns.map(col => {
              const isSortable = sortable && col.sortable
              const isSorted = activeSort?.key === col.key
              const alignClass = col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'

              return (
                <th
                  key={col.key}
                  className={`${alignClass} ${cellPadding} text-xs font-medium text-[var(--color-muted-foreground)] whitespace-nowrap ${isSortable ? 'cursor-pointer select-none' : ''}`}
                  aria-sort={isSorted ? (activeSort!.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={isSortable ? () => handleSort(col.key) : undefined}
                  onKeyDown={isSortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(col.key) } } : undefined}
                  tabIndex={isSortable ? 0 : undefined}
                  role={isSortable ? 'button' : undefined}
                >
                  <span className={isSortable ? 'inline-flex items-center gap-1' : ''}>
                    {col.header}
                    {isSortable && (
                      isSorted
                        ? activeSort!.direction === 'asc'
                          ? <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5" />
                        : <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />
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
              <td colSpan={visibleColumns.length} className={`${cellPadding} py-8 text-center text-[var(--color-muted-foreground)]`}>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              </td>
            </tr>
          )}
          {!loading && sortedData.length === 0 && (
            <tr>
              <td colSpan={visibleColumns.length} className={`${cellPadding} py-6 text-center text-[var(--color-muted-foreground)]`} aria-live="polite">
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
                role={isClickable ? 'link' : undefined}
              >
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
```

- [ ] **Step 2: Verify the build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DataTable.tsx
git commit -m "feat: create reusable DataTable component with sorting, editable cells, and footer support"
```

---

## Task 3: Migrate ParticipantDetailPage (simplest table)

**Files:**
- Modify: `frontend/src/pages/ParticipantDetailPage.tsx:78-100`

- [ ] **Step 1: Add DataTable import**

Add to the imports at top of file:

```typescript
import { DataTable, type Column } from '@/components/DataTable'
```

- [ ] **Step 2: Replace the table markup**

Replace the entire table block (lines ~78-100) — the `<div className="bg-[var(--color-card)]...">` containing the `<table>` — with:

```tsx
<DataTable
  data={bookings}
  keyField="id"
  columns={[
    {
      key: 'tripName',
      header: 'Trip',
      render: (b: any) => (
        <Link to={`/trips/${b.tripInstanceId}`} className="font-medium hover:text-[var(--color-primary)]">
          {b.tripName || 'Trip'}
        </Link>
      ),
    },
    { key: 'bookingStatus', header: 'Status', type: 'badge' },
    { key: 'bookingDate', header: 'Date', type: 'date' },
  ]}
  emptyMessage="No bookings"
/>
```

- [ ] **Step 3: Remove unused imports if any**

Check if `getStatusColor` or `formatDateAu` are still used elsewhere in the file. If only used in the table, remove from the import.

- [ ] **Step 4: Verify build and visual check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ParticipantDetailPage.tsx
git commit -m "refactor: migrate ParticipantDetailPage bookings table to DataTable"
```

---

## Task 4: Migrate BookingsPage

**Files:**
- Modify: `frontend/src/pages/BookingsPage.tsx:20-47`

- [ ] **Step 1: Add DataTable import**

```typescript
import { DataTable } from '@/components/DataTable'
```

- [ ] **Step 2: Replace the table markup**

Replace the `<div className="bg-[var(--color-card)]...">` table block with:

```tsx
<DataTable
  data={bookings}
  keyField="id"
  sortable
  columns={[
    {
      key: 'participantName',
      header: 'Participant',
      sortable: true,
      render: (b: any) => (
        <Link to={`/participants/${b.participantId}`} className="font-medium hover:text-[var(--color-primary)]">
          {b.participantName || '—'}
        </Link>
      ),
    },
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      render: (b: any) => (
        <Link to={`/trips/${b.tripInstanceId}`} className="hover:text-[var(--color-primary)]">
          {b.tripName || '—'}
        </Link>
      ),
    },
    { key: 'bookingStatus', header: 'Status', type: 'badge', sortable: true },
    { key: 'bookingDate', header: 'Booking Date', type: 'date', sortable: true },
    {
      key: 'wheelchairRequired',
      header: (<span className="material-symbols-outlined text-base leading-none">accessible</span>),
      type: 'boolean',
      align: 'center' as const,
    },
    { key: 'highSupportRequired', header: 'High', type: 'boolean', align: 'center' as const },
    { key: 'nightSupportRequired', header: 'Night', type: 'boolean', align: 'center' as const },
  ]}
/>
```

- [ ] **Step 3: Clean up unused imports**

Remove `getStatusColor` and `formatDateAu` from the import if no longer used directly.

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/BookingsPage.tsx
git commit -m "refactor: migrate BookingsPage table to DataTable with sorting"
```

---

## Task 5: Migrate ParticipantsPage

**Files:**
- Modify: `frontend/src/pages/ParticipantsPage.tsx`

- [ ] **Step 1: Read the current file to understand exact table structure**

Read `frontend/src/pages/ParticipantsPage.tsx` fully. Note the exact table JSX, column headers, row rendering, and any special features (clickable rows, search, archive buttons).

- [ ] **Step 2: Add DataTable import**

```typescript
import { DataTable } from '@/components/DataTable'
```

- [ ] **Step 3: Replace the table with DataTable**

Define columns array and replace the table. Key features to preserve:
- `onRowClick` for navigation to participant detail
- Status badges via `type: 'badge'`
- Boolean checkmarks for wheelchair, high support, repeat via `type: 'boolean'`
- Action buttons via `render` function (with `e.stopPropagation()` to prevent row click)
- Archive/Restore buttons conditionally shown

Enable `sortable` on name, NDIS number, region, and status columns.

- [ ] **Step 4: Clean up unused imports**

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ParticipantsPage.tsx
git commit -m "refactor: migrate ParticipantsPage table to DataTable with sorting"
```

---

## Task 6: Migrate StaffPage

**Files:**
- Modify: `frontend/src/pages/StaffPage.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/StaffPage.tsx` fully.

- [ ] **Step 2: Add DataTable import and replace table**

Preserve:
- Boolean checkmarks for Driver, First Aid, Meds, Manual, Overnight via `type: 'boolean'`
- Status badges (Active/Inactive)
- Edit & Archive/Restore action buttons
- Active/Archived tab toggle (this stays outside the table)

Enable `sortable` on name, role, region, status.

- [ ] **Step 3: Clean up, verify build, commit**

```bash
git add frontend/src/pages/StaffPage.tsx
git commit -m "refactor: migrate StaffPage table to DataTable with sorting"
```

---

## Task 7: Migrate TasksPage

**Files:**
- Modify: `frontend/src/pages/TasksPage.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/TasksPage.tsx` fully.

- [ ] **Step 2: Add DataTable import and replace table**

Preserve:
- Conditional checkbox column (only in active view, not archived)
- Priority badges (High/Urgent get `badge-overdue`, others get `badge-info`)
- Status badges via `getStatusColor()`
- Mark complete, Edit, Archive/Restore action buttons
- Status filter dropdown and Active/Archived toggle (stay outside the table)

Use `hidden` column property to conditionally show/hide the checkbox column based on view mode.

Enable `sortable` on task name, trip, type, owner, due date, priority, status.

- [ ] **Step 3: Clean up, verify build, commit**

```bash
git add frontend/src/pages/TasksPage.tsx
git commit -m "refactor: migrate TasksPage table to DataTable with sorting"
```

---

## Task 8: Migrate IncidentsPage

**Files:**
- Modify: `frontend/src/pages/IncidentsPage.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/IncidentsPage.tsx` fully.

- [ ] **Step 2: Add DataTable import and replace table**

Preserve:
- Severity badges with custom color mapping
- Status badges
- QSC status column
- Edit, Archive/Restore action buttons
- Status and severity filter dropdowns (stay outside the table)

Enable `sortable` on title, trip, type, severity, status, date.

- [ ] **Step 3: Clean up, verify build, commit**

```bash
git add frontend/src/pages/IncidentsPage.tsx
git commit -m "refactor: migrate IncidentsPage table to DataTable with sorting"
```

---

## Task 9: Migrate SettingsPage — Activities table

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx:139-166`

- [ ] **Step 1: Read the current SettingsPage.tsx**

Read the full file. Note that it has 3 separate tables in different tab sections.

- [ ] **Step 2: Add DataTable import**

```typescript
import { DataTable } from '@/components/DataTable'
```

- [ ] **Step 3: Replace Activities table (lines ~139-166)**

```tsx
<DataTable
  data={activities}
  keyField="id"
  sortable
  columns={[
    { key: 'activityName', header: 'Activity', sortable: true, className: 'font-medium' },
    { key: 'category', header: 'Category', sortable: true },
    { key: 'location', header: 'Location', render: (a: any) => a.location || '—' },
    {
      key: 'isActive',
      header: 'Status',
      render: (a: any) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${a.isActive ? 'badge-confirmed' : 'badge-cancelled'}`}>
          {a.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
      sortable: true,
    },
  ]}
/>
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "refactor: migrate SettingsPage activities table to DataTable"
```

---

## Task 10: Migrate SettingsPage — Catalogue table

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx:334-369`

- [ ] **Step 1: Replace catalogue table**

This is a 14-column table with state price limits. Replace with DataTable. Use `render` for the price columns (since they use inline `$` formatting), and `render` for the dayType badge.

```tsx
<DataTable
  data={allItems}
  keyField="id"
  sortable
  columns={[
    { key: 'itemNumber', header: 'Item Number', sortable: true, className: 'font-mono text-xs' },
    { key: 'description', header: 'Description', sortable: true },
    {
      key: 'dayType',
      header: 'Day Type',
      sortable: true,
      render: (item: any) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${dayTypeColor(item.dayType)}`}>{item.dayType}</span>
      ),
    },
    ...['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map(state => ({
      key: `priceLimit_${state}`,
      header: state,
      align: 'right' as const,
      type: 'currency' as const,
      sortable: true,
    })),
    { key: 'priceLimit_Remote', header: 'Remote', align: 'right' as const, type: 'currency' as const },
    { key: 'priceLimit_VeryRemote', header: 'V.Remote', align: 'right' as const, type: 'currency' as const },
    { key: 'effectiveFrom', header: 'Effective From', type: 'date' as const, sortable: true },
  ]}
  emptyMessage="No catalogue items. Import the NDIS Support Catalogue XLSX."
/>
```

- [ ] **Step 2: Verify build, commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "refactor: migrate SettingsPage catalogue table to DataTable"
```

---

## Task 11: Migrate SettingsPage — Public Holidays table

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx:493-539`

- [ ] **Step 1: Replace holidays table**

This table has a special inline-add row at the top when `adding` is true. The DataTable doesn't natively support inline-add rows, so keep the add row as a separate element above the DataTable, or use a custom approach:

**Option:** Keep the `adding` row outside the DataTable as a standalone form row above it, then use DataTable for the data rows:

```tsx
{adding && (
  <div className="bg-[var(--color-card)] rounded-t-2xl border border-b-0 border-[var(--color-border)] p-3 flex gap-3 items-center">
    <input type="date" value={newForm.date} onChange={...} className={inputClass} />
    <input value={newForm.name} onChange={...} placeholder="Holiday name" className={inputClass} />
    <Dropdown variant="form" value={newForm.state} onChange={...} items={...} label="Select state" />
    <div className="flex gap-2">
      <button onClick={handleAdd} ...>Save</button>
      <button onClick={() => setAdding(false)} ...>Cancel</button>
    </div>
  </div>
)}
<DataTable
  data={holidays as any[]}
  keyField="id"
  className={adding ? 'bg-[var(--color-card)] rounded-b-2xl border border-t-0 border-[var(--color-border)] overflow-x-auto' : undefined}
  sortable
  columns={[
    { key: 'date', header: 'Date', sortable: true, className: 'font-medium' },
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'state',
      header: 'State',
      render: (h: any) => (
        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-muted-foreground)]">
          {h.state || 'All'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (h: any) => (
        <button onClick={() => deleteHoliday.mutate(h.id)} className="text-xs text-red-500 hover:text-red-700 hover:underline">
          Delete
        </button>
      ),
    },
  ]}
  emptyMessage={`No holidays found for ${year} in ${state}.`}
/>
```

**Note:** If the `adding` state is rarely true, the simpler approach is to put the add form row inside the DataTable via the `footer` prop rendered as a top row — but this changes the visual position. The recommended approach is to keep the add form separate above the table.

- [ ] **Step 2: Verify build, commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "refactor: migrate SettingsPage holidays table to DataTable"
```

---

## Task 12: Migrate TripDetailPage — Tasks tab (simplest of the 4)

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx:2351-2375`

- [ ] **Step 1: Read the TripDetailPage.tsx**

This is a large file (~164KB). Read the tasks table section around lines 2351-2375. Also check existing imports.

- [ ] **Step 2: Add DataTable import at top of file**

```typescript
import { DataTable } from '@/components/DataTable'
```

- [ ] **Step 3: Replace tasks table**

```tsx
<DataTable
  data={tasks}
  keyField="id"
  sortable
  columns={[
    { key: 'title', header: 'Task', sortable: true, className: 'font-medium' },
    { key: 'taskType', header: 'Type', sortable: true },
    {
      key: 'ownerName',
      header: 'Owner',
      sortable: true,
      render: (t: any) => t.ownerName || 'Unassigned',
    },
    { key: 'dueDate', header: 'Due', type: 'date', sortable: true },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (t: any) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          t.priority === 'High' || t.priority === 'Urgent' ? 'badge-overdue' : 'badge-info'
        }`}>{t.priority}</span>
      ),
    },
    { key: 'status', header: 'Status', type: 'badge', sortable: true },
  ]}
/>
```

- [ ] **Step 4: Verify build, commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "refactor: migrate TripDetailPage tasks tab table to DataTable"
```

---

## Task 13: Migrate TripDetailPage — Claims tab

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx:70-106` (ClaimsTabContent)

- [ ] **Step 1: Replace claims table**

Preserve the Dropdown component for status updates and the conditional delete button. The status column uses an inline Dropdown, so use `render` for it.

```tsx
<DataTable
  data={claims}
  keyField="id"
  sortable
  columns={[
    { key: 'claimReference', header: 'Reference', sortable: true, className: 'font-mono text-xs' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (c: any) => (
        <Dropdown
          variant="pill"
          value={c.status}
          onChange={(val) => updateClaim.mutate({ id: c.id, status: val })}
          colorClass={CLAIM_STATUS_COLORS[c.status] || ''}
          items={['Draft','Submitted','Paid','Rejected','PartiallyPaid'].map(s => ({ value: s, label: s }))}
        />
      ),
    },
    { key: 'totalAmount', header: 'Total Amount', type: 'currency', sortable: true, align: 'right' },
    { key: 'createdAt', header: 'Created', type: 'date', sortable: true },
    { key: 'submittedAt', header: 'Submitted', type: 'date', sortable: true },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c: any) => (
        <div className="flex items-center justify-end gap-2">
          <Link to={`/claims/${c.id}`} className="text-xs text-[var(--color-primary)] hover:underline">View</Link>
          {c.status !== 'Submitted' && c.status !== 'Paid' && (
            <button onClick={() => deleteClaim.mutate(c.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
          )}
        </div>
      ),
    },
  ]}
  emptyMessage="No claims yet. Generate one from the bookings."
/>
```

- [ ] **Step 2: Verify build, commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "refactor: migrate TripDetailPage claims tab table to DataTable"
```

---

## Task 14: Migrate TripDetailPage — Staff tab

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx:2067-2105`

- [ ] **Step 1: Replace staff table**

Preserve conflict indicator (AlertTriangle), edit/delete buttons, sleepover type display.

```tsx
<DataTable
  data={staff}
  keyField="id"
  sortable
  columns={[
    { key: 'staffName', header: 'Staff', sortable: true, className: 'font-medium' },
    { key: 'assignmentRole', header: 'Role', sortable: true, render: (s: any) => s.assignmentRole || '—' },
    {
      key: 'assignmentStart',
      header: 'Dates',
      sortable: true,
      render: (s: any) => `${formatDateAu(s.assignmentStart)} — ${formatDateAu(s.assignmentEnd)}`,
    },
    { key: 'status', header: 'Status', type: 'badge', sortable: true },
    { key: 'isDriver', header: 'Driver', type: 'boolean', align: 'center' },
    {
      key: 'sleepoverType',
      header: 'Sleepover',
      align: 'center',
      render: (s: any) => s.sleepoverType !== 'None' ? <span className="text-xs">{s.sleepoverType}</span> : null,
    },
    {
      key: 'actions',
      header: '',
      align: 'center',
      render: (s: any) => (
        <div className="flex items-center justify-center gap-2">
          {s.hasConflict && <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />}
          <button onClick={() => openEditStaffModal(s)} className="...">Edit</button>
          <button onClick={() => setDeletingStaff(s)} className="...">Delete</button>
        </div>
      ),
    },
  ]}
  emptyMessage="No staff assigned yet"
/>
```

- [ ] **Step 2: Verify build, commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "refactor: migrate TripDetailPage staff tab table to DataTable"
```

---

## Task 15: Migrate TripDetailPage — Bookings tab

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx:1106-1192`

- [ ] **Step 1: Replace bookings table**

This is the most complex table with 10 columns and 3 inline Dropdown components. Preserve all mutation handlers (`patchBooking.mutate`, action buttons, alert indicator).

Define a `bookingColumns` array before the JSX return with all 10 column definitions. Each Dropdown and action button uses `render`. Enable `sortable` on participant name, status, date, ratio.

- [ ] **Step 2: Verify build, commit**

```bash
git add frontend/src/pages/TripDetailPage.tsx
git commit -m "refactor: migrate TripDetailPage bookings tab table to DataTable"
```

---

## Task 16: Migrate ClaimDetailPage (with footer)

**Files:**
- Modify: `frontend/src/pages/ClaimDetailPage.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/pages/ClaimDetailPage.tsx` fully to understand the line items table structure, footer totals, and all the special features (plan type badges, No Show toggles, invoice download).

- [ ] **Step 2: Add DataTable import and replace table**

Define columns for: Participant (with NDIS number + plan type badge), Support Item, Day Type, Dates, Hours, Unit Price, Total, Status, Actions.

Use the `footer` prop for the totals row:

```tsx
<DataTable
  data={lineItems}
  keyField="id"
  sortable
  columns={claimLineColumns}
  footer={
    <tr>
      <td colSpan={6} className="p-3 text-right font-semibold text-[var(--color-foreground)]">Total</td>
      <td className="p-3 font-bold text-[var(--color-foreground)]">{formatCurrency(totalAmount)}</td>
      <td colSpan={2} />
    </tr>
  }
/>
```

- [ ] **Step 3: Verify build, commit**

```bash
git add frontend/src/pages/ClaimDetailPage.tsx
git commit -m "refactor: migrate ClaimDetailPage line items table to DataTable with footer"
```

---

## Task 17: Migrate GenerateClaimModal

**Files:**
- Modify: `frontend/src/components/GenerateClaimModal.tsx:194-224`

- [ ] **Step 1: Add DataTable import and replace table**

Simple 5-column read-only table. Replace with:

```tsx
<DataTable
  data={previewData.lineItems ?? []}
  keyField="id"
  columns={[
    { key: 'participantName', header: 'Participant' },
    {
      key: 'dayType',
      header: 'Day Type',
      render: (item: any) => item.dayTypeLabel || dayTypeLabel(item.dayType),
    },
    {
      key: 'supportsDeliveredFrom',
      header: 'Dates',
      render: (item: any) => {
        const from = item.supportsDeliveredFrom ? new Date(item.supportsDeliveredFrom).toLocaleDateString('en-AU') : '—'
        const to = item.supportsDeliveredTo && item.supportsDeliveredTo !== item.supportsDeliveredFrom
          ? ` – ${new Date(item.supportsDeliveredTo).toLocaleDateString('en-AU')}`
          : ''
        return from + to
      },
    },
    { key: 'hours', header: 'Hours' },
    { key: 'totalAmount', header: 'Amount', type: 'currency', className: 'font-medium' },
  ]}
/>
```

- [ ] **Step 2: Verify build, commit**

```bash
git add frontend/src/components/GenerateClaimModal.tsx
git commit -m "refactor: migrate GenerateClaimModal summary table to DataTable"
```

---

## Task 18: Migrate QualificationsPage (editable cells, nested)

**Files:**
- Modify: `frontend/src/pages/QualificationsPage.tsx`

- [ ] **Step 1: Read the current file thoroughly**

Read `frontend/src/pages/QualificationsPage.tsx` fully. Understand:
- The accordion structure (one per staff member)
- The inner table per accordion (Qualification, Expiry Date, Status, Actions)
- Inline date editing with save/cancel
- Color-coded row backgrounds
- Issue count badges on accordion headers

- [ ] **Step 2: Add DataTable import**

```typescript
import { DataTable } from '@/components/DataTable'
```

- [ ] **Step 3: Replace each inner table within the accordion**

The accordion structure stays — only the `<table>` inside each accordion section gets replaced with DataTable. Use:
- `editingRow` prop to track which qualification is being edited
- `editable.render` on the expiry date column for the date input
- `rowClassName` for conditional row backgrounds (expired = `bg-[#ffdad6]/10`, expiring = `bg-[#fef3c7]/10`)
- `render` on status column for the various status indicators
- `render` on actions column for Edit/Save/Cancel buttons

```tsx
<DataTable
  data={staffQualifications}
  keyField="qualificationKey"
  editingRow={editingKey}
  compact
  rowClassName={(q) =>
    q.isExpired ? 'bg-[#ffdad6]/10' :
    q.isExpiring ? 'bg-[#fef3c7]/10' : ''
  }
  columns={[
    { key: 'qualificationName', header: 'Qualification' },
    {
      key: 'expiryDate',
      header: 'Expiry Date',
      type: 'date',
      editable: {
        render: (q, onChange) => (
          <input
            type="date"
            value={q.expiryDate ?? ''}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        ),
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (q) => {
        // existing status rendering logic (EXPIRED, No date set, Current, X days remaining)
      },
    },
    {
      key: 'actions',
      header: '',
      render: (q) => {
        // existing Edit/Save/Cancel button logic
      },
    },
  ]}
/>
```

- [ ] **Step 4: Verify build and visual check**

Run: `cd frontend && npx tsc --noEmit`
Visually verify the accordion still works and inline editing functions correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QualificationsPage.tsx
git commit -m "refactor: migrate QualificationsPage nested tables to DataTable with editable cells"
```

---

## Task 19: Final verification and cleanup

- [ ] **Step 1: Full build check**

Run: `cd frontend && npm run build && npm run lint`
Expected: No errors, no warnings related to table markup

- [ ] **Step 2: Search for any remaining raw tables**

Search for `<table` and `<thead` in the `frontend/src/` directory to confirm no tables were missed (except SchedulePage which is excluded).

- [ ] **Step 3: Verify no unused imports**

Check that old imports (`getStatusColor`, `formatDateAu`) are removed from files where they were only used for table rendering and are now handled by DataTable internally.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore: final cleanup after DataTable migration"
```
