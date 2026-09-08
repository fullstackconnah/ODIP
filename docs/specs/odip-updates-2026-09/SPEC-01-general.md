# SPEC 01 — General (platform-wide)

Source backlog items:
- *"Full audit of the drop down fields to use the updated version that has the stylised dropdowns"*
- *"For the tables component, we should have the ability to enable vertical separators for columns
  as well as the already existing row separators, when this is selected, it should be remembered
  and applied to all tables on the platform for that user."*

Discovery evidence: `discovery/01-general-ui.md`.

---

## GEN-1 — Stylised dropdown migration

**Branch:** `feat/gen01-dropdown-audit`

### Current state
46 raw native `<select>` elements in production `.tsx` (49 total; 3 are test fixtures in
`lib/conditionalFields.test.tsx` and are out of scope). Two stylised components already exist and
are the migration targets:

| Component | Path | Use when |
|---|---|---|
| `Dropdown` | `frontend/src/components/Dropdown.tsx` | Fixed, short option lists (enums, statuses, ratings). `variant="form"` inside `FormField`; `variant="pill"` for list-page filter toolbars. |
| `SearchableSelect` | `frontend/src/components/SearchableSelect.tsx` | Long / data-driven lists (participants, staff, trips, properties, tenants) where typing to filter matters. |

Precedent already exists in-tree — several staff/participant pickers were previously migrated off
native `<select>` (see comments at `IncidentCreatePage.tsx:237`, `TaskCreatePage.test.tsx:13`,
`StaffTab.test.tsx:13`). Follow that established pattern rather than inventing a new one.

### Scope decision — deferred call sites
`ParticipantCreatePage.tsx` (13 selects) and `IncidentCreatePage.tsx` (6 selects) are **excluded
from GEN-1**.

> Corrected 2026-09-01: SPEC-02's audit found **13**, not 12. The extra site is the dynamic
> per-row `riskEntries.atRiskParty` select, which is easy to undercount because it renders inside
> a field array. SPEC-02 carries the authoritative completion table for this file. Both files are structurally rewritten by SPEC-02 (participant form) and SPEC-04
(incident wizard). Migrating their selects here would create a guaranteed three-way merge against
a rewrite of the same lines. Instead, each rewrite must land its own fields on `Dropdown` /
`SearchableSelect` directly — this is an acceptance criterion on those specs, not an omission.

Also excluded:
- `pages/LoginPage.tsx:191` — dev-only impersonation picker, not user-facing UI.
- `pages/rostering/CompatibilityPage.tsx:254` — per-cell rating select inside a dense pinned grid.
  A portal-based listbox in every cell of a large matrix is a performance and scroll-anchoring
  risk. Tracked separately as GEN-1b; not part of this branch.

### In-scope inventory (25 call sites)

> Corrected 2026-09-01: this heading originally said 28, which was an arithmetic error on my part —
> the per-file rows below sum to 25. The 25 is right and the coverage is complete: 46 production
> selects, minus ParticipantCreatePage's 13, IncidentCreatePage's 6, LoginPage's 1 and
> CompatibilityPage's 1 = 25. Verification confirmed all 25 migrated and the acceptance grep clean,
> so nothing was missed — only the total was mistyped.

| Area | File:line | Selects | Target |
|---|---|---|---|
| Incidents (list) | `pages/IncidentsPage.tsx:89,102` | Status filter, Severity filter | `Dropdown` pill |
| Staff | `pages/StaffCreatePage.tsx:210,246` | Position, Role | `Dropdown` form |
| Staff (trip) | `pages/trip-detail/StaffTab.tsx:243,277,386` | Assignment Status, Sleepover Type x2 | `Dropdown` form |
| Tasks | `pages/TaskCreatePage.tsx:131,140,185,200` | Trip, Task Type, Priority, Status | Trip to `SearchableSelect`; rest to `Dropdown` form |
| Tasks (list) | `pages/TasksPage.tsx:111` | Status filter | `Dropdown` pill |
| Trips (list) | `pages/TripsPage.tsx:198` | Status filter | `Dropdown` pill |
| Bookings | `pages/trip-detail/BookingsTab.tsx:232,247,285,308` | Participant, Booking Status, Support Ratio Override, Insurance Status | Participant to `SearchableSelect`; rest to `Dropdown` form |
| Accommodation | `pages/trip-detail/AccommodationTab.tsx:474,522,575,619` | Property x2, Reservation Status x2 | Property to `SearchableSelect`; Status to `Dropdown` form |
| Vehicles | `pages/VehicleCreatePage.tsx:124` | Vehicle Type | `Dropdown` form |
| Claims | `pages/ClaimBatchBuilderPage.tsx:317,331` | Participant filter, Stream filter | Participant to `SearchableSelect`; Stream to `Dropdown` pill |
| Templates | `components/TemplateFormPanel.tsx:220` | Fill-from-trip | `SearchableSelect` |

### Rules for every migration
1. Inside a form, the control stays wrapped in `FormField`. `FormField` already branches on native
   vs custom children (`FormField.tsx:24` `NATIVE_INPUTS`) and wires `aria-labelledby` for custom
   components — do not hand-roll label association.
2. react-hook-form fields move from `register()` to `<Controller>`, forwarding `field.onChange`,
   `field.value`, and `field.onBlur` (`Dropdown` accepts `onBlur` explicitly for this).
3. Empty/placeholder option: native `<option value="">Select...</option>` becomes the `label` prop
   (form variant renders it as placeholder). Do **not** add a synthetic empty-string item to `items`.
4. Preserve any custom `onChange` side-effects verbatim (e.g. the Other-switch guard on Funding
   Source) — behaviour must not change, only the control.
5. Preserve `required`, `disabled`, and error wiring. `disabled` is caller-controlled on
   `Dropdown` and is *not* auto-applied on an empty `items` array — pass it explicitly where the
   native version relied on an empty list.
6. Options derived from an enum must build `DropdownItem[]` from the same source constant the
   native version mapped over. No duplicated literal option lists.

### Style drift (in scope, low risk)
`SettingsPage.tsx:234-235,492`, `AccommodationTab.tsx`, and `BookingsTab.tsx` each declare local
`inputClass`/`labelClass` strings that diverge from the exported ones in `FormField.tsx`
(`rounded-2xl`/`bg-surface-container-low` vs `rounded-lg`/`bg-input`). Where a migrated control
sits next to those inputs, import the shared constants from `FormField` instead of the local copy,
so a migrated dropdown does not sit visually mismatched beside its neighbours. Do not restyle
unrelated inputs on this branch.

### Acceptance
- `grep -rn "<select" frontend/src --include=*.tsx` returns only: `ParticipantCreatePage.tsx`,
  `IncidentCreatePage.tsx`, `LoginPage.tsx:191`, `CompatibilityPage.tsx:254`, and
  `lib/conditionalFields.test.tsx`.
- `npm run build` clean; `npm test` green; no new `npm run lint` errors versus main.
- Existing tests that query by `getByLabelText` / `getByRole('combobox')` are updated to the
  listbox-button role where the control changed, and still assert the same behaviour.
- Keyboard: each migrated control is reachable by Tab, opens on Enter/Space, and selects with
  Enter. `Dropdown` already implements this; the check is that `FormField` wiring was not broken.

---

## GEN-2 — Table column separators, remembered per user

**Branch:** `feat/gen02-table-vertical-separators`

### Current state
`DataTable<T>` (`frontend/src/components/DataTable.tsx`) **already implements the visual half**:

```ts
/** Adds a vertical border between every column (header + body cells) ... Off by default */
verticalDividers?: boolean
```

applied as `divide-x divide-[var(--color-border)]` on the header row and each body row
(`DataTable.tsx:212,223,321,368`). Row dividers are `tbody` `divide-y divide-[var(--color-border)]`
and stay on unconditionally. **No caller passes `verticalDividers` today.** So this item is
persistence, a control, and backfilling the raw-table stragglers — not new table rendering.

### Persistence decision
There is **no per-user preference store** in ODIP. `AppSettings`
(`backend/Odip.Domain/Entities/AppSettings.cs`) is per-*tenant*, single-row, and holds exactly one
field; there is no local users table at all (auth identity is Firebase + JWT claims), so a
server-side per-user preference means a new entity, a new migration, a new controller, and a
user-identity resolution decision.

**Assumption taken (flagged for review):** persist client-side, namespaced by the signed-in user
id, following the established `odip_*` localStorage convention already used for auth/tenant state.

- Key: `odip_ui_prefs:<userId>`, value a JSON object, so future preferences do not each need a key.
- Trade-off accepted: the preference does not follow the user across browsers or devices.
- Mitigation: all reads and writes go through one module, so a later swap to a server-backed store
  is a single-file change rather than a 25-file change.

If it should sync across devices, that is a separate backend item (new `UserPreference` entity keyed
by JWT subject plus `api/v1/me/preferences`) and gets its own branch.

### Implementation

1. **New** `frontend/src/lib/uiPreferences.ts`
   - `export type UiPreferences = { tableVerticalDividers: boolean }`
   - `DEFAULT_UI_PREFERENCES: UiPreferences = { tableVerticalDividers: false }`
   - `readUiPreferences(userId: string | null): UiPreferences` — wrap `JSON.parse` in try/catch and
     fall back to defaults on any malformed value or a throwing `localStorage` (private mode).
   - `writeUiPreferences(userId, prefs)` — same guarding; a throw must never break render.
   - Resolve `userId` from the existing `odip_user` localStorage entry the auth layer already
     maintains (`api/client.ts`, `main.tsx`). Null user means in-memory defaults and no write.

2. **New** `frontend/src/hooks/useUiPreferences.ts`
   - Context provider plus hook: `useUiPreferences()` returning `{ prefs, setPref }`.
   - Provider mounted in `App.tsx` inside the authenticated shell.
   - Must re-read on user or tenant switch. The super-admin impersonation flow
     (`components/layout/UserSwitcher.tsx`, `TenantSwitcher.tsx`) changes the active user without a
     full reload, so initialising state once from the user id is not enough — subscribe to the same
     signal those components use, or remount the provider keyed on user id.

3. **`DataTable.tsx`** — default `verticalDividers` from the preference:
   `const { prefs } = useUiPreferences()` then
   `const showVertical = verticalDividers ?? prefs.tableVerticalDividers`.
   The explicit prop must still win when passed, so a table that genuinely needs dividers always is
   unaffected by the preference. Change the prop's effective default from `false` to `undefined`.

4. **The toggle** — new "Appearance" sub-tab on `frontend/src/pages/SettingsPage.tsx`'s `TabNav`,
   visible to every role (unlike the existing admin-gated tabs). Single checkbox:
   *"Show vertical separators between table columns"*, with helper text noting it applies to all
   tables and is remembered on this device.
   Rationale for Settings over a per-table control: the requirement is that the choice applies to
   *all* tables, so a global home is the honest place for it. A per-table toggle that silently
   changes every other table is a surprising interaction.

5. **Raw-table stragglers.** 8 files bypass `DataTable` with hand-written `<table>` markup and
   inconsistent divider idioms. "Applied to all tables on the platform" is the requirement, so:
   - `pages/settings/TenantDetailView.tsx:140`, `pages/settings/TenantsTab.tsx:80`,
     `pages/settings/UsersTab.tsx:160` — plain lists; **convert to `DataTable`**. They gain the
     preference, sorting, and the empty state for free, and three divergent border idioms go away.
   - `pages/rostering/PatternsPage.tsx:80`, `pages/billing/TableSkeleton.tsx:18` — keep as raw
     markup (skeleton / aria-hidden decorative), but read the preference and apply the same
     `divide-x divide-[var(--color-border)]` class so they match visually.
   - `pages/rostering/CompatibilityPage.tsx:55,205` and `pages/SchedulePage.tsx:209` — **leave
     alone, known exclusion.** Both use custom sticky header and first-column positioning, and
     `divide-x` interacts badly with sticky cells: the divider scrolls with the wrong element.

### Acceptance
- Toggling the Settings checkbox changes column separators on the Participants, Trips, Incidents
  and Tasks lists, and on the converted Tenants/Users tables, without a page reload.
- Reloading the browser preserves the choice; signing in as a different user shows that user's own
  choice, not the previous user's.
- With `localStorage` unavailable (simulate by making `getItem` throw), the app renders with
  dividers off and does not error.
- A caller passing `verticalDividers={true}` explicitly still gets dividers when the preference is off.
- `npm run build` clean, `npm test` green, no new lint errors.
- New tests: `uiPreferences` round-trip and malformed-value fallback; `DataTable` renders `divide-x`
  when the preference is on and omits it when off.
