# DataTable Component Design

**Date:** 2026-03-29
**Status:** Approved

## Problem

The Trip Planner frontend has 16+ inline HTML tables spread across 10+ pages. They share no common component, leading to:

- **Visual inconsistency** — two style families: CSS-variable pages vs hardcoded-hex TripDetailPage tables
- **Duplicated markup** — container, header, body, empty-state, hover logic repeated per table
- **No sorting** — none of the tables support column sorting
- **No editable cells** — QualificationsPage implements inline editing ad-hoc
- **Maintenance cost** — styling or behavior changes require touching every page

## Solution

A single generic `DataTable<T>` component at `frontend/src/components/DataTable.tsx` with:

- Declarative column config (array of column objects)
- Opt-in sorting, editable cells, footer, clickable rows
- Unified styling via CSS variables matching the warm TripDetailPage palette
- Same export/pattern conventions as the existing `Dropdown` component

## Scope

### In scope (16 tables)

| # | Page | Key Features |
|---|------|-------------|
| 1 | ParticipantsPage | Clickable rows, search, status badges |
| 2 | StaffPage | Qualification checkmarks, action buttons |
| 3 | TasksPage | Checkbox column, priority/status badges |
| 4 | BookingsPage | Read-only, status badges, links |
| 5 | IncidentsPage | Severity/status badges, actions |
| 6 | QualificationsPage | Nested accordion, editable cells, row coloring |
| 7 | ParticipantDetailPage | Simple 3-column booking history |
| 8 | TripDetailPage — Claims | Dropdown in cells, conditional actions |
| 9 | TripDetailPage — Bookings | 10 columns, 3 inline dropdowns, actions |
| 10 | TripDetailPage — Staff | Conflict indicators, edit/delete actions |
| 11 | TripDetailPage — Tasks | Read-only with priority/status badges |
| 12 | ClaimDetailPage | Footer totals, plan type badges, toggles |
| 13 | SettingsPage — Activities | Activity type management table |
| 14 | SettingsPage — Catalogue | Catalogue items table |
| 15 | SettingsPage — Public Holidays | Holiday dates table |
| 16 | GenerateClaimModal | Line items summary before generation |

### Out of scope

- **SchedulePage** — uses a calendar/grid view, not a standard data table
- **Card grids** — TripsPage, VehiclesPage, AccommodationPage, DashboardPage use card layouts
- **Pagination** — not needed with current data volumes; can be added later
- **Responsive column hiding** — `overflow-x-auto` is the V1 baseline; breakpoint-aware column visibility can be added later

## API Design

### Types

```typescript
export type ColumnType = 'text' | 'date' | 'currency' | 'boolean' | 'badge' | 'custom'

// Shared column properties
type ColumnBase<T> = {
  header: string | ReactNode
  type?: ColumnType                // default: 'text'
  sortable?: boolean               // opt-in per column
  align?: 'left' | 'center' | 'right'  // default: 'left'
  hidden?: boolean                 // conditionally hide
  editable?: {
    render: (row: T, onChange: (value: unknown) => void) => ReactNode
  }
  sortFn?: (a: T, b: T) => number // custom sort comparator
  className?: string               // extra cell classes
}

// Discriminated union: render is optional when key is a real field,
// required when key is a virtual field (e.g. 'actions')
export type Column<T> =
  | (ColumnBase<T> & {
      key: keyof T & string          // real data field
      render?: (row: T, rowIndex: number) => ReactNode
    })
  | (ColumnBase<T> & {
      key: string                    // virtual field (not on T)
      render: (row: T, rowIndex: number) => ReactNode  // required
    })

export type SortState = {
  key: string
  direction: 'asc' | 'desc'
}

export type DataTableProps<T> = {
  data: T[]
  columns: Column<T>[]
  keyField: keyof T & string

  // Sorting
  sortable?: boolean
  defaultSort?: SortState
  sort?: SortState                 // controlled sort
  onSortChange?: (sort: SortState | null) => void  // null = cleared

  // Rows
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  emptyMessage?: string            // default: 'No data'

  // Footer
  footer?: ReactNode

  // Loading
  loading?: boolean

  // Editable — compared against String(row[keyField])
  editingRow?: string | number | null
  onEditChange?: (row: T, key: string, value: unknown) => void

  // Styling
  className?: string               // wrapper override
  compact?: boolean                // tighter padding
}
```

**`editingRow` semantics:** The value is compared against `String(row[keyField])`. This supports composite keys (e.g. `${staffId}-${qualField}` in QualificationsPage) as long as the `keyField` property on the data object contains the composite string.

**`Column<T>.key` semantics:** When `key` is a property of `T`, built-in type rendering works automatically. When `key` is not a property of `T` (virtual columns like `'actions'`), a `render` function is required — TypeScript enforces this at compile time via the discriminated union. If `sortable: true` is set on a virtual column without a `sortFn`, sorting is a no-op.

### Usage Examples

**Simple read-only table:**
```tsx
<DataTable
  data={bookings}
  keyField="id"
  columns={[
    { key: 'participantName', header: 'Participant', sortable: true },
    { key: 'tripName', header: 'Trip' },
    { key: 'status', header: 'Status', type: 'badge' },
    { key: 'bookingDate', header: 'Date', type: 'date', sortable: true },
    { key: 'wheelchairRequired', header: 'Accessible', type: 'boolean', align: 'center' },
  ]}
  sortable
  emptyMessage="No bookings yet"
/>
```

**Table with custom renders, actions, and clickable rows:**
```tsx
<DataTable
  data={participants}
  keyField="id"
  onRowClick={(p) => navigate(`/participants/${p.id}`)}
  columns={[
    { key: 'fullName', header: 'Name', sortable: true },
    { key: 'ndisNumber', header: 'NDIS Number' },
    { key: 'status', header: 'Status', render: (p) => (
      <span className={getStatusColor(p.status)}>{p.status}</span>
    )},
    { key: 'actions', header: '', render: (p) => (
      <button onClick={(e) => { e.stopPropagation(); archive(p.id) }}>
        Archive
      </button>
    )},
  ]}
  sortable
/>
```

**Editable table (QualificationsPage pattern):**
```tsx
<DataTable
  data={qualifications}
  keyField="id"
  editingRow={editingId}
  rowClassName={(q) =>
    q.isExpired ? 'bg-[#ffdad6]/10' :
    q.isExpiring ? 'bg-[#fef3c7]/10' : ''
  }
  columns={[
    { key: 'name', header: 'Qualification' },
    {
      key: 'expiryDate',
      header: 'Expiry Date',
      type: 'date',
      editable: {
        render: (q, onChange) => (
          <input type="date" value={q.expiryDate} onChange={e => onChange(e.target.value)} />
        )
      }
    },
    { key: 'status', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
    { key: 'actions', header: '', render: (q) => <EditSaveCancel row={q} /> },
  ]}
/>
```

**Table with footer (ClaimDetailPage pattern):**
```tsx
<DataTable
  data={lineItems}
  keyField="id"
  columns={claimColumns}
  footer={
    <tr>
      <td colSpan={6} className="p-3 text-right font-semibold">Total</td>
      <td className="p-3 font-bold">{formatCurrency(total)}</td>
      <td colSpan={2} />
    </tr>
  }
/>
```

## Prerequisites

**`formatCurrency` utility** — must be added to `frontend/src/lib/utils.ts` in Phase 1:

```typescript
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
}
```

## Built-in Column Type Behaviors

| Type | Rendering | Default Sort |
|------|-----------|-------------|
| `text` | Raw value, `toString()` | Alphabetical (locale-aware) |
| `date` | `formatDateAu()` from `@/lib/utils` | Chronological |
| `currency` | `formatCurrency()` from `@/lib/utils` | Numeric |
| `boolean` | Checkmark icon when truthy, empty when falsy | Boolean (true first) |
| `badge` | `<span>` with `getStatusColor()` | Alphabetical |
| `custom` | Must provide `render` function | No default (use `sortFn`) |

When a column has a `render` function, the built-in type rendering is bypassed entirely. The `type` is still used for default sorting if `sortable: true` and no `sortFn` is provided.

## Sorting Behavior

- **Sort indicator:** Arrow icons in header cells for sortable columns (up/down/neutral)
- **Click cycle:** neutral -> asc -> desc -> neutral
- **Clearing sort:** when cycling back to neutral, `onSortChange` receives `null`
- **Uncontrolled by default:** internal `useState` manages sort state
- **Controlled mode:** when `sort` and `onSortChange` are provided, the component defers to the consumer
- **Stable sort:** equal elements preserve their original order
- **Virtual columns:** if `sortable: true` on a column where `key` is not a property of `T` and no `sortFn` is provided, sorting is a no-op

## Accessibility

The component uses semantic HTML `<table>` elements which carry implicit ARIA roles. Additional accessibility features:

- **Sortable headers:** rendered as `<button>` elements inside `<th>`, keyboard-activatable via Enter/Space
- **`aria-sort`:** set on sortable `<th>` elements — `ascending`, `descending`, or `none`
- **Clickable rows:** when `onRowClick` is provided, rows receive `tabindex="0"`, `role="link"`, and `onKeyDown` handling for Enter/Space activation
- **Focus management:** visible focus ring on interactive elements (headers, rows, editable cells)
- **Screen reader:** empty state announced via `aria-live="polite"` region

## Styling

### CSS Variables (add to theme)

```css
--color-table-bg: var(--color-card);
--color-table-header: var(--color-accent);
--color-table-border: var(--color-border);
--color-table-hover: color-mix(in srgb, var(--color-accent) 50%, transparent);
--color-table-text: var(--color-foreground);
--color-table-text-muted: var(--color-muted-foreground);
```

### Structure

```html
<div class="bg-[var(--color-table-bg)] rounded-2xl border border-[var(--color-table-border)] overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-[var(--color-table-header)]">
      <tr>
        <th class="text-left p-3 text-xs font-medium text-[var(--color-table-text-muted)]">...</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-[var(--color-table-border)]">
      <tr class="hover:bg-[var(--color-table-hover)] transition-colors cursor-pointer?">
        <td class="p-3">...</td>
      </tr>
    </tbody>
    <tfoot><!-- optional footer --></tfoot>
  </table>
</div>
```

### Loading State

- When `loading: true` and data exists: semi-transparent overlay with spinner on top of existing rows (preserves layout)
- When `loading: true` and data is empty: spinner replaces the empty message
- Loading disables `onRowClick` and editable cell interactions while active

### Empty State

Centered message spanning all columns: `<td colSpan={columns.length}>No data</td>` with `aria-live="polite"`

## Migration Strategy

Migrate tables in order of complexity (simple first) to validate the component API before tackling complex cases:

1. **Phase 1 — Component creation + simple tables**
   - Add `formatCurrency` to `@/lib/utils`
   - Create `DataTable.tsx`
   - Add CSS variables to theme
   - Migrate: ParticipantDetailPage, BookingsPage

2. **Phase 2 — Medium complexity**
   - Migrate: ParticipantsPage, StaffPage, TasksPage, IncidentsPage
   - Migrate: TripDetailPage Tasks tab
   - Migrate: SettingsPage tables (Activities, Catalogue, Public Holidays)

3. **Phase 3 — Complex tables**
   - Migrate: TripDetailPage Claims, Bookings, Staff tabs
   - Migrate: ClaimDetailPage (footer)
   - Migrate: GenerateClaimModal (summary table)
   - Migrate: QualificationsPage (editable cells, row coloring, nested)

Each migration should be a self-contained change that doesn't alter behavior — only the underlying markup changes. Visual output should be identical.

## File Structure

```
frontend/src/components/
  DataTable.tsx    # Component + types (exported)
  Dropdown.tsx     # Existing — pattern reference
```

No separate types file — types are co-located and exported from the component file, matching the Dropdown pattern.
