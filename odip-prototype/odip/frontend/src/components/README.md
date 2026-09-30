# Shared components

This is ODIP's shared primitive set — the recurring UI building blocks (tables, form
fields, pickers, dialogs, status/empty states) that every feature should build on rather
than inventing page-local variants. This document is the DS-01 "documented set"
deliverable: for each primitive below it covers props, visual/interaction states, the
accessibility contract, when to reach for it (and when not to), and a short usage
snippet.

Anything not listed here (`AddActivityModal`, `AddVehicleModal`, `GenerateClaimModal`,
`NoShowModal`, `TemplateFormPanel`, `AuditHistoryTab`, `ItineraryTab`, `ItineraryPdf`,
`ParticipantAlertsBanner`, `ServiceStreamBadges`, …) is a feature-specific composed
component, not a generic primitive — it's fine for those to live outside this contract,
but if a second feature needs the same shape, extract the shared part in here instead of
copying it.

## Contents

- [DataTable](#datatable)
- [FormField](#formfield)
- [Dropdown](#dropdown)
- [SearchableSelect](#searchableselect)
- [ToggleGroup](#togglegroup)
- [EmptyState](#emptystate)
- [Modal](#modal) / [ConfirmDialog](#confirmdialog)
- [SearchInput](#searchinput)
- [StatusBadge](#statusbadge)
- [Card](#card) / [StatCard](#statcard)
- [PageHeader](#pageheader)
- [Tabs](#tabs)
- [ActionButtons](#actionbuttons)
- [Touch hit areas](#touch-hit-areas) (`TAP_AREA`, `TAP_FLOOR`, `TAP_AREA_LINKS`, `--tap-min`)
- [ErrorBoundary](#errorboundary)
- [Picking a picker](#picking-a-picker) (Dropdown vs SearchableSelect vs ToggleGroup)

---

## DataTable

`DataTable.tsx` — the shared table for any row/column dataset: participant lists, claims,
audit history, compatibility matrices, restrictive-practice registers.

**Props** (generic over row type `T`):

| Prop | Type | Notes |
|---|---|---|
| `data` | `T[]` | Rows to render. |
| `columns` | `Column<T>[]` | See column shape below. |
| `keyField` | `keyof T & string` | Field used as React key and row identity. |
| `sortable` | `boolean` | Table-level switch; a column also needs its own `sortable: true`. |
| `defaultSort` / `sort` / `onSortChange` | | Uncontrolled (`defaultSort`) or controlled (`sort` + `onSortChange`) sort state — same pattern as `DropdownProps.value`. |
| `onRowClick` | `(row: T) => void` | Makes the row a keyboard-operable button (`role="button"`, `tabIndex=0`, Enter/Space). |
| `rowClassName` | `(row: T) => string` | Per-row extra classes (e.g. highlighting a flagged row). |
| `emptyMessage` | `string` | Shown when `data` is empty and not loading. Default `'No data'`. |
| `loading` | `boolean` | See States below. |
| `editingRow` | `string \| number \| null` | Row whose `editable` columns render their edit control instead of the display cell — the *row-at-a-time* shape (a claims table's amount field). |
| `editingRows` | `Set<string>` | **RP-01.** Every row whose key is in this set renders every `editable` column's edit control, simultaneously, for as many rows as are in the set — the *N-freeform-rows-at-once* shape (a bulk-add table). Independent of `editingRow`; use whichever matches the consumer's edit model. |
| `onEditChange` | `(row: T, key: string, value: unknown) => void` | Fired by an editable column's `onChange`, for either edit mode above. |
| `rowError` | `(row: T) => string \| undefined` | Per-row validation error rendered as its own `role="alert"` row directly beneath a row currently in edit mode (`editingRow` or `editingRows`). Return `undefined` for a row with nothing to show. |
| `selectable` / `selectedRows` / `onSelectionChange` | | Adds a checkbox column with select-all in the header. |
| `compact` | `boolean` | Tighter cell padding. |
| `verticalDividers` | `boolean` | **DS-02.** Adds a vertical rule between every column (header + body). Off by default — most tables read fine with only the horizontal row dividers already in place; turn it on for dense, many-column tables where tracking a column by eye benefits from a rule (e.g. a wide compatibility matrix). |
| `footer` | `ReactNode` | Rendered in a `<tfoot>` below the body. |
| `className` | `string` | Overrides the default card/border wrapper entirely. |

Column shape (`Column<T>`):

```ts
{
  key: keyof T & string   // or a synthetic string key for a computed column
  header: string | ReactNode
  type?: 'text' | 'date' | 'currency' | 'boolean' | 'badge' | 'custom'  // built-in cell renderer
  render?: (row: T, rowIndex: number) => ReactNode                      // overrides `type`
  sortable?: boolean
  sortFn?: (a: T, b: T) => number   // overrides the default type-aware comparator
  align?: 'left' | 'center' | 'right'
  hidden?: boolean
  editable?: { render: (row: T, onChange: (value: unknown) => void) => ReactNode }
  bulkEditable?: { items: DropdownItem[]; onBulkChange: (selectedIds: string[], value: string) => void }
  className?: string
}
```

**States**

- **Loading, no data yet**: a centred spinner row with "Loading...", `colSpan`ned across
  every visible column.
- **Loading, stale data still visible**: a translucent overlay + spinner on top of the
  existing rows, so a re-fetch doesn't flash the table empty.
- **Empty**: `emptyMessage`, `aria-live="polite"` so a filter that empties the table is
  announced.
- **Editable cell — row-at-a-time**: swaps a specific row's cell(s) to the column's
  `editable.render` control while `editingRow` matches that row's key — the rest of the row
  (and every other row) stays read-only. E.g. a claims table's amount field.
- **Editable cell — all rows at once (RP-01)**: every row whose key is in `editingRows`
  swaps *all* of its `editable` columns to their edit control, simultaneously, for every row
  in the set — the "N freeform rows, all editable at once" shape a bulk-add table needs
  (RP-01's restrictive-practice bulk-add: pick a type + count, get an editable table with
  that many rows, each becoming its own register entry on save). Each `editable.render` is
  still just a plain controlled input the caller renders — DataTable doesn't add
  spreadsheet/grid semantics (no arrow-key cell-to-cell navigation, no copy/paste across
  cells) — keyboard navigation between cells is the browser's native Tab order across the
  rendered `<input>`s, which is sufficient for this shape's row-by-row entry pattern. Pair
  with `rowError` to show a per-row validation message (e.g. "Description is required")
  directly under a row that failed to save, and give every `editable.render` control a
  `min-h-[44px]` touch target like any other input. `editable.render`'s third argument,
  `ctx.errorId`, is that row's error `<p>`'s id (only defined while the row actually has one
  rendered) — wire it onto the rendered control as `aria-describedby={ctx.errorId}` +
  `aria-invalid={ctx.errorId ? 'true' : undefined}` so the association reaches assistive tech,
  not just sighted users reading the text under the row. See RestrictivePracticesTab's bulk-add
  columns for the pattern applied to all four cell inputs of a row that failed to save.
- **Selectable**: header checkbox is `indeterminate` when some-but-not-all visible rows
  are selected.

**Accessibility**

- Sortable headers are `role="button"`, keyboard-operable (Enter/Space), and carry
  `aria-sort` (`ascending` / `descending` / `none`).
- Clickable rows (`onRowClick`) are `role="button"`, `tabIndex=0`, with a visible
  `focus-visible` ring and Enter/Space activation.
- Select-all and per-row checkboxes carry `aria-label`s (`"Select all rows"` /
  `"Select row {id}"`).
- A row's error message (`rowError`, either editable mode) renders at a stable id
  (`${rowKey}-row-error`) with `role="alert"`; that id is only ever handed to `editable.render`
  (as `ctx.errorId`) for the row it belongs to, and only while the error `<p>` is actually
  rendered — never a dangling `aria-describedby` reference to an id nothing renders.

**When to use**: any tabular list of records. **When not to**: a small, fixed 2-3 row
summary — reach for `Card`/`StatCard` instead.

```tsx
<DataTable
  data={participants}
  columns={[
    { key: 'name', header: 'Name', sortable: true },
    { key: 'status', header: 'Status', type: 'badge' },
    { key: 'startDate', header: 'Started', type: 'date', sortable: true },
  ]}
  keyField="id"
  sortable
  onRowClick={p => navigate(`/participants/${p.id}`)}
  emptyMessage="No participants match these filters."
  loading={isLoading}
  verticalDividers
/>
```

`editingRows` (all-rows-at-once editable table — RP-01's bulk-add shape):

```tsx
<DataTable
  data={rows}
  keyField="id"
  columns={[
    {
      key: 'description', header: 'Description',
      editable: { render: (row, onChange) => (
        <input value={row.description} onChange={e => onChange(e.target.value)}
          className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-[var(--color-border)]" />
      ) },
    },
    { key: 'remove', header: '', render: row => <button onClick={() => removeRow(row.id)}>Remove</button> },
  ]}
  editingRows={new Set(rows.map(r => r.id))}
  onEditChange={(row, key, value) => updateRow(row.id, key, value)}
  rowError={row => rowErrors.get(row.id)}
/>
```

---

## FormField

`FormField.tsx` — the label/hint/error/required wrapper every form control sits inside.
Handles the native-vs-custom-control id/label/aria wiring so individual forms never have
to hand-roll `aria-describedby` plumbing.

**Props**

| Prop | Type | Notes |
|---|---|---|
| `label` | `ReactNode` | Required. |
| `required` | `boolean` | Appends `*` to the label and sets `aria-required` on the control. |
| `error` | `string` | Shown instead of `hint` when present; sets `aria-invalid`. |
| `hint` | `string` | Helper text below the control. |
| `descriptionId` | `string` | Folds an *externally-rendered* description (e.g. a conditional inline notice the caller renders itself) into the control's `aria-describedby` alongside the built-in hint/error. |
| `layout` | `'default' \| 'checkbox'` | `'checkbox'` renders label-wraps-input with a 44px tall row instead of label-above-control. |
| `className` | `string` | On the wrapping `<div>`. |
| `children` | one element | The control — a native `input`/`select`/`textarea`, or a custom component (`Dropdown`, `SearchableSelect`, an RHF `<Controller>` render). |

**States**: default / error (replaces hint) / required (marked on both label and control).
No loading/disabled state of its own — that's the child control's job (FormField only
forwards whatever `disabled` etc. the child already had).

**Accessibility contract** — this is the a11y pass's core deliverable:

- **Native input/select/textarea** children: get `inputClass` styling merged in, an
  auto-generated `id` (unless the child already sets one) with a real `<label htmlFor>`,
  plus `aria-required`/`aria-invalid`/`aria-describedby` as needed.
- **Custom component** children (Dropdown, SearchableSelect, an RHF Controller): get `id`
  + `aria-labelledby` (pointing at the `<label>`) instead of relying on `htmlFor`/`id`
  association alone, since that's not reliably announced for non-native ARIA-widget
  triggers — plus the same `aria-required`/`aria-invalid`/`aria-describedby` wiring.
  Components that don't read these props (e.g. RHF's `<Controller>` render prop) simply
  ignore them — no crash, no warning.
- **Checkbox/radio inputs** are detected and excluded from the `inputClass` treatment (its
  `w-full` would blow a checkbox up to the field's width) and get the `layout="checkbox"`
  44px-tall label-as-hit-area treatment.
- `aria-describedby` is *composed*, not overwritten: built-in hint id + built-in error id +
  caller's `descriptionId` all fold into one space-separated list, and only the ids that
  actually render are included (no dangling references).

**When to use**: wrapping any labelled form control. **When not to**: a checkbox/toggle
that isn't part of a labelled field-with-hint shape — a bare `<label>` is fine for that.

```tsx
<FormField label="Staff" hint="Leave unassigned to add this shift to the Unfilled lane.">
  <SearchableSelect value={staffId ?? ''} onChange={setStaffId} items={staffOptions} />
</FormField>

<FormField label="Ends the next day" layout="checkbox">
  <input type="checkbox" checked={endsNextDay} onChange={e => setEndsNextDay(e.target.checked)} />
</FormField>
```

---

## Dropdown

`Dropdown.tsx` — a portal-based select/menu with four trigger appearances sharing one
keyboard/positioning engine.

**Props**: `variant: 'pill' | 'form' | 'menu' | 'icon'`, `items: DropdownItem[]`
(`{ value, label, icon?, description?, disabled? }`), `value`/`onChange` (pill/form),
`onSelect` (menu, no tracked value), `onBlur`, `label`, `icon`, `colorClass`, `disabled`,
`loading`, `align`, `searchable` (adds a filter `<input>` *inside* the open panel — see
[Picking a picker](#picking-a-picker) for how this differs from SearchableSelect), plus
the `id`/`aria-labelledby`/`aria-required`/`aria-invalid`/`aria-describedby` labelling
contract that mirrors FormField's custom-component clone.

**States**: closed / open / disabled / loading (spinner in place of the chevron) / empty
panel (`"No options available"` or, when `searchable` and a query is active, `"No results
found"`).

**Accessibility**: trigger is a real `<button>` with `aria-haspopup="listbox"`,
`aria-expanded`, `aria-activedescendant`; panel is `role="listbox"` of `role="option"`
rows. Full arrow-key/Home/End/Enter/Escape support, click-outside-to-close. Option rows
carry `onMouseDown={e => e.preventDefault()}` and `handleSelect` re-focuses the trigger
button after a selection commits — without this, the browser's default mousedown-blur
would blur the trigger before the click that commits the selection ever fires, stranding
DOM focus outside the component (W3C APG / Downshift combobox pattern).

**When to use**: a *bounded* option set (a handful up to maybe a couple dozen) presented
as a button trigger — status pills, filter menus, kebab action menus, small selects.
**When not to**: a list large enough that scanning beats clicking — see SearchableSelect.

```tsx
<Dropdown variant="form" value={ratio} onChange={setRatio} items={SUPPORT_RATIOS.map(r => ({ value: r, label: RATIO_LABELS[r] }))} />
```

---

## SearchableSelect

`SearchableSelect.tsx` — a typeahead single-select for large option lists, built on the
WAI-ARIA 1.2 "combobox with list autocomplete" pattern (UX-01). This is the primitive to
reach for once a Dropdown's list is long enough that finding an entry by scrolling is
worse than typing a few letters — participant/staff pickers, diagnosis lists, anything
with dozens-plus entries.

**Props**

| Prop | Type | Notes |
|---|---|---|
| `items` | `SearchableSelectItem[]` | Same shape as `DropdownItem` (`{ value, label, icon?, description?, disabled? }`) — re-exported under this component's name. |
| `value` / `onChange` | `string` / `(value: string) => void` | Controlled, like `Dropdown`'s `value`/`onChange`. |
| `onBlur` | `() => void` | Forward an RHF `Controller`'s `field.onBlur`. Fires on selection and on every close-without-a-selection (outside click, Escape, Tab-away). |
| `placeholder` | `string` | Default `'Search…'`. |
| `disabled` | `boolean` | |
| `loading` | `boolean` | Options are still arriving — see States. The field stays typeable while loading. |
| `emptyMessage` | `string` | Default `'No options available'` — shown when `items` is empty. |
| `noMatchMessage` | `string` | Default `'No results found'` — shown when a typed query matches nothing. |
| `id` / `aria-labelledby` / `aria-required` / `aria-invalid` / `aria-describedby` | | Same FormField labelling contract as Dropdown — a drop-in swap under a `FormField`. |

**Behaviour model** (worth reading before reaching for this over Dropdown): the input's
displayed text is *derived*, not stored — while closed it's always the current
selection's label, recomputed straight from `value`/`items`, so it can never drift out of
sync with a controlling parent. Opening the field (focus or click) clears it to an empty
query so the **full option list is immediately arrow-key-browsable without typing a
single character**; typing narrows from there. Selecting an option commits `onChange` and
closes; Escape or an outside click close *without* committing anything, snapping the
field straight back to the unchanged selection's label.

**States**: closed (shows selection or blank) / open-browsing (full list, arrow-key
navigable) / open-filtered (narrowed by typed query) / no-match (`noMatchMessage`) /
empty (`emptyMessage`, no items at all) / loading (spinner in the field + a "Loading
options…" row while `items` is still empty) / disabled.

**Accessibility contract**:

- The input carries `role="combobox"`, `aria-expanded`, `aria-controls` (pointing at the
  listbox), `aria-autocomplete="list"`, and `aria-activedescendant` — the "virtual focus"
  moves via that attribute while real DOM focus stays on the input, per the APG combobox
  pattern. The popup is `role="listbox"` of `role="option"` rows with `aria-selected`.
- Full keyboard support: **ArrowDown/ArrowUp** move the active option (wrapping, skipping
  `disabled` items); **Home/End** jump to the first/last enabled option; **Enter** selects
  the active option (or the sole filtered match, if none is explicitly active yet);
  **Escape** closes and discards the query; **Tab** closes and moves focus on, same as a
  native `<select>`.
- 44px-tall input and option rows (touch-target guardrail).
- Option rows carry `onMouseDown={e => e.preventDefault()}` and `handleSelect`
  re-focuses the input after a selection commits — the same mousedown-blur guard as
  Dropdown, for the same reason: without it, a mouse/touch click on an option blurs the
  input before the click that commits the selection fires, stranding DOM focus outside
  the component and breaking the "focus never leaves the input" contract this primitive
  is built on.

**When to use**: participant/staff/contact pickers, diagnosis/medication-style lookup
lists, anything where the option count makes "just click through a Dropdown panel"
impractical. **When not to**: a short, bounded option set — use `Dropdown`, whose click-a
trigger-then-pick model is one interaction step simpler for a dozen items.

```tsx
<FormField label="Staff" hint="Leave unassigned — the shift shows as unfilled.">
  <SearchableSelect
    value={staffId ?? ''}
    onChange={v => setStaffId(v || null)}
    placeholder="Unassigned"
    items={[{ value: '', label: 'Unassigned' }, ...staffOptions]}
  />
</FormField>
```

---

## ToggleGroup

`ToggleGroup.tsx` — single-select-from-a-small-set rendered as adjacent buttons, e.g. a
medication administration status picker (Administered/Refused/Withheld/Missed).

**Props**: `options: { key: string; label: string }[]`, `value: string`,
`onChange: (key: string) => void`, `className`, `ariaLabel?: string`.

**States**: each option is selected/unselected; no disabled-per-option support today (add
it if a consumer needs it rather than working around its absence).

**Accessibility**: this is a *radio group*, not independent toggle buttons — every caller
tracks one selected value from a fixed set, which is exactly `role="radiogroup"` +
`role="radio"` + `aria-checked` semantics (not `aria-pressed`, which implies independent
on/off toggles). Roving tabindex: only the checked option (or the first, if none matches)
is a Tab stop; Arrow keys (all four directions) plus Home/End move *and select* within the
group, per the ARIA APG radio pattern. `ariaLabel` sets the radiogroup's accessible name
directly (`aria-label`) — pass it whenever the group isn't already labelled another way.
In particular, a bare ToggleGroup rendered directly as a FormField's child DOES get a real
label for free (FormField's `cloneElement` reaches it), but a ToggleGroup rendered as the
output of an RHF `<Controller>`'s `render` prop inside FormField does NOT — FormField clones
its labelling props onto the `<Controller>` element itself, which doesn't forward unknown
props to its render function, so the label is silently dropped (no crash, no warning — see
FormField.tsx's own comment). Pass `ariaLabel` explicitly for that shape; omitting it isn't
an error, just an unlabelled radiogroup.

**When to use**: 2-5 mutually-exclusive, always-visible options where showing every
choice at once beats hiding them behind a Dropdown trigger. **When not to**: more than
~5 options (cognitive load / horizontal space), or when the options aren't all equally
relevant at once — that's a Dropdown or SearchableSelect job.

```tsx
<ToggleGroup
  options={STATUS_OPTIONS.map(o => ({ key: o.key, label: o.label }))}
  value={status}
  onChange={v => setStatus(v as MedicationAdministrationStatus)}
  ariaLabel="Status"
/>
```

Controller-wrapped inside FormField (the shape that needs `ariaLabel` — see above):

```tsx
<FormField label="Granted">
  <Controller
    control={control}
    name="consents.0.granted"
    render={({ field }) => (
      <ToggleGroup
        options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }, { key: '', label: 'Not recorded' }]}
        value={field.value ?? ''}
        onChange={field.onChange}
        ariaLabel="Granted"
      />
    )}
  />
</FormField>
```

---

## EmptyState

`EmptyState.tsx` — the "nothing here yet" placeholder for an empty list/table page (not
DataTable's own inline empty *row* — this is a full-page/full-section empty state with an
icon, explanation, and a next action).

**Props**: `icon: ComponentType`, `title: string`, `description?: string`,
`action?: { label, to } | { label, onClick }`, `className`.

**States**: with/without a description, with/without an action.

**Accessibility**: the action renders as a real `<Link>` or `<button>` (never a `<div
onClick>`), 44px min-height tap target, visible focus ring.

**When to use**: a page/section whose primary content list is empty — pair the copy with
*why* it's empty and what to do next ("teaches", per the product register), not just "No
data". **When not to**: a table that's merely *filtered* to zero rows — that's
`DataTable`'s `emptyMessage`, phrased as "no matches" rather than "nothing exists yet".

```tsx
<EmptyState
  icon={Users}
  title="No participants yet"
  description="Add your first participant to start scheduling shifts and tracking their plan."
  action={{ label: 'Add participant', to: '/participants/new' }}
/>
```

---

## Modal / ConfirmDialog

`Modal.tsx` is the base dialog shell: focus trap, Escape-to-close, background scroll
lock, focus returns to the trigger on close, `role="dialog"` + `aria-modal` +
`aria-labelledby`. Props: `open`, `onClose`, `title`, `size` (`sm`/`md`/`lg`/`xl`),
`footer`, `children`, `className`.

`ConfirmDialog.tsx` is `Modal` pre-wired for the confirm/cancel shape: `title`, `message`,
`confirmLabel`, `variant` (`'default' | 'danger'`), `loading` (button reads
"Processing…" and disables), or a fully custom `footer` for flows with more than one
destructive choice.

**When to use Modal directly** vs building a page: any transient, focused task that
doesn't need its own URL/route. **When to use ConfirmDialog** vs a bespoke Modal footer:
any destructive or consequential confirm/cancel decision — don't hand-roll another
confirm footer.

```tsx
<ConfirmDialog
  open={confirmDelete}
  onConfirm={handleDelete}
  onCancel={() => setConfirmDelete(false)}
  title="Delete shift"
  message="This permanently removes the shift from the roster. This can't be undone."
  confirmLabel="Delete"
  variant="danger"
  loading={deleteShift.isPending}
/>
```

---

## SearchInput

`SearchInput.tsx` — a plain labelled text filter box (leading search icon, no
suggestions/popup). Props: `value`, `onChange`, `placeholder`, `label` (falls back to
`placeholder` for `aria-label`), `className`.

**When to use**: filtering an already-rendered list/table client-side, or driving a
server-side text filter. **When not to**: picking *one* item from a list of options —
that's SearchableSelect, which adds the listbox/keyboard/selection machinery this
component deliberately doesn't have.

---

## StatusBadge

`StatusBadge.tsx` — a small coloured pill for an enum-like status value. Props: `status`
(matched case/whitespace-insensitively against a large built-in colour map spanning
booking, severity, claims, QSC and plan-type vocabularies), `label` (override the
displayed text without changing the colour lookup), `colorMap` (per-call overrides/
additions), `pulse`, `className`. Unrecognised statuses fall back to an amber "pending"
colour rather than an unstyled default.

**When to use**: rendering any of the app's status/severity/plan-type enums. Check the
built-in `STATUS_COLORS` map before adding a one-off inline badge — a new status value is
usually a one-line addition there, not a reason to bypass this component.

---

## Card / StatCard

`Card.tsx` is the generic bordered/padded content container (`title`, `action`,
`compact`, `children`). `StatCard.tsx` is `Card` pre-wired for a single label/value KPI
tile. **When to use StatCard vs a hand-rolled metric block**: any single-number summary
stat — keeps the "hero-metric template" tendency the design guardrails ban confined to
one real, reused component instead of copy-pasted markup per page.

---

## PageHeader

`PageHeader.tsx` — the title/subtitle/primary-action row every page starts with, plus an
optional row of filter/toolbar children below it. Props: `title`, `subtitle`, `action`,
`children`.

---

## Tabs

`Tabs.tsx` — the single tab primitive. It absorbed the former `TabNav.tsx` (deleted) so
every tab surface in the app shares one look and one behaviour set; the billing screen's
underlined, icon-optional, text-only strip is the reference styling.

Two usage modes:

1. **Inline panels** — each item carries its own `content`:
   ```tsx
   <Tabs tabs={[{ id: 'a', label: 'A', content: <PanelA /> }]} active={id} onChange={setId} ariaLabel="Sections" />
   ```
2. **External panels** (the default for existing pages) — items are `{ key, label, icon?, badge?, disabled? }`
   and the parent renders the panel itself. `onChange` receives the tab's `key`:
   ```tsx
   <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Sections" />
   {tab === 'funding' && <FundingSourcesTab />}
   ```

Accessibility contract: `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`,
`aria-controls` (only when a real panel exists), roving tabindex, ArrowLeft/ArrowRight (wrapping),
Home/End, and disabled tabs skipped. An `active` value that matches no enabled tab falls back to
the first enabled tab rather than rendering a strip with nothing selected. Long tab sets
(e.g. the 11-tab participant detail) never overflow the page: below `md` the strip is ONE row that scrolls
sideways (scrollbar hidden, each tab a `--tap-min` 44px on touch), and the active tab is scrolled into view inside
the strip whenever `active` changes; from `md` up it wraps onto extra rows as before.

> When a test previously did `getByRole('button', { name: <tab> })`, it is now
> `getByRole('tab', { name: <tab> })` — the role change is the accessibility fix, not a
> cosmetic one.

---

## ActionButtons

`ActionButtons.tsx` — the compact icon-button row for a table row's Edit/Delete/Restore
actions. Props: `editTo` (renders a `<Link>`), `onEdit`, `onDelete`, `onRestore`,
`showArchived` (swaps Delete for Restore). Every button stops click propagation, so it's
safe to drop into a `DataTable` row that also has `onRowClick`.

---

## Touch hit areas

Spec §1: on a touch screen (`pointer: coarse`) a 36px control keeps its size and gets a hit area padded to 44px.
`tapArea.ts` exports `TAP_AREA`, the one class list that does it: a transparent, centred `::before` sized
`max(100%, var(--tap-min))`. `--tap-min` (index.css) is `0px` on a mouse — the pseudo-element is then exactly the
control's own box, so nothing changes on desktop — and `44px` under coarse. A tap in the padding is a tap on the
control (the pseudo-element belongs to it). Already applied to `Button` (`size="sm"` and `iconOnly`) and the
`Dropdown` pill and menu triggers; add it to any other content-sized control shorter than 44px.

Rules: `TAP_AREA` includes `relative`, so the control takes no other `position`; the pad reaches
`(44 − visual size) / 2` past each edge, so neighbouring controls must sit at least that far apart under coarse
(widen the gap with `pointer-coarse:gap-*`, as `RowActions` does: 6px → 8px); an `overflow-hidden` ancestor clips the
pad. For controls that sit flush against their neighbours (the mobile bottom nav, whose links are equal-width `flex-1`
cells) use a `min-h/min-w-[var(--tap-min)]` floor instead — it cannot overlap a neighbour. `Dropdown variant="icon"`
is deliberately not padded (its one consumer is flush against a roster chip).

Three more pieces of the same story (all in `tapArea.ts` or built on it):

- **`TAP_FLOOR`** (`min-h-[var(--tap-min)]`, with `inline-flex` and `items-center` under `pointer-coarse:` only) is the
  other route, for a standalone link that has a line to itself: "View All", "← Back to Trips" on the create pages. The
  link is 44px tall on touch (0px floor on a mouse, where it stays the plain inline link box for box) and centred in
  that height. It adds real layout height, so it needs no neighbour spacing and can never be clipped by an `overflow`
  ancestor; prefer the pad where growing the box would move things.
- **`TAP_AREA_LINKS`** is `TAP_AREA` for every link in a table cell, written once on `DataTable`'s body `<td>`: a
  `render: row => <Link>` gets a 44px hit area with no caller code, and on a mouse not even `position` changes. It is a
  single class, `tap-area-links`, a `@utility` in `index.css` (all of it inside `@media (pointer: coarse)`), so a cell
  carries one class name rather than ten arbitrary-variant ones. A `truncate`/`overflow-hidden` link clips its own pad, so
  give it `TAP_TRUNCATED_LINK` (vertical padding from md up) instead. The pager's Previous/Next take `--control-h` (44px
  on touch) rather than a pad.
- **`TAP_ICON_SQUARE`** is the touch shape of a small icon control in a row cluster: `TAP_AREA` plus the
  `--control-h-sm` square (36px) with the icon centred, under `pointer-coarse:` only. `ActionButtons` uses it, and so
  do the hand-rolled icon clusters on the trip detail Bookings and Staff tabs; two neighbours need 8px between them
  there (a `gap-2` row) so their pads touch and never overlap. A link that sits in such a cluster and is NOT padded
  the same way would take DataTable's `TAP_AREA_LINKS` pad and overlap its small neighbours.
- **`ActionButtons`** carries `TAP_ICON_SQUARE` on each icon control: the `--control-h-sm` square (36px) under coarse
  wherever it sits (a DataTable row or a card), and it opens its gap from 4px to 8px there so the pads touch and never
  overlap.

---

## ErrorBoundary

`ErrorBoundary.tsx` — app-shell-level React error boundary (class component; React has no
hook equivalent). Catches render errors, shows a "Something went wrong" fallback (or a
custom `fallback`) with a retry button, and specifically detects stale-chunk errors after
a deploy (`Failed to fetch dynamically imported module`, etc.) to force a one-time reload
so users aren't stuck on an old JS bundle referencing chunks that no longer exist.

---

## Picking a picker

Three components answer "let the user choose one thing from a set" — pick by set size and
shape, not habit:

| | Set size | Interaction | Reach for it when |
|---|---|---|---|
| **ToggleGroup** | 2-5, always relevant | All options visible at once, one click | Status/mode pickers where seeing every choice up front matters (medication administration status) |
| **Dropdown** (`searchable`) | Up to a couple dozen | Click trigger → optional filter *inside* the open panel → click option | Bounded selects — ratios, day-of-week, sleepover type, small reference lists |
| **SearchableSelect** | Dozens+ | Type-to-filter *in the trigger itself*, full combobox keyboard model | Participant/staff/contact-scale pickers |

Dropdown's `searchable` prop and SearchableSelect look similar but solve different
problems: Dropdown's search box is a filter *inside an already-open button-triggered
panel* (`role="listbox"` behind a `<button>`); SearchableSelect *is* the trigger — a real
`role="combobox"` text input — which is what the WAI-ARIA combobox pattern and platform
autocomplete conventions expect once a list is genuinely large. Migrate a Dropdown
`searchable` picker to SearchableSelect when its backing list is participant/staff/contact
scale; leave it as Dropdown `searchable` for anything smaller.
