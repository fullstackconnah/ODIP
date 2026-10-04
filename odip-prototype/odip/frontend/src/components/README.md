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
- [PageState](#pagestate) (loading, error and not found, in place of a page or a tab)
- [Modal](#modal) / [ConfirmDialog](#confirmdialog)
- [useDialogBehavior](#usedialogbehavior) (`hooks/useDialogBehavior.ts`: the Escape, Tab trap, scroll lock and focus return behind every dialog, and the stack that lets one open over another)
- [SlideOver](#slideover) (the right-hand panel for creating or editing a record)
- [SearchInput](#searchinput)
- [StatusBadge](#statusbadge)
- [Tone system](#tone-system) (`lib/tone.ts`: `TONE`, `STATUS_TONE`, how a status gets its colour)
- [ReadinessNote](#readinessnote) (a quiet, never-blocking "Not ready: …" warning, as a chip or a line)
- [Deadline state](#deadline-state) (`lib/deadline.ts`, `lib/dateOnly.ts`, `lib/credentials.ts`: how close a dated deadline is, and its words)
- [Format helpers](#format-helpers) (`lib/format.ts`: `plural`, `formatRatio`, `formatRelative`, the date-time formatters)
- [Card](#card) / [StatCard](#statcard)
- [PageHeader](#pageheader) (and the opt-in detail variant, `PageHeaderMeta`)
- [BackButton](#backbutton) (the one Back control)
- [FactBar](#factbar) (the default strip and the opt-in glance variant)
- [Tabs](#tabs) and [useTabParam](#usetabparam) (the active tab in the URL)
- [ActionButtons](#actionbuttons)
- [Touch hit areas](#touch-hit-areas) (`TAP_AREA`, `TAP_FLOOR`, `TAP_AREA_LINKS`, `--tap-min`)
- [NoticesRegion](#noticesregion) (`hooks/useNotices.ts`: what became of a row or detail-page action, kept at the top until dismissed)
- [AnnouncementRegion](#announcementregion) (`hooks/useRefocusWhenLost.ts`: a create's done view, audible and with focus kept)
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
  hidden?: boolean                  // the caller's own switch (a column a role cannot see); not a breakpoint
  pin?: 'start' | 'end' | false     // see "The column rule"
  minWidth?: number | string        // narrowest the column is laid out at (md+)
  maxWidth?: number | string        // cap for a plain-string cell (ellipsis, full text in `title`); default 24rem
  wrap?: boolean                    // let the cell wrap (prose); default: rows are exactly --row-h
  editable?: { render: (row: T, onChange: (value: unknown) => void) => ReactNode }
  bulkEditable?: { items: DropdownItem[]; onBulkChange: (selectedIds: string[], value: string) => void }
  className?: string
}
```

**The column rule** (L3-04; DESIGN.md, Tables). A column is never removed at md and up: the old `priority` prop, which hid columns below xl / 2xl / 1792px, is retired
and ignored (a column hidden by breakpoint is data deleted from the page). Cap text instead (`maxWidth`, `CellText`); a table still wider than its box scrolls
sideways inside its own box, and two columns stay put while it does: the first labelled column (an unlabelled tick or avatar column and the select-all checkbox
column are skipped) pins to the start edge, and the column keyed `actions` pins to the end edge. `pin` picks an edge for any column or opts out with `false`.
A pinned cell is filled opaque, with a hairline, only while content is scrolled under it, so a tinted row keeps its tint at rest. Below md the table is cards and
nothing is pinned. `src/test/dataTableColumnRule.test.ts` fails a page that passes `priority`.

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
`onChange: (key: string) => void`, `className`, `ariaLabel?: string`, `disabled?: boolean`.

**States**: each option is selected/unselected. `disabled` locks the whole group, for a
setting the user may read but not change (Provider Settings' "Participant readiness check"
for a user who cannot edit provider settings): every radio is `disabled` (not focusable, not
clickable), the group is `aria-disabled`, and the selected option still reads as selected.
There is no per-option disabled today (add it if a consumer needs it rather than working
around its absence).

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

## PageState

`PageState.tsx` (with `lib/httpStatus.ts`) is what a page, or a tab inside one, shows in place of itself while its record loads, when the load failed, and when there is no such
record. They are three different facts, so there are three states, and none of them is a bare `<div>`.

**Props**: `kind: 'loading' | 'error' | 'not-found'`, `noun` (lower case, singular: "trip", "staff member"; it fills the sentences), `onRetry?` (error), `backTo?` and `backLabel?`
(not found).

| `kind` | Renders | Role |
|---|---|---|
| `loading` | "Loading trip…", muted, centred in a 16rem band | `status` (polite) |
| `error` | a danger `Callout`: "Couldn't load this trip. Check your connection and try again." and, with `onRetry`, a "Try again" button | `alert` (assertive) |
| `not-found` | "Trip not found" and, with `backTo`, a `BackButton` to it | none |

```tsx
const { data: trip, isLoading, isError, error, refetch } = useTrip(id)
if (isLoading) return <PageState kind="loading" noun="trip" />
if (!trip) {
  return isError && !isNotFoundError(error)
    ? <PageState kind="error" noun="trip" onRetry={() => refetch()} />
    : <PageState kind="not-found" noun="trip" backTo="/trips" backLabel="trips" />
}
```

Two rules sit in that snippet. A 404 is the API's answer "no such record" (the detail endpoints return `NotFound` for an unknown id), so `isNotFoundError(error)` sends it to not-found; only a
failure (a 500, a dropped connection) is an error. And the failed branch sits under `!trip`, so a background refetch that fails over data already on screen does not replace the page.

**Accessibility**: loading is a polite `status`, error an `alert`; not found carries a real Back link. No state adds a heading: a screen's one `h1` comes from `PageHeader` (The One Heading Rule).

**When to use**: the early return of a record page or tab (`kind="not-found"` without `backTo` inside a tab, because the page around it is still on screen). **When not to**: a page that keeps its header
and shows skeletons for a region (the dashboard, the portal shift), a list with no rows (`EmptyState`), or a mutation failure (`Callout`).

---

## Modal / ConfirmDialog

`Modal.tsx` is the base dialog shell: focus trap, Escape-to-close, background scroll
lock, focus returns to the trigger on close, `role="dialog"` + `aria-modal` +
`aria-labelledby`. The behaviour is [`useDialogBehavior`](#usedialogbehavior), so a Modal
opened over another layer (a ConfirmDialog over a [SlideOver](#slideover)) answers Escape
alone. Props: `open`, `onClose`, `title`, `size` (`sm`/`md`/`lg`/`xl`), `footer`,
`children`, `className`. The close button is named "Close dialog" and has the `TAP_AREA`
44px hit area on touch (its box stays 28px).

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

## useDialogBehavior

`hooks/useDialogBehavior.ts` is the behaviour every modal layer owes its user, in one hook: **Escape** closes it, **Tab**
stays inside it (and wraps both ways), focus **moves in** on open and **returns** to whatever had it when the layer
opened, and the **page behind does not scroll**. `Modal`, `SlideOver`, `EditTripModal` and the unsaved-changes dialog
(`useUnsavedChangesWarning`) all run on it. It renders nothing and sets no ARIA: the caller marks up the dialog.

```tsx
const ref = useRef<HTMLDivElement>(null)
useDialogBehavior({ open, onClose, containerRef: ref })
return open ? <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>…</div> : null
```

| Option | Default | |
|---|---|---|
| `open` | | The layer is on screen. Everything below starts on `open` and is undone when it goes false (or the component unmounts). |
| `onClose` | | What Escape does. The caller closes the layer; the hook never does. |
| `containerRef` | | The dialog element: the Tab trap's boundary and where focus goes. Give it `tabIndex={-1}`. |
| `closeOnEscape` | `true` | `false` makes the layer ignore Escape and still keep Escape from reaching the layer under it. |
| `lockScroll` | `true` | Counted: the page stays locked until the last layer that asked for it closes. |
| `initialFocusRef` | first focusable | An element in the container. Read when focus moves in, so a ref set in a layout effect works. |
| `returnFocus` | `true` | Give focus back to the opener on close. |

**The stack.** Every open layer registers in a small module-level list in the order it opened, and ONE `keydown`
listener serves all of them. Escape and the Tab trap act on the TOPMOST layer only, so a ConfirmDialog opened from a panel
closes by itself and the panel keeps its place and focus (a dialog hands focus back to the control that opened it, the
Delete button, which is inside the panel). Before the stack each layer listened on `document` on its own and one Escape
closed both. Order is order of opening, not order in the tree.

**Escape that something else used.** An open `Dropdown` or `SearchableSelect` list closes on Escape and calls
`preventDefault()`; the hook ignores an Escape that is already `defaultPrevented`, so the first Escape closes the list
and the second closes the dialog.

**Rules.** Do not use `autoFocus` inside a layer: React focuses that element before the hook runs, so the hook would take it
for the opener and never return focus to the real one; pass `initialFocusRef`. Focus that has strayed outside the layer (a
click on a scrim that does not dismiss) is pulled back in on the next Tab. Hidden inputs and anything in a disabled
`<fieldset>` are skipped when finding the first and last stop.

**Not done: an inert background.** `aria-modal` tells assistive technology to ignore the page behind, and the trap keeps
keyboard focus in, but the background is not `inert`: a layer rendered inline cannot make its own ancestors inert, so it
needs a portal first.

### The nav drawer

`AppLayout`'s drawer runs on the hook. It is the one layer whose element is also something else: below `lg` the `<aside>` IS a drawer,
from `lg` it is the permanent sidebar (a landmark). So the layer is open only while it is a drawer:

```tsx
const isBelowLg = useIsBelowLg()            // hooks/useIsBelowLg.ts: matchMedia('(min-width: 64rem)'), the same switch as `lg:`
const drawerOpen = sidebarOpen && isBelowLg
useDialogBehavior({ open: drawerOpen, onClose: () => setSidebarOpen(false), containerRef: drawerRef })
```

- `role="dialog" aria-modal="true" aria-label="Main menu" tabIndex={-1}` are set only while `drawerOpen`. Closed, or from `lg`, the aside
  is a plain `complementary` landmark.
- A stale `sidebarOpen` after a resize is dropped during render (`if (!isBelowLg && sidebarOpen) setSidebarOpen(false)`), so it can neither
  lock the scroll or trap Tab on a desktop nor reopen the drawer on the way back down.
- Closed below `lg` the aside is `inert`, which takes its links out of the Tab order and the accessibility tree (they were 13 off-screen
  tab stops before the page). Not `visibility: hidden`: it is inherited, every nav item has `transition-all`, and a visibility
  transition starts at `hidden`, so for the first frames after opening each link is still hidden and the `focus()` the hook makes is
  refused. jsdom has no transitions, so only a real browser shows it. `inert` is dropped in the very commit that opens the layer, before
  the hook's effect runs.
- Focus moves onto the first item and comes back to the opener (the header toggle, or the bottom bar's "More") on Escape and after a link is
  followed: `returnFocus` stays on, because the opener is the best place to leave focus once the menu has closed.
- Not done: an `inert` page behind it. The header toggle that opens the drawer sits inside the page region, so inerting that region would
  take focus away from the opener before the hook records it. `aria-modal` and the Tab trap cover it.
- It is not a `SlideOver`: its element is also the permanent sidebar, so it cannot be mounted only while open.

---

## SlideOver

`components/SlideOver.tsx` is the panel docked to the right edge, for creating or editing a record without leaving the list.
It replaced nine hand-rolled copies (`TemplateFormPanel`, `BillableEventFormPanel`, `FundingSourceFormPanel`,
`ServiceBookingFormPanel`, `ExceptionsDrawer`, `PatternSlideOver`, `ShiftSlideOver`, `TenantFormPanel`, `UserFormPanel`), six
of which had no Escape, no focus handling and no dialog role.

```tsx
<SlideOver
  open
  onClose={onClose}
  title={isEdit ? 'Edit pattern' : 'New pattern'}
  dirty={isDirty}
  bodyClassName="flex flex-col gap-[var(--field-gap-y)]"
  footerClassName="flex items-center justify-between gap-3"
  footer={<>…Delete… <div className="flex gap-3">…Cancel, Save…</div></>}
>
  …fields…
</SlideOver>
```

| Prop | |
|---|---|
| `open`, `onClose`, `title` | `title` is the h2 and the dialog's accessible name. |
| `description` | One muted line under the title; the dialog's accessible description. None of the nine uses it yet. |
| `footer` | The sticky strip under the body: the actions. Omit it for a read-only panel (the rostering panels do when `canWrite` is false). |
| `size` | `md` = `max-w-md` (28rem, the default), `lg` = `max-w-lg` (32rem). Full width below that. Keep a panel's width when migrating. |
| `side` | `'right'` is the only edge. (The nav drawer, the one left-hand layer, runs on [useDialogBehavior](#usedialogbehavior) directly.) |
| `dirty` | The form has unsaved edits: Escape, the scrim and the close button then ask "Discard changes?" (**Keep editing** / **Discard**) instead of closing. |
| `beforeClose` | `() => boolean \| Promise<boolean>`; `false` vetoes Escape, the scrim and the close button. Runs before `dirty`. |
| `initialFocusRef` | Where focus lands. Default: the first focusable element, which is the close button. |
| `bodyClassName`, `footerClassName` | Layout classes merged over the defaults (`cn`), e.g. the field gap on the body, or a justify rule on the footer. |

**Markup.** A `z-40` scrim (`bg-black/40`) and a `z-50` panel: `fixed right-0 top-0 w-full max-w-md|lg flex-col overflow-hidden
border-l bg-card shadow-xl`, `role="dialog"` `aria-modal="true"` `aria-labelledby` the title. Header: a `font-display` 16px
title and a `Button variant="ghost" iconOnly` close ("Close panel", 44px hit area on touch). Body: `flex-1 overflow-y-auto`
with `--card-pad` padding, so **the panel scrolls, not your form**: put the `<form>` inside it with no `overflow` of its own, and
submit it from the footer with `type="submit" form="the-form-id"`. Footer: `shrink-0 border-t`, `--card-pad` padding.

**Closing.** A panel closes by the caller setting `open` false, or by one of the three ways the panel closes itself (Escape,
scrim, close button), which go through `beforeClose` and then `dirty`. A successful save calls `onClose` directly and
a footer Cancel is an explicit discard that calls `onClose` directly: neither asks. To make a footer Cancel ask too, it has to
call the panel's own request, which is not exposed; keep Cancel as the explicit way out.

**Dirty.** The panels compute `dirty` from what they already have: react-hook-form's `formState.isDirty` (Template, Billable
event, Funding source, Service booking), or the current values against the values the panel opened with (Shift and Pattern
compare to their first render, because their page keys them on the target; Tenant and User compare to what the open effect
set). A panel that shows a success notice before it auto-closes (Template, Tenant) is not dirty once it has saved. A read-only
panel (`canWrite` false, a claimed billable event) cannot be dirty.

**A dialog over the panel** (the Delete flow) is a `ConfirmDialog` rendered after the `SlideOver`: it is the topmost layer, so
Escape closes only it, focus returns to the Delete button, and the page stays scroll-locked until the panel closes too. See
[useDialogBehavior](#usedialogbehavior).

**Layers and touch.** Scrim z-40, panel z-50: a Modal opened over it is also z-50 and later in the DOM, so it paints above. Below
`lg` the fixed bottom nav (`AppLayout`, z-50, `--mobile-nav-h` tall) is also z-50 and later in the DOM than the page, so a full-height
panel had its footer (Cancel, Save, Delete) underneath it and unreachable; the panel stops above the nav there
(`h-[calc(100%-var(--mobile-nav-h))]`, full height from `lg`), as the wizard footer does. At `lg` and up the desktop sidebar is z-50 under a
z-40 scrim, so it is neither dimmed nor blocked; that is unchanged.

**Motion.** The panel slides in from the right and the scrim fades in over 200ms, only under
`@media (prefers-reduced-motion: no-preference)` (`index.css`); with the preference set both just appear. There is no exit animation.

**When to use it.** Create or edit one record from a list, where the list should stay in view behind. A short confirm or a
small form is a `Modal`; anything with its own URL or several steps is a page.

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

`StatusBadge.tsx` — a small coloured pill for an enum-like status value. Props: `status` (matched case/whitespace-insensitively against
`STATUS_TONE`, the tone map in `lib/tone.ts`, which spans booking, severity and priority, claims, QSC, plan-type and trip vocabularies), `label`
(override the displayed text without changing the colour lookup), `tone` (colour the badge with this tone whatever the status word is), `colorMap`
(per-call overrides for one domain), `pulse`, `className`, `size`. Every status the API sends has a row, and an unrecognised status falls back to the NEUTRAL tone
(never the amber "awaiting" pair: an unknown word must not claim attention) rather than an unstyled default. `size` is `'sm'` (default: the 12px pill every table uses) or `'md'` (13px semibold, 24px tall), the one opt-in
step up, for the status that leads a detail header's meta row; the colour is the same at both.

```tsx
<StatusBadge status={claim.status} />                          {/* looked up in STATUS_TONE */}
<StatusBadge tone="danger" label="Refused" />                  {/* a tone and a word, no status */}
<StatusBadge status={leave.status} colorMap={LEAVE_STATUS_COLORS} />  {/* { cancelled: 'neutral', ... }: values are tones */}
```

`colorMap` values are a `Tone` (`'danger'`), or, for back-compat, a ready-made class string (the contact role chip still passes one). A `colorMap` is for
a domain whose word means something else (a cancelled leave request is over, not a failure), not for a new colour.

**When to use**: rendering any of the app's status/severity/priority/plan-type enums. Check `STATUS_TONE` before adding a one-off inline badge: a new status
value is usually a one-line addition there, not a reason to bypass this component. The colour never carries the meaning alone: the status word is always printed.

---

## Tone system

`lib/tone.ts` (JSX-free, so any file can import it) is the one table that decides what each status colour means. A **tone** is one of
`'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accessible'`, and each maps to colours already in the palette: no status gets a colour of its own
(DESIGN.md, The Tone Rule). `TONE[tone]` has three class strings:

- `solid`: a container fill and its on-container text, as one pair. A badge, a chip, a glance cell, an attention tile.
- `soft`: a wash for something larger than a pill (a tile, a row). Pair it with `ink`.
- `ink`: text only, for a figure or a line on the card or on the `soft` wash.

| Need | Use |
|---|---|
| The colour of a status word, priority or plan type | `STATUS_TONE[key]` (add the word there), or `statusClass(status)` for the pill classes |
| A badge | `<StatusBadge status=... />`, or `<StatusBadge tone=... label=... />` |
| A pill you build yourself | `` `${TONE.warning.solid} rounded-full px-2 py-0.5 text-xs` `` |
| A tinted tile on a `Card` | `CARD_WASH[tone]` (the soft wash with the important modifier, since `Card` paints its own fill) and `TONE[tone].ink` |
| A chip on a tinted segment | `ON_TINT[tone]` (the tone's text on the card fill) |
| Which tones tint a segment or tile | `attentionOf(tone)`: warning tints the warning container, danger the error container, every other tone is quiet |
| The older tone words | `toneOf('error' \| 'positive' \| 'negative')`: Callout `error` is `danger`, FactChip `positive` is `success` and `negative` is `danger` |

Adding a status: put it in `STATUS_TONE` (the key is the status lower-cased with no spaces); `lib/statusToneCoverage.test.ts` fails for a status value or a
`*Status` enum the API can send that has no row. In progress is `info` (not the accessibility pink). Do not add a colour, a class string or a hex; if the word means
something else in one domain, give that domain a `colorMap` of tones. **Plan types and other categories are `info`, `accessible` or `neutral`, never `warning`
or `danger`.** `--color-warning` is a fill, border and ring colour, never text or an icon (2.15:1 on the card): warning text is `TONE.warning.ink`.

`src/test/toneContrast.test.ts` reads `src/index.css` and holds every solid pair and every soft wash with its ink to WCAG AA (4.5:1); it also ratchets down
text still written in `--color-warning`. `lib/tone.test.ts` pins the class strings and the mappings (a trip status, a task priority and a plan type each have one).

---

## ReadinessNote

`ReadinessNote.tsx`: a quiet note that a participant is not fully ready yet: **"Not ready: Intake not complete · No signed service agreement"**. An
organisation chooses how strictly it gates such participants (Provider Settings, "Participant readiness check"). In **Warn** (the default) the server lets
staff roster, book and activate a participant who is not fully ready and reports what is missing as `readinessIssues` (a `string[]`, omitted when nothing is
missing); in **Enforce** it refuses with a 400 instead. This is how the Warn-mode gaps show.

**Props**: `issues?: readonly string[] | null` (the server's words, shown verbatim), `variant?: 'chip' | 'line'` (default `'line'`), `className?`.

| Variant | Looks like | Where it goes |
|---|---|---|
| `chip` | `TONE.warning.solid` pill (StatusBadge's 12px shape), one 20px line, `min-w-0 max-w-full`; the text `truncate`s with an ellipsis, and is all-or-nothing: with under about 3rem of room it wraps out of the clipped pill and the icon alone is centred (never a fragment of a letter) | A table row's name block (the roster board's participant row), a detail header's meta row beside the status badge (participant detail) |
| `line` | `TONE.warning.ink` text on the card, no wash, wraps to at most three lines (`line-clamp-3`), `role="status"` (announced politely when it appears) | Under a field in a form: the shift panel's Participant field, the Add Booking modal's participant picker |

Both carry the whole text in `title`, so a truncated chip can still be read, and an `AlertTriangle` that is `aria-hidden` (the words are the message; colour is
never the only cue).

**Informational, never blocks.** It renders nothing when `issues` is empty, `null` or `undefined`, so a ready participant looks exactly as before. It is not an
alert (no `role="alert"`), it never disables or hides a control, and nothing reads the issues to gate a Save: the server decides whether a write is allowed.
It uses the warning tone only: no new colour, and warning text is `TONE.warning.ink`, never `--color-warning`. `className` wins over the base classes (they go
through `cn`), which is how the board row squares the chip up to its neighbours and has it take only the room the name leaves:
`h-5 min-w-6 max-w-max flex-1 rounded-sm px-1.5`.

```tsx
<ReadinessNote issues={participant.readinessIssues} />                          {/* a line under a picker */}
<ReadinessNote issues={participant.readinessIssues} variant="chip" />          {/* a chip beside a status badge */}
```

**When not to use**: a state that must stop the user or needs action now. That is an error `Callout` (an Enforce-mode refusal shows the server's own message,
not a ReadinessNote). A dated deadline is `StatusBadge` with `deadlineLabel`, not this.

---

## Deadline state

A dated deadline (a credential's expiry, a review due date) is one state with one set of words. Three JSX-free modules in `lib/`:

- `lib/dateOnly.ts`: date-only math. A `DateOnly` from the API ("2026-08-14") names a calendar day, so a day is a whole number (`parseDateOnly`,
  `calendarDaysUntil(target, today)`), never a gap between two local midnights in milliseconds. That gap is 9.96 days where a day is 23 hours long (Sydney,
  4 Oct 2026), which is how "10 days from now" used to floor to 9. `today` is a `Date` (its local calendar day) or a "YYYY-MM-DD" string, and defaults to now.
- `lib/deadline.ts`: `deadlineState(iso, { warnDays, today })` returns `{ status: 'overdue' | 'today' | 'soon' | 'ok' | 'none', days }`;
  `deadlineLabel(state, 'long' | 'compact')` the words; `DEADLINE_TONE[status]` the tone (overdue `danger`, today and soon `warning`, ok `success`, none `neutral`);
  `isDeadlineIssue(state)` is true for everything but `ok`.
- `lib/credentials.ts`: which staff credentials apply and what state each is in (`staffCredentials(staff, { warnDays })`, `credentialIssueCount`). One rule for
  the Qualifications list, the staff Credentials tab and the Dashboard's Qualification Issues count: a flagged credential applies with or without a date, worker
  screening (no flag) applies only once it has an expiry date.

```tsx
const state = deadlineState(row.expiryDate, { warnDays })           // { status: 'soon', days: 10 }
<StatusBadge tone={DEADLINE_TONE[state.status]} label={deadlineLabel(state)} />   // Expires in 10 days
```

| State | `long` | `compact` | Tone |
|---|---|---|---|
| `overdue` | Expired | Expired | `danger` |
| `today` | Expires today | Expires today | `warning` |
| `soon` | Expires in 12 days | 12 days | `warning` |
| `ok` | Current | Current | `success` |
| `none` | No date set | No date set | `neutral` |

Use `long` unless the cell has no room for "Expires in": the staff Credentials tab is `long`, the Qualifications table (a wrapping card per row on a phone) is `compact`. Tests inject `today` and set the zone they need (`src/test/timeZone.ts`), including the daylight-saving
days of Sydney, Lord Howe, Auckland, New York and London.

---

## Format helpers

`lib/format.ts` (JSX-free) is how the app spells a count, a ratio and a relative time. Nothing it builds for a test to pin uses `Intl` (en-AU prints September as
"Sep" or "Sept" depending on the ICU build, the rule `lib/dateRange.ts` follows), and nothing reads the clock unless you leave `now` out.

| Need | Use | Result |
|---|---|---|
| A count and its noun | `plural(n, 'day')`, `plural(n, 'person', 'people')` | "1 day", "2 days", "0 days", "1 person", "2 people" |
| An "x / y" figure | `formatRatio(a, b)` (`glanceRatio` is the earlier name) | "12 / 14" |
| How long ago, in a cell or chip | `formatRelative(iso, { style: 'compact' })` | Just now, 5m ago, 3h ago, 62d ago, in 2d |
| How long ago, in running text | `formatRelative(iso, { style: 'long' })` | just now, 5 min ago, 3 hrs ago, 2 months ago |
| A bare coarse age in an "Age" column | `formatAge(iso)` | "<1h", "5h", "2d" |
| A date and time, en-AU | `formatDateTimeAu(iso)` | "27/03/2026, 01:45 pm" |
| A shift note's timestamp | `formatNoteTimestamp(iso)` | "8 Sept 2026, 7:30 pm" |

`formatRelative` rounds down to one unit. `null`, `undefined` and '' read "Never" (compact) or "never" (long), an unparseable value reads "—", and a date-only string
("2026-09-30", a due date) counts calendar days against today (it reads "Today" on the day). Pass a `Date` you have already parsed (`parseApiDate`, for a UTC
timestamp the server sent without a zone). A timestamp up to 5 minutes ahead of the viewer's clock reads "Just now" (clock skew), not "in 2m". Compact shows days at any size ("62d ago": an overdue figure wants the exact count); long switches to months from 30 days.

Do not write `` `${n} day${n === 1 ? '' : 's'}` `` or `` `${a}/${b}` `` by hand: the first drifts at 0 and in nouns with an irregular plural, the second against the
design rule that a ratio has a space each side of the slash.

---

## Card / StatCard

`Card.tsx` is the generic bordered/padded content container (`title`, `action`,
`compact`, `children`). `StatCard.tsx` is `Card` pre-wired for a single label/value KPI
tile. **When to use StatCard vs a hand-rolled metric block**: any single-number summary
stat — keeps the "hero-metric template" tendency the design guardrails ban confined to
one real, reused component instead of copy-pasted markup per page.

`StatCard` takes `label`, `value`, `to`, `tone`, `caption`, `className`, `variant`, `detail`, `action`, `loading` and `error`. `variant` is `'default'` (the default: the small KPI
tile, a 12px label over a `text-xl` value, unchanged and still what Vehicles uses) or `'attention'`, the opt-in tile of the dashboard's **attention
band** (DESIGN.md "Attention band"): a display-step tabular figure (`text-display`) over a 13px medium label, in its own bordered `--radius-md` tile
with an 8px side inset (the compact card's). Given an `action` it is the band's **tall tile** instead (below); the compact tile is what an item with no data shows.

- `tone`: `'danger'` fills the tile with the error-container and `'warning'` with the warning-container, and the figure and the label take the matching
  on-container colour. Those are the glance strip's own tints: both take `TONE.warning.solid` and `TONE.danger.solid` from `lib/tone.ts` (`attentionOf` decides
  which tones tint). Any other tone, or none, is quiet: the card fill, with
  the figure and the label in `muted-foreground`. The rule is "non-zero is loud, zero is quiet", so pass `tone={count > 0 ? 'danger' : undefined}`.
- Default tile: every tone (`neutral`, `info`, `success`, `warning`, `danger`) sets the tone's soft wash (`CARD_WASH`, from `lib/tone.ts`) and the figure takes the tone's ink;
  a tile with no tone has no wash and keeps the olive figure. Unchanged by the tone system.
- `caption`: the all-clear state ("All clear"). On a quiet tile it is the lime positive chip beside the figure (the glance strip's all-clear); on a tinted
  tile it is plain text, because a lime chip never sits on a tint.
- `to`: the whole tile is a `Link` with a focus ring and a `--tap-min` floor, and its accessible name is its content ("Qualification Issues 5"). A tile
  without `to` is a named group ("Overdue 2"), so the number and the label are always in the name. A tinted tile carries `data-attention="error" | "warning"`,
  as a glance cell does.
- `action` (`{ label, to }`, attention only) and `detail` (a string): a count somebody has to act on. `action` makes the **tall tile**: stacked, the display-step figure, the label (14px, 600), the `detail` line
  (13px: one honest line saying what the count means) and a link to where it is fixed (`action.label`, `action.to`, a chevron), padded `--section-gap` on every side, so it is the biggest colour field on the
  page. The fill and the on-container ink are the tone's, as above, and the line and the link take that ink, never grey. The tile is a named group ("Overdue 2"), not a link, so leave `to` off; the link's
  `::after` stretches over the whole tile, so the tile is one big target (and the focus ring surrounds it) while the page keeps ONE link with a name of its own ("Open overdue tasks"), and its own box keeps a
  `--tap-min` floor. It has no caption (`detail` takes that job), and it is the compact tile whatever it is given while `loading` or `error` is set. The default variant ignores `detail` and `action`.
- `loading` and `error` (attention only; the default tile ignores them): the figure is an en dash in the muted style, never tinted, with no caption, and a
  screen-reader-only text replaces the number: "Loading" (and the tile is `aria-busy`) while the request is in flight, "Couldn't load" (not busy) after it
  failed; `loading` wins if both are set. Use them for a figure whose own request has no data yet, so it is never read as a definite zero or an "All clear".

Lay the tiles out with `pages/dashboard/AttentionBand.tsx`, which makes a tall tile of each item above zero, names the items at zero in one "All clear" row on Pale Sprout, and shows one Pale Sprout field when every
item is at zero; its rows are dealt by `pages/dashboard/bandLayout.ts` (balanced, 1 to 5 tiles a row by the band's own width). The compact tile's source order is label, figure, caption, like a glance cell, so a screen reader
hears "Overdue, 2"; the tall tile reads its figure, label, line and link in that order.

---

## PageHeader

`PageHeader.tsx` — the title/subtitle/primary-action row every page starts with, plus an
optional row of filter/toolbar children below it. Props: `title`, `titleNote`, `documentTitle`, `subtitle`, `action`,
`children`, `variant`.

`variant` is `'default'` (the default: the 20px title, exactly as every page renders it) or `'detail'`, the
opt-in **detail header** for a record's own page (DESIGN.md "Detail header pattern"). `detail` sets the title at the
display step (`text-display`: 28px, Plus Jakarta Sans 800), groups it with the subtitle in one block so the meta row sits
under the title instead of a section-gap away, and always renders the subtitle below the title. It is still the page's one
`h1`, and the actions wrap under the title below `md` exactly as in the default. Pair it with `PageHeaderMeta`:

```tsx
<PageHeader
  variant="detail"
  title={trip.tripName}
  subtitle={
    <PageHeaderMeta>
      <StatusBadge status={trip.status} size="md" />
      {trip.destination}                       {/* undefined / '' / false are dropped, with their separator */}
      {trip.tripCode && <span className="font-mono">{trip.tripCode}</span>}
      {formatDateRange(trip.startDate, trip.endDate)}
    </PageHeaderMeta>
  }
  action={...}
/>
```

`PageHeaderMeta` joins its children with `aria-hidden` middots. Falsy children are skipped BEFORE the separators are placed, so a
missing fact never leaves a dangling dot; each separator belongs to the item before it, so a wrapped line can end with a dot but never
begins with one. `titleNote` (a node) sets a second phrase inside the same `h1`, in the muted ink at the same size (the dashboard's date after its greeting, as a `<time>`); the two parts wrap as units. `documentTitle`
names the tab and the history when the `h1` says something else (it defaults to `title`): the dashboard's `h1` is a greeting that changes with the hour, and the tab stays "Management Dashboard".
**When not to**: a list or hub page (keep the default), or any page that does not lead with a status and countable facts.
The trip detail page opts in with a status-led meta row, and the dashboard opts in for its title with a meta row of plain counts and no status
("3 upcoming trips · 5 active participants · 4 outstanding tasks", each noun agreeing with its count, in `tabular-nums`); the other detail pages adopt it next.

---

## BackButton

`BackButton.tsx` is the one Back control: the first action in a detail header, secondary, and it names its destination.

**Props**: `to` (a real route) **or** `onBack` (the in-page form, below), `label` (lower-case noun for where it goes: `label="staff"` names it "Back to staff"), `variant?: 'button' | 'icon' | 'link'`
(default `button`), `history?: boolean` (default `true`), `className?` (spacing only: `mt-1`, `py-3`), `data-testid?`.

| Variant | Look | Use it for |
|---|---|---|
| `button` | secondary `Button`, an arrow and "Back", `--control-h` tall | a detail page's action cluster (trip, staff, accommodation, incident, onboarding) |
| `icon` | ghost icon-only `Button`, 24px on a mouse and a 44px square under a coarse pointer; its tooltip carries the name | a form or wizard header with the title beside it (participant, the intake and profile wizards, enquiry, medication, agreement draft, caregiver review) |
| `link` | primary-coloured text link with an arrow, a `--tap-min` floor, a keyboard-only focus ring | a page with no action cluster (the portal, claim batch detail) |

**Accessibility**: always a real `<a href>` (open in a new tab and copy-link work); it is never a `<button>` that navigates. The visible text is "Back" and the accessible name is "Back to {label}" (it contains
the visible text). 44px under a coarse pointer in every variant, visible focus ring, first in the tab order of its header.

**History.** With `history` on, the hook `useBackTarget(to)` runs inside the component: when the user arrived from another in-app screen, Back returns there and `to` is only the fallback for a deep link or a
reload; the name then says where it really goes ("Back to Dashboard", or "Go back" for a screen with no known name). Because the hook lives in the component, a page can render a BackButton after an early return
without a hook below it (the class of bug #155 fixed on the onboarding page). `history={false}` pins Back to `to`: use it on a record page reached from many places where "up to the list" is the meaning, and
wherever the previous screen can be a form the user has just saved. A change of query on the same path (a tab or a filter written with `replace`) is the same screen, never a predecessor.

**In-page back.** `onBack` (and no `to`) renders a real `<button>` for a view that is switched in place and has no route to link to (the tenant detail pane inside Settings). Prefer giving the view a URL.

```tsx
<BackButton to="/staff" label="staff" history={false} />                             {/* header action cluster */}
<BackButton to={`/participants/${id}`} label="participant" variant="icon" className="mt-1" />   {/* beside a title */}
<BackButton to="/portal" label="my shifts" variant="link" history={false} />
```

---

## FactBar

`FactBar.tsx` — a read-only strip of `label / value [badge]` segments for a detail page. Props: `segments`
(`{ label, value, badge?, icon?, attention? }[]`), `className`, `variant`.

- `variant="default"` (the default) is the 44px-tall strip: 12px label over a 14px medium value, 1px rules between segments,
  wrapping onto a new line when narrow. Every page that uses it today renders it unchanged.
- `variant="glance"` is the opt-in detail-header form. Cells share the width equally; each shows the value as a **display-step
  tabular figure** (`text-display`), the state chip beside it, and the icon and a 13px label beneath (source order stays label,
  value, badge, so a screen reader hears "Outstanding Tasks, 2, Action Needed"). It is a 2×2 grid below `md` and one row from there;
  a chip that does not fit wraps under its figure. Keep figures short (a count, a ratio, a short amount); anything longer belongs in a `FactList`.
- `attention` (glance only; the default bar ignores it): `'warning'` fills the segment with the warning-container, `'error'` with the
  error-container, and the figure, label and icon take the matching on-container colour. Leave it unset for a quiet segment.
  **Never set `attention` and the chip separately**: use `glanceState`.

```tsx
import { FactBar, type FactBarSegment } from '@/components/FactBar'
import { glanceState } from '@/components/glanceState'
import { formatRatio } from '@/lib/format'

const segments: FactBarSegment[] = [
  { label: 'Outstanding Tasks', value: 2, icon, ...glanceState('negative', 'Action Needed') },  // tinted (error-container)
  { label: 'Insurance', value: formatRatio(5, 5), icon, ...glanceState('positive', 'Covered') }, // quiet, "5 / 5"
]
<FactBar variant="glance" segments={segments} />
```

**Spell every ratio with `formatRatio(x, y)`** (`lib/format.ts`; `glanceRatio` is its earlier name), which returns `"x / y"` (a space each side of the slash). At display size a hand-written `` `${a}/${b}` ``
beside `"12 / 10"` is obvious, and one shared formatter is what stops two figures in a strip, or on two pages, drifting apart.

`glanceState(tone, label)` returns `{ badge, attention }` from ONE tone (`'positive' | 'warning' | 'negative' | 'neutral'`, or the tone words `'success'` and
`'danger'`, which mean `'positive'` and `'negative'`; see the Tone system), so the fill can never disagree with its chip: `warning` tints warning, `negative` tints error, `positive` and `neutral` stay quiet. On a tint the chip (`FactChip`) becomes a
card-white pill that keeps the tone's text colour, so it does not vanish into its own fill. `attentionForTone` is the same mapping on its own. These live in
`glanceState.tsx`, not `FactBar.tsx`, because react-refresh wants a component file to export only components.

The glance strip is the second reusable home of the "hero-metric" shape (after `StatCard`), so a page that needs big figures uses it
instead of copying markup. It is a single ruled strip of real operational counts whose tint means a state, not a grid of cards. Only the trip
detail page opts in today; the other detail pages adopt it next.

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

`overflow` (optional, `'wrap'` by default): `overflow="scroll"` keeps the strip to ONE row that scrolls sideways at EVERY width, md and up included (a thin scrollbar from md, the
native hidden one below it), instead of wrapping from md up. Use it for a strip too long to fit one row at the widest layout, where wrapping leaves the last tab alone on a second row:
Settings, with its ten tabs. The active tab (including one named by `?tab=`) is scrolled into view either way, arrow-key navigation is unchanged, and `'wrap'` renders exactly what it did before.

> When a test previously did `getByRole('button', { name: <tab> })`, it is now
> `getByRole('tab', { name: <tab> })` — the role change is the accessibility fix, not a
> cosmetic one.

---

## useTabParam

`hooks/useTabParam.ts` keeps a page's active tab in the URL as `?tab=`, so a reload, a bookmark and a shared link land on the same tab. The URL is the only source of truth: there is no copy in component
state, so a link to `?tab=bookings` clicked while the page is open switches it too.

```tsx
const TAB_KEYS: Tab[] = ['overview', 'bookings', 'history']
const [tab, setTab] = useTabParam(TAB_KEYS, 'overview')
<Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Trip sections" />
```

`tab` is the key in the URL when it is one of `keys`, else `defaultKey`; `setTab(key)` ignores a key that is not in the list. It writes with `setSearchParams(prev => …, { replace: true })`, so switching tabs
does not stack history entries, it keeps every other query param, and it deletes `tab` when the key is the default, so the default tab has the clean URL. Used by the trip, participant, staff and Participants hub pages.

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

## NoticesRegion

`components/NoticesRegion.tsx` with `hooks/useNotices.ts` says what became of an action on a row or on a detail page (a set-password email sent, or not) at the place the person acted, and keeps saying it
until they dismiss it. The notices are ordinary content, so they add no layer to the z-index table, and nothing floats over the next panel's footer.

```tsx
const { notices, notify, dismiss } = useNotices()   // hold it ABOVE anything that unmounts: SettingsPage holds the Users tab's, so a tab switch keeps them
<NoticesRegion notices={notices} onDismiss={dismiss} focusAfterDismiss={focusRowAction} className="empty:mb-0" />   // above the table
notify('danger', person.fullName, message, person.id)   // title: who it is about; tone: 'success' | 'danger'; subject: their stable key (optional)
```

- **One persistent live region.** It is `role="status"` (polite), mounted before the first message and empty while idle; what is put into it is announced. A live region created already holding its text
  is announced unreliably, so only its content comes and goes. Each notice is a `Callout` with `announce={false}` (no role or `aria-live` of its own), so nothing is announced twice.
- **Rules.** Newest first. Only *successes* are capped (`MAX_SUCCESSES`, 3): over the cap the oldest successes go, and a new success is always let in. An error is never evicted to make room; it stays until it is dismissed or until something newer
  about the same person (the notice's `subject`) supersedes it: a success (the problem is over) or another error (retries do not pile up identical failures). A success never removes another person's error, and a notice with no `subject` replaces nothing.
  Each notice names the person, its text breaks (`break-words`), and Dismiss is a `Button iconOnly` named for them. The region announces only what is added (`aria-atomic="false"`, `aria-relevant="additions"`), and Dismiss moves focus to the next notice's
  Dismiss button, or when none is left to `focusAfterDismiss(dismissed)`: the control that raised it, found from the `subject`.
- Collapse the empty region with an `empty:` class that cancels the gap around it (`empty:mb-0` in a `space-y` stack, `empty:-mt-[var(--section-gap)]` in a flex column with a `gap`).
- **The control that raises a notice** is a `RowActions` cluster of `Button variant="ghost" size="sm" iconOnly` (a detail page uses a plain `Button`), named for the person it acts on ("Send set-password email to Ann One"). While its action is under way
  it is `aria-disabled` with a guard in the handler, never `disabled`: disabling the button that was just activated can drop keyboard focus in some browsers. `Button` dims only on `disabled`, so add `aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`.
- **What it reports today** is only the set-password email (`lib/signInEmail.ts` words it). That flow exists only while people sign in with an email and a password: the SSO plan (`docs/odip-changes-todo.md`, "Harden the token exchange") disables
  that provider and retires the emails, the two sign-in-account routes and the temporary-password option with it. The region and the hook are generic and stay.
- **When not to use**: the result of a CREATE belongs in the panel's own done state (a `SignInEmailOutcome` Callout and a Done button, as in `UserFormPanel`), which stays open until the person closes it; a failure
  next to a field is an inline error.
---

## AnnouncementRegion

`components/AnnouncementRegion.tsx` with `hooks/useRefocusWhenLost.ts` makes a create's DONE view usable without sight: a form swapped in place for its outcome (`UserFormPanel`, `TenantFormPanel`, `StaffCreatePage`).
The focused Create button unmounts in that swap, so focus falls to the top of the page and a Callout that appears already holding its text is announced unreliably.

```tsx
const doneLine = useRef<HTMLParagraphElement>(null)
useRefocusWhenLost(doneLine, done)                 // focus the done line after each change, but only if focus was lost
<AnnouncementRegion message={announcement} />      // FIRST in the content, in the form view AND the done view, so React keeps the same node
<p ref={doneLine} tabIndex={-1} className="... focus:outline-none">{name} was created.</p>
<SignInEmailOutcome ... announce={false} />        // the visible Callout does not announce itself as well
```

- **One sentence, two places.** The announcement and the visible text come from the same function (`describeEmailOutcome`, `describeTypedPassword`, `TENANT_FIRST_USER_ACCOUNT_FAILED` in `lib/signInEmail.ts`), so they cannot drift apart.
- **Focus only when lost.** `useRefocusWhenLost` moves focus after the swap, and again when a retry removes the button that had it, but leaves it alone when a control that still exists holds it (a Send again that failed and is still there).
- **Sends in a done view are `aria-disabled` while they send**, with a guard in the handler, like the table's.

## ErrorBoundary

`ErrorBoundary.tsx` — app-shell-level React error boundary (class component; React has no
hook equivalent). Catches render errors, shows a "Something went wrong" fallback (or a
custom `fallback`) with a retry button, and specifically detects stale-chunk errors after
a deploy (`Failed to fetch dynamically imported module`, etc.) to force a one-time reload
so users aren't stuck on an old JS bundle referencing chunks that no longer exist.

Two boundaries run in the app. The one in `App.tsx` wraps the whole shell, as a last resort for a crash in the shell itself. The one in
`AppLayout` wraps the `<Outlet/>` with `inline` and `resetKey={pathname}`, so a page that throws takes down only the page area: the
sidebar, the header and the bottom bar stay, and following a nav link away clears the error. `inline` fills the area the boundary sits in
instead of the viewport (`min-h-screen`); `resetKey` clears a caught error when it changes, without remounting a healthy page. A page that
is still loading suspends inside the shell too (a `<Suspense>` in `AppLayout`), so a lazy chunk never replaces the nav with "Loading...".

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
