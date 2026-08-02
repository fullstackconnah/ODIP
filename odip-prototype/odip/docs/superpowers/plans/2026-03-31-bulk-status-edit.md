# Bulk Status Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add row selection and column-header bulk status triggers to `DataTable`, wired up in `TripDetailPage` for claims and bookings.

**Architecture:** `DataTable` gets opt-in `selectable` prop and `bulkEditable` extension on the `Column` type. When rows are selected, status column headers show a Dropdown bulk trigger labelled "N rows ▾". Selecting a value fires `Promise.all` mutations via the existing TanStack Query hooks. `TripDetailPage` owns the `selectedRows` state.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, Tailwind CSS v4, Vite

---

## File map

| File | Change |
|------|--------|
| `frontend/src/components/DataTable.tsx` | Add types, checkbox column, bulk trigger in headers |
| `frontend/src/pages/TripDetailPage.tsx` | Add selection state + `bulkEditable` columns for claims and bookings tables |

---

### Task 1: Extend DataTable types and imports

**Files:**
- Modify: `frontend/src/components/DataTable.tsx`

- [ ] **Step 1: Add imports**

Replace the top three import lines (lines 1–3):

```typescript
import { type ReactNode, useState, useMemo, useRef, useEffect } from 'react'
import { formatDateAu, getStatusColor, formatCurrency } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
```

- [ ] **Step 2: Add `bulkEditable` to `ColumnBase<T>`**

Inside `ColumnBase<T>` (after the `className?: string` line, before the closing `}`), add:

```typescript
  bulkEditable?: {
    items: DropdownItem[]
    onBulkChange: (selectedIds: string[], value: string) => void
  }
```

The full `ColumnBase<T>` should now read:

```typescript
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
```

- [ ] **Step 3: Add selection props to `DataTableProps<T>`**

After `compact?: boolean` and before the closing `}` of `DataTableProps<T>`, add:

```typescript
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
```

The end of `DataTableProps<T>` should read:

```typescript
  className?: string
  compact?: boolean
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
}
```

- [ ] **Step 4: Add new props to the component destructuring**

In the `export function DataTable<T>({` signature, add three props after `compact = false,`:

```typescript
  compact = false,
  selectable = false,
  selectedRows,
  onSelectionChange,
}: DataTableProps<T>) {
```

- [ ] **Step 5: Build to verify types compile**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors (build may emit warnings from pre-existing issues — only new errors matter).

- [ ] **Step 6: Commit**

```bash
cd "F:/Projects/personal/Trip Planner" && git add frontend/src/components/DataTable.tsx && git commit -m "feat(datatable): add selectable and bulkEditable type extensions"
```

---

### Task 2: Add checkbox column rendering

**Files:**
- Modify: `frontend/src/components/DataTable.tsx`

- [ ] **Step 1: Add the select-all ref and indeterminate effect**

After the existing `const [internalSort, ...]` and before `const visibleColumns`, add:

```typescript
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selectAllRef.current || !selectable || !sortedData.length) return
    const selectedCount = sortedData.filter(row =>
      selectedRows?.has(String((row as any)[keyField]))
    ).length
    selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < sortedData.length
  }, [selectedRows, sortedData, keyField, selectable])
```

Note: `sortedData` is defined later in the file. Move this `useEffect` to **after** the `sortedData` `useMemo`. Place it just before the `function handleSort` definition.

- [ ] **Step 2: Add checkbox `<th>` as first cell in `<thead>`**

Inside `<thead><tr>`, before the `{visibleColumns.map(col => {` block, add:

```tsx
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
```

- [ ] **Step 3: Add checkbox `<td>` as first cell in each `<tbody>` row**

Inside the `{sortedData.map((row, rowIndex) => {` block, just before the existing `{visibleColumns.map(col => {` map, add:

```tsx
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
```

- [ ] **Step 4: Update `colSpan` in the loading and empty-state rows**

There are two `<td colSpan={visibleColumns.length}` usages (loading spinner row and empty-message row). Change both to:

```tsx
<td colSpan={visibleColumns.length + (selectable ? 1 : 0)}
```

- [ ] **Step 5: Build to verify**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run build 2>&1 | tail -20
```

Expected: no new TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd "F:/Projects/personal/Trip Planner" && git add frontend/src/components/DataTable.tsx && git commit -m "feat(datatable): add checkbox column with select-all support"
```

---

### Task 3: Add bulk trigger Dropdown to column headers

**Files:**
- Modify: `frontend/src/components/DataTable.tsx`

- [ ] **Step 1: Replace the `<th>` inner content to include the bulk trigger**

Find the `<span>` inside the `<th>` render. The current code is:

```tsx
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
```

Replace it with:

```tsx
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
```

- [ ] **Step 2: Build to verify**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run build 2>&1 | tail -20
```

Expected: no new TypeScript errors.

- [ ] **Step 3: Lint**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run lint 2>&1 | tail -20
```

Expected: no new lint errors.

- [ ] **Step 4: Commit**

```bash
cd "F:/Projects/personal/Trip Planner" && git add frontend/src/components/DataTable.tsx && git commit -m "feat(datatable): add bulk status trigger in column headers"
```

---

### Task 4: Wire ClaimsTabContent in TripDetailPage

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx` — `ClaimsTabContent` function only (lines 32–122)

- [ ] **Step 1: Add selection state and bulk update function**

Inside `ClaimsTabContent`, after the existing `const [error, setError] = useState...` line, add:

```typescript
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  async function bulkUpdateClaimStatus(ids: string[], status: string) {
    setBulkLoading(true)
    try {
      await Promise.all(
        ids.map(
          id =>
            new Promise<void>((resolve, reject) => {
              updateClaim.mutate(
                { claimId: id, data: { status: status as TripClaimStatus } },
                { onSuccess: () => resolve(), onError: err => reject(err) }
              )
            })
        )
      )
      setSelectedClaimIds(new Set())
    } catch (err: any) {
      setError(
        err?.response?.data?.errors?.[0] ??
        err?.response?.data?.message ??
        'Failed to update claims.'
      )
    } finally {
      setBulkLoading(false)
    }
  }
```

- [ ] **Step 2: Add `bulkEditable` to the status column and wire the DataTable**

Find the `<DataTable` for claims (around line 70). Change it to:

```tsx
        <DataTable
          data={claims}
          keyField="id"
          sortable
          loading={bulkLoading}
          selectable
          selectedRows={selectedClaimIds}
          onSelectionChange={setSelectedClaimIds}
          emptyMessage="No claims yet"
          columns={[
            { key: 'claimReference', header: 'Reference', sortable: true, className: 'font-medium font-mono text-sm' },
            {
              key: 'status',
              header: 'Status',
              sortable: true,
              bulkEditable: {
                items: CLAIM_STATUS_ITEMS,
                onBulkChange: (ids, value) => bulkUpdateClaimStatus(ids, value),
              },
              render: (c: any) => (
                <Dropdown
                  variant="pill"
                  value={c.status}
                  onChange={val => updateClaim.mutate({ claimId: c.id, data: { status: val as TripClaimStatus } })}
                  colorClass={CLAIM_STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-600'}
                  items={CLAIM_STATUS_ITEMS}
                />
              ),
            },
            { key: 'totalAmount', header: 'Total Amount', type: 'currency', sortable: true },
            { key: 'createdAt', header: 'Created', type: 'date', sortable: true },
            { key: 'submittedDate', header: 'Submitted', type: 'date', sortable: true },
            {
              key: 'actions',
              header: '',
              render: (c: any) => (
                <div className="flex items-center gap-3">
                  <Link to={`/claims/${c.id}`} className="text-xs text-[#396200] hover:underline">View</Link>
                  {c.status !== 'Submitted' && c.status !== 'Paid' && (
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-500 hover:underline"
                    >Delete</button>
                  )}
                </div>
              ),
            },
          ]}
        />
```

- [ ] **Step 3: Build + lint**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run build 2>&1 | tail -20 && npm run lint 2>&1 | tail -10
```

Expected: no new TypeScript errors, no lint errors.

- [ ] **Step 4: Commit**

```bash
cd "F:/Projects/personal/Trip Planner" && git add frontend/src/pages/TripDetailPage.tsx && git commit -m "feat(claims): add bulk status edit to claims table"
```

---

### Task 5: Wire Bookings DataTable in TripDetailPage

**Files:**
- Modify: `frontend/src/pages/TripDetailPage.tsx` — main component body

- [ ] **Step 1: Add selection state and bulk patch function**

In the main component body, after the existing line `const patchBooking = usePatchBooking()` (around line 162), add:

```typescript
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set())
  const [bookingBulkLoading, setBookingBulkLoading] = useState(false)

  async function bulkPatchBookings(
    ids: string[],
    patch: Partial<{ bookingStatus: BookingStatus; insuranceStatus: InsuranceStatus; paymentStatus: PaymentStatus }>
  ) {
    setBookingBulkLoading(true)
    try {
      await Promise.all(
        ids.map(
          id =>
            new Promise<void>((resolve, reject) => {
              patchBooking.mutate(
                { id, data: patch },
                { onSuccess: () => resolve(), onError: err => reject(err) }
              )
            })
        )
      )
      setSelectedBookingIds(new Set())
    } catch {
      // individual mutation errors surface through TanStack Query
    } finally {
      setBookingBulkLoading(false)
    }
  }
```

Also add `BookingStatus`, `InsuranceStatus`, `PaymentStatus` to the existing type import if not already present. The current import is:

```typescript
import type { TripClaimStatus, BookingStatus, InsuranceStatus, PaymentStatus, SupportRatio, SleepoverType } from '@/api/types/enums'
```

All four are already imported — no change needed.

- [ ] **Step 2: Add `bulkEditable` to the three booking status columns and wire the DataTable**

Find the bookings `<DataTable` (around line 1098). Add `loading`, `selectable`, `selectedRows`, `onSelectionChange` props and `bulkEditable` to the three status columns:

```tsx
            <DataTable
              data={bookings}
              keyField="id"
              emptyMessage="No bookings yet"
              sortable
              loading={bookingBulkLoading}
              selectable
              selectedRows={selectedBookingIds}
              onSelectionChange={setSelectedBookingIds}
              columns={[
                {
                  key: 'participantName',
                  header: 'Participant',
                  className: 'font-medium',
                  sortable: true,
                  render: (b: any) => b.participantName || '—',
                },
                {
                  key: 'bookingStatus',
                  header: 'Status',
                  sortable: true,
                  bulkEditable: {
                    items: [
                      { value: 'Enquiry', label: 'Enquiry' },
                      { value: 'Held', label: 'Held' },
                      { value: 'Confirmed', label: 'Confirmed' },
                      { value: 'Waitlist', label: 'Waitlist' },
                      { value: 'Cancelled', label: 'Cancelled' },
                      { value: 'Completed', label: 'Completed' },
                      { value: 'NoLongerAttending', label: 'No Longer Attending' },
                    ],
                    onBulkChange: (ids, value) =>
                      bulkPatchBookings(ids, { bookingStatus: value as BookingStatus }),
                  },
                  render: (b: any) => (
                    <Dropdown
                      variant="pill"
                      value={b.bookingStatus}
                      onChange={val => patchBooking.mutate({ id: b.id, data: { bookingStatus: val as BookingStatus } })}
                      colorClass={getStatusColor(b.bookingStatus)}
                      items={[
                        { value: 'Enquiry', label: 'Enquiry' },
                        { value: 'Held', label: 'Held' },
                        { value: 'Confirmed', label: 'Confirmed' },
                        { value: 'Waitlist', label: 'Waitlist' },
                        { value: 'Cancelled', label: 'Cancelled' },
                        { value: 'Completed', label: 'Completed' },
                        { value: 'NoLongerAttending', label: 'No Longer Attending' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'bookingDate',
                  header: 'Date',
                  type: 'date',
                  sortable: true,
                },
                {
                  key: 'supportRatioOverride',
                  header: 'Ratio',
                  render: (b: any) => (({ OneToOne: '1:1', OneToTwo: '1:2', OneToThree: '1:3', OneToFour: '1:4', OneToFive: '1:5', TwoToOne: '2:1', SharedSupport: 'Shared', Other: 'Other' } as Record<string, string>)[b.supportRatioOverride as string]) || '—',
                },
                {
                  key: 'wheelchairRequired',
                  header: <span className="material-symbols-outlined text-base leading-none">accessible</span>,
                  type: 'boolean',
                  align: 'center',
                },
                {
                  key: 'highSupportRequired',
                  header: 'High',
                  type: 'boolean',
                  align: 'center',
                },
                {
                  key: 'nightSupportRequired',
                  header: 'Night',
                  type: 'boolean',
                  align: 'center',
                },
                {
                  key: 'insuranceStatus',
                  header: 'Insurance',
                  align: 'center',
                  sortable: true,
                  bulkEditable: {
                    items: [
                      { value: 'None', label: 'None' },
                      { value: 'Pending', label: 'Pending' },
                      { value: 'Confirmed', label: 'Confirmed' },
                      { value: 'Expired', label: 'Expired' },
                      { value: 'Cancelled', label: 'Cancelled' },
                    ],
                    onBulkChange: (ids, value) =>
                      bulkPatchBookings(ids, { insuranceStatus: value as InsuranceStatus }),
                  },
                  render: (b: any) => (
                    <Dropdown
                      variant="pill"
                      value={b.insuranceStatus || 'None'}
                      onChange={val => patchBooking.mutate({ id: b.id, data: { insuranceStatus: val as InsuranceStatus } })}
                      colorClass={getStatusColor(b.insuranceStatus || 'none')}
                      items={[
                        { value: 'None', label: 'None' },
                        { value: 'Pending', label: 'Pending' },
                        { value: 'Confirmed', label: 'Confirmed' },
                        { value: 'Expired', label: 'Expired' },
                        { value: 'Cancelled', label: 'Cancelled' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'paymentStatus',
                  header: 'Payment',
                  align: 'center',
                  sortable: true,
                  bulkEditable: {
                    items: PAYMENT_STATUS_ITEMS,
                    onBulkChange: (ids, value) =>
                      bulkPatchBookings(ids, { paymentStatus: value as PaymentStatus }),
                  },
                  render: (b: any) => (
                    <Dropdown
                      variant="pill"
                      value={b.paymentStatus || 'NotInvoiced'}
                      onChange={val => patchBooking.mutate({ id: b.id, data: { paymentStatus: val as PaymentStatus } })}
                      colorClass={PAYMENT_STATUS_COLORS[b.paymentStatus || 'NotInvoiced'] ?? 'bg-neutral-100 text-neutral-600'}
                      items={PAYMENT_STATUS_ITEMS}
                      disabled={isReadOnly}
                    />
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'center',
                  render: (b: any) => (
                    <div className="flex items-center justify-center gap-2">
                      {b.actionRequired && <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />}
                      <button onClick={() => openEditModal(b)} className="p-1 rounded hover:bg-[#efeeea] transition-colors" title="Edit booking">
                        <Pencil className="w-3.5 h-3.5 text-[#43493a]" />
                      </button>
                      <Link to={`/participants/${b.participantId}`} className="p-1 rounded hover:bg-[#efeeea] transition-colors" title="View participant">
                        <ExternalLink className="w-3.5 h-3.5 text-[#43493a]" />
                      </Link>
                      <button onClick={() => setDeletingBooking(b)} className="p-1 rounded hover:bg-[#ffdad6]/60 transition-colors" title="Remove from trip">
                        <Trash2 className="w-3.5 h-3.5 text-[#43493a] hover:text-[#ba1a1a]" />
                      </button>
                    </div>
                  ),
                },
              ]}
            />
```

- [ ] **Step 3: Build + lint**

```bash
cd "F:/Projects/personal/Trip Planner/frontend" && npm run build 2>&1 | tail -20 && npm run lint 2>&1 | tail -10
```

Expected: no new TypeScript errors, no lint errors.

- [ ] **Step 4: Commit**

```bash
cd "F:/Projects/personal/Trip Planner" && git add frontend/src/pages/TripDetailPage.tsx && git commit -m "feat(bookings): add bulk status edit to bookings table (status, insurance, payment)"
```

---

## Verification

After all tasks complete, manually verify in the browser (`npm run dev`):

1. Open a trip detail page → Bookings tab
2. Check a row → checkbox becomes ticked, row gets a subtle highlight
3. Header checkbox (select all) checks all rows, clicking again deselects all
4. With rows selected → "N rows ▾" pill appears in Status, Insurance, and Payment column headers
5. Click "N rows ▾" on Status → dropdown opens with booking status options
6. Select "Confirmed" → all selected rows update to Confirmed, selection clears
7. Repeat for Claims tab (single status column)
8. Deselect all → bulk triggers disappear, table looks exactly as before
9. Single-row pill dropdowns still work when no rows are selected
