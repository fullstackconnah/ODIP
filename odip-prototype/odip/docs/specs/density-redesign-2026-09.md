# ODIP density redesign — "Ledger, compact" (2026-09-29)

Status: PROPOSED — awaiting owner approval. Scope: keep the Operational Ledger world (palette, Plus Jakarta Sans + Manrope,
Material Symbols, warm tonal depth, Pale Sprout active nav). Change the *spatial system* only, so a 1920px screen carries
roughly 1.6–2x the information it does today. Primary target: office coordinator, desktop 1920px+. Field workers on
touch devices keep today's 44px targets.

Baseline evidence: 1920x1080 screenshots + measurements (sidebar 288px, header 76px, gutters 32px, table rows 53px,
inputs 46px, cards p-5, KPI tiles 110–136px, trip H1 ~56px).

## 1. The one mechanism: a density token layer

Nothing today is tokenised except colour and 3 radii; every component hard-codes Tailwind spacing. Add a small set of
semantic spatial tokens in `src/index.css` and point every shared primitive at them.

| Token | Compact (default, fine pointer) | Comfortable (`pointer: coarse`) |
|---|---|---|
| `--control-h` (button, input, select) | 32px | 44px |
| `--control-h-sm` (row actions, pills) | 24px | 36px (hit area padded to 44px) |
| `--row-h` (table body row) | 34px | 48px |
| `--cell-px` | 12px | 12px |
| `--card-pad` | 12px | 16px |
| `--section-gap` (between page blocks) | 16px | 20px |
| `--field-gap` (form grid gap) | 12px x 16px | 16px x 16px |
| `--gutter` (main content side padding) | 20px | 16px |

Switch: `@media (pointer: coarse)` flips to Comfortable. No user toggle in v1 (can add a `data-density` attribute on
`<html>` later without touching components). WCAG 2.5.8 (AA) needs 24px targets; 32px controls on mouse devices pass.

Radii tighten (dense UIs read as noisy with fat radii): `--radius-sm` 0.5rem → 0.375rem (controls), `--radius-md`
1rem → 0.5rem (cards, tables), `--radius-lg` 2rem → 0.75rem (modals, prominent panels). Replace the 164 `rounded-2xl`
container usages with token classes. Pills stay only for badges, chips, and the active-nav marker.

## 2. App shell (`components/layout/AppLayout.tsx`)

- Sidebar 288px → 232px. Nav items: 32px tall (`py-1.5 px-3`), `rounded-md` not full pills, 18px icons, 2px pitch.
  Active item keeps Pale Sprout fill. Sub-items indent 28px, 28px tall.
- Brand block 64px → 48px. "New Trip" CTA becomes a standard `Button size=md` at the top of nav, not a 44px floating pill.
- Header 76px → 48px fixed (`h-12`), global search 32px tall and 360px wide.
- Main padding `lg:px-8 lg:pt-8` → `px-[--gutter] pt-4`. No max-width on data pages; forms and prose cap at 1600px.
- Replace hardcoded hex in AppLayout with `var(--color-*)` while touching those lines.
- Mobile bottom bar unchanged.

## 3. Page header (`PageHeader`)

- H1 `text-2xl` (24px) → `text-xl` (20px, 700). Trip detail's display-size title → same 20px H1 (one heading scale).
- Subtitle sits inline after the title (muted, 13px) instead of on its own line, or in a meta row of chips.
- Actions on the same row, right-aligned, 32px buttons. Filters/search row directly below, `gap-2`, 32px controls.
- Total header block target: ≤ 72px including filters (today 150–230px).

## 4. Tables (`DataTable`) — biggest single win

- Default becomes compact: `--row-h` 34px (today 53px) → ~1.55x rows per screen. Header 32px, sticky within scroll area.
- Text stays 14px (Density Rule: density from layout, not micro-type). Numbers/IDs/dates `tabular-nums`.
- Container `rounded-2xl` → `rounded-md`. Row actions become 24px icon buttons revealed on row hover/focus (always
  visible on coarse pointers).
- Optional column-visibility menu (existing prop surface permitting) — v1.1, not required.
- Convert the 7 hand-rolled tables to use the same tokens (not necessarily DataTable).
- Trips list: add a **table view** (default on ≥1280px) alongside the current card grid; card grid stays for narrow.

## 5. Detail pages (Trip, Participant, Accommodation, Staff, Claim)

- **Fact bar replaces stat tiles.** Trip detail's four 136px tiles → one 44px strip of `label value [badge]` segments
  separated by rules. Frees ~100px above the tabs.
- **Fact lists (`<dl>`)**: label column fixed 10rem (muted 13px), value column flows; 24px row pitch (today 32px) and no
  50/50 split that leaves 350px of dead air between label and value.
- **Section grid**: `repeat(auto-fill, minmax(26rem, 1fr))` with `align-items: start` → 3 columns at 1920, 2 at 1366,
  and no more short cards stretched to match tall neighbours (the Address-card void).
- Empty values: render sections with all-empty fields as a single muted line ("Not recorded — Edit") rather than ten
  rows of dashes.
- Tabs: 40px tall (`py-2`), counts inline, overflow scrolls silently (existing `.scrollbar-none`).
- Overview tab two-pane layouts: side panel 360px fixed, main flexes; no empty-message-in-a-void — empty states inline.

## 6. Forms (create/edit pages, wizards, modals)

- Inputs/selects 32px (`--control-h`), `px-3`, `rounded-[--radius-sm]`, keep Field Grey fill. Labels 13px/500, 4px gap.
- **Width by content, not by column.** 12-column form grid at ≥1280px; fields declare a span: short (code, region,
  number, date) = 3, medium (name, select) = 6, long (notes, address) = 12. Today every field spans its card.
- Helper text 12px, one line, directly under the field; errors replace helper text in place (no layout jump).
- Sections: cards keep a title, `--card-pad` 12px, 16px between sections; on 1920 the create-trip form fits one screen.
- Wizard shell: `gap-8` → `gap-4`, rail `w-60` → `w-52`, step buttons 32px.
- Modal `p-6` → `p-4`; header/footer 48px.

## 7. Dashboard / Schedule / Roster

- KPI row: `StatCard` becomes a 56px tile (label above, 20px value), all KPIs in one row (`auto-fit, minmax(10rem,1fr)`)
  — replaces today's 3 rows of mismatched tile sizes. Tinted tiles only when the number is non-zero and actionable.
- Upcoming trips: 120px rich rows → 40px list rows (name, date, place, pax, status); icon tile dropped.
- Overdue tasks: same 40px row treatment.
- Schedule matrix / roster board: 34px rows, 28px chips, sticky first column and header.

## 8. Other primitives

| Primitive | Today | New |
|---|---|---|
| Button md / sm / lg | 36 / 28 / 40px | 32 / 24 / 36px (coarse: 44 / 36 / 48) |
| Card | `rounded-xl p-5`, title mb-4 | `rounded-md p-[--card-pad]`, title 14px/600 mb-2 |
| StatCard | text-2xl value, p-3 | see §7 |
| EmptyState | py-24, 64px icon | py-10 page / py-6 in-table, 40px icon |
| SearchInput | py-2.5 | 32px |
| Dropdown panel | rounded-2xl | rounded-md, 32px items |
| StatusBadge | unchanged size (20px), move raw Tailwind palette/hex to tokens |

## 9. DESIGN.md changes (written at finish from the built result)

- Key characteristic "44px minimum touch targets throughout" → "44px on coarse pointers; 32px controls / 34px rows
  on fine pointers (≥ WCAG 2.5.8)".
- New section: Density tokens (table above). Radii updated. Card padding 1.25rem → 0.75rem.
- New rules: **Width by content** (form field spans), **No stretched voids** (`align-items: start` section grids),
  **One heading scale** (no display-size H1 on detail pages).

## Out of scope

Colour/type changes, new features, nav IA regrouping, user density toggle, column-visibility menus (v1.1).

## Rollout (branch `feat/density-redesign`)

1. Tokens + primitives (index.css, Button, Card, StatCard, DataTable, FormField/Text/Select, SearchInput, Dropdown,
   Tabs, Modal, EmptyState, PageHeader) — one agent.
2. App shell — one agent.
3. Page passes in parallel: (a) detail pages + participant sections, (b) forms/wizards/modals, (c) dashboard,
   schedule, roster, trips list table view, (d) remaining list pages + hand-rolled tables.
4. Gates: `npm run build`, `npm test`, `npm run lint` (no new problems), Impeccable detector, 1920 + 1366 + 390
   after-screenshots, finish review, DESIGN.md rewrite.
