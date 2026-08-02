---
tags: [project/trip-planner, tech/react, pattern/bulk-edit, component/datatable]
date: 2026-03-31
project: TripPlanner
---

# Bulk Status Edit — Design Spec

## Overview

Add row selection and bulk status editing to the `DataTable` component. When rows are selected, status columns that support bulk editing show a dropdown trigger in their header — clicking it sets that status on all selected rows in parallel. Individual single-row quick-edit pill dropdowns remain unchanged.

---

## Scope

**In scope:**
- `DataTable` component — add selection and bulk-edit header trigger
- `TripDetailPage` — wire up bulk editing for all existing pill dropdown status columns

**Out of scope:**
- Pages with read-only status badges (Tasks, Bookings list, Participants, Staff, Incidents) — no quick-edit added here
- Card grid on TripsPage — not a table
- Backend bulk endpoints — not needed; parallel client-side mutations are sufficient

---

## Current State

`TripDetailPage` is the only page with `variant="pill"` Dropdown quick-edit inside a DataTable. It has four such columns across two tables:

| Table | Column | Status type |
|-------|--------|-------------|
| Claims | Status | `TripClaimStatus` |
| Bookings | Booking status | `BookingStatus` |
| Bookings | Insurance status | `InsuranceStatus` |
| Bookings | Payment status | `PaymentStatus` |

No row selection or bulk action infrastructure exists anywhere in the codebase today.

---

## Design

### DataTable — new props

```ts
// On DataTableProps<T>
selectable?: boolean                           // renders checkbox first-column
selectedRows?: Set<string>                     // controlled by parent page
onSelectionChange?: (ids: Set<string>) => void // parent updates its state

// On Column<T>
bulkEditable?: {
  items: DropdownItem[]                        // same type used by Dropdown component
  onBulkChange: (selectedIds: string[], value: string) => void
}
```

Both additions are **opt-in**. Tables that don't pass `selectable` are entirely unaffected.

### Checkbox column

- Always visible (not hover-only), 32 px wide, prepended before all other columns
- Header cell: "select all / deselect all" checkbox — checked when all rows selected, indeterminate when partial
- Row cells: individual checkbox tied to that row's `keyField` value
- Selected rows get a subtle background tint (matches existing design system surface hierarchy)

### Bulk trigger in column headers

- When `selectedRows.size > 0`, any column with `bulkEditable` defined renders a **"▾ N rows"** pill button next to its column label
- Columns without `bulkEditable` show no change — their header labels remain as-is
- The pill uses the existing `Dropdown` component internally (portal-positioned, same viewport-edge handling)
- Dropdown label at top of panel: e.g. "Set booking status for 3 rows"

### Selection flow

```
User checks row(s) → onSelectionChange fires → parent updates selectedRows state
→ DataTable re-renders header with bulk trigger pills on eligible columns
```

### Bulk update flow

```
User clicks "▾ N rows" on a column → Dropdown opens
→ User selects a status value
→ column's onBulkChange(selectedIds, value) fires
→ parent calls Promise.all(selectedIds.map(id => mutation(id, value)))
→ table shows loading state (existing DataTable loading prop)
→ on success: parent clears selectedRows (calls onSelectionChange(new Set()))
→ TanStack Query cache invalidated → pills update with new values
```

### Error handling

- If any mutation in the batch fails, the parent catches and shows a toast/error — selection is **not** cleared so the user can retry
- Partial success (some succeed, some fail) is treated as failure — user retries the whole selection

---

## Component changes

### `components/DataTable.tsx`

1. Extend `Column<T>` with optional `bulkEditable` field
2. Extend `DataTableProps<T>` with `selectable`, `selectedRows`, `onSelectionChange`
3. When `selectable={true}`:
   - Prepend a 32 px checkbox column to the rendered column list
   - Render select-all checkbox in `<thead>` first cell
   - Render row checkbox in each `<tbody>` first cell, checked when row id is in `selectedRows`
4. When `selectedRows.size > 0` and a column has `bulkEditable`:
   - Render `"▾ N rows"` pill button next to column header label
   - On click: open `Dropdown` with `bulkEditable.items`, positioned below the header cell
   - On `Dropdown` `onChange`: call `column.bulkEditable.onBulkChange(Array.from(selectedRows), value)`

No changes to existing column rendering, sorting, editing, or loading logic.

### `pages/TripDetailPage.tsx`

For each of the two tables (claims, bookings):

1. Add `useState<Set<string>>(new Set())` for `selectedRows`
2. Pass `selectable={true}`, `selectedRows`, `onSelectionChange` to `<DataTable>`
3. On each status column, add `bulkEditable`:
   - `items`: same `DropdownItem[]` array already used by that column's single-row `Dropdown`
   - `onBulkChange`: fire `Promise.all` with the appropriate mutation hook, then clear selection on success

---

## Non-goals

- No bulk delete, bulk assign, or other bulk actions beyond status change
- No drag-to-select or shift-click range selection
- No persistence of selection across page navigation
- No keyboard shortcuts for selection

---

## Open questions (resolved)

| Question | Decision |
|----------|----------|
| Floating bar vs column trigger | Column header trigger (Option B) |
| Checkboxes always-visible vs hover | Always visible |
| Backend bulk endpoint? | No — `Promise.all` client-side |
| Which surfaces? | DataTable only (not card grids) |
| Selection state location? | Controlled by parent page |
