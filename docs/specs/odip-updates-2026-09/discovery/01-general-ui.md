# Discovery: General UI Components (Dropdowns + Tables + Preferences)

Scope: `odip-prototype/odip/frontend` and `odip-prototype/odip/backend`. Excludes `bin/`, `obj/`,
`node_modules/`, `_to_delete/`, `odip-prototype.zip`, `docs/superpowers/`.

---

## TOPIC 1 — Dropdown / Select Audit

### 1.1 Existing stylised dropdown components

Two sibling components, both in `frontend/src/components/`, sharing the same `DropdownItem` type
and the same labelling/FormField contract. They are drop-in swaps for each other under a
`FormField`.

#### `Dropdown` — `frontend/src/components/Dropdown.tsx`

Exported: `Dropdown` (component), `DropdownItem` (type). Custom listbox built with a portal
(`createPortal` to `document.body`), full roving-focus keyboard handling (Arrow/Home/End/Enter/
Escape/Tab), WAI-ARIA `listbox`/`option` roles, and viewport-aware flip positioning (opens
upward if insufficient space below).

Verbatim prop type (`Dropdown.tsx:6-46`):
```ts
export type DropdownItem = {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  disabled?: boolean
}

type DropdownProps = {
  variant: 'pill' | 'form' | 'menu' | 'icon'
  items: DropdownItem[]

  // Value control — pill and form variants
  value?: string
  onChange?: (value: string) => void
  // Menu variant: fires on item selection, no tracked value
  onSelect?: (value: string) => void
  // Form variant: forward field.onBlur from RHF Controller
  onBlur?: () => void

  // Trigger appearance
  label?: string            // button text (menu), placeholder text (form)
  icon?: ReactNode          // leading icon on trigger (menu variant)
  colorClass?: string       // Tailwind color classes for pill trigger background
  disabled?: boolean        // caller controls — not auto-applied on empty items
  loading?: boolean

  // Panel alignment — default varies by variant: pill='right', form='left', menu='right'
  align?: 'left' | 'right'
  searchable?: boolean

  // Labelling — lets a wrapping component (e.g. FormField) associate an external <label>
  // with the trigger button, since the button itself carries no visible label text.
  // Not applied to the 'icon' variant, which labels itself via `label`/aria-label instead.
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}
```

Feature matrix:
- **Search**: `searchable` prop — adds an `<input>` inside the popup that client-filters `items`
  by label substring (`Dropdown.tsx:160-162,295-307`). This is a basic in-panel filter, distinct
  from `SearchableSelect`'s combobox-input pattern.
- **Multi-select**: not supported — `value`/`onChange` are single-value only.
- **Grouping**: not supported — flat `items` array, no group/section concept.
- **Disabled**: per-item via `DropdownItem.disabled` (renders dimmed, unclickable, skipped by
  keyboard nav), and whole-component via `disabled` prop.
- **Placeholder**: `label` prop doubles as placeholder text for the `form` variant when no value
  is selected (`'Select…'` default, `Dropdown.tsx:404-406`).
- **Error state**: no visual error styling itself — relies on the wrapping `FormField` to pass
  `aria-invalid`/`aria-describedby` through the labelling prop contract; `Dropdown` does not
  render a border/color change for `aria-invalid` on its own.
- **Option rendering**: each option row renders `icon` (optional, left), `label` (bold if a
  `description` is present), and `description` (small muted text underneath) —
  `Dropdown.tsx:339-345`.
- **Variants**: `pill` (compact rounded filter chip, used e.g. for column bulk-edit headers),
  `form` (full-width trigger styled like a form input), `menu` (large CTA-style button, no
  tracked value, fires `onSelect`), `icon` (icon-only kebab/action trigger).

#### `SearchableSelect` — `frontend/src/components/SearchableSelect.tsx`

Exported: `SearchableSelect` (component), `SearchableSelectItem` (type alias of `DropdownItem`,
re-exported "so callers don't have to reach into Dropdown for a type that's really shared
vocabulary"). A WAI-ARIA 1.2 "combobox with list autocomplete" pattern — a real `<input>` carries
`role="combobox"`, and a virtual cursor is moved via `aria-activedescendant` instead of moving DOM
focus into the popup.

Verbatim prop type (`SearchableSelect.tsx:12-38`):
```ts
export type SearchableSelectProps = {
  items: SearchableSelectItem[]
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
  noMatchMessage?: string
  className?: string

  // Labelling — lets a wrapping component (e.g. FormField) associate an external <label>
  // with the input, matching Dropdown's labelling contract exactly.
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}
```

Feature matrix:
- **Search**: always-on — this component *is* the searchable/typeahead variant; opening it clears
  the input to a blank query so the full list is browsable, then narrows on typing
  (`SearchableSelect.tsx:89-92`).
- **Multi-select**: not supported — single `value: string`.
- **Grouping**: not supported.
- **Disabled**: per-item (`item.disabled`, dimmed/skipped) and whole-component `disabled` prop.
- **Placeholder**: `placeholder` prop, default `'Search…'`.
- **Error state**: same as `Dropdown` — no self-styling, just forwards `aria-invalid`/
  `aria-describedby` for a wrapping `FormField` to have set.
- **Loading**: `loading` prop shows a spinner in the trigger and a "Loading options…" popup row
  while keeping the input editable.
- **Option rendering**: identical shape to `Dropdown` — icon, bold label if `description` set,
  muted description line underneath.

Both components' 44px-min-height option rows and shared `DropdownItem` shape are called out in
`SearchableSelect.tsx`'s docblock as intentional so the two are interchangeable under `FormField`.

### 1.2 Raw native `<select>` inventory

**Total: 49 occurrences of `<select` under `frontend/src`** — 46 in production `.tsx` files, 3 in
a single test file (`lib/conditionalFields.test.tsx`, testing a generic form-registration helper,
not app UI). Grouped by page/feature area below (file:line — what it selects).

#### Incidents
- `pages/IncidentCreatePage.tsx:407` — Service Type (Trip/other)
- `pages/IncidentCreatePage.tsx:416` — Trip (conditional on Service Type = Trip)
- `pages/IncidentCreatePage.tsx:426` — Incident Type (Injury, etc.)
- `pages/IncidentCreatePage.tsx:448` — Severity (Low/etc.)
- `pages/IncidentCreatePage.tsx:643` — Status (Draft/etc., review section)
- `pages/IncidentCreatePage.tsx:654` — QSC Reporting Status
- `pages/IncidentsPage.tsx:89` — Filter by status (list toolbar)
- `pages/IncidentsPage.tsx:102` — Filter by severity (list toolbar)

#### Participants (`pages/ParticipantCreatePage.tsx` — 12 occurrences)
- `:2111` — Gender
- `:2178` — Address State
- `:2200` — Living Arrangement
- `:2271` — Funding Source (has custom `onChange` handler for Other-switch guard)
- `:2740` — Overnight Support
- `:2749` — Overnight Ratio (conditional)
- `:2816` — Ambulant Status
- `:2825` — Falls Risk Rating
- `:2834` — Level of Personal Care
- `:2905` — Primary Diagnosis
- `:3149` — Memory (cognitive)
- `:3165` — Behaviour Risk Rating
- `:3475` — At Risk Party (per risk-entry row, repeatable field array)

#### Staff
- `pages/StaffCreatePage.tsx:210` — Position (Support Worker/etc.)
- `pages/StaffCreatePage.tsx:246` — Role (permission role, can be disabled/locked)
- `pages/trip-detail/StaffTab.tsx:243` — edit-row Assignment Status
- `pages/trip-detail/StaffTab.tsx:277` — edit-row Sleepover Type
- `pages/trip-detail/StaffTab.tsx:386` — add-staff Sleepover Type

#### Tasks
- `pages/TaskCreatePage.tsx:131` — Trip
- `pages/TaskCreatePage.tsx:140` — Task Type
- `pages/TaskCreatePage.tsx:185` — Priority
- `pages/TaskCreatePage.tsx:200` — Status (edit mode only)
- `pages/TasksPage.tsx:111` — Filter by status (list toolbar)

#### Trips / Bookings / Accommodation
- `pages/TripsPage.tsx:198` — Filter by status (list toolbar)
- `pages/trip-detail/BookingsTab.tsx:232` — Participant picker (add-booking form)
- `pages/trip-detail/BookingsTab.tsx:247` — Booking Status
- `pages/trip-detail/BookingsTab.tsx:285` — Support Ratio Override
- `pages/trip-detail/BookingsTab.tsx:308` — Insurance Status
- `pages/trip-detail/AccommodationTab.tsx:474` — Accommodation Property (add reservation)
- `pages/trip-detail/AccommodationTab.tsx:522` — Reservation Status (add reservation)
- `pages/trip-detail/AccommodationTab.tsx:575` — Accommodation Property (edit reservation)
- `pages/trip-detail/AccommodationTab.tsx:619` — Reservation Status (edit reservation)

#### Vehicles
- `pages/VehicleCreatePage.tsx:124` — Vehicle Type (Car/etc.)

#### Claims / Billing
- `pages/ClaimBatchBuilderPage.tsx:317` — filter by Participant
- `pages/ClaimBatchBuilderPage.tsx:331` — filter by Stream

#### Settings / Templates
- `components/TemplateFormPanel.tsx:220` — "Fill from trip" (non-edit mode only)

#### Rostering
- `pages/rostering/CompatibilityPage.tsx:254` — per-cell compatibility Level rating

#### Auth / Dev tooling
- `pages/LoginPage.tsx:191` — Dev-only user impersonation picker (`devUsers` list)

#### Test-only (not app UI)
- `lib/conditionalFields.test.tsx:90,239,356` — generic RHF-registration test fixtures, unrelated
  to any real page.

**Migration note found in comments**: several files explicitly document that native `<select>`
was *already* migrated away from in favor of `SearchableSelect` for some pickers — e.g.
`IncidentCreatePage.tsx:237` ("the four staff/participant pickers migrated from native
`<select>`/`register()`"), `TaskCreatePage.test.tsx:13` (Owner picker), `StaffTab.test.tsx:13`
(Add Staff picker), `ParticipantCreatePage.tsx:1178` (Funding Source still native, callout is
about *not* having migrated it), `pages/settings/UserFormPanel.tsx:45` (notes `Dropdown`'s
trigger is a `<button>`, not a native `<select>`, re: label association). This means the codebase
already has partial precedent/pattern for select→Dropdown/SearchableSelect migrations to follow.

### 1.3 Shared form wrapper + Tailwind conventions

**`FormField`** — `frontend/src/components/FormField.tsx`. Verbatim prop type:
```ts
export type FormFieldProps = {
  label: ReactNode
  required?: boolean
  error?: string
  hint?: string
  descriptionId?: string
  layout?: 'default' | 'checkbox'
  className?: string
  children: ReactNode
}
```
Behavior: clones its single child element to wire up `id`/`htmlFor`, `aria-required`,
`aria-invalid`, and `aria-describedby` (hint and/or error, or an externally supplied
`descriptionId`). It distinguishes two child shapes:
- **Native inputs** (`input`, `select`, `textarea` — see `NATIVE_INPUTS` const,
  `FormField.tsx:24`): gets the shared `inputClass` string merged onto its own `className`, plus
  a generated `id` for label association.
- **Custom components** (e.g. `Dropdown`'s `form` variant, or an RHF `<Controller>` wrapping
  one): gets `aria-labelledby` pointed at the field's generated label id instead of `htmlFor`/
  `id`, since a custom trigger isn't reliably announced via plain `htmlFor`.

Exported Tailwind constants other components import directly: `inputClass` (used by
`SearchableSelect.tsx:5,320` for its input) and `labelClass`.
```ts
export const inputClass = 'w-full px-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-shadow'
export const labelClass = 'block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]'
```
Several pages (`SettingsPage.tsx:234-235`, `AccommodationTab.tsx`, `BookingsTab.tsx`,
`PublicHolidaysTab` in `SettingsPage.tsx:492`) define their own local, near-identical
`inputClass`/`labelClass` strings rather than importing FormField's — these are inconsistent
variants (`rounded-2xl` + `bg-[var(--color-surface-container-low)]` + `focus:bg-white` instead of
FormField's `rounded-lg` + `bg-[var(--color-input)]`). Worth flagging as drift if standardizing
dropdown styling platform-wide.

---

## TOPIC 2 — Table Component + Column Separators

### 2.1 Shared table component

**`DataTable<T>`** — `frontend/src/components/DataTable.tsx`. Single generic table component;
no separate `ListTable`. Renders a real `<table>` internally (not a div-grid).

Verbatim prop type (`DataTable.tsx:11-87`, `ColumnBase`/`Column`/`SortState`/`DataTableProps`):
```ts
export type ColumnType = 'text' | 'date' | 'currency' | 'boolean' | 'badge' | 'custom'

type ColumnBase<T> = {
  header: string | ReactNode
  type?: ColumnType
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  hidden?: boolean
  editable?: {
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
  editingRows?: Set<string>
  onEditChange?: (row: T, key: string, value: unknown) => void
  rowError?: (row: T) => string | undefined
  className?: string
  compact?: boolean
  selectable?: boolean
  selectedRows?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  /** Adds a vertical border between every column (header + body cells), for tables dense enough
   * that scanning across a row benefits from a rule to track against. Off by default — most
   * tables read fine with only the horizontal row dividers already in place. */
  verticalDividers?: boolean
}
```

Columns are defined as a plain array of `Column<T>` objects passed to `columns`; each has a
`key` (matched against row data via `getValue`), a `header`, and optional `type` (drives a
built-in cell renderer: date/currency/boolean-check/badge) or a custom `render` function.
Sorting is controlled-or-uncontrolled (`sort`/`onSortChange` vs internal `useState`), bulk-editing
a column across selected rows is done via `bulkEditable` rendering a `Dropdown` (`variant="pill"`)
in the column header when rows are selected.

**Row separators — current implementation** (`DataTable.tsx:212-223,290`):
- Row dividers: `<tbody className="divide-y divide-[var(--color-border)]">` — a horizontal rule
  *between* rows only (Tailwind's `divide-y` utility, which skips the last row's bottom edge
  automatically). This is the only separator on by default.
- Column dividers: **off by default**, opt-in via the `verticalDividers` prop, implemented as
  `const dividerClass = verticalDividers ? 'divide-x divide-[var(--color-border)]' : ''` applied
  to both the header `<tr>` and each body `<tr>` (`DataTable.tsx:212,223,321,368`). Tailwind's
  `divide-x` puts a vertical rule *between* columns within that row (first cell gets no left
  border), consistent with `divide-y`'s "between, not around" semantics.
- Both dividers use the same design token: `var(--color-border)`.
- No separate cell-level border classes are used — the table container itself
  (`DataTable.tsx:215`) supplies the outer boundary: `rounded-2xl border border-[var(--color-border)] overflow-x-auto`, with header background `bg-[var(--color-accent)]`.

### 2.2 Usage inventory

**`DataTable` is used in 25 non-test `.tsx` files** (26th match is `DataTable.test.tsx` itself):

```
pages/ParticipantDetailPage.tsx
pages/participant-detail/ParticipantAdlAssessmentsSection.tsx
pages/participant-detail/ParticipantHealthConditionsSection.tsx
pages/participant-detail/ContactsTab.tsx
pages/trip-detail/StaffTab.tsx
pages/rostering/PatternsPage.tsx
pages/medications/ReportTab.tsx
pages/ParticipantsPage.tsx
pages/ClaimBatchBuilderPage.tsx
pages/BillingPage.tsx
pages/participant-detail/RestrictivePracticesTab.tsx
pages/SettingsPage.tsx                    (Activity Library tab, Support Catalogue tab, Public Holidays tab)
pages/StaffPage.tsx
pages/QualificationsPage.tsx
pages/medications/RegisterTab.tsx
pages/trip-detail/BookingsTab.tsx
pages/trip-detail/ClaimsTab.tsx
pages/billing/ServiceBookingDetailModal.tsx
pages/TasksPage.tsx
pages/IncidentsPage.tsx
pages/ClaimBatchDetailPage.tsx
pages/ClaimDetailPage.tsx
pages/BookingsPage.tsx
components/GenerateClaimModal.tsx
pages/trip-detail/TasksTab.tsx
```

**Tables built with raw `<table>` markup that bypass `DataTable`** (9 matches total; 8 real
bypasses + `DataTable.tsx` itself as the source of the pattern):

| File:line | Row separator classes used | Notes |
|---|---|---|
| `pages/billing/TableSkeleton.tsx:18` (`tbody` at :28) | `divide-y divide-[var(--color-border)]` | Loading-skeleton placeholder, mirrors DataTable's own row-divider convention but is a standalone component, not a DataTable wrapper. |
| `pages/rostering/CompatibilityPage.tsx:55` | `border-b border-border` per `<tr>` (`:68`) — first small legend table; `aria-hidden` | Two raw tables in this file. |
| `pages/rostering/CompatibilityPage.tsx:205` | `tbody className="divide-y divide-border"` (`:221`), sticky header/first-column cells | Complex pinned-header/pinned-column compatibility grid — not a good DataTable fit as-is (custom sticky positioning, per-cell `<select>` editing). |
| `pages/SchedulePage.tsx:209` | no `divide-y`; only a `last:border-b-0` hover class per row (`:372`) — relies on default browser table borders / `border-collapse` | Wide horizontally-scrolling Gantt-style schedule grid, dynamic column count based on `tripCount`. |
| `pages/rostering/PatternsPage.tsx:80` | `tbody className="divide-y divide-[var(--color-border)]"` (`:88`, comment marks it `aria-hidden`) | Uses DataTable's exact divider convention manually. |
| `pages/settings/TenantDetailView.tsx:140` | `border-b border-[var(--color-border)]` on header `<tr>` (`:142`) and each body `<tr>` with `last:border-b-0` (`:161`) | Per-row `border-b` instead of `tbody`-level `divide-y` — functionally similar but a different Tailwind idiom (each row draws its own bottom border vs. gaps between rows). |
| `pages/settings/TenantsTab.tsx:80` | same per-row `border-b ... last:border-b-0` pattern (`:82,107`) | Tenants list. |
| `pages/settings/UsersTab.tsx:160` | same per-row `border-b ... last:border-b-0` pattern (`:162,189`) | Users list. |

**Observation for the "column separators" change**: `DataTable` already has the exact toggle
(`verticalDividers`) the topic is asking about, using `divide-x divide-[var(--color-border)]` —
so a platform-wide "column separators" preference likely just needs to (a) thread a
persisted boolean into every `<DataTable ... verticalDividers={pref} />` call site listed above,
and (b) decide what (if anything) happens for the 8 raw-`<table>` bypass sites, none of which
currently expose an equivalent prop.

### 2.3 Per-user UI preference persistence

**No per-user preference store exists server-side today** — confirmed by:
- `grep -r "UserPreference|UserSettings|Preferences"` across `backend/Odip.Domain` and
  `backend/Odip.Api/Controllers` returns exactly one hit, and it's unrelated: a code comment in
  `backend/Odip.Domain/Entities/Participant.cs:430` referencing a participant's own "Personal and
  Cultural Preferences" domain field, not a UI/app preference concept.
- The only settings entity/controller found is **`AppSettings`**
  (`backend/Odip.Domain/Entities/AppSettings.cs`) — explicitly **per-tenant, not per-user**
  (`ITenantEntity`, doc comment "One row per tenant"), with exactly one field today:
  ```csharp
  public class AppSettings : ITenantEntity
  {
      public Guid Id { get; set; }
      public Guid TenantId { get; set; }
      public Tenant? Tenant { get; set; }
      public int QualificationWarningDays { get; set; } = 30;
  }
  ```
  Served via `backend/Odip.Api/Controllers/SettingsController.cs` (`GET`/`PUT`
  `api/v1/settings`, role-gated to `Admin,Coordinator,SuperAdmin`, single-row-per-tenant
  upsert pattern — `FirstOrDefaultAsync` then create-or-update). Frontend hook:
  `frontend/src/api/hooks/settings.ts` (`useSettings`/`useUpdateSettings`, consumed by
  `QualificationSettingsTab` in `pages/SettingsPage.tsx:23-67`).
- `localStorage` usage across `frontend/src` (26 files, ~90 call sites) is **entirely
  auth/tenant-view state**, not UI preferences: keys found are `odip_token`, `odip_user`,
  `odip_viewing_tenant`, `odip_viewing_user`, `odip_superadmin_user`, `odip_last_tenant` — all
  read/written from `api/client.ts`, `main.tsx`, `LoginPage.tsx`, `lib/permissions.ts`, and the
  `components/layout/{AppLayout,UserSwitcher,TenantSwitcher}.tsx` trio for the super-admin
  tenant-impersonation flow. No key resembling a display/UI preference (theme, column layout,
  density, etc.) exists anywhere in the codebase today.

**What adding a new boolean per-user preference would require**, given the above:
1. `AppSettings` is the wrong table (it's tenant-scoped, one row per tenant, not per user) — a
   new boolean preference needs either (a) a new per-user table (e.g. `UserPreferences` keyed by
   the Firebase/JWT user id, since there's no `User` entity table today either — auth identity is
   Firebase + JWT claims, not a local `Users` table for regular staff; `AdminUserDto`/tenant users
   exist for tenant/user *management*, not for storing individual UI prefs), or (b) if the
   preference is meant to be tenant-wide rather than truly per-user, simply add a new column to
   the existing `AppSettings` entity + `AppSettingsDto`/`UpdateAppSettingsDto` (in
   `backend/Odip.Application/DTOs/DTOs.cs`) + a new EF Core migration, following the exact pattern
   `QualificationWarningDays` already uses in `SettingsController.cs`.
2. On the frontend, follow `frontend/src/api/hooks/settings.ts`'s existing
   `useSettings`/`useUpdateSettings` pattern (TanStack Query, `apiGetWithDefault`/`apiPutRaw`) —
   no new infra needed there, just extend the DTO type and consume the new field.
3. If a genuinely local-only/no-backend-round-trip preference is acceptable instead (e.g. it only
   needs to persist per browser, not sync across devices), `localStorage` is already
   the established mechanism in this codebase, just currently only used for auth state — a new
   key following the existing `odip_*` naming convention would be a lower-effort but
   non-syncing alternative.

### `SettingsPage.tsx` / `pages/settings/` structure

- `frontend/src/pages/SettingsPage.tsx` — the single settings page/route. Tab-based
  (`TabNav`), tabs: Event Templates, Activity Library, Qualification Warnings, Provider Settings,
  Support Catalogue (super-admin only), Public Holidays (super-admin only), Tenants (super-admin
  only), Users (super-admin only). Sub-tab components (`QualificationSettingsTab`,
  `ProviderSettingsTab`, `SupportCatalogueTab`, `PublicHolidaysTab`) are defined inline in this
  same file rather than split out.
- `frontend/src/pages/settings/` (separate directory, imported by `SettingsPage.tsx`):
  - `TenantsTab.tsx` — tenant list (raw `<table>`, see 2.2)
  - `TenantFormPanel.tsx` — tenant create/edit side panel
  - `TenantDetailView.tsx` — tenant detail/drill-down (raw `<table>` for its users list)
  - `UsersTab.tsx` — cross-tenant user list (raw `<table>`)
  - `UserFormPanel.tsx` — user create/edit side panel
  - There is no dedicated "preferences" or "appearance" sub-tab today — a new UI-preference
    toggle would be a new addition to this tab set (or to `QualificationSettingsTab`'s general
    area) rather than something slotting into an existing preferences UI.
