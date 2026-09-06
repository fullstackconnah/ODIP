# ODIP UX Audit Stage 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 8 "Stage 0" findings from the ODIP UX audit — small, isolated, currently-doing-active-harm accessibility/correctness fixes — without touching migrations, adding dependencies, or expanding scope into the audit's larger DS-01/codemod recommendations.

**Architecture:** Backend is .NET 8 layered (Domain → Application → Infrastructure → Api), tests in `Odip.Tests` (xUnit + Moq + EF InMemory). Frontend is React 19 + TypeScript 5.9 + Vite 7 + Tailwind 4, data via TanStack Query hooks in `src/api/hooks/*`, tests via vitest + Testing Library co-located as `*.test.tsx`. Design tokens live in a single Tailwind 4 `@theme` block in `frontend/src/index.css`; Tailwind 4 auto-generates utility classes (`bg-input`, `ring-ring`, `bg-error-container`, ...) from every `--color-*` token defined there.

**Tech Stack:** .NET 8 / xUnit / Moq / EF Core InMemory (backend); React 19 / TypeScript 5.9 / Vite 7 / Tailwind 4 / TanStack Query / react-router 7 / react-hook-form+zod / vitest / @testing-library/react (frontend).

**Spec:** docs/specs/2026-09-06-odip-ux-audit-and-feature-suggestions.md (Part A findings C-1, C-2, C-3, C-4a, I-1, I-3, I-4; Part B F-3 one-line fix; Part C Stage 0)

## Global Constraints

- All work happens under `odip-prototype/odip/` — the repo root (`F:\Projects\personal\ODIP`) holds only planning material. Backend commands run from `odip-prototype/odip/backend`; frontend commands run from `odip-prototype/odip/frontend`.
- Backend gate: `dotnet build` then `dotnet test` (both must be clean; `Odip.Tests` is the xUnit suite — `Odip.ProtoTests` is deliberately excluded from the `.sln` and is not part of this gate).
- Frontend gate: `npm run build` (tsc -b && vite build) and `npm test` (vitest run) must both be clean. `npm run lint` has pre-existing failures in non-test files — the working bar is **no NEW lint errors** introduced by this plan's changes, not a clean `npm run lint` run.
- No new npm or NuGet dependencies of any kind.
- Every colour must resolve through the existing `@theme` tokens in `frontend/src/index.css` (bare Tailwind theme utilities like `bg-error-container`, or `var(--color-*)` arbitrary values) — never a new hardcoded hex value and never a raw Tailwind palette class (`red-500`, `blue-100`, etc.).
- MediatR and AutoMapper are referenced in `.csproj` files but are unused in this codebase — do not add handlers or profiles for either.
- Do not touch EF Core migrations or `Program.cs`'s `__EFMigrationsHistory` self-healing logic.
- Every git command in every step uses `git -c safe.directory=*` (this checkout has no `.git` safe-directory config).
- Do not commit anything beyond what each task's own Step 5 specifies — one commit per task, only the files that task touched.

---
### Task 1: Define the missing `--color-surface` token ([C-4a])

**Files:**
- Modify: `odip-prototype/odip/frontend/src/index.css:33` (insert one line immediately before the existing `--color-surface-container` line, inside the `@theme` block)
- Test: `odip-prototype/odip/frontend/src/test/designTokens.test.ts` (new)

**Interfaces:** Consumes: the `@theme` block's existing token grammar (`--color-<name>: <hex>;`) already used by `--color-surface-container`, `--color-surface-container-low/-high/-lowest`. Produces: a `--color-surface` token that `bg-[var(--color-surface)]` (already written, unused-until-now, in `AddActivityModal.tsx:131,151` and `GenerateClaimModal.tsx:74,184,202`) resolves against instead of an unset CSS variable.

- [ ] **Step 1: Write the failing test**
  ```ts
  // odip-prototype/odip/frontend/src/test/designTokens.test.ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync } from 'node:fs'
  import { fileURLToPath } from 'node:url'

  const INDEX_CSS_PATH = fileURLToPath(new URL('../index.css', import.meta.url))

  describe('design tokens (C-4a)', () => {
    it('defines --color-surface, so the five bg-[var(--color-surface)] usages in AddActivityModal/GenerateClaimModal resolve to a real background instead of rendering unset', () => {
      const css = readFileSync(INDEX_CSS_PATH, 'utf-8')
      const themeBlock = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'))

      // Plain substring, not a regex: "--color-surface-container:" does NOT contain the
      // substring "--color-surface:" (the character after "surface" differs: "-" vs ":"),
      // so this can't be satisfied by the pre-existing -container/-low/-high/-lowest tokens.
      expect(themeBlock).toContain('--color-surface:')
    })
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/test/designTokens.test.ts`
  Expected: FAIL — `expect(themeBlock).toContain('--color-surface:')` fails because `index.css` currently only defines `--color-surface-container`, `-container-low`, `-container-high`, `-container-lowest`.
- [ ] **Step 3: Implement**
  In `odip-prototype/odip/frontend/src/index.css`, insert one line directly before the existing `--color-surface-container: #efeeea;` line so the block reads:
  ```css
  --color-surface: #ffffff;
  --color-surface-container: #efeeea;
  --color-surface-container-low: #f5f3ef;
  --color-surface-container-high: #eae8e4;
  --color-surface-container-lowest: #ffffff;
  ```
  `#ffffff` is chosen deliberately to match `--color-surface-container-lowest` (the token these five elements have been invisibly falling back to) — this is a pure bug fix with zero visual delta, not a design change.
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/test/designTokens.test.ts` then `npm run build`
  Expected: the vitest run passes; `npm run build` (`tsc -b && vite build`, which invokes the real `@tailwindcss/vite` plugin against `index.css`) completes with no new errors, confirming the token addition doesn't break Tailwind's `@theme` parsing.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/index.css odip-prototype/odip/frontend/src/test/designTokens.test.ts
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(tokens): define --color-surface so bg-[var(--color-surface)] resolves (C-4a)

  Five elements in AddActivityModal/GenerateClaimModal reference a token that
  index.css never defined; only -container/-low/-high/-lowest existed. Adds
  --color-surface at the same value as -container-lowest (#ffffff), matching
  the fallback these elements have been invisibly rendering with already.
  EOF
  )"
  ```

---
### Task 2: Strip the alpha suffix off ~72 focus rings ([C-2])

**Files:**
- Modify (72 call sites across 21 files — exact lines from `grep -rnoE "ring-\[var\(--color-(ring|primary)\)\]/[0-9]+" src --include=*.tsx --include=*.ts` run from `odip-prototype/odip/frontend`):
  - `src/components/AddActivityModal.tsx:131`
  - `src/components/AddVehicleModal.tsx:156,205,217,241,251`
  - `src/components/Dropdown.tsx:304,372,402`
  - `src/components/GenerateClaimModal.tsx:74`
  - `src/components/TemplateFormPanel.tsx:183`
  - `src/pages/ClaimDetailPage.tsx:12`
  - `src/pages/LoginPage.tsx:126,141,195,212`
  - `src/pages/schedule/AvailabilityEditor.tsx:108,109`
  - `src/pages/schedule/StaffAssignModal.tsx:107`
  - `src/pages/schedule/VehicleAssignModal.tsx:79`
  - `src/pages/settings/TenantFormPanel.tsx:203`
  - `src/pages/settings/TenantsTab.tsx:59`
  - `src/pages/settings/UserFormPanel.tsx:141`
  - `src/pages/settings/UsersTab.tsx:91`
  - `src/pages/SettingsPage.tsx:261,487,519,653,661`
  - `src/pages/trip-detail/AccommodationTab.tsx:464,469,474,494,499,540,594,599,608,613,618,647,652,660`
  - `src/pages/trip-detail/BookingsTab.tsx:334,372,377,711,754,759`
  - `src/pages/trip-detail/EditTripModal.tsx:180,185,203,208,220,225,230,273,278,283,288,293,298,307`
  - `src/pages/trip-detail/OverviewTab.tsx:143`
  - `src/pages/trip-detail/StaffTab.tsx:268,273,302,377,382,411`
  - `src/pages/TripsPage.tsx:28,193`
- Test: `odip-prototype/odip/frontend/src/test/focusRingTokens.test.ts` (new)

**Interfaces:** Consumes: nothing new — every one of these sites is a `className` string literal or template literal containing `ring-[var(--color-ring)]/NN` or `ring-[var(--color-primary)]/NN` (`NN` ∈ {20, 25, 30, 50}). Produces: every site converges on the single bare form `ring-[var(--color-ring)]` (not `ring-[var(--color-primary)]` — the two tokens share the same value, `#396200`, so canonicalising on `--color-ring` is a pure rename), which Tailwind resolves to a 7.19:1-contrast solid ring instead of a ≤2.6:1 translucent one.

- [ ] **Step 1: Write the failing test**
  ```ts
  // odip-prototype/odip/frontend/src/test/focusRingTokens.test.ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { fileURLToPath } from 'node:url'
  import { join } from 'node:path'

  const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))
  const FORBIDDEN_PATTERN = /ring-\[var\(--color-(?:ring|primary)\)\]\/\d+/

  function collectSourceFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(fullPath))
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(fullPath)
      }
    }
    return files
  }

  describe('focus ring tokens (C-2)', () => {
    it('has zero alpha-suffixed ring-[var(--color-ring)]/NN or ring-[var(--color-primary)]/NN focus rings left in src', () => {
      const offenders = collectSourceFiles(SRC_DIR).filter(file => FORBIDDEN_PATTERN.test(readFileSync(file, 'utf-8')))
      expect(offenders).toEqual([])
    })
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/test/focusRingTokens.test.ts`
  Expected: FAIL — `offenders` is a 21-element array (the files listed above), so `expect(offenders).toEqual([])` fails.
- [ ] **Step 3: Implement**
  Run this from `odip-prototype/odip/frontend` (mechanical replace across exactly the 21 files above — Node is already a project dependency, no new tooling):
  ```bash
  node -e "
  const fs = require('fs');
  const files = [
    'src/components/AddActivityModal.tsx',
    'src/components/AddVehicleModal.tsx',
    'src/components/Dropdown.tsx',
    'src/components/GenerateClaimModal.tsx',
    'src/components/TemplateFormPanel.tsx',
    'src/pages/ClaimDetailPage.tsx',
    'src/pages/LoginPage.tsx',
    'src/pages/schedule/AvailabilityEditor.tsx',
    'src/pages/schedule/StaffAssignModal.tsx',
    'src/pages/schedule/VehicleAssignModal.tsx',
    'src/pages/settings/TenantFormPanel.tsx',
    'src/pages/settings/TenantsTab.tsx',
    'src/pages/settings/UserFormPanel.tsx',
    'src/pages/settings/UsersTab.tsx',
    'src/pages/SettingsPage.tsx',
    'src/pages/trip-detail/AccommodationTab.tsx',
    'src/pages/trip-detail/BookingsTab.tsx',
    'src/pages/trip-detail/EditTripModal.tsx',
    'src/pages/trip-detail/OverviewTab.tsx',
    'src/pages/trip-detail/StaffTab.tsx',
    'src/pages/TripsPage.tsx',
  ];
  const pattern = /ring-\[var\(--color-(?:ring|primary)\)\]\/\d+/g;
  for (const f of files) {
    const before = fs.readFileSync(f, 'utf8');
    const after = before.replace(pattern, 'ring-[var(--color-ring)]');
    if (before === after) throw new Error('no match replaced in ' + f);
    fs.writeFileSync(f, after);
  }
  console.log('replaced in', files.length, 'files');
  "
  ```
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/test/focusRingTokens.test.ts` then `npm test` (full suite) then `npm run build`
  Expected: `focusRingTokens.test.ts` passes with zero offenders; the full `npm test` suite has no new failures (no test asserted on the alpha-suffixed class name); `npm run build` succeeds.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/components/AddActivityModal.tsx odip-prototype/odip/frontend/src/components/AddVehicleModal.tsx odip-prototype/odip/frontend/src/components/Dropdown.tsx odip-prototype/odip/frontend/src/components/GenerateClaimModal.tsx odip-prototype/odip/frontend/src/components/TemplateFormPanel.tsx odip-prototype/odip/frontend/src/pages/ClaimDetailPage.tsx odip-prototype/odip/frontend/src/pages/LoginPage.tsx odip-prototype/odip/frontend/src/pages/schedule/AvailabilityEditor.tsx odip-prototype/odip/frontend/src/pages/schedule/StaffAssignModal.tsx odip-prototype/odip/frontend/src/pages/schedule/VehicleAssignModal.tsx odip-prototype/odip/frontend/src/pages/settings/TenantFormPanel.tsx odip-prototype/odip/frontend/src/pages/settings/TenantsTab.tsx odip-prototype/odip/frontend/src/pages/settings/UserFormPanel.tsx odip-prototype/odip/frontend/src/pages/settings/UsersTab.tsx odip-prototype/odip/frontend/src/pages/SettingsPage.tsx odip-prototype/odip/frontend/src/pages/trip-detail/AccommodationTab.tsx odip-prototype/odip/frontend/src/pages/trip-detail/BookingsTab.tsx odip-prototype/odip/frontend/src/pages/trip-detail/EditTripModal.tsx odip-prototype/odip/frontend/src/pages/trip-detail/OverviewTab.tsx odip-prototype/odip/frontend/src/pages/trip-detail/StaffTab.tsx odip-prototype/odip/frontend/src/pages/TripsPage.tsx odip-prototype/odip/frontend/src/test/focusRingTokens.test.ts
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(a11y): strip alpha suffix from ~72 focus rings (C-2)

  ring-[var(--color-ring)]/NN and ring-[var(--color-primary)]/NN compute to
  1.4-2.6:1 contrast against the page (WCAG 1.4.11/2.4.11 need 3:1) across the
  entire login form, every Settings input, every Dropdown, and the
  claim-generation modal. Mechanical replace to the already-majority, already-
  correct bare ring-[var(--color-ring)] (7.19:1). Adds a repo-wide grep gate so
  the alpha suffix can't silently come back.
  EOF
  )"
  ```

---
### Task 3: Remove `role="button"` from `<tr>`/`<th>` in DataTable ([C-3])

**Files:**
- Modify: `odip-prototype/odip/frontend/src/components/DataTable.tsx:266` (header `role`), `:329` (row `role`)
- Test: `odip-prototype/odip/frontend/src/components/DataTable.test.tsx` (existing — update 2 queries, add 2 new tests)

**Interfaces:** Consumes: nothing new. Produces: a sortable `<th>` keeps its native `columnheader` role (so `aria-sort` stays valid per WCAG 4.1.2/1.3.1) and a clickable `<tr>` keeps its native `row` role (so cells stay individually navigable) — `tabIndex`, `onClick`, and the `Enter`/`Space` `onKeyDown` handler are all retained, so keyboard operability is unaffected.

- [ ] **Step 1: Write the failing test**
  In `odip-prototype/odip/frontend/src/components/DataTable.test.tsx`, change the two `getByRole('button', ...)` header lookups in the `'DataTable — sortable columns'` describe block to `getByRole('columnheader', ...)`:
  ```tsx
  it('marks a sortable header with aria-sort and toggles it on click: none -> asc -> desc -> none', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

    const nameHeader = screen.getByRole('columnheader', { name: /name/i })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')

    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')

    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')

    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')
  })

  it('reorders rows when a sortable column header is clicked', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

    await user.click(screen.getByRole('columnheader', { name: /name/i }))

    const cells = screen.getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Alex')
  })
  ```
  Then add a new describe block at the end of the file:
  ```tsx
  describe('DataTable — native table semantics (C-3)', () => {
    it('never puts role="button" on a sortable header — aria-sort stays on the native columnheader role', () => {
      render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      expect(nameHeader).not.toHaveAttribute('role')
      expect(nameHeader).toHaveAttribute('aria-sort')
    })

    it('never puts role="button" on a clickable row — rows keep their native row role and cells stay navigable', () => {
      render(<DataTable data={rows} columns={columns} keyField="id" onRowClick={vi.fn()} />)

      for (const row of screen.getAllByRole('row')) {
        expect(row).not.toHaveAttribute('role')
      }
      // Cells are still individually exposed, not flattened into one string per row.
      expect(screen.getAllByRole('cell').length).toBeGreaterThan(0)
    })

    it('keeps a clickable row keyboard-operable (tabIndex + Enter) even without role="button"', async () => {
      const user = userEvent.setup()
      const onRowClick = vi.fn()
      render(<DataTable data={rows} columns={columns} keyField="id" onRowClick={onRowClick} />)

      const firstDataRow = screen.getAllByRole('row')[1]
      expect(firstDataRow).toHaveAttribute('tabIndex', '0')
      firstDataRow.focus()
      await user.keyboard('{Enter}')
      expect(onRowClick).toHaveBeenCalledWith(rows[0])
    })
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/components/DataTable.test.tsx`
  Expected: FAIL — `getByRole('columnheader', ...)` finds nothing because the explicit `role="button"` on the `<th>` currently overrides its native `columnheader` role in the accessibility tree; the two new "never puts role=button" assertions also fail because the attribute is currently present.
- [ ] **Step 3: Implement**
  In `odip-prototype/odip/frontend/src/components/DataTable.tsx`, remove the `role` prop from both elements:
  ```tsx
  // :259-267 — header cell (remove the role line)
  <th
    key={col.key}
    className={`${alignClass} ${cellPadding} text-xs font-medium text-[var(--color-muted-foreground)] whitespace-nowrap ${isSortable ? 'cursor-pointer select-none' : ''}`}
    aria-sort={isSortable ? (isSorted ? (activeSort!.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
    onClick={isSortable ? () => handleSort(col.key) : undefined}
    onKeyDown={isSortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(col.key) } } : undefined}
    tabIndex={isSortable ? 0 : undefined}
  >
  ```
  ```tsx
  // :324-330 — body row (remove the role line)
  <tr
    className={`hover:bg-[var(--color-accent)]/50 transition-colors ${dividerClass} ${isClickable ? 'group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]' : ''} ${extraClass}`}
    onClick={isClickable ? () => onRowClick(row) : undefined}
    onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(row) } } : undefined}
    tabIndex={isClickable ? 0 : undefined}
  >
  ```
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/components/DataTable.test.tsx` then `npm test` (full suite)
  Expected: all `DataTable.test.tsx` tests pass; full suite has no new failures (no other test file queries `DataTable`'s rows/headers via `getByRole('button')`).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/components/DataTable.tsx odip-prototype/odip/frontend/src/components/DataTable.test.tsx
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(a11y): remove role=button from DataTable tr/th (C-3)

  role="button" overrode the implicit columnheader/row roles: aria-sort is
  only valid on columnheader/rowheader/gridcell, so it was silently dropped
  from the accessibility tree, and a role="button" row flattened its cells
  into one string for screen readers. Removing the role restores native table
  semantics across all 35 tables that use DataTable; tabIndex/onClick/Enter-
  Space handling is unchanged, so keyboard operability is unaffected.
  EOF
  )"
  ```

---
### Task 4: Wire the existing `.mobile-card-table` CSS into DataTable ([I-1])

**Files:**
- Modify: `odip-prototype/odip/frontend/src/components/DataTable.tsx:225` (table `className`), `:358` and `:365` (both `<td>` render branches)
- Test: `odip-prototype/odip/frontend/src/components/DataTable.test.tsx` (existing — add 1 describe block)

**Interfaces:** Consumes: `frontend/src/index.css:76-111`'s existing `.mobile-card-table` rules (`thead{display:none}`, `tbody tr` becomes a flex card, `tbody td::before{content:attr(data-label)}`) — written but, per a repo-wide grep for `mobile-card-table`/`data-label`, never referenced from any component. Produces: every one of DataTable's 35 call sites gets the mobile card transform for free, with each cell's `data-label` sourced from its column's string `header`.

- [ ] **Step 1: Write the failing test**
  Add to `odip-prototype/odip/frontend/src/components/DataTable.test.tsx`:
  ```tsx
  describe('DataTable — mobile card view (I-1)', () => {
    it('applies the mobile-card-table class so the existing CSS-only card transform activates under 768px', () => {
      render(<DataTable data={rows} columns={columns} keyField="id" />)

      expect(screen.getByRole('table')).toHaveClass('mobile-card-table')
    })

    it('emits a data-label attribute on each cell equal to its column header text, for the CSS pseudo-header', () => {
      render(<DataTable data={rows} columns={columns} keyField="id" />)

      expect(screen.getByText('Bianca').closest('td')).toHaveAttribute('data-label', 'Name')
      expect(screen.getByText('30').closest('td')).toHaveAttribute('data-label', 'Age')
    })

    it('emits an empty data-label (never the literal "undefined") for a column with a non-string ReactNode header', () => {
      const columnsWithNodeHeader: Column<Row>[] = [
        { key: 'name', header: <span>Name</span> },
      ]
      render(<DataTable data={rows} columns={columnsWithNodeHeader} keyField="id" />)

      expect(screen.getByText('Bianca').closest('td')).toHaveAttribute('data-label', '')
    })
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/components/DataTable.test.tsx`
  Expected: FAIL — the `<table>` has no `mobile-card-table` class and no `<td>` has a `data-label` attribute.
- [ ] **Step 3: Implement**
  In `odip-prototype/odip/frontend/src/components/DataTable.tsx`:
  ```tsx
  // :225
  <table className="w-full text-sm mobile-card-table">
  ```
  ```tsx
  // :356-362 — editable branch
  if (isEditing && col.editable) {
    return (
      <td key={col.key} className={`${cellPadding} ${alignClass} ${col.className ?? ''}`} data-label={typeof col.header === 'string' ? col.header : ''}>
        {col.editable.render(row, (value) => onEditChange?.(row, col.key, value), { errorId: rowErrorId })}
      </td>
    )
  }

  // :364-368 — display branch
  return (
    <td key={col.key} className={`${cellPadding} ${alignClass} ${col.className ?? ''}`} data-label={typeof col.header === 'string' ? col.header : ''}>
      {renderCell(row, col, rowIndex)}
    </td>
  )
  ```
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/components/DataTable.test.tsx` then `npm test` (full suite) then `npm run build`
  Expected: all pass; no other test asserted on the exact `className`/child structure of a `<td>` in a way `data-label` would break.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/components/DataTable.tsx odip-prototype/odip/frontend/src/components/DataTable.test.tsx
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(responsive): wire the existing mobile-card-table CSS into DataTable (I-1)

  index.css already had a complete mobile card-view transform (thead hidden,
  rows become flex cards, data-label-driven pseudo-headers) with zero
  consumers. Adding the class and emitting data-label from each column's
  string header activates it across all 35 DataTable call sites at once,
  replacing the 12-column horizontal scroller ParticipantsPage renders on a
  phone.
  EOF
  )"
  ```

---
### Task 5: Wire the QSC banner to tokens, `role="alert"`, and a filtered link ([C-1])

**Files:**
- Modify: `odip-prototype/odip/frontend/src/pages/IncidentsPage.tsx:8` (import), `:41-43` (new search-param read), `:64-65` (new filtered list), `:94,140,158` (use the filtered list), `:130-138` (banner markup)
- Test: `odip-prototype/odip/frontend/src/pages/IncidentsPage.test.tsx` (new)

**Interfaces:** Consumes: `useOverdueQscIncidents()` and `useIncidents()` (`@/api/hooks`, both already imported), each incident's existing `isOverdue24h: boolean` field (`IncidentListDto`, `frontend/src/api/types/incidents.ts:67`), and `useSearchParams` from `react-router-dom` (already a dependency, not yet imported in this file). Produces: a `role="alert"` banner styled from `--color-error-container`/`--color-destructive` tokens that links to `/incidents?qsc=overdue`, and the same page reading that query param to show only overdue incidents.

- [ ] **Step 1: Write the failing test**
  ```tsx
  // odip-prototype/odip/frontend/src/pages/IncidentsPage.test.tsx
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import { render, screen, within } from '@testing-library/react'
  import { MemoryRouter, Routes, Route } from 'react-router-dom'
  import IncidentsPage from './IncidentsPage'

  const { mockUseIncidents, mockUseOverdueQscIncidents } = vi.hoisted(() => ({
    mockUseIncidents: vi.fn(),
    mockUseOverdueQscIncidents: vi.fn(),
  }))

  vi.mock('@/api/hooks', () => ({
    useIncidents: mockUseIncidents,
    useOverdueQscIncidents: mockUseOverdueQscIncidents,
    useUpdateIncident: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteIncident: () => ({ mutate: vi.fn(), isPending: false }),
  }))

  function baseIncident(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inc-1',
      title: 'Slip in kitchen',
      tripName: null,
      incidentType: 'Injury',
      severity: 'Low',
      status: 'Draft',
      reportedByName: 'Alex Rivera',
      incidentDateTime: '2026-09-01T10:00:00Z',
      qscReportingStatus: 'Required',
      isOverdue24h: false,
      ...overrides,
    }
  }

  function renderPage(initialEntry = '/incidents') {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/incidents" element={<IncidentsPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    mockUseIncidents.mockReturnValue({ data: [], isLoading: false })
    mockUseOverdueQscIncidents.mockReturnValue({ data: [] })
  })

  afterEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('IncidentsPage — QSC overdue banner (C-1)', () => {
    it('does not render a banner when there are no overdue QSC incidents', () => {
      renderPage()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('renders the overdue QSC banner with role="alert" and destructive design tokens, not raw Tailwind reds', () => {
      mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
      renderPage()

      const banner = screen.getByRole('alert')
      expect(banner).toHaveTextContent(/1 incident/)
      expect(banner).toHaveTextContent(/require QSC reporting/)
      expect(banner.className).toMatch(/bg-error-container/)
      expect(banner.className).not.toMatch(/red-500/)
      expect(banner.className).not.toMatch(/text-red-400/)
    })

    it('contains a link into the incident list filtered to qsc=overdue (the alert itself stays a plain landmark, not an anchor)', () => {
      mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
      renderPage()

      const banner = screen.getByRole('alert')
      expect(banner.tagName).not.toBe('A')
      const link = within(banner).getByRole('link', { name: /view overdue incidents/i })
      expect(link).toHaveAttribute('href', '/incidents?qsc=overdue')
    })

    it('offers a "Show all incidents" link back out of the filter when qsc=overdue is active', () => {
      mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ isOverdue24h: true })] })
      renderPage('/incidents?qsc=overdue')

      expect(screen.getByRole('link', { name: /show all incidents/i })).toHaveAttribute('href', '/incidents')
    })

    it('does not render the "Show all incidents" link when no filter is active', () => {
      renderPage()
      expect(screen.queryByRole('link', { name: /show all incidents/i })).not.toBeInTheDocument()
    })

    it('shows only overdue incidents when visiting /incidents?qsc=overdue', () => {
      mockUseIncidents.mockReturnValue({
        data: [
          baseIncident({ id: 'inc-1', title: 'Overdue one', isOverdue24h: true }),
          baseIncident({ id: 'inc-2', title: 'On-time one', isOverdue24h: false }),
        ],
        isLoading: false,
      })
      mockUseOverdueQscIncidents.mockReturnValue({ data: [baseIncident({ id: 'inc-1', isOverdue24h: true })] })
      renderPage('/incidents?qsc=overdue')

      expect(screen.getByText('Overdue one')).toBeInTheDocument()
      expect(screen.queryByText('On-time one')).not.toBeInTheDocument()
    })
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/pages/IncidentsPage.test.tsx`
  Expected: FAIL — no element has `role="alert"` (today's banner is a plain `<div>`), so every test in the new file fails at `screen.getByRole('alert')` (or, for the first test, passes vacuously while the others fail).
- [ ] **Step 3: Implement**
  In `odip-prototype/odip/frontend/src/pages/IncidentsPage.tsx`:
  ```tsx
  // :8 — add useSearchParams
  import { Link, useSearchParams } from 'react-router-dom'
  ```
  ```tsx
  // immediately after the existing `const [severityFilter, setSeverityFilter] = useState('')` (around :42)
  const [searchParams] = useSearchParams()
  const qscOverdueOnly = searchParams.get('qsc') === 'overdue'
  ```
  ```tsx
  // immediately after `const { data: incidents = [], isLoading } = useIncidents(queryParams)` (around :64)
  const visibleIncidents = qscOverdueOnly ? incidents.filter((i) => i.isOverdue24h) : incidents
  ```
  Replace the three `incidents` usages below it with `visibleIncidents`: the `PageHeader` `subtitle` (`` `${visibleIncidents.length} incident${visibleIncidents.length !== 1 ? 's' : ''}` ``), the empty-state condition (`!isLoading && visibleIncidents.length === 0`), and the `DataTable`'s `data={visibleIncidents}` prop.
  Replace the banner block (`:129-138`). The alert stays a `<div role="alert">` (an anchor with `role="alert"` would lose its link semantics for assistive tech) and carries the link inside it:
  ```tsx
  {/* QSC Overdue Alert Banner */}
  {!showArchived && overdueQsc.length > 0 && (
    <div
      role="alert"
      className="flex items-center gap-3 p-4 rounded-xl bg-error-container border border-destructive/40 text-on-error-container"
    >
      <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold text-sm">{overdueQsc.length} incident{overdueQsc.length !== 1 ? 's' : ''} require QSC reporting — 24-hour deadline exceeded</p>
        <p className="text-xs mt-0.5 opacity-80">NDIS Quality and Safeguards Commission requires reportable incidents to be escalated within 24 hours.</p>
        <Link to="/incidents?qsc=overdue" className="inline-block mt-1 text-sm font-medium underline underline-offset-2">
          View overdue incidents
        </Link>
      </div>
    </div>
  )}
  ```
  Directly after the banner block (still inside the page's top-level container, before the filter/search row), add the escape hatch out of the filter:
  ```tsx
  {qscOverdueOnly && (
    <p className="text-sm text-[var(--color-muted-foreground)]">
      Showing only incidents past the 24-hour QSC deadline.{' '}
      <Link to="/incidents" className="font-medium underline underline-offset-2">Show all incidents</Link>
    </p>
  )}
  ```
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/pages/IncidentsPage.test.tsx` then `npm test` (full suite) then `npm run build`
  Expected: all pass. `npm run build`'s `tsc -b` confirms `bg-error-container`/`border-destructive`/`text-on-error-container` are valid (Tailwind generates them from `--color-error-container`/`--color-destructive`/`--color-on-error-container`, already defined in `index.css`).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/pages/IncidentsPage.tsx odip-prototype/odip/frontend/src/pages/IncidentsPage.test.tsx
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(a11y): QSC overdue banner uses tokens, role=alert, and links to a filter (C-1)

  text-red-400 on bg-red-500/10 computed to 2.32:1 against the page (WCAG
  1.4.3 needs 4.5:1), had no role/aria-live so a screen reader never announced
  a breached statutory deadline, and named a count with no way to reach the
  underlying incidents. Switches to the --color-error-container/--color-
  destructive tokens (7.24:1), adds role="alert", and turns the banner into a
  Link to /incidents?qsc=overdue, which the page now reads to filter the list
  to the overdue incidents by their existing isOverdue24h flag.
  EOF
  )"
  ```

---
### Task 6: Skip link, labelled nav landmarks, and per-route document titles ([I-4])

**Files:**
- Create: `odip-prototype/odip/frontend/src/hooks/useDocumentTitle.ts`
- Modify: `odip-prototype/odip/frontend/src/components/PageHeader.tsx`
- Modify: `odip-prototype/odip/frontend/src/components/layout/AppLayout.tsx:134-135` (skip link, first child of the root `<div>`), `:157` (sidebar `<nav>`), `:336` (`<main>`), `:342` (mobile bottom `<nav>`)
- Test: `odip-prototype/odip/frontend/src/hooks/useDocumentTitle.test.tsx` (new), `odip-prototype/odip/frontend/src/components/PageHeader.test.tsx` (new), `odip-prototype/odip/frontend/src/components/layout/AppLayout.test.tsx` (existing — add 1 describe block)

**Interfaces:** Consumes: nothing new. Produces: `useDocumentTitle(title)` — a hook any page can call, wired once into `PageHeader` so every page already passing a `title` prop gets a distinct `document.title` for free; a keyboard-focusable skip-to-`#main` link as `AppLayout`'s first child; `aria-label="Main"`/`aria-label="Mobile"` distinguishing the two `<nav>` landmarks.

- [ ] **Step 1: Write the failing test**
  ```ts
  // odip-prototype/odip/frontend/src/hooks/useDocumentTitle.test.tsx
  import { describe, it, expect, afterEach } from 'vitest'
  import { renderHook, cleanup } from '@testing-library/react'
  import { useDocumentTitle } from './useDocumentTitle'

  describe('useDocumentTitle (I-4)', () => {
    afterEach(() => {
      cleanup()
      document.title = ''
    })

    it('sets document.title to the given title suffixed with the app name', () => {
      renderHook(() => useDocumentTitle('Incident Reports'))
      expect(document.title).toBe('Incident Reports — Odip')
    })

    it('updates document.title when the title argument changes', () => {
      const { rerender } = renderHook(({ title }) => useDocumentTitle(title), { initialProps: { title: 'Trips' } })
      expect(document.title).toBe('Trips — Odip')

      rerender({ title: 'Participants' })
      expect(document.title).toBe('Participants — Odip')
    })
  })
  ```
  ```tsx
  // odip-prototype/odip/frontend/src/components/PageHeader.test.tsx
  import { describe, it, expect, afterEach } from 'vitest'
  import { render, cleanup } from '@testing-library/react'
  import { PageHeader } from './PageHeader'

  describe('PageHeader — per-route document title (I-4)', () => {
    afterEach(() => {
      cleanup()
      document.title = ''
    })

    it('sets document.title from its title prop, so tab switching and the back button work per-route', () => {
      render(<PageHeader title="Incident Reports" />)
      expect(document.title).toBe('Incident Reports — Odip')
    })

    it('updates document.title when a different page renders with a different title', () => {
      const { rerender } = render(<PageHeader title="Trips" />)
      expect(document.title).toBe('Trips — Odip')

      rerender(<PageHeader title="Participants" />)
      expect(document.title).toBe('Participants — Odip')
    })
  })
  ```
  Add to `odip-prototype/odip/frontend/src/components/layout/AppLayout.test.tsx`:
  ```tsx
  describe('AppLayout — skip link and labelled landmarks (I-4)', () => {
    afterEach(() => {
      localStorage.clear()
    })

    it('renders a skip-to-content link as the first focusable element, pointing at #main', () => {
      renderAt('/trips')
      const skipLink = screen.getByRole('link', { name: /skip to content/i })
      expect(skipLink).toHaveAttribute('href', '#main')
      expect(document.getElementById('main')?.tagName).toBe('MAIN')
    })

    it('gives the sidebar nav and the mobile bottom nav distinct aria-labels', () => {
      renderAt('/trips')
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
      expect(screen.getByRole('navigation', { name: 'Mobile' })).toBeInTheDocument()
    })
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/hooks/useDocumentTitle.test.tsx src/components/PageHeader.test.tsx src/components/layout/AppLayout.test.tsx`
  Expected: FAIL — `useDocumentTitle` doesn't exist yet (module resolution error); the new `AppLayout` tests fail because there's no skip link, no `id="main"`, and both `<nav>`s are unlabelled (`getByRole('navigation', { name: 'Main' })` finds nothing).
- [ ] **Step 3: Implement**
  ```ts
  // odip-prototype/odip/frontend/src/hooks/useDocumentTitle.ts (new file)
  import { useEffect } from 'react'

  /**
   * I-4: gives each route a distinct document.title. Before this, all 30 routes left index.html's
   * static "Odip — NDIS Trip Management" untouched, so tab-switching and the back button carried
   * no per-page orientation. Wired into PageHeader so any page already passing it a `title` gets
   * this for free.
   */
  export function useDocumentTitle(title: string): void {
    useEffect(() => {
      const previousTitle = document.title
      document.title = title ? `${title} — Odip` : 'Odip'
      return () => {
        document.title = previousTitle
      }
    }, [title])
  }
  ```
  In `odip-prototype/odip/frontend/src/components/PageHeader.tsx`, make exactly two additions and leave the rest of the file untouched — add the import at the top, and call the hook as the first statement of the component body:
  ```tsx
  import { useDocumentTitle } from '@/hooks/useDocumentTitle'
  ```
  ```tsx
  export function PageHeader({ title, subtitle, action, children }: PageHeaderProps) {
    useDocumentTitle(title)
    // ...existing JSX unchanged
  ```
  In `odip-prototype/odip/frontend/src/components/layout/AppLayout.tsx`:
  ```tsx
  // :134-135 — first child of the root div
  return (
    <div className="flex min-h-screen bg-[#fbf9f5]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-[var(--color-primary)] focus:text-[var(--color-primary-foreground)] focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:ring-offset-2"
      >
        Skip to content
      </a>
      {/* Mobile overlay */}
  ```
  ```tsx
  // :157 — sidebar nav
  <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto">
  ```
  ```tsx
  // :336 — main
  <main id="main" className="flex-1 px-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8 pb-24 lg:pb-8">
  ```
  ```tsx
  // :342 — mobile bottom nav
  <nav aria-label="Mobile" className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#fbf9f5]/90 backdrop-blur-xl shadow-[0_-8px_24px_-4px_rgba(27,28,26,0.04)] px-6 py-3 flex justify-around items-center z-50">
  ```
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/hooks/useDocumentTitle.test.tsx src/components/PageHeader.test.tsx src/components/layout/AppLayout.test.tsx` then `npm test` (full suite) then `npm run build`
  Expected: all pass. Full suite: no existing test asserts a fixed `document.title` or queries `getByRole('navigation')` without a name filter in a way the new `aria-label`s would break (confirmed — no such assertions exist in the current suite).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/hooks/useDocumentTitle.ts odip-prototype/odip/frontend/src/hooks/useDocumentTitle.test.tsx odip-prototype/odip/frontend/src/components/PageHeader.tsx odip-prototype/odip/frontend/src/components/PageHeader.test.tsx odip-prototype/odip/frontend/src/components/layout/AppLayout.tsx odip-prototype/odip/frontend/src/components/layout/AppLayout.test.tsx
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(a11y): skip link, labelled nav landmarks, per-route document title (I-4)

  Two <nav> landmarks were both unlabelled ("navigation, navigation" in a
  screen reader's landmark list), there was no skip-to-content link (forcing
  every keyboard user through up to 15 sidebar links plus CTA plus sign-out on
  every page load), and grepping src for document.title returned nothing — all
  30 routes shared index.html's static title. Adds a visually-hidden skip link
  to #main, aria-label="Main"/"Mobile" on the two navs, and a useDocumentTitle
  hook wired into PageHeader so every page using it gets a distinct title for
  free.
  EOF
  )"
  ```

---
### Task 7: Resolve real participant/practice names on the incident review step ([I-3])

**Files:**
- Modify: `odip-prototype/odip/frontend/src/pages/IncidentCreatePage.tsx:4` (import `useParticipants`, `useRestrictivePractices`), `:178-180` (new hook calls), `:445-446` (new resolver functions), `:452,466` (review rows)
- Test: `odip-prototype/odip/frontend/src/pages/IncidentCreatePage.test.tsx` (existing — hoist `reviewValueFor`, update 2 assertions, add 1 test)

**Interfaces:** Consumes: `useParticipants()` (`@/api/hooks`, `ParticipantListDto[]` with `id`/`fullName` — already mocked in this test file returning `[{ id: 'participant-1', fullName: 'Sophie Brown', ... }]`) and `useRestrictivePractices(participantId, includeInactive)` (`@/api/hooks`, `RestrictivePracticeDto[]` with `id`/`description` — already imported and used by the child `RestrictivePracticeStep`, and already mocked in this test file via `mockUseRestrictivePractices`). Produces: `participantName(id)`/`practiceLabel(id)` resolvers, in the same style as the existing `staffName(id)`/`tripName(id)` immediately above them, so the Review step's "Involved Participant" and "Linked Practice" rows show real values instead of the literal strings `(selected)`/`(linked)`.

- [ ] **Step 1: Write the failing test**
  In `odip-prototype/odip/frontend/src/pages/IncidentCreatePage.test.tsx`, move the `reviewValueFor` helper (currently declared inside the `'IN-8 producer field trace through to Review'` describe block, around line 521) to module scope, directly below the `addMinimalInjury` helper and above `beforeEach`:
  ```tsx
  /** Reads a Review-step row's value by its `<dt>` label text — the row layout is a fixed
   * `<dt>{label}</dt><dd>{value}</dd>` sibling pair (WizardReviewStep's defaultRenderRow). */
  function reviewValueFor(label: string) {
    return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
  }
  ```
  (leave the two call sites inside `IN-8`'s tests as plain `reviewValueFor(...)` calls — only the declaration moves, and remove it from inside the `IN-8` describe block).

  Update the two existing assertions that currently encode the bug, in the `'IN-8 producer field trace through to Review'` tests (around lines 555 and 608):
  ```tsx
  expect(reviewValueFor('Involved Participant')).toBe('Sophie Brown')
  ```
  (both `marPrefill` and `shiftNotePrefill` in this describe block use `participantId: 'participant-1'`, which the file's `useParticipants` mock resolves to `fullName: 'Sophie Brown'`.)

  Add a new test to the `'IncidentCreatePage — INC-05 link to an authorised practice'` describe block, after `'submits restrictivePracticeId when a practice is linked'`:
  ```tsx
  it('resolves the linked practice to its description on Review, not the placeholder "(linked)"', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [
      { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room during acute crisis.', reviewDate: null, isActive: true },
    ] })
    const user = userEvent.setup()
    renderCreatePage()

    await fillBasicsMinimallyAndNext(user, { title: 'RP incident', incidentTypeOption: /Restrictive Practice Use/i, selectParticipant: true })
    await openAndSelect(user, /Restrictive Practice Type/i, /^seclusion/i)
    await user.click(screen.getByRole('radio', { name: /Seclusion room during acute crisis/i }))
    await clickNext(user) // Restrictive Practice -> Incident Details
    await fillDetailsMinimallyAndNext(user)

    expect(reviewValueFor('Involved Participant')).toBe('Sophie Brown')
    expect(reviewValueFor('Linked Practice')).toBe('Seclusion room during acute crisis.')
  })
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/frontend`): `npm test -- src/pages/IncidentCreatePage.test.tsx`
  Expected: FAIL — the two updated `IN-8` assertions fail because the page currently renders the literal `'(selected)'`; the new INC-05 test fails at both assertions for the same reason plus `'(linked)'`.
- [ ] **Step 3: Implement**
  In `odip-prototype/odip/frontend/src/pages/IncidentCreatePage.tsx`:
  ```tsx
  // :4 — add useParticipants and useRestrictivePractices to the existing import
  import { useCreateIncident, useUpdateIncident, useIncident, useTrips, useStaff, useParticipants, useRestrictivePractices } from '@/api/hooks'
  ```
  ```tsx
  // immediately after the existing `const { data: staff = [] } = useStaff()` (around :179)
  const { data: participants = [] } = useParticipants()
  // I-3: fetch every practice (active + inactive) for the currently-selected participant so the
  // Review step can resolve a linked practice regardless of whether it's since gone inactive —
  // RestrictivePracticeStep fetches its own copy for the picker, scoped to its own concerns.
  const { data: allRestrictivePractices = [] } = useRestrictivePractices(involvedParticipantId || undefined, true)
  ```
  ```tsx
  // :445-446 — add alongside the existing staffName/tripName resolvers
  const staffName = (staffId: string | null | undefined) => staff.find((s) => s.id === staffId)?.fullName ?? '—'
  const tripName = (tripId: string | null | undefined) => trips.find((t) => t.id === tripId)?.tripName ?? '—'
  const participantName = (participantId: string | null | undefined) => participants.find((p) => p.id === participantId)?.fullName ?? '—'
  const practiceLabel = (practiceId: string | null | undefined) => allRestrictivePractices.find((p) => p.id === practiceId)?.description ?? '—'
  ```
  ```tsx
  // :452
  { label: 'Involved Participant', value: involvedParticipantId ? participantName(involvedParticipantId) : 'None' },
  ```
  ```tsx
  // :466
  { label: 'Linked Practice', value: restrictivePracticeId ? practiceLabel(restrictivePracticeId) : 'Not linked' },
  ```
- [ ] **Step 4: Run tests**
  Run: `npm test -- src/pages/IncidentCreatePage.test.tsx` then `npm test` (full suite) then `npm run build`
  Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/frontend/src/pages/IncidentCreatePage.tsx odip-prototype/odip/frontend/src/pages/IncidentCreatePage.test.tsx
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(incidents): resolve real participant/practice names on Review (I-3)

  Every other Review row resolved to a real value except "Involved
  Participant" and "Linked Practice", which rendered the literal strings
  "(selected)"/"(linked)" — unverifiable at the point of filing a statutory
  record. Adds participantName()/practiceLabel() resolvers alongside the
  existing staffName()/tripName(), using data the picker (useParticipants)
  and RestrictivePracticeStep's sibling hook (useRestrictivePractices) already
  fetch.
  EOF
  )"
  ```

---
### Task 8: Include worker screening in `HasExpiredQualifications` (F-3 one-line fix)

**Files:**
- Modify: `odip-prototype/odip/backend/Odip.Domain/Entities/User.cs:40-50`
- Test: `odip-prototype/odip/backend/Odip.Tests/Domain/UserTests.cs` (new)

**Interfaces:** Consumes: `User.WorkerScreeningExpiryDate` (`DateOnly?`, already a field on `User`, `User.cs:38`) — no new field, no migration. Produces: `User.HasExpiredQualifications` now agrees with `DashboardPage.tsx:94`'s existing `!!s.workerScreeningExpiryDate` dashboard tile, which already counts worker screening without a separate "is screened" flag (there isn't one — presence of an expiry date is the flag, exactly as for the other four qualifications gated on their own boolean).

- [ ] **Step 1: Write the failing test**
  ```csharp
  // odip-prototype/odip/backend/Odip.Tests/Domain/UserTests.cs
  using System;
  using Odip.Domain.Entities;
  using Xunit;

  namespace Odip.Tests.Domain;

  public class UserTests
  {
      private static User BuildUser() => new()
      {
          Id = Guid.NewGuid(),
          TenantId = Guid.NewGuid(),
          Username = "jsmith",
          Email = "jsmith@example.com",
          FirstName = "Jamie",
          LastName = "Smith",
      };

      [Fact]
      public void HasExpiredQualifications_IsTrue_WhenOnlyWorkerScreeningHasExpired()
      {
          var user = BuildUser();
          user.WorkerScreeningNumber = "WWCC-12345";
          user.WorkerScreeningExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

          Assert.True(user.HasExpiredQualifications);
      }

      [Fact]
      public void HasExpiredQualifications_IsFalse_WhenWorkerScreeningExpiryIsInTheFuture_AndNothingElseIsSet()
      {
          var user = BuildUser();
          user.WorkerScreeningNumber = "WWCC-12345";
          user.WorkerScreeningExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(30);

          Assert.False(user.HasExpiredQualifications);
      }

      [Fact]
      public void HasExpiredQualifications_IsFalse_WhenNoExpiryDatesAreSetAtAll()
      {
          var user = BuildUser();

          Assert.False(user.HasExpiredQualifications);
      }

      [Fact]
      public void HasExpiredQualifications_IsTrue_WhenAnExistingFlagStillDetectsExpiry_RegressionGuard()
      {
          var user = BuildUser();
          user.IsFirstAidQualified = true;
          user.FirstAidExpiryDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);

          Assert.True(user.HasExpiredQualifications);
      }
  }
  ```
- [ ] **Step 2: Run test to verify it fails**
  Run (from `odip-prototype/odip/backend`): `dotnet test --filter "FullyQualifiedName~UserTests"`
  Expected: FAIL — `HasExpiredQualifications_IsTrue_WhenOnlyWorkerScreeningHasExpired` fails because the current property ORs first aid/driver/manual-handling/medication only, ignoring `WorkerScreeningExpiryDate` entirely, so it evaluates to `false`. The other three pass already (they document existing behaviour) but must be present so the fix can't accidentally regress them.
- [ ] **Step 3: Implement**
  In `odip-prototype/odip/backend/Odip.Domain/Entities/User.cs:40-50`:
  ```csharp
  public bool HasExpiredQualifications
  {
      get
      {
          var today = DateOnly.FromDateTime(DateTime.UtcNow);
          return (IsFirstAidQualified && FirstAidExpiryDate.HasValue && FirstAidExpiryDate.Value < today)
              || (IsDriverEligible && DriverLicenceExpiryDate.HasValue && DriverLicenceExpiryDate.Value < today)
              || (IsManualHandlingCompetent && ManualHandlingExpiryDate.HasValue && ManualHandlingExpiryDate.Value < today)
              || (IsMedicationCompetent && MedicationCompetencyExpiryDate.HasValue && MedicationCompetencyExpiryDate.Value < today)
              || (WorkerScreeningExpiryDate.HasValue && WorkerScreeningExpiryDate.Value < today);
      }
  }
  ```
  (No boolean gate for the new clause — unlike the other four qualifications, `User` has no `IsWorkerScreened` field; `WorkerScreeningNumber`/`WorkerScreeningExpiryDate` being set is itself the signal, matching `DashboardPage.tsx:94`'s `!!s.workerScreeningExpiryDate`.)
- [ ] **Step 4: Run tests**
  Run: `dotnet test --filter "FullyQualifiedName~UserTests"` then `dotnet build` then `dotnet test`
  Expected: all four `UserTests` pass; `dotnet build` is clean; the full `dotnet test` run has no new failures (no other test constructs a `User` with only `WorkerScreeningExpiryDate` set and asserts `HasExpiredQualifications` is `false`).
- [ ] **Step 5: Commit**
  ```bash
  git -c safe.directory=* add odip-prototype/odip/backend/Odip.Domain/Entities/User.cs odip-prototype/odip/backend/Odip.Tests/Domain/UserTests.cs
  git -c safe.directory=* commit -m "$(cat <<'EOF'
  fix(qualifications): include worker screening in HasExpiredQualifications (F-3)

  HasExpiredQualifications ORs first aid, driver licence, manual handling and
  medication competency but omitted WorkerScreeningExpiryDate entirely, while
  DashboardPage.tsx's tile already counts it — the backend flag and the
  dashboard disagreed about the single most consequential expiry in the
  business. No new field/migration: WorkerScreeningExpiryDate already exists
  on User, and (unlike the other four) has no separate "is screened" boolean
  to gate on, matching how the dashboard already treats it.
  EOF
  )"
  ```
