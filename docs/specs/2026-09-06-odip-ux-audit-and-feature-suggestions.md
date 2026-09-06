# ODIP — UX/UI Audit and Feature Recommendations

**Date:** 2026-09-06
**Scope:** `odip-prototype/odip/frontend/src` (React 19 / TS / Tailwind 4), read against `odip-prototype/odip/backend` for data grounding.
**Method:** Impeccable skill — `scripts/context.mjs --target odip-prototype/odip/frontend` resolved `PRODUCT.md` as the register (no `DESIGN.md` present), so `reference/product.md` (app UI → product register) governs, applied with `reference/audit.md`'s five-dimension rubric and `reference/critique.md`'s Nielsen/cognitive-load/persona method.
**Evidence basis:** **Code-only.** No browser harness is installed — `odip-prototype/odip/frontend/node_modules` contains neither `playwright`, `@playwright/test`, nor `puppeteer`, and `npx playwright` refuses without a network install. The deployed prototype at `http://192.168.4.70:8475` was not visited. Every finding below is traced to a file and line; none is inferred from a screenshot. Contrast ratios were computed from the literal hex values in the source (WCAG 2.x relative-luminance formula, alpha composited against the actual parent surface).
**Backlog awareness:** cross-checked against `odip-prototype/odip/docs/odip-changes-todo.md`, `docs/specs/odip-updates-2026-09/SPEC-00…05`, and `docs/plans/2026-09-03-caregiver-form-*` so nothing already shipped or already specced is re-proposed.

---

## Executive Summary

- **The codebase is bimodal, and that is the single most consequential finding.** The newest modules (`pages/rostering/`, `pages/portal/`, `components/wizard/`) are genuinely good — tokenised, skeleton-loaded, keyboard-accessible, 44px targets. The oldest (`components/layout/AppLayout.tsx`, `pages/DashboardPage.tsx`) carry 38 and 9 hardcoded hex values and dead controls. PRODUCT.md's "consistent design effort across modules" principle is being violated by *vintage*, not by business priority.
- **The most safety-critical banner in the product fails WCAG AA by 2×.** `IncidentsPage.tsx:131` renders the QSC 24-hour-breach alert as `text-red-400` on `bg-red-500/10` — **2.32:1** against a required 4.5:1 — with no `role="alert"` and no link to the incidents it names.
- **Focus indicators fail non-text contrast across ~72 call sites.** `focus:ring-[var(--color-ring)]/30` computes to **1.61:1**; WCAG 1.4.11 requires 3:1. The solid variant (`ring-[var(--color-ring)]`, 129 sites) is fine at 7.19:1 — the alpha variants are the bug.
- **`--color-surface` is used 5 times and defined nowhere** (`AddActivityModal.tsx:131,151`; `GenerateClaimModal.tsx:74,184,202`) — those panels and inputs render with no background at all.
- **There is no toast/notification system anywhere in the app.** Most mutations confirm success only by navigating away; `ParticipantsPage.tsx:105` deactivates a participant from an inline dropdown with no confirm, no success signal, and no failure signal.
- **`.mobile-card-table` (35 lines of `index.css`) is dead CSS — zero consumers.** All 35 `DataTable` instances, including a 12-column participants table, horizontally scroll raw `<table>` markup on phones.
- **`<tr role="button">` and `<th role="button">` in `DataTable.tsx:329,266`** strip row and columnheader semantics, which also invalidates the `aria-sort` on the same element.
- **A 401 calls `window.location.href` (`api/client.ts:26`), bypassing the react-router blocker that `useUnsavedChangesWarning` relies on** — a token expiry 40 minutes into an incident report silently destroys it.
- **Top features:** a complaints register (a stated core obligation with *zero* backend representation), a real two-deadline reportable-incident clock (24h notification + 5-business-day final report — currently one binary flag), and a shift→billable-event pipeline (`BillableEvent.SourceEntityType` exists and is never written, so shift data is re-keyed into claims by hand, contradicting the product's founding principle).
- **One dated compliance risk:** from 1 July 2026 the NDIA moved travel / cancellation / non-face-to-face off `ClaimType` codes onto dedicated line-item suffixes. `ProdaBulkFileWriter.cs:51` still writes `CANC/REPW/TRAN/NF2F`.

**Audit Health Score: 11/20 — Acceptable (significant work needed).**
**Design Health Score (Nielsen): 22/40 — Acceptable.**

---

# Part A — UX Audit Findings

## A.0 Scorecards

### Audit Health (audit.md rubric)

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2/4 | QSC breach banner at 2.32:1; focus rings at 1.61:1; `role="button"` on `<tr>`/`<th>`; no skip link |
| 2 | Performance | 2/4 | No pagination or virtualisation on 35 tables; no debounce on list search; full-axis Material Symbols variable font *plus* lucide-react |
| 3 | Theming | 2/4 | Three competing styling dialects; 247 hardcoded hex; one undefined token; Tailwind palette leakage |
| 4 | Responsive | 2/4 | `.mobile-card-table` unused; 12-column table on phones; mobile sidebar has no focus trap or Esc |
| 5 | Anti-Patterns | 3/4 | Not AI slop. Tells confined to the dashboard: gradient stack, `hover:scale-[0.98]`, bento grid |
| **Total** | | **11/20** | **Acceptable — significant work needed** |

### Design Health (critique.md, Nielsen 0–4)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No toast system; most saves confirm only by navigation |
| 2 | Match System / Real World | 3 | Strong domain language; but `(selected)` on the incident review step, GUIDs in row labels |
| 3 | User Control and Freedom | 2 | 401 hard-redirect destroys unsaved work; no undo anywhere; backdrop click closes long modals |
| 4 | Consistency and Standards | 2 | 3 styling dialects, 2 icon systems, 7 input classes, 5 h1 treatments, 3 badge components |
| 5 | Error Prevention | 3 | Blocking roster findings + override-reason capture and `BillingValidator` are genuinely strong |
| 6 | Recognition Rather Than Recall | 3 | Critical alert text hidden in a native `title` tooltip; header search is a dead input |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, no bulk actions wired, no column chooser, no saved views, no list export |
| 8 | Aesthetic and Minimalist | 3 | Restrained overall; the dashboard is the outlier |
| 9 | Error Recovery | 2 | Portal does it right; the rest say "check your input" without saying which |
| 10 | Help and Documentation | 1 | No help for NDIS-technical fields where a new coordinator most needs it |
| **Total** | | **22/40** | **Acceptable** |

### Anti-Patterns Verdict

**This does not read as AI-generated,** and that is worth saying plainly. The density is real, the domain vocabulary is real (QSC status, MAR, sleepover vs active night, service streams, HIDPA), the roster board's blocking-finding-with-override-reason flow is something no template produces, and the code comments show someone reasoning about specific failures rather than pattern-matching. Against `reference/product.md`'s actual test — "would a user fluent in Linear/Stripe/Notion trust this, or pause at every subtly-off component" — the answer is mostly *trust*, with pauses concentrated in three places.

The tells that do exist are all on `DashboardPage.tsx`:
- A gradient stack: `bg-gradient-to-br from-[#396200] to-[#4d7c0f]` on the sidebar CTA (`AppLayout.tsx:246`), the same gradient on the avatar (`:292`), and seven more on trip thumbnails (`DashboardPage.tsx:26-34`).
- `hover:scale-[0.98]` on the primary CTA (`AppLayout.tsx:246`) — buttons that *shrink* on hover is an invented affordance; `reference/product.md` bans "reinventing standard affordances for flavour."
- The literal comment `{/* ── Metrics Bento Grid ── */}` (`DashboardPage.tsx:137`) over a 7-column hero-metric grid — the canonical AI dashboard shape.
- `rounded-[2rem]` cards on the dashboard against `rounded-xl` on `Card.tsx:13` and `rounded-2xl` on `DataTable.tsx:219`.

Everything else is earned familiarity.

---

## A.1 Critical

### [C-1] The QSC 24-hour breach banner is unreadable and unannounced

**Location:** `frontend/src/pages/IncidentsPage.tsx:130-138`
**Category:** Accessibility / Copy / IA — WCAG 1.4.3 (AA), 4.1.3

```jsx
<div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
  <p className="font-semibold text-sm">{overdueQsc.length} incident{...} require QSC reporting — 24-hour deadline exceeded</p>
```

**Evidence.** `text-red-400` is `#f87171`. Composited over `bg-red-500/10` on the `#fbf9f5` page ground, the effective background is `#fdeae9`. Contrast: **2.32:1** (AA needs 4.5:1). The border at `red-500/30` computes to **1.48:1** against the page, so the banner's boundary is also invisible. Three separate failures compound here:

1. Colour: unreadable.
2. Semantics: no `role="alert"` and no `aria-live`. A coordinator using a screen reader gets no announcement that a statutory deadline has been breached.
3. Interaction: the banner names a count but is not a link. There is no way to get from "3 incidents are overdue" to *those three incidents* — the QSC column has no filter, so the user scans the table by eye.

Note the token set already contains the correct colours: `--color-destructive: #ba1a1a` on `--color-error-container: #ffdad6` gives **7.24:1**. This banner reached for raw Tailwind reds and got the worst of both.

**Recommendation.** Replace with `role="alert"` + tokens, and make it a filter link:

```jsx
<Link to="/incidents?qsc=overdue" role="alert"
  className="flex items-center gap-3 p-4 rounded-xl bg-error-container border border-destructive/40 text-on-error-container">
```

Add a `qsc=overdue` query-param filter to `queryParams` alongside the existing `status`/`severity` filters (`IncidentsPage.tsx:58-62`).

---

### [C-2] Focus indicators fail non-text contrast at ~72 call sites

**Location:** ~72 files. Representative: `components/Dropdown.tsx:304,372,402`; `components/GenerateClaimModal.tsx:74`; `components/TemplateFormPanel.tsx:183`; `pages/ClaimDetailPage.tsx:12`; `pages/SettingsPage.tsx:261,519`; `pages/TripsPage.tsx:28`; `pages/LoginPage.tsx:126,141,195`
**Category:** Accessibility — WCAG 1.4.11 (AA), 2.4.11 (AA, WCAG 2.2)

**Evidence.** Counting the alpha suffixes across `src`:

| Ring class | Sites | Computed contrast |
|---|---|---|
| `ring-[var(--color-ring)]` | 129 | **7.19:1** ✅ |
| `ring-[var(--color-ring)]/30` | 38 | **1.61:1** ❌ |
| `ring-[var(--color-primary)]/30` | 25 | **1.61:1** ❌ |
| `ring-[var(--color-primary)]/50` | 5 | ~2.6:1 ❌ |
| `ring-[var(--color-ring)]/25` | 3 | **1.43:1** ❌ |
| `ring-[var(--color-primary)]/20` | 1 | ~1.4:1 ❌ |

Seventy-two focusable controls have a focus ring a low-vision keyboard user cannot see — including the entire login form, every Settings input, every Dropdown, and the claim-generation modal. This is not a nuance: the solid variant is already the majority and is already correct, so the fix is deletion of the alpha suffix, not a design decision.

**Recommendation.** Global find/replace `ring-[var(--color-ring)]/NN` and `ring-[var(--color-primary)]/NN` → `ring-[var(--color-ring)]`, then add a `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` recipe to the shared field set (DS-01's natural home) and stop letting each page invent one.

---

### [C-3] `role="button"` on `<tr>` and `<th>` destroys table semantics

**Location:** `frontend/src/components/DataTable.tsx:266` and `:329`
**Category:** Accessibility — WCAG 1.3.1 (A), 4.1.2 (A)

```jsx
// :259-267 — header cell
<th aria-sort={isSortable ? (...) : undefined}
    tabIndex={isSortable ? 0 : undefined}
    role={isSortable ? 'button' : undefined}>

// :324-330 — body row
<tr onClick={...} tabIndex={isClickable ? 0 : undefined}
    role={isClickable ? 'button' : undefined}>
```

**Evidence.** `role="button"` overrides the implicit `columnheader` / `row` role. Two consequences: (a) `aria-sort` is only valid on `columnheader`/`rowheader`/`gridcell`, so with `role="button"` present the sort state is silently dropped from the accessibility tree; (b) a `role="button"` row flattens its cells — a screen-reader user loses the row/column relationship and hears one concatenated string per row instead of navigable cells. This affects all 35 tables, which is the primary way the coordinator persona reads the entire product.

**Recommendation.** Keep native semantics. For the header, wrap the label in a real `<button>` inside the `<th>` and leave `aria-sort` on the `<th>`. For the row, keep `<tr>` unroled and make the first cell's content a `<Link>` (which also gets you middle-click-to-new-tab, currently impossible on any list). Retain the row `onClick` as a convenience only.

---

### [C-4] Token system is not enforced — three dialects, 247 hardcoded hex, one undefined token

**Location:** repo-wide. Worst offenders: `components/layout/AppLayout.tsx` (38), `components/ItineraryPdf.tsx` (34), `components/layout/UserSwitcher.tsx` (18), `components/AuditHistoryTab.tsx` (17), `components/layout/TenantSwitcher.tsx` (16), `components/StatusBadge.tsx` (11)
**Category:** Theming / Consistency

**Evidence.** `index.css` defines a complete `@theme` block (43 colour tokens, 3 radii, 2 font families). Three incompatible ways of consuming it coexist:

| Dialect | Example | Files |
|---|---|---|
| 1. Raw hex | `bg-[#f5f3ef]`, `text-[#396200]` (`AppLayout.tsx:139,147`) | 39 |
| 2. Arbitrary CSS var | `bg-[var(--color-input)]` | 141 |
| 3. Tailwind theme utility | `bg-input`, `text-foreground`, `ring-ring` (`RosterBoardPage.tsx:212,324`) | 17 |

Dialects 2 and 3 emit identical CSS — Tailwind 4 generates `bg-input` from `--color-input` automatically — so 141 files are typing 22 characters where 8 would do. Six files mix both in the same component (`pages/rostering/PatternsPage.tsx`, `components/ExceptionsDrawer.tsx`, `FindingsList.tsx`, `ParticipantRow.tsx`, `ShiftSlideOver.tsx`, `StaffRow.tsx`). Dialect 1 is the real defect: a palette change in `index.css` silently leaves the app shell, the dashboard and the PDF renderer on the old colours.

Worse, **`--color-surface` does not exist**:

```jsx
// components/AddActivityModal.tsx:131
const inputClass = "... bg-[var(--color-surface)] border border-[var(--color-border)] ..."
// components/GenerateClaimModal.tsx:184
<div className="bg-[var(--color-surface)] rounded-xl p-4 grid ...">
```

`index.css` defines `--color-surface-container`, `-low`, `-high`, `-lowest` — never bare `--color-surface`. Those five elements render with `background-color:` unset. It has been invisible because the fallback surface happens to be white.

Also leaking: `bg-blue-100 text-blue-700`, `purple-100`, `orange-100`, `red-100`, `amber-100` in `StatusBadge.tsx:38-49`, and `hover:text-red-400` / `hover:text-green-400` in `ActionButtons.tsx:37,45` (2.77:1 and 1.74:1 respectively). Note the collision this creates: `submitted` (claims) and `ndiamanaged` (plan type) are both `bg-blue-100 text-blue-700` — two semantically unrelated badges that look identical in the same table.

**Recommendation.** Three mechanical steps, in order: (1) define `--color-surface` or replace the 5 usages with `--color-surface-container-lowest`; (2) codemod dialect 2 → dialect 3 and dialect 1 → dialect 3, which is a pure syntax change with no visual delta except in the 39 hex files where it is the point; (3) add an ESLint rule banning `#[0-9a-f]{6}` and bare Tailwind palette names in `className`. This is DS-01's foundation and should land before DS-01's component work.

---

### [C-5] No feedback system: saves are silent, failures are silent

**Location:** repo-wide — no `toast`, `snackbar`, or notification module exists anywhere in `src`. Representative failure: `pages/ParticipantsPage.tsx:100-112`
**Category:** Visibility of System Status / Error Recovery — Nielsen 1, 9

```jsx
<Dropdown variant="pill" value={current}
  onChange={val => updateParticipant.mutate({ id: p.id, data: { ...p, isActive: val === 'Active' } })}
  ... />
```

**Evidence.** This one line does three unsafe things at once. Changing a participant from Active to Inactive — which removes them from rosters and claiming — is a single click in a table row with **no confirmation**. On success there is **no confirmation message**; the only signal is the pill re-rendering after the query invalidates. On failure the mutation rejects, nothing is rendered, and the pill snaps back to its old value with no explanation. The user cannot distinguish "saved" from "silently failed."

This pattern generalises. There are 35 `DataTable`s and dozens of mutation hooks; success feedback across the app is either a `navigate()` away from the form, or nothing. `role="alert"` appears 32 times but almost always for *validation* errors inside a form, not for mutation outcomes.

**Recommendation.** Add one small toast provider (a `<ToastRegion role="status" aria-live="polite">` portal plus a `useToast()` hook — roughly 80 lines, no dependency, CSP-safe). Wire it into the shared mutation hooks in `src/api/hooks/` so every mutation gets a default success/failure toast without per-page work. For the participant status change specifically, add a `ConfirmDialog` (the component already exists) and an undo action in the toast.

---

### [C-6] A 401 destroys unsaved work by bypassing the unsaved-changes guard

**Location:** `frontend/src/api/client.ts:19-27`, interacting with `frontend/src/hooks/useUnsavedChangesWarning.tsx`
**Category:** User Control and Freedom / Data loss — Nielsen 3

```js
function logout() {
  if (loggingOut) return
  loggingOut = true
  localStorage.removeItem('odip_token')
  ...
  window.location.href = '/login'
}
```

**Evidence.** `App.tsx:74-78` deliberately uses a data router *specifically* so `useBlocker` works for `useUnsavedChangesWarning`. That guard protects the incident wizard (`IncidentCreatePage.tsx:443`), the intake wizard, and the profile wizard. `window.location.href` is a full document navigation — `useBlocker` never fires, the `beforeunload` handler is the only thing left, and after `localStorage` has already been cleared there is nothing to return to.

The realistic scenario: a coordinator is 40 minutes into a restrictive-practice incident report. A background query 401s, the refresh path fails (expired Firebase session), and the entire report is gone with no prompt. In a compliance system where the report has a statutory deadline attached, this is the highest-cost bug in the audit.

**Recommendation.** Two changes. (1) Before redirecting, persist the in-flight form: have `useUnsavedChangesWarning` register its `getValues()` into a module-level registry, and have `logout()` snapshot it to `sessionStorage` under a route key, restoring on next login. (2) For wizards specifically, autosave drafts server-side — the incident wizard already has a `Draft` status (`IncidentsPage.tsx:14`) and `CORE-02` shipped partial-save PATCH for participants; incidents should use the same mechanism.

---

## A.2 Important

### [I-1] Every table is a horizontally-scrolling `<table>` on mobile — and the fix already exists, unused

**Location:** `frontend/src/index.css:76-111` (35 lines of `.mobile-card-table` CSS); `frontend/src/components/DataTable.tsx:219,225`
**Category:** Responsive

**Evidence.** `index.css` contains a complete mobile card-view transform: `thead { display:none }`, rows become flex cards, and cells get `content: attr(data-label)` pseudo-headers. Grepping `src` for `mobile-card-table` or `data-label` returns **zero non-test matches**. `DataTable` renders `<table className="w-full text-sm">` in a `overflow-x-auto` div and never applies the class or emits `data-label` attributes.

The consequence at the worst case: `ParticipantsPage.tsx:58-170` defines **12 columns** (Name, NDIS Number, Plan Type, Region, Streams, ♿, High, Support Ratio, Repeat, Status, Alerts, actions). On a phone this is a 12-column table in a horizontal scroller with no row header pinning — the field-worker and on-the-road-coordinator personas cannot use it.

**Recommendation.** Wire the CSS that already exists: add `mobile-card-table` to `DataTable`'s root `<table>` and emit `data-label={typeof col.header === 'string' ? col.header : ''}` on each `<td>`. That is a ~4-line change in `DataTable.tsx` that fixes all 35 tables at once. Separately, add a `priority?: 'primary' | 'secondary'` flag to `Column<T>` so the card view can hide the seven low-signal boolean columns behind a disclosure.

---

### [I-2] Two icon systems render side by side in the same components

**Location:** 13 files import both, including the app shell. `components/layout/AppLayout.tsx:2-6` (lucide) and `:144,177,204,228,277,290` (Material Symbols)
**Category:** Consistency / Performance — `reference/product.md` product ban ("Same icon style")

**Evidence.** 99 files use `lucide-react`; 15 use `.material-symbols-outlined`; **13 of those 15 use both**. In the sidebar specifically, every nav item's leading glyph is a Material Symbol (`<span className="material-symbols-outlined">dashboard</span>`) while its trailing disclosure chevron is a lucide `<ChevronDown className="w-4 h-4" />`, and the CTA below is a lucide `<Plus />`. Different stroke weights, different optical sizing, different baseline metrics, in one 288px column. Same story on `DashboardPage`, `TripsPage`, `TripDetailPage`, `SchedulePage`, `SettingsPage`, `QualificationsPage`, `BookingsPage`, `AccommodationPage`.

There is a cost beyond consistency. `index.html:10` loads Material Symbols across its full variable axis range (`opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200`) — that is a large, render-blocking webfont fetched for 15 files' worth of glyphs, on top of the tree-shaken lucide SVGs already in the bundle.

**Recommendation.** Standardise on lucide (99 files vs 15; it is tree-shaken, it needs no network request, and it survives the strict CSP without a `font-src` allowance). Replace the 15 Material Symbols files — a mapping table of roughly 30 glyph names — and delete both the `<link>` at `index.html:10` and the `.material-symbols-outlined` rule at `index.css:113-122`. This also removes the `fonts.gstatic.com` icon dependency, leaving only the two text families. PRODUCT.md lists Material Symbols as a shipped commitment, so this is a decision to put to the owner rather than a unilateral fix — but the current state (both, mixed, in one nav) is not what that commitment meant.

---

### [I-3] The incident review step will not tell you who the incident is about

**Location:** `frontend/src/pages/IncidentCreatePage.tsx:452` and `:466`
**Category:** Copy / Error Prevention — Nielsen 2, 5

```js
{ label: 'Involved Participant', value: involvedParticipantId ? '(selected)' : 'None' },
...
{ label: 'Linked Practice', value: restrictivePracticeId ? '(linked)' : 'Not linked' },
```

**Evidence.** The Review step is the last screen before a statutory record is filed. Every other row resolves to a real value — `staffName(reportedByStaffId)`, `tripName(tripInstanceId)`, the full injury list — but the two most consequential fields render as the literal strings `(selected)` and `(linked)`. The user cannot verify at the point of submission that the incident is attached to the right participant, or to the right authorised restrictive practice. Given `INC-04`/`INC-05` intend to drive authorised-vs-unauthorised determination off that RP link, an unverifiable link is a compliance hazard, not a cosmetic gap.

The lookup data is already loaded in this component. `staffName()` and `tripName()` are defined immediately above at `:445-446`.

**Recommendation.** Add `participantName(id)` and `practiceLabel(id)` resolvers in the same style and use them. Participants are already fetched for the picker; restrictive practices are already fetched by `RestrictivePracticeStep`.

---

### [I-4] No skip link, no labelled landmarks, no per-route document title

**Location:** `components/layout/AppLayout.tsx:154` (`<nav>` unlabelled), `:339` (second `<nav>` unlabelled), `:333` (`<main>` with no id); `index.html:13`
**Category:** Accessibility — WCAG 2.4.1 (A), 1.3.1 (A), 2.4.2 (A)

**Evidence.** There are two `<nav>` landmarks and neither has an `aria-label`, so a screen-reader user's landmark list reads "navigation, navigation." There is no skip-to-content link, so keyboard users tab through up to 15 sidebar links plus the CTA plus sign-out **on every page load**, on every page, forever. Grepping `src` for `document.title` returns nothing — all 30 routes report the static `index.html` title "Odip — NDIS Trip Management", so browser history, tab switching, and back-button orientation are all useless for a coordinator running six tabs.

**Recommendation.** Three small additions to `AppLayout.tsx`: a visually-hidden `<a href="#main" className="sr-only focus:not-sr-only …">Skip to content</a>` as the first child; `aria-label="Main"` / `aria-label="Mobile"` on the two navs; `id="main"` on the `<main>`. Add a `useDocumentTitle(title)` hook called from `PageHeader` so the title follows the h1 for free across every page that already uses it.

### [I-5] Icon-only destructive actions labelled only by `title`, with a mismatched glyph

**Location:** `frontend/src/components/ActionButtons.tsx:29-56`
**Category:** Accessibility / Error Prevention

```jsx
<button onClick={e => stop(e, onDelete)}
  className="p-1.5 rounded hover:bg-red-500/20 text-[var(--color-muted-foreground)] hover:text-red-400 ..."
  title="Archive">
  <Trash2 className="w-4 h-4" />
</button>
```

**Evidence.** Three problems in one control, used in every list in the app. (a) The accessible name comes only from `title`, the weakest source and one that is never surfaced on touch. (b) The glyph is `Trash2` — universally "delete permanently" — while the label says "Archive"; the action is in fact a soft archive (`useArchiveRestore`). A coordinator hesitating over a delete icon is being made to guess. (c) The hover colours are `red-400` (2.77:1) and `green-400` (1.74:1) on white, both far below the 3:1 non-text minimum, and both outside the token system.

The nearby `ParticipantsPage.tsx:155-163` medication button does it correctly — `title` *and* `aria-label={`View medications for ${p.fullName}`}` — so the right pattern already exists in the codebase.

**Recommendation.** Add `aria-label` with the entity name to all four buttons, swap `Trash2` for `Archive`, and replace the hover colours with `hover:text-destructive` / `hover:text-primary`.

### [I-6] Critical clinical alerts are hidden behind a native tooltip

**Location:** `frontend/src/pages/ParticipantsPage.tsx:126`
**Category:** Accessibility / Recognition — Nielsen 6

```jsx
<span className="inline-flex items-center gap-1" title={entry!.alerts.map((a) => a.message).join('; ')}>
```

**Evidence.** The Alerts column shows counts as coloured pills; the *content* of every alert — including Critical-severity ones the dashboard treats as urgent — is concatenated into a native `title` attribute. Native tooltips are not reachable by keyboard, do not appear on touch, are truncated by the OS at varying lengths, and cannot be read by a screen reader in a controlled way. For a coordinator scanning a caseload, this is the difference between "3 critical" and knowing *which* three things.

**Recommendation.** Replace with a small hover/focus popover (or make the pill a link to `/participants/:id?tab=<deepLinkTab>` — `DashboardPage.tsx:347` already builds exactly that URL from `alert.deepLinkTab`). At minimum, give the pill a real `aria-label` enumerating the alerts.

### [I-7] Mobile sidebar is a modal without any modal behaviour

**Location:** `frontend/src/components/layout/AppLayout.tsx:134-139`
**Category:** Accessibility / Responsive — WCAG 2.1.2 (A), 2.4.3 (A)

**Evidence.** The mobile drawer renders a full-screen scrim (`fixed inset-0 bg-black/40`) and slides the `<aside>` in, but: the scrim is a bare `<div onClick>` with no keyboard equivalent; there is no `Escape` handler; focus is not moved into the drawer, not trapped, and not returned to the hamburger on close; background content is not `inert` or `aria-hidden`, so a screen reader continues to read the page underneath. A keyboard user who opens the menu tabs straight past it into the page behind.

`components/Modal.tsx:29-84` already implements Escape, a Tab trap, scroll lock, and focus return correctly. The drawer should reuse that logic rather than reimplement none of it.

### [I-8] No accelerators anywhere — the primary persona's main cost

**Location:** repo-wide; most visible on `pages/ParticipantsPage.tsx`, `pages/TripsPage.tsx`, `pages/StaffPage.tsx`, `pages/TasksPage.tsx`
**Category:** Flexibility and Efficiency — Nielsen 7 (scored 1/4)

**Evidence.** PRODUCT.md's primary design target is a desk-based coordinator living in these lists all day. What they get:

- **No keyboard shortcuts.** No search focus key, no `g`+letter navigation, no command palette. Zero `keydown` handlers outside modals and the sort header.
- **No bulk actions on the main tables.** `DataTable` fully supports `selectable`, `selectedRows`, `onSelectionChange`, and per-column `bulkEditable` (`DataTable.tsx:81-83,277-287`) — and none of Participants, Trips, Staff, or Tasks passes `selectable`. The capability was built and never adopted.
- **No column chooser and no density control.** `Column<T>` has a `hidden` flag (`:17`) that no page exposes to the user. `compact` exists (`:80`) and is likewise never surfaced. `useUiPreferences` already persists `tableVerticalDividers` per user, so the persistence mechanism is there too.
- **No saved views.** Filter state is component `useState`, lost on navigation and unshareable — a coordinator cannot bookmark "unfilled shifts, my region."
- **No export.** No CSV/XLSX out of any list, in a business whose whole reason for existing is data that must reach Xero, Brevity and PRODA.
- **No debounce.** `SearchInput` fires a query per keystroke on Participants, Staff, Trips and Tasks. Only `AddContactRoleForm.tsx:437` and `ShiftSlideOver.tsx:138` debounce.

**Recommendation.** Sequence: debounce `SearchInput` internally (one file, immediate win); surface `selectable` + `hidden` + `compact` through a shared `<TableToolbar>`; persist filter state to the URL query string (also fixes shareability and back-button); then a command palette. All four are DS-01 work.

### [I-9] Every page title looks different

**Location:** `components/PageHeader.tsx:15` vs `pages/DashboardPage.tsx:129` vs `pages/SchedulePage.tsx:116` vs `pages/LoginPage.tsx:99` vs `pages/ClaimBatchDetailPage.tsx:103`
**Category:** Consistency — Nielsen 4

**Evidence.** Five distinct h1 treatments across 20 pages:

| Treatment | Where |
|---|---|
| `text-2xl font-bold` | `PageHeader` (the shared component — 14 pages) |
| `text-xl md:text-2xl font-bold` | Create/wizard pages (7) |
| `font-display font-extrabold text-2xl md:text-4xl tracking-tight` | Dashboard only |
| `font-display font-extrabold text-2xl md:text-3xl text-primary` | Schedule only |
| `text-2xl font-bold font-mono` | Claim batch detail |

`index.css:63-65` already applies `--font-display` to all headings, so the family is consistent; the *scale and weight* are not. Moving between Dashboard (4xl extrabold) and Participants (2xl bold) reads as two products. This directly contradicts PRODUCT.md's "no module is treated as more hero than another."

**Recommendation.** One `text-2xl font-bold tracking-tight` h1 in `PageHeader`, adopted by all 20 pages including the three that hand-roll it. Drop the `font-mono` on the batch reference into a `<span>` inside the title, where it belongs.

### [I-10] `StatusBadge` fails open into "pending"

**Location:** `frontend/src/components/StatusBadge.tsx:53,56`
**Category:** Error Prevention / Copy

```js
const DEFAULT_COLOR = 'bg-[#fef3c7] text-[#92400e]'   // amber — identical to `pending`
const color = colorMap?.[key] ?? STATUS_COLORS[key] ?? DEFAULT_COLOR
```

**Evidence.** Any status string not in the 30-entry map renders in exactly the same amber as `pending`, `reportedlate` and `medium`. A new backend enum value — say a future `QscReportingStatus` — silently displays as a benign "pending" badge instead of surfacing as unknown. In an app where badges carry regulatory state, failing open into a plausible-looking wrong value is worse than failing loud.

Related: `pulse={i.isOverdue24h}` (`IncidentsPage.tsx:84`) applies `animate-pulse` — an infinite 2s opacity oscillation down to 50% — to the OVERDUE badge, which both reduces its legibility on every other frame and is decorative motion by `reference/product.md`'s definition. And the `label` override at `:82` replaces the QSC status text with `OVERDUE`, so an overdue incident no longer shows whether it is `Required` or `Pending`.

**Recommendation.** Make the default visually neutral-but-obviously-unmapped (`bg-muted text-muted-foreground` plus the raw string), drop `pulse` in favour of a static high-contrast treatment, and render overdue as a *second* badge beside the status rather than replacing it.

### [I-11] Modal backdrop click discards long forms; footers scroll away

**Location:** `frontend/src/components/Modal.tsx:88,100`
**Category:** User Control and Freedom

**Evidence.** `onClick={onClose}` on the backdrop fires on any click whose *release* lands outside the dialog — including a text selection dragged out of a textarea. `Modal` is the base for `ConfirmDialog`, `RecordAdministrationModal` (493 lines), `GenerateClaimModal`, `EditTripModal` (333 lines) and `AddVehicleModal`. Losing a half-written medication-administration record to a stray drag is a realistic daily event.

Separately, the dialog is `max-h-[90vh] overflow-y-auto` with the footer *inside* the scroll container (`:100`, `:104-108`), so in the long modals the Save button scrolls out of view and the user has to scroll to find it.

**Recommendation.** Close on backdrop only when `mousedown` *and* `mouseup` both land on the backdrop. Make the dialog a flex column with a `shrink-0` sticky footer and scroll only the body.

### [I-12] `WizardStepRail` announces "Intake wizard steps" in every wizard

**Location:** `frontend/src/components/wizard/WizardStepRail.tsx:20`
**Category:** Accessibility / Copy

```jsx
<nav aria-label="Intake wizard steps" className="overflow-x-auto">
```

The component is shared by the Incident wizard (`IncidentCreatePage.tsx:545`), the Intake wizard, and the Profile wizard. A screen-reader user filing an incident report hears "Intake wizard steps." One-line fix: add a `label` prop, default `'Wizard steps'`.

### [I-13] Two dead controls in the app shell

**Location:** `frontend/src/components/layout/AppLayout.tsx:276-284` and `:289-291`
**Category:** Consistency / Trust

The header search input has no `value`, no `onChange`, no form, and no handler — it is a placeholder that says "Search trips, participants..." and does nothing. The notification bell button has no `onClick` and no `aria-label` — a screen reader announces it as an unlabelled button. Both sit in the most prominent chrome in the product. Either wire them (a global search over participants/trips/staff is genuinely the coordinator's most-wanted accelerator — see F-13) or remove them; a control that lies about being interactive costs more trust than a missing feature.

---

## A.3 Polish

- **[P-1] Sub-4.5:1 secondary text.** `AppLayout.tsx:148` "NDIS Management" at `text-[#43493a] opacity-70` = **3.85:1**; `:279` search placeholder at `/60` = **3.05:1**. Both are decorative-adjacent but both are text. Drop the opacity and use `--color-muted-foreground` (8.03:1 on the sidebar).
- **[P-2] Sort affordance invisible.** `DataTable.tsx:275` renders the unsorted indicator at `opacity-30` = **1.64:1**. The single cue that a column is sortable is below non-text contrast. Use `opacity-60` (≈3.4:1).
- **[P-3] Form control borders are invisible.** `--color-input: #e4e2de` against white is **1.29:1** and `--color-border: #c3c9b5` is **1.70:1**. WCAG 1.4.11 requires 3:1 for the boundary of a control when that boundary is what identifies it. Darkening `--color-border` to roughly `#8d9480` would clear 3:1 without changing the palette's character.
- **[P-4] `--color-warning: #f59e0b` is 2.04:1 on the page ground** and is used as text at `ItineraryTab.tsx:291`, `BookingsTab.tsx:605` and `StaffTab.tsx:358`, and as a meaning-carrying dot at `StaffRow.tsx:47`. `--color-on-warning-container: #92400e` (6.37:1) already exists for exactly this and is used correctly on `DashboardPage.tsx:121`.
- **[P-5] `EmptyState` icon at `opacity-20`** = 1.51:1 (`EmptyState.tsx:19`). Fine as pure decoration, but it is the only visual anchor of the state; `opacity-40` reads better without becoming loud.
- **[P-6] Row select labels announce GUIDs.** `DataTable.tsx:349`: `aria-label={`Select row ${rowKey}`}` where `rowKey` is a UUID. Add an optional `rowLabel?: (row: T) => string` prop and pass `p.fullName` etc.
- **[P-7] Two competing empty-state systems.** `EmptyState` (42 usages, teaches + offers an action) and `DataTable`'s `emptyMessage` string (30 usages, mostly "No X found"). The `emptyMessage` default is literally `'No data'` (`DataTable.tsx:147`). Pick one; `reference/product.md` is explicit that empty states should teach the interface.
- **[P-8] `TabNav` has no tab semantics.** `TabNav.tsx:14-30` renders plain buttons — no `role="tablist"`/`tab`, no `aria-selected`, no arrow-key roving focus, no focus-visible ring, and no hover state on inactive tabs. It drives the participant detail page, the busiest screen in the product.
- **[P-9] Loading is spinners, not skeletons — inconsistently.** `PortalShiftsPage.tsx:29` and `RosterGridSkeleton` do it right (and the portal's `sr-only role="status"` announcement is exemplary). `DashboardPage.tsx:66` and `DataTable.tsx:299` use bare spinners, causing layout jump. `pages/billing/TableSkeleton.tsx` exists — generalise it into `DataTable`.
- **[P-10] Default Vite favicon.** `index.html:5` still points at `/vite.svg`, and the product is spelled "Odip" here against "ODIP" everywhere else — the open item PRODUCT.md flags. Worth resolving before any external eyes, since the favicon is what a coordinator picks out of six tabs.
- **[P-11] Portal week toolbar overflows on a phone.** `PortalShiftsPage.tsx:71-111` packs a link, two 44px arrows, a `min-w-[10rem]` label and a "This week" button into `PageHeader`'s children row — roughly 420px of content at the field-worker persona's most common width.

---

## A.4 Systemic Patterns

1. **Quality tracks vintage, not module.** `pages/rostering/`, `pages/portal/`, `components/wizard/` are consistently good: tokens, skeletons, `aria-label` on every icon button, `h-11` targets, focus-visible rings, error states with retry. `AppLayout`, `DashboardPage`, `ItineraryPdf`, `AuditHistoryTab`, `TenantSwitcher`, `UserSwitcher` are consistently not. Any remediation plan should be ordered oldest-file-first, and the newest files should be lifted verbatim into DS-01 as the reference implementations.
2. **Capabilities are built and never adopted.** `.mobile-card-table` (0 consumers), `DataTable`'s `selectable`/`bulkEditable`/`hidden`/`compact` (0 consumers), `EmptyState`'s coexistence with `emptyMessage`. Each represents work already paid for and not collected.
3. **Alpha is used as a design tool on things that must meet contrast.** `/30` rings, `/20` icons, `opacity-70` text, `red-500/10` backgrounds. Every contrast failure in this audit except the `--color-warning` and `--color-input` token values is an alpha decision.
4. **Feedback is inline-only.** Errors appear where the form is; nothing appears anywhere else, ever. There is no channel for "saved", "failed", "undo", or "this happened in the background."

## A.5 What Is Working

- **The roster board is the best thing in the product.** `RosterBoardPage.tsx` — blocking vs overridable findings, a required override *reason* captured into `Shift.OverrideReason` and `AcknowledgedFindingCodes`, `KeyboardSensor` alongside `PointerSensor` so drag-assignment is keyboard-operable, a dismissible empty-week hint that does *not* replace the grid (the comment at `:208-210` explains exactly why), and filtering computed from the unfiltered board so an empty filter never masquerades as an empty week. This is domain-literate interaction design.
- **`WSC_EXPIRED` is correctly the single Blocking finding.** `RosterConflictService.cs:35-38,103` singles out worker screening as the one regulatory hard stop that a coordinator cannot override, while everything else is a warning. That is exactly right under the Commission's no-grace-period rule, and it was a deliberate call, documented in a comment.
- **`FormField.tsx` is a properly-built accessible field.** It composes `aria-describedby` from hint + error + a caller-supplied `descriptionId`, distinguishes native inputs from custom controls and labels each correctly, and gives checkbox rows a 44px target without inflating the box. The comments explain the non-obvious choices.
- **The reduced-motion strategy is thought through.** `index.css:162-178` neutralises durations rather than disabling transitions, with a written rationale for why `transition: none` would break focus-reveal patterns. Most codebases get this wrong.
- **Empty states teach.** `IncidentsPage.tsx:149-154` explains what an incident report *is* and mentions QSC reporting before offering the action, and distinguishes "no results for your filter" (with a clear-filters action) from "none exist." That is the standard `reference/product.md` asks for.
- **`BillingValidator` encodes real rejection causes,** not generic validation — booking balance, duplicate claim reference, claim-window deadline, quantity XOR hours, date order, amount arithmetic. It is built from Oassist's actual PRODA rejection log.

---

# Part B — Feature Recommendations

## B.0 Summary Table

| # | Feature | Primary user | Builds on | Size | Priority |
|---|---|---|---|---|---|
| F-1 | Complaints & feedback register | Coordinator, Admin | `IncidentReport` + `AuditLog` pattern | M | **P0** |
| F-2 | Two-deadline reportable-incident clock | Coordinator | `QscReportingStatus`, `PublicHoliday` sync | M | **P0** |
| F-3 | Worker screening & risk-assessed-role register | Admin, Coordinator | `User` screening fields, `WSC_EXPIRED` finding | M | **P0** |
| F-4 | Evidence & document store | All | `TripDocument`, catalogue upload | M–L | **P1** |
| F-5 | Price-limit validation + effective-dated catalogue | Finance | `SupportCatalogueItem`, `BillingValidator` | S–M | **P1** |
| F-6 | July-2026 claim-suffix migration | Finance | `ClaimType`, `ProdaBulkFileWriter` | M | **P1** |
| F-7 | Shift → billable event pipeline | Coordinator, Finance | `BillableEvent.SourceEntityType` (unused) | M | **P1** |
| F-8 | Shift verification: clock in/out, actual vs rostered | Support worker, Finance | `Shift`, portal shift detail | M | **P1** |
| F-9 | Offline-first portal capture | Support worker | Portal pages, TanStack Query | L | **P1** |
| F-10 | Participant goals & outcome reporting | Coordinator, Clinical | `Participant.Goals`, `ShiftNote` | M | **P2** |
| F-11 | Plan budget burn-down & plan-expiry alerts | Coordinator, Finance | `FundingSource`, `ServiceBookingLine`, alerts | S–M | **P2** |
| F-12 | Claim rejection reconciliation | Finance | `BillableEvent.Status`/`RejectionReason` | M | **P2** |
| F-13 | Coordinator work surface | Coordinator | `DataTable` unused capabilities | M | **P2** |

---

## B.1 Detail

### F-1 — Complaints and feedback register

**For:** office coordinator (intake and follow-up), Admin (oversight and audit evidence).

**Problem.** PRODUCT.md lists "a complaints/feedback register" as one of four core compliance capabilities, alongside incidents, restrictive practices and audit logging. The other three exist. This one does not: `grep -ril "complaint"` across the entire `backend` tree returns **zero files**. There is no entity, no controller, no DTO, no UI. Under the NDIS Practice Standards a registered provider must operate a complaints management and resolution system and keep a record of every complaint and the action taken — auditors specifically examine the register for date received, complainant (or an anonymous marker), nature, how received, a unique reference, response actions, resolution and outcome ([NDIS Commission — Complaints about supports and services you provide](https://www.ndiscommission.gov.au/complaints/complaints-about-supports-and-services-you-provide); [Effective Complaint Handling Guidelines for NDIS Providers](https://www.ndiscommission.gov.au/sites/default/files/2024-09/complainthandlingguidelinesforproviders_0.pdf)). Oassist is currently keeping this somewhere outside ODIP, which is precisely the re-keying the product exists to eliminate.

**Builds on.** `Odip.Domain/Entities/IncidentReport.cs` is the structural template — a tenant-scoped register entity with a status lifecycle, a reporter, a reviewer, and audit-logged mutations. `IncidentsController.cs`, `IncidentsPage.tsx` and the `CORE-01` wizard shell give a complete pattern to copy: list + filters + `EmptyState` + a stepped create flow. `AuditLog` already covers every entity generically. `ParticipantAlertsController` gives a place to surface an open complaint on the participant record.

**Shape.** A `Complaint : ITenantEntity` — `Reference` (human-readable, sequential per tenant), `ReceivedAt`, `ReceivedVia` (phone / in-person / email / anonymous), `ComplainantName?` + `IsAnonymous`, `ParticipantId?`, `Nature` (enum + free text), `Status` (Received → UnderReview → Resolved → Closed), `Acknowledgement` timestamps, `ActionsTaken`, `Outcome`, `ResolvedAt`, `FeedsQualityImprovement` flag. A `/complaints` route mirroring `/incidents`, and a cross-link so a complaint that reveals a reportable matter can spawn an incident (the reverse of the existing `INC-03` medication→incident direction).

**Size:** M. **Priority: P0** — it is the only stated core compliance capability with no implementation, and it is the cheapest of the three P0s because the pattern to copy is already in the repo.

---

### F-2 — A real reportable-incident clock: 24-hour notification *and* the 5-business-day report

**For:** office coordinator.

**Problem.** PRODUCT.md says "incident and reportable-incident workflows with 24-hour/5-day countdown timers." What exists is one boolean. `IncidentsPage.tsx:82-84` renders `i.isOverdue24h ? 'OVERDUE' : formatQscLabel(...)` and `useOverdueQscIncidents()` drives a banner. There is no countdown, no second deadline, and no distinction between the two obligations.

The actual obligation is two-stage: an Immediate Notification within **24 hours** of key personnel becoming aware, followed by a detailed **5-business-day** report. Some categories — notably unauthorised use of a restrictive practice — notify within 5 business days *unless* the incident caused harm, in which case the 24-hour clock applies instead ([NDIS Commission — Reportable incidents](https://www.ndiscommission.gov.au/rules-and-standards/reportable-incidents-and-incident-management/reportable-incidents); [Notify us about a reportable incident](https://beta.ndiscommission.gov.au/providers/complaints-and-incidents/notify-us-about-reportable-incident)). "5 business days" is the operative subtlety — a Friday-evening incident is not due Wednesday, and the current model has no concept of it.

**Builds on.** `QscReportingStatus` and `qscReportedAt` / `qscReferenceNumber` already exist on `IncidentReport` and are captured in `ComplianceStep`. `HolidaySyncBackgroundService` + the `PublicHoliday` entity already sync Australian public holidays per state via the Nager provider, and `ProviderSettings.State` says which state — so business-day arithmetic is fully supported by data already in the system. `ParticipantAlertsController` provides the alert-surfacing mechanism.

**Shape.** Add `ImmediateNotificationDueAt`, `ImmediateNotificationSubmittedAt`, `FinalReportDueAt`, `FinalReportSubmittedAt` to `IncidentReport`, computed on transition to a reportable status from `AwareAt` (a new field — awareness time, not incident time, is what the clock runs from). A business-day calculator in `Odip.Domain` reading `PublicHoliday` for `ProviderSettings.State`. In the UI: a live countdown chip on the incident row and detail header with three states (comfortable / due within 4 hours / breached), driving a dashboard tile alongside the existing `qscOverdueCount`, and — fixing **[C-1]** at the same time — a banner that links to the filtered list.

**Size:** M. **Priority: P0** — it is a named core capability delivered at roughly a third of its stated scope, and the missing two-thirds is the part with legal consequence.

---

### F-3 — Worker screening register: risk-assessed roles, suspensions, and point-in-time reconstruction

**For:** Admin (registration evidence), coordinator (rostering safety).

**Problem.** Rostering already blocks correctly — `WSC_EXPIRED` is the single Blocking finding in `RosterConflictService.cs`, which is exactly right given the Commission's no-grace-period rule. The gap is the *record*, and there are three concrete holes:

1. **`HasExpiredQualifications` silently ignores worker screening.** `Odip.Domain/Entities/User.cs:40-50` ORs first aid, driver licence, manual handling and medication competency — and omits `WorkerScreeningExpiryDate` entirely. Meanwhile `DashboardPage.tsx:86-102` *does* count it. So the backend flag and the dashboard tile disagree about the single most consequential expiry in the business.
2. **No record of risk-assessed roles, and no suspension/bar status.** The provider obligation is two written records: one of all risk-assessed roles in the organisation (updated within 20 business days of a role being identified or reclassified), and one per worker capturing full name, date of birth, address, the specific role held, the check number, the clearance expiry, **and any suspension, interim bar, or revocation**. `User` holds only `WorkerScreeningNumber` and `WorkerScreeningExpiryDate` — a suspended-but-unexpired worker looks perfectly clear to the roster engine.
3. **No point-in-time reconstruction.** Records must be retained seven years in a form that lets a Commission auditor determine which workers held risk-assessed roles on any given past date. `User` is a mutable current-state row; updating an expiry date overwrites history. ([NDIS Commission — Worker screening for registered providers](https://www.ndiscommission.gov.au/workforce/worker-screening/worker-screening-registered-providers))

**Builds on.** `User`'s existing screening fields, the `WSC_EXPIRED`/`WSC_MISSING` findings, `QualificationsPage.tsx`'s expiry dashboard, `AuditLog` (which gives history for free if screening changes become their own entity), and `ProviderSettings` for the org-level role record.

**Shape.** A one-line fix to `HasExpiredQualifications`. A `WorkerScreeningRecord : ITenantEntity` with `Status` (Cleared / Suspended / InterimBar / Revoked / Expired / NotHeld), `CheckNumber`, `IssuedAt`, `ExpiresAt`, `StateOfIssue`, `EvidenceDocumentId` (see F-4), and `ValidFrom`/`ValidTo` so it is append-only and reconstructable. A `RiskAssessedRole` lookup plus a `UserRiskAssessedRole` assignment with its own effective dating. Extend `RosterConflictService` so `Suspended`/`InterimBar`/`Revoked` are Blocking exactly as `Expired` is. A "Worker screening" tab on `QualificationsPage` with an "as at date" control that produces the auditor's reconstruction directly.

**Size:** M. **Priority: P0** — the enforcement is right but the evidence is not, and evidence is what an audit actually inspects.

---

### F-4 — Evidence and document store

**For:** all roles; most acutely the coordinator during an audit and the support worker at an incident.

**Problem.** There is exactly one file upload in the entire product: the support catalogue XLSX import at `SettingsPage.tsx:468`. There is no way to attach anything to anything else. Concretely that means: no photo or witness statement on an incident report; no signed service agreement, NDIS plan PDF, behaviour support plan or consent form on a participant; no worker screening card, first-aid certificate or licence scan on a staff member — only an expiry *date*, which is an assertion, not evidence.

`TripDocument` exists and models this correctly (`DocumentType`, `FileName`, `FilePath`, `FileSize`, `DocumentDate`, `UploadedAt`) — but it is trip-scoped and, as far as the frontend is concerned, unreachable.

**Builds on.** `TripDocument` is the entity template. `ParticipantConsent` already models consent records that want a signed artefact attached. `IncidentWitness` wants statements. `SettingsPage`'s XLSX upload proves the multipart plumbing works end to end. `ProdaBulkFileWriter` and the QuestPDF itinerary/Client-Overview generators prove file generation and download already work.

**Shape.** Generalise into a polymorphic `Document : ITenantEntity` — `OwnerType` + `OwnerId` (the same shape `BillableEvent.SourceEntityType`/`SourceEntityId` already uses), `DocumentType`, `ExpiresAt?`, `UploadedByUserId`, plus storage. Australian data residency is a hard requirement in PRODUCT.md, so storage must be a local volume or an `australia-southeast` bucket — decide this before writing code, not after. A shared `<DocumentsPanel ownerType ownerId />` mounts as a tab on participant, staff, incident and trip detail. Expiring documents feed the existing `ParticipantAlerts` and qualifications dashboards.

Note the CSP interaction: `index.html:7` allows `img-src 'self' data: blob:` (fine for previews) but `connect-src` is `'self'` plus Firebase only — same-origin upload works, a third-party storage SDK does not without a `Program.cs` policy change.

**Size:** M–L (storage decision is the L part). **Priority: P1.**

---

### F-5 — Price-limit validation and an effective-dated catalogue

**For:** finance.

**Problem.** `BillingValidator.cs` catches booking balance, duplicate claim references, claim-window deadlines, quantity-XOR-hours, date order and amount arithmetic — a genuinely good list drawn from real rejections. It does not check the one thing the NDIA checks hardest: **whether the unit price exceeds the price limit for that support item, in that state, on that service date.**

Everything needed is already modelled. `SupportCatalogueItem` carries `PriceLimit_ACT` through `PriceLimit_WA` plus `PriceLimit_Remote` and `PriceLimit_VeryRemote`, an `IsIntensive` flag, a `DayType`, and `EffectiveFrom`/`EffectiveTo`. `ProviderSettings.State` says which column applies. `BillableEvent` carries `SupportItemNumber`, `UnitPrice` and `SupportsDeliveredFrom`. Nothing joins them.

There is a second, subtler bug behind it: `CatalogueImportService.cs:128` sets `EffectiveFrom = today` — the *import* date, not the price guide's own effective date. So the catalogue cannot answer "what was the limit on 12 August?", which is exactly what a back-dated or re-submitted claim needs.

**Builds on.** `BillingValidator` (add two rules to an existing list), `SupportCatalogueItem`, `ProviderSettings.State`, `ClaimBatchBuilderPage`'s existing findings display.

**Shape.** Take `EffectiveFrom`/`EffectiveTo` from the imported file rather than stamping `today`. Add a `PRICE_LIMIT_EXCEEDED` **Error** and a `PRICE_BELOW_LIMIT` **Warning** (under-claiming is lost revenue and worth surfacing), resolving the catalogue row by `SupportItemNumber` where the service date falls within the effective window. Add an `ITEM_NOT_IN_CATALOGUE` Error — currently an invented item number sails through to PRODA and is rejected there, days later.

**Size:** S–M. **Priority: P1** — highest revenue-protection-per-hour in this list.

---

### F-6 — Migrate to the July-2026 claim-type suffix model

**For:** finance.

**Problem.** `ProdaBulkFileWriter.cs:51` validates against `{ "", "CANC", "REPW", "TRAN", "NF2F" }` and `MapClaimType` (`:144-154`) derives them from the `ClaimType` enum (`Enums.cs:418-424`). That is the pre-July-2026 model. From 1 July 2026 the NDIA moved travel, telehealth, cancellations, non-face-to-face work and NDIA-requested reports off claim-type codes and onto **dedicated line items formed by suffixing the base item number**, and the cancellation reason is no longer required for `_CA` claims ([NDIS Pricing Arrangements and Price Limits](https://www.ndis.gov.au/media/8096/download?attachment=); [NDIS 2026-27 pricing schedule — what changed in claiming rules](https://www.isoconsultingservices.com.au/ndis-2026-27-pricing-schedule-what-changed-in-claiming-rules-and-what-providers-must-do-now/)).

Oassist is about to run a full operating season on ODIP. If that season is 2026-27, every travel and cancellation claim the current writer produces is built on the superseded model.

**Builds on.** `ProdaBulkFileWriter` (the writer is well-factored — the mapping is isolated in one method, and there is already a `claimTypeCodeOverride` seam at `:99-122`), `Odip.Tests/Billing/BillingPrototypeTests.cs`, and `SupportCatalogueItem` which can carry the suffixed items directly once imported.

**Shape.** First confirm against the current NDIS Support Catalogue which items Oassist actually claims and which suffixes apply — this is a rules-confirmation task before it is a code task. Then: represent the variant on `BillableEvent` as a `ClaimVariant` (Standard / Cancellation / Travel / NonFaceToFace / ReportWriting) that resolves to a suffixed item number at write time; retain the legacy `ClaimTypeCode` path behind an effective-date switch on the service date, since claims for pre-July-2026 service dates still use the old form. Validate the resulting item number against the catalogue (F-5's `ITEM_NOT_IN_CATALOGUE` rule catches a bad suffix for free).

**Size:** M. **Priority: P1** — dated, external, and it silently produces rejected claims rather than failing loudly.

---

### F-7 — Shift → billable event pipeline

**For:** coordinator (stops double entry), finance (stops revenue leakage).

**Problem.** PRODUCT.md's first product principle is "data is entered once in ODIP and pushed outward." Rostering and billing violate it internally. `BillableEvent` has `SourceEntityType` and `SourceEntityId` — fields that exist precisely to trace a claim back to the thing that generated it — and grepping the whole backend shows they are configured in `OdipDbContext` and written **nowhere**. The only `new BillableEvent(...)` in the codebase is `BillingController.cs:270`, a manual create endpoint.

So a completed shift, which already knows its participant, funding source, date, start and end time, ratio and sleepover type, is re-typed into a billable event by hand. Every shift. Every week. Missed shifts are silently unbilled, and there is no way to answer "which delivered shifts have not been claimed?"

**Builds on.** `Shift` (all inputs present), `FundingSource` (participant → route type → funding), `SupportCatalogueItem` (item lookup by ratio, day type and sleepover), `BillableEvent.SourceEntityType`/`SourceEntityId` (the trace fields, waiting), `BillingRouter` (already decides claim-vs-invoice routing), `BillingValidator` (validates the result), `ClaimBatchBuilderPage` (already has an "unclaimed events" view at `:496`).

**Shape.** A `ShiftBillingService` that, on a shift reaching a completed status, derives a draft `BillableEvent`: item number from ratio + `PublicHoliday`-aware day type + `NightType`, hours from start/end (honouring `EndsNextDay`), unit price from the catalogue at the service date, funding source from the participant's active `FundingSource`. Emit as **Draft** for review, never auto-approved — a wrong claim is worse than a late one. Add an "Unbilled delivered shifts" panel to `BillingPage` driven by the absence of a `BillableEvent` with `SourceEntityType = "Shift"`, which is the revenue-leakage report the business currently cannot produce.

**Size:** M. **Priority: P1.**

---

### F-8 — Shift verification: clock in/out and actual-vs-rostered variance

**For:** support worker (evidence of attendance), finance (accurate claiming), coordinator (exception management).

**Problem.** `Shift` has `ServiceDate`, `StartTime`, `EndTime`, `EndsNextDay` — the *roster*. It has no `ActualStartAt` / `ActualEndAt`. There is no clock-in, no clock-out, no record that the shift happened at all beyond its status. That has three consequences: claims are made against rostered rather than delivered time (an NDIA audit risk in both directions); a late start or early finish is invisible to the coordinator until someone mentions it; and the support worker has no record of their own attendance.

It also blocks F-7 from being trustworthy — deriving a claim from rostered time is exactly the assumption an auditor will test.

**Builds on.** `PortalShiftDetailPage` is where the worker already is at the start and end of a shift. `ShiftNote` already proves the portal can write shift-scoped records. `ShiftStatus` gives the lifecycle hook. `RosterConflictService`'s findings model gives a natural home for a `VARIANCE_EXCEEDS_THRESHOLD` exception.

**Shape.** `ActualStartAt`, `ActualEndAt`, `ActualsSource` (worker-entered / coordinator-adjusted), `VarianceMinutes`, and an optional `VarianceReason` required past a configurable threshold. Two large thumb-zone buttons on `PortalShiftDetailPage` — "Start shift" / "End shift" — recording the client's local time (consistent with `MED-04`'s decision for medication administration). Coordinator-side: variance surfaces in the existing `ExceptionsDrawer`. Explicitly **not** geolocation: it is a surveillance decision that needs an owner, not an engineering default, and the CSP/permissions surface is non-trivial.

**Size:** M. **Priority: P1** — and it should land with or just before F-7, since F-7's output is only as good as this input.

---

### F-9 — Offline-first portal capture

**For:** field support worker.

**Problem.** PRODUCT.md names the field support worker as "mobile, on-location during trips, may have poor connectivity." The portal has no offline story at all. TanStack Query is configured with `staleTime: 30_000, retry: 1` (`App.tsx:50-54`) and no persister, so cache is in-memory only: a reload in a dead zone shows a blank page, and a shift note or medication administration composed without signal fails on submit and is lost. A supported holiday in regional Victoria is the *normal* operating case for this business, not the edge case.

**Builds on.** `PortalShiftsPage` / `PortalShiftDetailPage` / `PortalWitnessApprovalsPage` are already the smallest, cleanest, most self-contained surface in the app — the right place to do this first. `RecordAdministrationModal` and the shift-note flow are the two writes that matter. Vite 7 supports a service worker without adding a framework.

**Shape.** Three layers. (1) **Read:** persist the TanStack Query cache for the portal's query keys to IndexedDB so this week's shifts, participant support requirements and medication schedules survive a reload offline. (2) **Write:** an outbox — queue mutations locally with a client-generated idempotency key, replay on reconnect, and require the server to accept that key so a double-replay cannot double-administer a medication. (3) **UI:** an honest connection indicator and a per-item "queued / sent" state, because the one thing worse than losing a note is believing a queued one was filed.

Scope it to the portal only. Extending it to the coordinator's desktop surfaces is a different and much larger problem.

**Size:** L. **Priority: P1** — it is a stated user condition that the product currently does not meet, and it is the difference between the portal being usable on a trip and being decorative.

---

### F-10 — Participant goals and outcome reporting

**For:** coordinator (plan reviews), clinical.

**Problem.** `Participant.Goals` is a single nullable `string`. That is the entire representation of what the participant is trying to achieve — the thing NDIS supports exist to fund, and the thing a plan review is *about*. `ShiftNote.Body` is likewise unstructured free text with keyword flagging bolted on (`ShiftNoteFlagging.cs`) but no link to any goal.

The practical cost lands at plan review: the coordinator must reconstruct months of progress by reading shift notes by hand, and cannot produce evidence that funded supports advanced the participant's goals. That evidence is what secures the next plan.

**Builds on.** `ShiftNote` (already exists, already per-shift, already authored by the worker who was there), `ParticipantRoutine` and the routines/schedule work (which already model what happens on a shift), `Participant.Goals` (migrate the free text in), `AuditHistoryTab`'s timeline UI, and QuestPDF (already generating itineraries and the Client Overview) for the review report.

**Shape.** A `ParticipantGoal : ITenantEntity` — `Title`, `Description`, `Category`, `TargetDate`, `Status`, `PlanPeriodStart`/`End`, ordered. An optional `GoalId` on `ShiftNote` plus a lightweight progress rating, so a worker can tag a note to a goal in one tap without being forced to. A Goals tab on participant detail showing each goal with its linked notes as a timeline, and a "Plan review pack" PDF for a date range: goals, linked progress notes, incidents, and supports delivered. This is the report the coordinator currently assembles in Word.

**Size:** M. **Priority: P2** — high value, but it wants the intake/profile data model (SPEC-05) settled first, and unlike F-1 through F-3 nothing is legally overdue.

---

### F-11 — Plan budget burn-down and plan-expiry alerts

**For:** coordinator, finance.

**Problem.** The data to answer "is this participant's funding going to run out before their plan does?" is fully present and nothing asks the question. `FundingSource` has `Budget`, `PlanStartDate`, `PlanEndDate`. `ServiceBookingLine` has `AllocatedAmount` and `ClaimedAmount`, and `BillingValidator.Apply()` already consumes booking balance so subsequent batches see it. `pages/billing/BalanceIndicator.tsx` and `balanceUtils.ts` already render a per-line balance.

What is missing is the participant-level, time-aware view: spend rate against elapsed plan time, projected exhaustion date, and a warning when a plan is approaching its end with either significant unspent funds (a participant service failure) or an overspend trajectory (an unrecoverable revenue failure). `FUND-01` in the backlog adds plan dates to the participant record and explicitly notes it "underpins future claim-validity and review-reminder logic" — this is that logic.

**Builds on.** `FundingSource`, `ServiceBookingLine`, `BalanceIndicator`, `ParticipantAlertsController` + `ParticipantAlertsBanner` + `alertSeverityStyles` (a complete, working severity/deep-link alert pipeline that already surfaces on the dashboard, the participants table and the participant header), and the dashboard tile pattern.

**Shape.** A burn-down panel on participant detail: budget, claimed, committed (rostered-but-unclaimed, which F-7 makes computable), remaining, plan days elapsed vs remaining, and a projected exhaustion date from the trailing 8-week rate. Three new `ParticipantAlert` types feeding the existing pipeline — `PlanExpiringSoon`, `BudgetProjectedToExhaust`, `SignificantUnspentFunds` — plus a Billing-page roll-up across the caseload.

**Size:** S–M (the alert types are near-free; the projection panel is the work). **Priority: P2.**

---

### F-12 — Claim rejection reconciliation

**For:** finance.

**Problem.** `BillableEvent` has `Status` (including `Rejected`) and `RejectionReason`, and `BillingValidator` writes them for *pre-submission* failures. Nothing writes them for the rejections that actually cost money — the ones the NDIA returns after a bulk upload. There is no import of the PRODA remittance or return file, so post-submission reconciliation happens in a spreadsheet, and a rejected line either gets re-keyed by hand or quietly never gets paid.

`ClaimBatch` records `FileName` and `SubmittedAt` but has no notion of a response, so the batch's real outcome lives entirely outside the system.

**Builds on.** `ProdaBulkFileWriter` (the CSV column contract is already encoded precisely, which is exactly what a return-file parser needs), `ClaimBatch`, `BillableEvent.Status`/`RejectionReason`/`ClaimReference` (the join key), `SettingsPage`'s XLSX upload for the file-import UI pattern, `ClaimBatchDetailPage` for the display surface.

**Shape.** A remittance import on `ClaimBatchDetailPage` that matches returned rows to `BillableEvent` by `ClaimReference`, setting `Paid` / `PartiallyPaid` / `Rejected` with the NDIA's reason code and paid amount. A per-batch reconciliation view: submitted vs paid vs rejected, with variance. A "Rejected — needs action" queue that can correct and re-batch a line rather than forcing a fresh manual entry. Over time the rejection-reason histogram tells you which `BillingValidator` rule to write next, which is how that validator got good in the first place.

**Size:** M (the file format needs a real sample to build against). **Priority: P2** — clearly valuable, but F-5 and F-6 prevent rejections and this one cleans up after them; prevention first.

---

### F-13 — Coordinator work surface: saved views, bulk actions, columns, command palette

**For:** office coordinator — the primary design target.

**Problem.** This is the feature framing of audit finding **[I-8]**, and it is included here because it is the largest gap between "the primary persona" and "what the primary persona gets." Nielsen heuristic 7 scored 1/4. The coordinator spends the day in list views and has no keyboard shortcuts, no bulk actions, no column control, no saved filters, no export, and a header search box that does nothing (`AppLayout.tsx:276-284`).

The striking part is how much is already built: `DataTable` supports `selectable`, `selectedRows`, `onSelectionChange`, per-column `bulkEditable` with a dropdown, `hidden` columns, and `compact` density — and **no page passes any of them**. `useUiPreferences` already persists a per-user table preference, proving the persistence path.

**Builds on.** `DataTable.tsx:81-88,277-287` (unused capabilities), `useUiPreferences.ts` (per-user prefs), `Dropdown` / `ToggleGroup` / `SearchInput` (existing controls), `permissions.ts` (so bulk actions respect ReadOnly), and DS-01, whose stated purpose is exactly this consolidation.

**Shape.** In order of value-per-hour: (1) debounce `SearchInput` internally — one file. (2) Lift filter state into the URL query string on every list page, making views bookmarkable and shareable and fixing the back button. (3) A shared `<TableToolbar>` exposing column visibility and density, persisted through `useUiPreferences`. (4) Turn on `selectable` for Participants, Trips, Staff and Tasks with the bulk actions each genuinely needs (assign region, set status, archive). (5) CSV export from any `DataTable`, which is trivial once columns are already declared. (6) A `⌘K` command palette over participants, trips, staff and shifts — and *that* is what the dead header search box should become.

**Size:** M. **Priority: P2** — nothing here is a compliance risk, so it sits behind the P0/P1 work; but for the person PRODUCT.md names as the primary design target, it is the single biggest daily-friction win available.

---

# Part C — Suggested Sequencing

The ordering principle: **fix what is legally or financially exposed, then fix what is systemically expensive, then build.** Two things run in parallel throughout — DS-01 foundation work (which every later item consumes) and the audit's Critical fixes (which are small and unblock nothing but cost trust every day they stay).

### Stage 0 — Immediately, before anything else (roughly a week)

These are small, isolated, and each one is currently doing active harm.

1. **[C-1]** QSC banner: tokens, `role="alert"`, link to a filtered list.
2. **[C-2]** Strip the alpha off ~72 focus rings — mechanical find/replace.
3. **[C-4a]** Define `--color-surface` (or repoint the 5 usages). Five elements currently render with no background.
4. **[C-3]** Remove `role="button"` from `<tr>`/`<th>` in `DataTable`; restore `aria-sort` validity.
5. **[I-3]** Resolve `(selected)` / `(linked)` to real names on the incident review step.
6. **[I-4]** Skip link, `aria-label` on both navs, `useDocumentTitle` in `PageHeader`.
7. **[I-1]** Wire the already-written `.mobile-card-table` CSS into `DataTable` — 4 lines, fixes 35 tables.
8. **F-3's one-line fix:** add `WorkerScreeningExpiryDate` to `HasExpiredQualifications`.

*Why first:* every item is under a day, none has a dependency, and together they move accessibility from 2/4 toward 3/4 and remove the two outright bugs (undefined token, dashboard/backend disagreement on screening).

### Stage 1 — Compliance floor (the P0 features)

9. **F-1 — Complaints register.** Start here among the P0s: it is the cleanest copy of an existing pattern, so it is also the cheapest way to prove the Stage-0 design fixes hold up on a brand-new module.
10. **F-2 — Two-deadline incident clock.** Business-day arithmetic on top of the public-holiday sync that already runs.
11. **F-3 — Worker screening register.** Effective-dated records, suspension status, "as at date" reconstruction.

*Why here:* these three are the difference between "we have compliance features" and "we can survive an audit." Oassist is about to run a full season on this system; the season is the audit evidence.

### Stage 2 — Money integrity, in dependency order

12. **F-5 — Price-limit validation + effective-dated catalogue.** Smallest, highest revenue protection, and F-6 needs the effective-dating fix anyway.
13. **F-6 — July-2026 claim-suffix migration.** Confirm the rules against the current Support Catalogue first; the code change is the smaller half.
14. **F-8 — Shift clock in/out.** Before F-7, not after — F-7's claims are only defensible if they derive from delivered rather than rostered time.
15. **F-7 — Shift → billable event pipeline.** With F-5 validating the output and F-8 supplying honest input, this is where the "entered once" principle finally becomes true between two modules.

### Stage 3 — Field reality and the systemic fixes

16. **F-9 — Offline-first portal.** The largest single item in this document; start it once the portal's write surface has stopped changing (F-8 lands first for that reason).
17. **[C-5] Toast system + [C-6] 401 draft preservation.** Both are cross-cutting and both get easier once the shared mutation hooks are the single place every write goes through.
18. **[C-4b] Codemod the three styling dialects** to Tailwind theme utilities, then add the lint rule that stops dialect drift returning. Do this *after* Stage 1–2 feature work rather than before, so the codemod runs over the final file set once instead of colliding with in-flight branches.
19. **[I-2] Resolve the two-icon-system question** with the product owner (it touches a PRODUCT.md brand commitment), then execute whichever way it lands.
20. **F-4 — Document store.** The data-residency storage decision should be made during Stage 2 so implementation is unblocked here.

### Stage 4 — Leverage

21. **F-13 — Coordinator work surface,** delivered incrementally in its stated order (debounce → URL filter state → table toolbar → bulk actions → export → command palette). Each step ships independently.
22. **F-11 — Budget burn-down and plan alerts.** Cheap once F-7 makes committed spend computable.
23. **F-12 — Rejection reconciliation.** Needs a real NDIA return file to build against; the rejection histogram it produces then feeds the next round of `BillingValidator` rules.
24. **F-10 — Goals and outcome reporting.** Last of the features, first of the next horizon: it wants the SPEC-05 data model fully settled, and it is the natural companion to the caregiver profile form already planned in `docs/plans/2026-09-03-caregiver-form-*`.

### One thing to decide before Stage 1

Two open questions gate later work and should be answered by the product owner while Stage 0 runs:

- **Where do documents live?** (F-4). Australian data residency is a hard requirement; the answer changes whether F-4 is an M or an L, and F-3's screening evidence wants it.
- **Icons: Material Symbols, lucide, or both?** (I-2). PRODUCT.md lists Material Symbols as a shipped commitment; the current state — both, mixed, in the primary nav — is not what that commitment meant, and every new component built before this is settled inherits the ambiguity.

---

## Sources

- [NDIS Quality and Safeguards Commission — Reportable incidents](https://www.ndiscommission.gov.au/rules-and-standards/reportable-incidents-and-incident-management/reportable-incidents)
- [NDIS Quality and Safeguards Commission — Notify us about a reportable incident](https://beta.ndiscommission.gov.au/providers/complaints-and-incidents/notify-us-about-reportable-incident)
- [NDIS Quality and Safeguards Commission — Worker screening for registered providers](https://www.ndiscommission.gov.au/workforce/worker-screening/worker-screening-registered-providers)
- [NDIS Quality and Safeguards Commission — Complaints about supports and services you provide](https://www.ndiscommission.gov.au/complaints/complaints-about-supports-and-services-you-provide)
- [NDIS Quality and Safeguards Commission — Effective Complaint Handling Guidelines for NDIS Providers (PDF)](https://www.ndiscommission.gov.au/sites/default/files/2024-09/complainthandlingguidelinesforproviders_0.pdf)
- [NDIS — Pricing Arrangements and Price Limits](https://www.ndis.gov.au/media/8096/download?attachment=)
- [NDIS — Travel claiming rules, gap fees and other costs](https://www.ndis.gov.au/news/10827-travel-claiming-rules-gap-fees-and-other-costs)
- [ISO Consulting Services — NDIS 2026-27 pricing schedule: what changed in claiming rules](https://www.isoconsultingservices.com.au/ndis-2026-27-pricing-schedule-what-changed-in-claiming-rules-and-what-providers-must-do-now/)
