# ODIP Impeccable Review — Per-Page Audit, Critique & Completion Suggestions

**Date:** 2026-09-07

**Method:** dual-agent (A: 8 isolated page-group design reviewers · B: deterministic detector agent). Browser evidence: not attempted — no browser automation available; all evidence is code-level (file:line).

**Scope:** all 39 routed pages under odip-prototype/odip/frontend/src (47 routes in App.tsx; create/edit pairs reviewed as one page).

**Held scores:** Audit Health **13/20 — Acceptable** · Design Health **22/40 — Acceptable** (both from the post-Stage-0 re-score on 2026-09-06; this review does not re-score the platform).

**Why the platform scores are held, not raised:** the 8 isolated page-group reviewers' own numbers run higher than the held platform scores — per-page heuristic means sum to 25.5/40 (visibility 2.72, match 3.41, control 2.54, consistency 2.54, error prevention 2.67, recognition 2.87, flexibility 1.69, aesthetic 3.08, error recovery 2.38, help 1.56) and per-page audit means to 14.8/20 (a11y 2.82, performance 3.10, theming 2.90, responsive 2.82, anti-patterns 3.21). That gap is expected rather than a contradiction: a reviewer scoring one page at a time cannot see the cross-page inconsistency — C-4's three styling dialects, I-7's drawer pattern, I-11's modal-backdrop behaviour — which is exactly what pulls Control, Consistency, Flexibility and Help down once the product is judged as one system instead of 39 independent screens. The platform scores stand; per-page scores below are each page's own local score, not an argument to move the platform number.

## Overall impression

Quality tracks module vintage. The newer or recently-rebuilt modules — Rostering's blocking/warning override flow, the Participants/intake wizard family's shared `SectionEditPanel` vocabulary, the newer Billing pipeline's stale-validation guard, and the entire Worker Portal — are close to production-grade, with genuine engineering care around error prevention, connectivity failure, and non-color-alone status signalling. Older or parallel surfaces carry the app's worst anti-patterns almost undiluted: the legacy TripClaim page still uses `alert()`-adjacent single-click status flips with zero confirmation, the App shell's SuperAdmin impersonation controls are a different colour language with no confirm and a silent full reload, and `/schedule`'s core assign/unassign interaction is plain `<div onClick>` with no keyboard path at all. But the one finding repeated in every single one of the 8 group reports, more than any styling or accessibility gap, is completion, not design: backend endpoints, hooks, and DTO fields are built and simply never reached by a screen — accommodation reservations, vehicle assignments, the claim-batches list, Activity CRUD, per-booking funding fields, worker-screening verification metadata. The fastest, highest-value work on this list is wiring existing capability, not building new capability.

## Design Health

| # | Nielsen heuristic | Platform score /4 | Per-page mean | Strongest page (score) | Weakest page (score) |
|---|---|---|---|---|---|
| 1 | Visibility of system status | 2 | 2.72 | `/portal` (4) — tied with Intake wizard, Profile wizard | `/schedule` (1) — tied with Claim Batch Detail |
| 2 | Match between system & real world | 3 | 3.41 | 17 pages tied at 4 (Participants, Incidents, Rostering, Medications, Portal, …) | `/caregiver/:token` (2) — the one page below 3 |
| 3 | User control & freedom | 2 | 2.54 | `/medications/new and /medications/:id/edit` (4) | `/claims/:id`, `/billing/claim-batches/new`, `/billing/claim-batches/:id` (1) |
| 4 | Consistency & standards | 2 | 2.54 | `/rostering`, `/rostering/patterns`, `/rostering/compatibility`, `/portal` (4) | `(shell)`, `/`, `/settings`, `/claims/:id` (1) |
| 5 | Error prevention | 3 | 2.67 | `/incidents/new and /incidents/:id/edit`, `/billing/claim-batches/new`, `/rostering`, `/rostering/patterns`, `/medications/new and /medications/:id/edit` (4) | `(shell)`, `/trips`, `/vehicles/new and /vehicles/:id/edit`, `/claims/:id` (1) |
| 6 | Recognition rather than recall | 3 | 2.87 | `/portal/witness-approvals` (4) — the only page to reach it | `(shell)`, `/caregiver/:token`, `/accommodation`, `/bookings`, `/staff`, `/billing/claim-batches/:id` (2) |
| 7 | Flexibility & efficiency of use | 1 | 1.69 | 25 pages tied at 2 — **no page anywhere scored above 2** | 11 pages tied at 1 |
| 8 | Aesthetic & minimalist design | 3 | 3.08 | `/rostering`, `/medications`, `/medications/new and /medications/:id/edit`, `/portal`, `/portal/shifts/:id`, `/portal/witness-approvals` (4) | `/`, `/schedule`, `/claims/:id` (2) |
| 9 | Help users recognize/diagnose/recover from errors | 2 | 2.38 | `/portal`, `/portal/shifts/:id` (4) | `/login`, `/trips`, `/accommodation/:id`, `/tasks/new and /tasks/:id/edit` (1) |
| 10 | Help & documentation | 1 | 1.56 | `/medications` (4) — the only page anywhere to score a 4 | 19 pages tied at 1 (roughly half the app) |

**Design Health (held): 22/40 — Acceptable.**

Two dimensions carry the platform score below its per-page mean by the widest margin, and both are structural rather than page-local: Flexibility (#7) never earns better than a 2 on any single page reviewed — nowhere in the app is there a keyboard-shortcut set, a saved view, or a bulk action mature enough to earn a 3 — and Help (#10) sits at 1/4 on about half the app, with `/medications` the sole page to reach a 4, entirely on the strength of `MissedMedicationGuidance`'s escalation copy.

### Audit Health

| Dimension | Platform score /4 (post-Stage 0) | Per-page mean /4 | Weakest page (score) |
|---|---|---|---|
| Accessibility (a11y) | 3 | 2.82 | `/trips`, `/schedule` (1) |
| Performance | 2 | 3.10 | `/` (Dashboard), `/tasks/new and /tasks/:id/edit`, `/incidents`, `/rostering/compatibility` (2) |
| Theming (design-token usage) | 2 | 2.90 | `(shell)`, `/claims/:id` (1) |
| Responsive | 3 | 2.82 | 10 pages tied at 2, incl. `(shell)`, `/schedule`, `/participants`, `/bookings`, `/staff`, `/claims/:id`, `/billing`, `/rostering/compatibility` |
| Anti-patterns | 3 | 3.21 | `/` (Dashboard) (1) |

**Audit Health (held): 13/20 — Acceptable.** Platform figures are the 2026-09-06 post-Stage-0 re-score (see the A.0 table in `2026-09-06-odip-ux-audit-and-feature-suggestions.md`). Performance and Theming sit a full point below their per-page means because the platform-level defects (no pagination/virtualisation on any table; three styling dialects) are only visible across pages.

## Anti-Patterns verdict

**Not AI slop.**

Detector (Assessment B): 2 findings, both rule `gray-on-color`, both **false positives**:
- `src/pages/settings/TenantDetailView.tsx:343` — the extractor cross-paired classes from opposite ternary branches (`active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'`); the flagged pairing (`bg-green-100` + `text-gray-600`) never actually renders together.
- `src/pages/trip-detail/BookingsTab.test.tsx:30` — the same cross-pairing artifact, this time across two keys of a `PAYMENT_STATUS_COLORS` object literal, and it's inside a `*.test.tsx` mock, not live UI code, so even a genuine finding here would be inert.

The one real detector signal — a CSP `<meta>` tag at `index.html:8` — is a working policy (script-src/connect-src scoped to self + Firebase) delivered via meta tag rather than header; the detector correctly classifies this rather than flagging it as a defect.

LLM reviewers' anti-patterns mean: **3.21/4**, the highest of the five audit dimensions — the strongest evidence against templated/AI-slop authorship. Reviewers repeatedly called out hand-written domain logic (NDIS restrictive-practice authorisation preview, PRN dose-ceiling override, idempotent pattern generation with created-vs-skipped counts) as genuinely well-engineered, not boilerplate.

Pages scoring ≤2 on anti-patterns, with reason:
- **`/` (Dashboard) — 1/4:** "Resolve" links on both dashboard cards only navigate; neither resolves or dismisses anything, and the task version doesn't even deep-link to the specific task. Qualification-issue counting also re-derives expiry math in the component body on every render instead of being memoized or server-computed.
- **`(shell)` — 2/4:** the mobile bottom-nav "New Trip" FAB and Trips/People links bypass the same `canWrite`/`canAccessPage` checks the desktop sidebar enforces.
- **`/schedule` — 2/4:** three visible controls (Filter, Download, Timeline toggle) have no `onClick` handler at all, and the unassign flow shows a fake "Unassigned" success chip for a full second *before* the confirm dialog it's supposed to follow even opens.
- **`/vehicles/new and /vehicles/:id/edit` — 2/4:** Total Seats and Wheelchair Positions are validated as non-empty strings, not numbers — a non-numeric entry silently becomes `0` on save via `Number(payload.totalSeats) || 0`.

## What's working

- **Rostering's blocking-vs-warning finding model** — a Blocking finding hard-stops the save with no escape hatch, a Warning requires a typed override reason that is stored and re-shown on every reopen — real error prevention with a paper trail. `pages/rostering/RosterBoardPage.tsx:106-122,290-347`, `pages/rostering/components/ShiftSlideOver.tsx:394-422`.
- **Shared `SectionEditPanel` vocabulary** gives all ~15 Participant Detail cards identical edit/cancel/save/error chrome instead of 15 one-off forms, including a dirty-state discard confirmation. `pages/participant-detail/SectionEditPanel.tsx`.
- **`GeneratePatternDialog`'s two-step preview-then-confirm** for bulk shift generation states plainly that re-running is idempotent and reports created-vs-skipped counts afterward — genuine reassurance on a destructive-adjacent bulk action. `pages/rostering/components/GeneratePatternDialog.tsx:40-96`.
- **Trip sub-resource tabs' consistent two-choice ConfirmDialog** (soft-cancel vs. hard-delete, with a plain-language consequence line for each option) across Bookings, Accommodation, Staff and Activities. `pages/trip-detail/BookingsTab.tsx:788-837` and siblings.
- **`ClaimBatchBuilderPage`'s stale-validation guard and dry-run microcopy** — a prior "clean" validation is invalidated the instant selection changes, and "Read-only — validating never creates or changes anything" sits directly beside the Validate button. `pages/ClaimBatchBuilderPage.tsx:154-179,386-388`.
- **The entire Worker Portal scores highest in the app** on both audit and design axes: an explicit connectivity-failure state with working retry (`pages/portal/PortalShiftsPage.tsx:116-130`), skeletons that mirror the real layout exactly with `aria-live` announcements outside the `aria-hidden` wrapper, and status signalling that is never color alone.
- **`BalanceIndicator`'s icon + bold color + text + full-sentence `aria-label`** pattern for remaining-balance status. `pages/billing/BalanceIndicator.tsx:31-54`.
- **`MissedMedicationGuidance`'s non-diagnostic, tap-to-call escalation sequence**, sourced from the org's own manager contact and state health line. `pages/medications/MissedMedicationGuidance.tsx:61-127`.
- **Participants list's tailored empty states and skeleton-pulse Alerts column** distinguish "no participants at all" from "no matches," and never let an Info-only alert read as "no alerts." `pages/ParticipantsPage.tsx:118-146,195-210`.
- **The Intake wizard's clean separation of "Save as draft" from "Complete Intake"** — a dedicated `completeIntake` flag rather than a reused `isDraft`, so an abandoned session is never mis-reported as complete. `pages/intake/IntakeWizardPage.tsx:280-330`.

## Systemic findings across groups

- **Backend capability outpaces frontend exposure, everywhere.** The single most repeated pattern across all 8 groups: a fully-built endpoint, hook, or DTO field with zero UI consumer. Evidence: accommodation reservations (`backend/Odip.Api/Controllers/BookingsAccommodationController.cs:394-408`, unused by `AccommodationPage.tsx`/`AccommodationDetailPage.tsx`), vehicle assignments (`backend/Odip.Api/Controllers/VehiclesStaffController.cs:118-131`, no `/vehicles/:id` route exists), the claim-batches list (`backend/Odip.Api/Controllers/BillingController.cs:329-345` + `frontend/src/api/hooks/billing.ts:117-125`, zero consumers), Activity CRUD (`pages/SettingsPage.tsx:182-201`), Task entity FKs (`backend/Odip.Domain/Entities/BookingTask.cs:13-20`), the dashboard's `conflictCount` (`pages/DashboardPage.tsx:77,116-123`), trip documents (`frontend/src/api/hooks/documents.ts:5-9`), and per-booking funding/logistics fields (`api/types/bookings.ts:39-61`).
- **Hardcoded, non-token colors recur inside a token-driven system**, in nearly every group reviewed — a per-page-local instance of C-4: the shell (`pages/SettingsPage.tsx:337-342,666-676`), Trips/Schedule (`pages/schedule/StatusBadge.tsx:7-11`, `TripStatusBadge.tsx:9-10`, `helpers.ts:14`), Accommodation/Vehicles (`pages/AccommodationPage.tsx:88-90`, `pages/VehiclesPage.tsx:20,189,242`), Billing/Claims (`pages/ClaimBatchBuilderPage.tsx:281,493`, `pages/ClaimDetailPage.tsx:95,104,115,141,149,170` — the single worst offender in the app), and Medications (`pages/medications/RegisterTab.tsx:25-26`, `pages/MedicationFormPage.tsx:326,529`). Related: C-4.
- **State-changing actions fire on a single click with no confirmation and no error feedback**, unevenly even within one feature area — a per-page-local instance of C-5: Trips status pills (`pages/TripsPage.tsx:274-280`), Staff active/inactive toggle (`pages/StaffPage.tsx:64-80`), Bookings cancel (`pages/BookingsPage.tsx:63-78`), funding-source active/inactive (`pages/BillingPage.tsx:150-164`), and, most consequentially, claim status changes to Paid/Rejected on the legacy claims page (`pages/ClaimDetailPage.tsx:61-64,100-127`) — directly contrasted, in the same group, against `ClaimBatchBuilderPage`'s careful "cannot be undone" confirm dialog. Related: C-5.
- **The app's own `useUnsavedChangesWarning` hook is inconsistently wired.** Settings' Provider Settings/Qualification Warnings tabs, the Intake and Profile wizards, and the legacy Claim Detail notes field all lack it, while 12+ comparable create/edit pages (Trip, Staff, Vehicle, Task, Medication, Incident, Accommodation) already use it correctly. Related: C-6.
- **Two areas of the app run parallel, drifting implementations of the same feature.** Trip editing exists twice — `pages/TripsPage.tsx:294-470` and the more accessible `pages/trip-detail/EditTripModal.tsx:148-333`; staff scheduling exists as two independent systems with their own status enum (legacy `StaffAssignment`/`AssignmentStatus` on `/schedule` vs. the newer `Shift`/`ShiftStatus` on `/rostering`), and neither UI ever advances its enum to `Completed` — the root blocker for the F-7/F-8 shift-to-billing pipeline; there are also two independently-implemented `StatusBadge` components with incompatible APIs. Related: F-7, F-8.
- **Write-route gating (`requiresWrite`) is applied inconsistently.** `/trips/new` and `/participants/new` redirect a ReadOnly user away entirely; `/accommodation/new`, `/accommodation/:id/edit`, `/vehicles/new`, `/vehicles/:id/edit`, `/staff/new` and `/staff/:id/edit` do not, so a ReadOnly coordinator can fill out an entire form before a silent 403 on submit. Evidence: `frontend/src/App.tsx:94,108,110,112-116`.
- **`DataTable`'s existing `selectable`/`bulkEditable` capability sits unused** on most list pages that would benefit most from it — Trips, Participants, Incidents and Tasks all lack bulk actions despite the mechanism already existing and being consumed elsewhere (Bookings tab, Claims tab). Related: F-13, S-23.
- **Icon-only controls labelled only by a native `title` attribute** recur across the shell, Settings, Staff, and Incidents/Tasks — the same anti-pattern the platform review already flagged once (I-5), reproduced independently in at least four more places rather than fixed at the shared component. Related: I-5.
- **Archive/soft-delete is reimplemented per entity, and one implementation is actually broken.** Accommodation, Vehicles, Staff and Tasks each hand-roll their own archive/restore wiring instead of sharing one contract; Incidents' version is confirmed broken — its DELETE sets `IsActive=false` while the Archived tab filters on `status=Closed`, so an archived incident vanishes from both views with no UI path back (see PP-2).
## Priority issues

Numbered PP-1 … PP-100 across the whole report, in severity order (P0 first), ordered within each severity by impact to the office coordinator / compliance. Every issue from the 8 group JSONs is kept — none dropped.

### P0 — blocks task completion

| # | Page | Issue | Why it matters | Fix | Command | Evidence | Related |
|---|------|-------|-----------------|-----|---------|----------|---------|
| PP-1 | `/billing/claim-batches/new` — Build Claim Batch | 'Create claim batch' navigates to a route that does not exist. | ClaimBatchBuilderPage.tsx:195 calls navigate(`/claim-batches/${batch.id}`), but the only registered detail route in the app is `/billing/claim-batches/:id` (App.tsx:129) — there is no `/claim-batches/:id` route and no catch-all route in App.tsx. The single action on this entire page that is described as irreversible silently fails to show its own result; the coordinator lands on a blank/unmatched path with no batch reference, no PRODA download prompt, and no way back except re-navigating from memory. | Change the navigate target to `/billing/claim-batches/${batch.id}` to match the registered route. | `harden` | frontend/src/pages/ClaimBatchBuilderPage.tsx:195; frontend/src/App.tsx:128-129 | — |

### P1 — significant difficulty or WCAG AA violation (23)

| # | Page | Issue | Why it matters | Fix | Command | Evidence | Related |
|---|------|-------|-----------------|-----|---------|----------|---------|
| PP-2 | `/incidents` — Incident Reports list | Archiving an incident (the trash/delete action) sets `IsActive=false` on the backend, but the 'Archived' tab filters on `status=Closed` while GetAll's default `isActive`-true filter still applies underneath it — and Update never writes `IsActive` back to true at all. | An archived incident disappears from the Active list (correctly) but never appears in the Archived list either, and the 'Restore' action (which PUTs `{ ...i, status:'Draft', isActive:true }`) is a no-op because `isActive` isn't even a field on UpdateIncidentDto — so a coordinator has no UI path to ever see or recover an archived incident report again. | Either make the incident Delete endpoint set `Status = Closed` (matching the frontend's own `archiveVia:'status', archiveStatus:'Closed'` config, the same pattern Tasks already uses correctly) or change `IncidentsController.GetAll`'s isActive default so the Archived view actually queries `IsActive=false`, and add IsActive to UpdateIncidentDto so Restore can work. | `harden` | pages/IncidentsPage.tsx:56-65; hooks/useArchiveRestore.tsx:40-42; api/hooks/incidents.ts:64-70; Odip.Api/Controllers/IncidentsController.cs:141-157; Odip.Api/Controllers/IncidentsController.cs:576-586; Odip.Api/Controllers/IncidentsController.cs:416-480 | — |
| PP-3 | `/billing/claim-batches/:id` — Claim Batch Detail | No page anywhere lists existing claim batches, even though the backend and the frontend data layer for one are fully built. | BillingController.GetClaimBatches and the frontend useClaimBatches hook exist with a complete ClaimBatchListDto (FileName, CreatedAt, SubmittedAt, EventCount, TotalAmount), but grepping the frontend for useClaimBatches returns only its own definition — no route or component ever calls it. The only ways to reach a claim-batch detail page are (a) create a new one and have the builder's navigate() succeed (currently broken) or (b) already know/bookmark its GUID URL. This is exactly the screen a coordinator needs to re-open constantly — to re-download a PRODA file, check a batch's submitted state, or find last month's file for a query — and there is no browse/find path to it at all. | Add a claim-batches list page at a route such as /billing/claim-batches, rendered with the same DataTable pattern used elsewhere in this module, linked from a BillingPage tab or button; each row links to /billing/claim-batches/:id. | `layout` | backend/Odip.Api/Controllers/BillingController.cs:329-345; frontend/src/api/hooks/billing.ts:117-125; frontend/src/App.tsx:127-129; frontend/src/pages/BillingPage.tsx:79-90 | — |
| PP-4 | `/claims/:id` — Claim Detail (legacy TripClaim pipeline) | No confirmation and no error feedback on claim status changes (Submitted / Paid / Rejected). | These are financially consequential, largely one-way transitions (Paid/Rejected offer no further action at all afterward beyond the always-present downloads), yet they fire on a bare button click with no ConfirmDialog and no onError handling in useUpdateClaim — contrast with ClaimBatchBuilderPage in the same group, which wraps its one mutating action in a ConfirmDialog with explicit 'cannot be undone' copy and surfaces createMutation.isError inline. | Add a ConfirmDialog for Mark as Paid/Rejected (Submitted is lower-stakes but still benefits from a lightweight confirm), and add an onError handler that surfaces a visible failure message near the buttons. | `harden` | frontend/src/pages/ClaimDetailPage.tsx:61-64,100-127; frontend/src/api/hooks/claims.ts:47-57 | C-5 |
| PP-5 | `/participants/new and /participants/:id/intake` — Intake wizard | The Intake wizard never calls the app's own `useUnsavedChangesWarning` hook. | Navigating away mid-wizard (browser back, closing the tab, clicking a nav link) silently discards every field typed so far, unlike every other comparable create form in the app, which all warn first. | Call `useUnsavedChangesWarning(formState.isDirty)` and render its `dialog`, matching the pattern already used in pages/StaffCreatePage.tsx and pages/TripCreatePage.tsx. | `harden` | pages/intake/IntakeWizardPage.tsx:93; hooks/useUnsavedChangesWarning.tsx:26; pages/StaffCreatePage.tsx | — |
| PP-6 | `/caregiver/:token` — Public caregiver wizard | The wizard's generic Review-step fallback (used for every step except 'About you') renders raw camelCase field names as labels (e.g. 'personalInterests', 'middleName') and, for any array-valued field (consents on Cultural & Consents, adlAssessments on Daily Living), renders `String(value)` on an array of objects — which produces literal '[object Object]' text. | This is the last screen an unauthenticated, first-time family member sees before submitting compliance-relevant data about someone else, and it can visibly show broken '[object Object]' text for exactly the consent and ADL-assessment data that matters most. | Reuse the label()/norm() helpers that already solve this correctly on the admin-side diff view (lib/caregiverDiff.ts) for the caregiver wizard's own Review step instead of maintaining a second, weaker fallback. | `harden` | pages/caregiver/CaregiverWizardPage.tsx:254-261; lib/participantSchema.ts:518-520; lib/participantSchema.ts:539-545 | — |
| PP-7 | `/caregiver-submissions and /caregiver-submissions/:id` — Caregiver submissions queue and review | The Reject panel is a hand-built `role="dialog"` div with no aria-modal, no Escape handler, no focus trap, and no focus return on close. | Every other multi-field dialog in this same page group (and across the app) uses the shared Modal component, which has all four of those behaviours; a keyboard or screen-reader user rejecting a submission gets a visibly worse, inconsistent experience on the one action page in this group that most needs it. | Replace the inline div with `<Modal open={showReject} onClose={...} title="Reject submission">` wrapping the same note textarea and buttons. | `harden` | pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx:109-137; components/Modal.tsx:29-52; components/Modal.tsx:67-75; components/Modal.tsx:86 | — |
| PP-8 | `/rostering` — Roster board | ShiftSlideOver's create/edit form has no Status field at all, and the frontend's CreateShiftDto/UpdateShiftDto type has no status property — so every save through the roster board's own edit UI omits it from the request body. | The backend's UpdateShiftDto.Status defaults to ShiftStatus.Draft when the field is absent from the JSON body, meaning every edit made through this page's own slide-over silently resets that shift's status back to Draft, even if it had ever been advanced past it. No shift can ever durably reach Published or Completed through this UI, which is the root reason F-7's shift→billable-event pipeline has nothing to trigger on. | Add Status to CreateShiftDto/UpdateShiftDto and expose it (at minimum a Published/Completed toggle) in ShiftSlideOver, always sending the shift's current status back unchanged unless the user deliberately changes it. | `harden` | pages/rostering/components/ShiftSlideOver.tsx; api/types/rostering.ts:124-139; backend/Odip.Application/DTOs/RosteringDTOs.cs:157-160 | F-7, F-8 |
| PP-9 | `/schedule` — Schedule overview | The core write interaction on this page — clicking an 'Available' cell to assign, or an 'Assigned' cell to unassign — is implemented as a plain <div onClick> with no role, tabIndex, aria-label, or keyboard handler. | This is the page's primary task and it is entirely mouse-only: a keyboard-only or screen-reader user cannot assign or unassign a single staff member or vehicle to a trip from this page at all. | Convert both interactive states in StatusBadge to real <button type="button"> elements (or add role='button' + tabIndex=0 + onKeyDown for Enter/Space) with descriptive aria-labels. | `harden` | pages/schedule/StatusBadge.tsx:42-53; pages/schedule/StatusBadge.tsx:56-69 | — |
| PP-10 | `/tasks/new and /tasks/:id/edit` — Task create/edit form | Editing a single task fetches the entire tenant's task list client-side and searches it for the matching id, bypassing TanStack Query entirely. | The code's own comment states there is no single-task GET endpoint. TasksController exposes only GetAll/Create/Update/Delete, so every edit-task page load downloads every task in the tenant via a raw `apiClient.get` call instead of the app's established `useTasks`/hook pattern (used by every sibling edit page, e.g. IncidentCreatePage's `useIncident(id)`), and won't scale as the season's task count grows. | Add `GET /api/v1/tasks/{id:guid}` and a `useTask(id)` hook; load the edit form the same way IncidentCreatePage loads `useIncident(id)`. | `harden` | pages/TaskCreatePage.tsx:70-71; pages/TaskCreatePage.tsx:83-110; Odip.Api/Controllers/TasksDashboardController.cs:15-129 | — |
| PP-11 | `/tasks/new and /tasks/:id/edit` — Task create/edit form | A failed (or empty-result) background fetch in edit mode leaves the form silently on its create-mode defaults, with no error shown. | `fetchTask`'s catch block only calls `console.error`, and there is no `else` branch when the task isn't found in the returned list — nothing distinguishes a genuinely-new-looking task from a load that silently failed, so a coordinator could work from wrong assumptions about what they're editing. | Track a `loadError`/`notFound` state and render a visible message, mirroring the mutation-error banner already used lower on this same page. | `harden` | pages/TaskCreatePage.tsx:83-110 | — |
| PP-12 | `/trips/:id` — Trip detail | The tab switcher (Overview/Bookings/.../History) lacks ARIA tabs semantics entirely — no `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, or `aria-controls`. | Screen-reader and keyboard users cannot perceive this as a tab group or determine which tab is active; this is a distinct, page-specific gap from the platform's landmark/skip-link findings (I-4). | Wrap the tab bar in `role="tablist"`, give each button `role="tab"` + `aria-selected` + `aria-controls`, and wrap each panel in `role="tabpanel"`. | `harden` | pages/TripDetailPage.tsx:162-182 | — |
| PP-13 | `/trips/:id` — Trip detail | TasksTab is entirely read-only: no add, edit, complete, or reassign action, and no link into task creation pre-scoped to this trip. | A coordinator must leave the trip, open the global Tasks flow, and manually re-select this trip from a picker just to add one task to it — for a page whose header metric literally highlights 'Outstanding Tasks'. | Add an 'Add Task' button pre-filled with `tripInstanceId`, plus an inline status-cycle control per row. | `harden` | pages/trip-detail/TasksTab.tsx:1-62; pages/TaskCreatePage.tsx:1-56 | S-22, S-23 |
| PP-14 | `/trips` — Trips list | The per-card 'Edit trip' button is only reachable/visible on `:hover` (`max-w-0 overflow-hidden group-hover:max-w-[2rem]`, `opacity-0 group-hover:opacity-100`) with no `:focus-within` or `:focus-visible` equivalent. | Keyboard-only and touch users cannot discover or activate the edit action from the list at all. | Add `focus-within:opacity-100 focus-within:max-w-[2rem]` alongside the hover classes and confirm the button stays in tab order with a visible focus ring. | `harden` | pages/TripsPage.tsx:262-273 | — |
| PP-15 | `/trips` — Trips list | Trip status pill changes call `patchTrip.mutate` with no `onError`, and the backend's pre-departure gate can reject a status change to InProgress with a 400. | If the gate fires, the coordinator sees the pill silently do nothing (or revert on refetch) with zero explanation of why the trip can't start. | Add an onError handler that surfaces the backend's gate message (e.g. 'at least one confirmed staff assignment is required') near the pill or as a toast. | `harden` | pages/TripsPage.tsx:274-280; Odip.Api/Controllers/TripsController.cs:244-261 | C-5 |
| PP-16 | `/bookings` — Bookings (cross-trip list) | Selecting Cancelled or No Longer Attending in the status pill mutates immediately with no confirmation, unlike every archive action elsewhere in this group. | Cancelling a booking is at least as consequential as archiving a vehicle (it triggers RecalculateStaffRequired and drops the participant from the trip's attendance), yet it's a single accidental dropdown click here versus a two-step confirm everywhere else in the group. | Route the Cancelled/NoLongerAttending transitions through the same ConfirmDialog pattern used by AccommodationPage/VehiclesPage, or gate it behind S-30's cancellation-cleanup flow once built. | `harden` | pages/BookingsPage.tsx:63-78; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:234-249 | S-30 |
| PP-17 | `/accommodation/:id` — Accommodation detail | Website values without an http(s) prefix are silently hidden instead of shown as text. | The create form never requires or normalizes a protocol, so a coordinator who types 'oceanview.com.au' will never see it again on this page with no error or fallback - it just disappears. | Normalize the URL on submit (prepend https:// if missing) or relax the render condition to show the raw value as plain text when it doesn't match the URL pattern. | `harden` | pages/AccommodationDetailPage.tsx:94-99; pages/AccommodationCreatePage.tsx:192-194 | — |
| PP-18 | `/accommodation/new and /accommodation/:id/edit` — Accommodation create/edit | The /accommodation/new and /accommodation/:id/edit routes carry no requiresWrite gate, unlike /trips/new and /participants/new. | A ReadOnly user who reaches this URL directly (bookmark, back button, typed URL) gets the full create/edit form instead of being redirected away, and only discovers they lack permission when the save silently 403s behind a misleading 'check your input' message. | Add requiresWrite to the /accommodation/new and /accommodation/:id/edit route definitions, matching the pattern already used for /trips/new and /participants/new. | `harden` | frontend/src/App.tsx:108; frontend/src/App.tsx:110; frontend/src/App.tsx:94 | — |
| PP-19 | `/vehicles/new and /vehicles/:id/edit` — Vehicle create/edit | Total Seats and Wheelchair Positions are validated as non-empty strings, not as numbers - a non-numeric entry silently becomes 0 on submit. | vehicleSchema declares totalSeats: z.string().min(1, ...) and wheelchairPositions: z.string() with no numeric check; onSubmit then does Number(payload.totalSeats) \|\| 0, so 'abc' passes validation and is saved as 0 with zero user-facing feedback - a real capacity/wheelchair-count record silently corrupted. | Use z.coerce.number().min(0) (matching AccommodationCreatePage's pattern for the same kind of field) so a non-numeric entry fails validation with a visible error instead of being coerced to 0. | `harden` | pages/VehicleCreatePage.tsx:27-28; pages/VehicleCreatePage.tsx:78-79 | — |
| PP-20 | `/vehicles/new and /vehicles/:id/edit` — Vehicle create/edit | The /vehicles/new and /vehicles/:id/edit routes carry no requiresWrite gate, unlike /trips/new and /participants/new. | A ReadOnly user reaching this URL directly gets the full create/edit form instead of being redirected away, discovering the block only when the save silently 403s. | Add requiresWrite to both route definitions, matching /trips/new and /participants/new. | `harden` | frontend/src/App.tsx:112; frontend/src/App.tsx:113; frontend/src/App.tsx:94 | — |
| PP-21 | `(shell)` — App shell | Mobile bottom nav bypasses the same permission and write-access checks the desktop sidebar enforces. | A ReadOnly or restricted-access coordinator on a phone gets links and a FAB that always render, then silently bounce them to the dashboard on tap instead of being hidden like their desktop equivalents. | Filter the mobile bottom-nav items through permissions.canAccessPage and gate the FAB behind permissions.canWrite, mirroring the sidebar's own logic. | `harden` | odip-prototype/odip/frontend/src/components/layout/AppLayout.tsx:253; odip-prototype/odip/frontend/src/components/layout/AppLayout.tsx:348-369 | — |
| PP-22 | `(shell)` — App shell | Switching tenant or impersonating a user has no confirmation and reloads the page immediately. | These are the highest-blast-radius actions a SuperAdmin can take in the product — silently discarding whatever they were doing on the current page, with no undo beyond a separate "Exit view" action after the fact. | Add a lightweight confirm step before switchTenant/selectUser fire, and warn if there are unsaved changes on the current page before the reload. | `harden` | odip-prototype/odip/frontend/src/components/layout/TenantSwitcher.tsx:57-68; odip-prototype/odip/frontend/src/components/layout/UserSwitcher.tsx:24-44 | C-6, S-25 |
| PP-23 | `/login` — Login | Login failures are not announced to assistive tech, and the error message is identical for every failure mode. | A screen-reader user gets no signal that submission failed at all; a sighted user can't tell a network error, a rate limit, and wrong credentials apart, unlike the much better dev-login error handling 20 lines below. | Add role="alert" (or aria-live="polite") to the error container, and branch handleSubmit's catch the same way handleDevLogin already does for its own errors. | `harden` | odip-prototype/odip/frontend/src/pages/LoginPage.tsx:49-51; odip-prototype/odip/frontend/src/pages/LoginPage.tsx:106-110 | — |
| PP-24 | `/settings` — Settings | Native browser alert() is used for Support Catalogue import failures. | Blocks the thread, can't be styled or dismissed gracefully, and is inconsistent with every other error path in the same file, which use inline banners. | Replace both alert() calls with the same inline error-banner pattern ProviderSettingsTab already uses. | `harden` | odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:389; odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:406 | — |

### P2 — annoyance with workaround (54)

| # | Page | Issue | Why it matters | Fix | Command | Evidence | Related |
|---|------|-------|-----------------|-----|---------|----------|---------|
| PP-25 | `/billing/claim-batches/new` — Build Claim Batch | Validation Warning-severity pills and row tint use raw Tailwind palette utilities instead of tokens. | bg-amber-100/text-amber-700 and bg-amber-50 sit beside a correctly token-driven Error treatment (--color-error-container), reproducing C-4 inside the one workflow whose entire purpose is presenting NDIA-compliance findings — and it is also the same amber the audit already flagged as under-contrast at P-4. | Replace with the existing --color-warning-container / --color-on-warning-container tokens (already used correctly on DashboardPage). | `harden` | frontend/src/pages/ClaimBatchBuilderPage.tsx:281,493 | C-4, P-4 |
| PP-26 | `/incidents/new and /incidents/:id/edit` — Incident report wizard | Family/support-coordinator notification can only be recorded after the incident already exists, because the Compliance step is edit-mode-only. | A coordinator filing the report at the moment family is actually notified has to save, reopen, and add that fact separately — friction on a time-relevant compliance fact that ideally gets captured once. | Expose FamilyNotified/FamilyNotifiedAt/SupportCoordinatorNotified/At as an optional section available even in create mode (e.g. on the Details step), leaving the QSC/review-only fields edit-only. | `layout` | pages/IncidentCreatePage.tsx:63-76; pages/incidents/steps/ComplianceStep.tsx:21-29 | S-7 |
| PP-27 | `/incidents/new and /incidents/:id/edit` — Incident report wizard | A witness's submitted statement is never shown anywhere in the incident wizard. | `IncidentWitnessDto.StatementText` is returned by the API and populated when a witness responds on the portal, but WitnessesStep's own doc comment confirms it deliberately renders type/name/status only — so the actual account of what happened, the evidence a coordinator needs to review and close the incident, is invisible in the tool built to review it. | Render each responded witness's `statementText` read-only in WitnessesStep or ComplianceStep once present. | `clarify` | pages/incidents/steps/WitnessesStep.tsx:36-45; Odip.Api/Controllers/IncidentsController.cs:251-261 | — |
| PP-28 | `/incidents/new and /incidents/:id/edit` — Incident report wizard | Every save failure — including a ReadOnly/unauthorised user's 403 — shows the same hardcoded message: 'Failed to ... incident report. Please check your input and try again.' | 'Check your input' is actively wrong guidance for a permissions failure, and per lib/permissions.ts's own documented design, ReadOnly and SupportWorker users are deliberately allowed to reach this entire multi-step form only to have the backend reject the save — so this exact scenario is expected to happen, not an edge case. | Surface the real API error status/message (e.g. a 403 → 'You don't have permission to file incident reports') instead of one hardcoded string. | `harden` | pages/IncidentCreatePage.tsx:408-445; pages/IncidentCreatePage.tsx:557-561; lib/permissions.ts:80-91 | — |
| PP-29 | `/medications` — Medications (MAR / Register / Report) | Warning-state styling is hardcoded Tailwind amber utilities instead of the design token used elsewhere in this module. | Two dialects of 'warning' color exist side by side — MissedMedicationGuidance already uses --color-warning-container, but RegisterTab's schedule-4/8 chip and MedicationFormPage's chemical-restraint box use raw amber-100/amber-50/amber-700/amber-800 — so a future theme or dark-mode change only half-applies. | Replace the amber-* utility classes with --color-warning-container / --color-on-warning-container. | `harden` | pages/medications/RegisterTab.tsx:25; pages/MedicationFormPage.tsx:326; pages/MedicationFormPage.tsx:529; pages/medications/MissedMedicationGuidance.tsx:77 | C-4 |
| PP-30 | `/medications` — Medications (MAR / Register / Report) | RecordAdministrationModal's Status control shows five same-weight options with no primary/exception grouping. | Administered is the happy path and the other four all trigger extra required fields (reason/witness/notes) — under time pressure, a worker recording several doses back-to-back has no visual cue to slow down on the four exception statuses. | Visually separate the default 'Administered' option from the four exception statuses inside the existing ToggleGroup (e.g. a divider or a distinct outlined style for the exception group). | `clarify` | pages/medications/RecordAdministrationModal.tsx:41-47; pages/medications/RecordAdministrationModal.tsx:414-416 | — |
| PP-31 | `/medications` — Medications (MAR / Register / Report) | Modal backdrop click silently discards a partially-filled Record/Amend administration form. | RecordAdministrationModal carries reason/PRN-reason/witness/notes fields that can represent real typed content on a compliance record; one accidental tap outside the dialog loses all of it with no confirmation. | Disable backdrop-dismiss once any field is dirty, or route it through the same unsaved-changes guard MedicationFormPage already uses. | `harden` | pages/medications/RecordAdministrationModal.tsx:151-154; components/Modal.tsx:82 | I-11 |
| PP-32 | `/medications/new and /medications/:id/edit` — Medication form (create / edit) | Save/update failures surface only a generic banner, never the server's actual validation message. | MedicationsController.ValidateMedicationDto returns a specific reason (e.g. 'A purpose is required when a medication is flagged as a chemical restraint') but the form only ever shows the generic fallback, discarding it. | Read res.errors?.[0] / res.message from the mutation result — the same pattern RecordAdministrationModal already uses — and show the server's actual message. | `harden` | frontend/src/pages/MedicationFormPage.tsx:251-269; frontend/src/pages/MedicationFormPage.tsx:291-295; backend/Odip.Api/Controllers/MedicationsController.cs:609-635 | — |
| PP-33 | `/portal/witness-approvals` — Witness approvals | A witness request already resolved elsewhere surfaces only a generic 'Failed to approve/decline.' error with no explanation. | The list has no refetchInterval of its own (only the sidebar badge polls every 60s), and RespondToWitnessRequestAsync 400s with 'This witness request has already been responded to' when the status has moved on — but the page's catch-all error text never distinguishes that from a network failure. | Detect the 'already responded to' message and show a specific 'This request was already handled' message plus an automatic list refetch, instead of the generic failure text. | `harden` | frontend/src/pages/portal/PortalWitnessApprovalsPage.tsx:59-65; backend/Odip.Api/Controllers/PortalController.cs:344-345 | — |
| PP-34 | `/billing/claim-batches/:id` — Claim Batch Detail | The 'Submitted to NDIA' badge uses raw bg-blue-100/text-blue-700 instead of a token. | This is the exact badge C-4 already documents as colliding visually with the unrelated ndiamanaged plan-type badge elsewhere in the app — two semantically unrelated pieces of state render identically. | Use a token-based success/info treatment distinct from the plan-type badge palette. | `harden` | frontend/src/pages/ClaimBatchDetailPage.tsx:104-111 | C-4 |
| PP-35 | `/claims/:id` — Claim Detail (legacy TripClaim pipeline) | This page hardcodes raw colors and card styling instead of the token system used elsewhere in the same module. | bg-white appears 3 times for card backgrounds (elsewhere in the app this is --color-card), the BPR CSV button border is a raw hex (border-[#c3c9b6]), and the primary/reject button hover states use hardcoded hex/Tailwind red rather than tokens (hover:bg-[#294800], bg-red-600 hover:bg-red-700) — making this the single most token-inconsistent page in the Billing & Claims group. | Replace with --color-card, --color-border, --color-primary, and --color-destructive token classes to match ClaimBatchDetailPage and BillingPage. | `harden` | frontend/src/pages/ClaimDetailPage.tsx:95,104,115,123,141,149,162,170 | C-4 |
| PP-36 | `/billing` — Billing (Funding Sources / Service Bookings / Billable Events) | No delete/void action exists anywhere for a mistaken funding source, service booking, or billable event. | BillingController.cs exposes only GET/POST for funding-sources and service-bookings and GET/POST/PUT for billable-events — no DELETE route for any of the three. A duplicate Draft billable event or a wrong funding source can only be edited, never removed, and will keep surfacing as a candidate in ClaimBatchBuilderPage. | Add scoped DELETE endpoints restricted to Draft/unclaimed status (or a soft-void status with a reason field), and a delete/void action on each panel row guarded by ConfirmDialog. | `harden` | backend/Odip.Api/Controllers/BillingController.cs; frontend/src/pages/BillingPage.tsx:166-179,408-426 | — |
| PP-37 | `/billing` — Billing (Funding Sources / Service Bookings / Billable Events) | Rejected billable events never surface their rejection reason in the UI. | BillingValidator.Apply writes a concrete RejectionReason string onto a rejected event, and the DTO carries it, but BillingPage's Billable Events columns render only a StatusBadge — the reason is invisible without querying the API (Nielsen 9, error recovery). | Add a rejection-reason cell or tooltip that appears when status is Rejected, mirroring how ClaimBatchBuilderPage already surfaces findings inline per row. | `clarify` | backend/Odip.Domain/Billing/Services/BillingValidator.cs:82-87; backend/Odip.Application/DTOs/DTOs.cs:2492; frontend/src/pages/BillingPage.tsx:389-427 | — |
| PP-38 | `/billing` — Billing (Funding Sources / Service Bookings / Billable Events) | Funding-source Active/Inactive toggle has no confirmation step and no success/failure feedback. | Deactivating a funding source affects future billing routing for that participant, yet it is a single click on an inline dropdown pill with no ConfirmDialog and no toast — the exact anti-pattern already documented platform-wide, reproduced on billing-relevant data. | Wrap this mutation in the same ConfirmDialog + toast remediation prescribed for C-5, since it is a status flip on money-routing data rather than a cosmetic field. | `harden` | frontend/src/pages/BillingPage.tsx:150-164 | C-5 |
| PP-39 | `/participants/:id` — Participant detail | The History (audit) tab is gated on `currentUser.role === 'Admin'` read directly from localStorage, not on the page's own `usePermissions()` hook used for every other gate on this page. | This excludes SuperAdmin (who outranks Admin everywhere else) and Coordinator (the primary persona) from the one tab that shows who changed a participant's compliance data, and duplicates logic `usePermissions().isAdmin` already provides. | Replace the raw localStorage/role check with `usePermissions()` and gate History on a proper flag (e.g. isSuperAdmin \|\| isAdmin, or wider). | `harden` | pages/ParticipantDetailPage.tsx:34-35; pages/ParticipantDetailPage.tsx:171; pages/ParticipantDetailPage.tsx:278; lib/permissions.ts:58-59 | — |
| PP-40 | `/participants/:id` — Participant detail | CaregiverLinkControl's 'Revoke' action fires immediately on click with no ConfirmDialog. | Every other destructive action on this same page (delete risk/contact/note/routine/restrictive-practice entries) is behind a ConfirmDialog; Revoke is the one exception, and it cuts off a real family member's access. | Wrap the Revoke onClick in the same ConfirmDialog pattern used by RiskEntriesSection's delete. | `harden` | pages/ParticipantDetailPage.tsx:298-352 | — |
| PP-41 | `/participants` — Participants list | The participant list's DataTable renders all 11 columns regardless of viewport, with no column-hiding or responsive collapse strategy. | On a tablet or narrow laptop window this table must scroll horizontally to be read at all, and nothing in the column config adapts to viewport. | Apply the same responsive column-priority/collapse pattern already available on DataTable (per the platform's own I-1 fix) to this page's column set. | `adapt` | pages/ParticipantsPage.tsx:58-170 | I-1 |
| PP-42 | `/participants/:id/profile` — Profile wizard | Like the Intake wizard, ProfileWizardPage never calls `useUnsavedChangesWarning`. | Blast radius is smaller than Intake's (each step already PATCHes on Next, so only the current in-progress step's edits are at risk), but a coordinator who types into the current step and then navigates away without clicking Next still loses that step's work with no warning. | Wire useUnsavedChangesWarning keyed off the current step's dirty state, same as recommended for the Intake wizard. | `harden` | pages/profile/ProfileWizardPage.tsx | — |
| PP-43 | `/caregiver/:token` — Public caregiver wizard | The same Review-step fallback only shows the first 4 fields of each step (`step.fields.slice(0, 4)`). | Compliance-relevant fields such as Anaphylaxis Risk, Allergy Management Notes, continence/bowel-care detail, and BSP/RIDS flags are silently absent from the Review screen a caregiver is asked to confirm before submitting. | Show every field for a step on Review, not just the first 4, reusing the same label/value helpers recommended above. | `harden` | pages/caregiver/CaregiverWizardPage.tsx:257-259; lib/participantSchema.ts:522-531; lib/participantSchema.ts:533-537 | — |
| PP-44 | `/caregiver-submissions and /caregiver-submissions/:id` — Caregiver submissions queue and review | The diff table (Field / Current / Caregiver's value) has no horizontal-scroll container — its parent `<section>` uses `overflow-hidden`, which clips rather than scrolls. | Either value column can hold long free-text; on a narrow viewport the table has no way to reveal clipped content. | Wrap the table in an `overflow-x-auto` container, or migrate it onto the shared DataTable, which already handles this. | `adapt` | pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx:71-73 | I-1 |
| PP-45 | `/staff` — Staff list | No search input or position/region filter exists, though sibling list pages (Participants, Accommodation) both have a search box. | Finding a specific staff member in a growing roster requires scrolling and reading every row; every comparable list in the app already solves this. | Add a text search input (name/position/region) above the table, matching ParticipantsPage's pattern. | `clarify` | pages/StaffPage.tsx:84-96; pages/ParticipantsPage.tsx | — |
| PP-46 | `/staff` — Staff list | Toggling a staff member's Active/Inactive status pill fires the mutation immediately with no confirmation and no visible success feedback beyond the pill's own re-render. | Deactivating a staff member removes them from rostering eligibility; a silent, instant, unconfirmed toggle risks an accidental click going unnoticed until someone can't find that person in the roster. | Add a brief confirm step (or an undo toast) for the Inactive transition specifically, since Active→Inactive is the consequential direction. | `harden` | pages/StaffPage.tsx:64-80 | C-5 |
| PP-47 | `/staff` — Staff list | The 'valid worker screening' table cell renders a bare lucide Check icon with no aria-label or sr-only text, while the 'expired' case correctly uses a labelled StatusBadge. | A screen-reader user hears nothing for the common (valid) case in a compliance-relevant column, only for the exceptional one. | Wrap the Check icon in a visually-hidden 'Current' label or add aria-label='Worker screening current'. | `harden` | pages/StaffPage.tsx:56-61 | — |
| PP-48 | `/staff/new, /staff/:id/edit` — Staff create/edit | The form never checks usePermissions().canWrite (only isCoordinator, for role-option filtering) — every field and the submit button render fully enabled regardless of role. | A ReadOnly user reaching this route (direct URL, back-button, bookmark) sees a form that looks fully usable and only discovers it isn't when the 403 comes back after filling it in. | Disable the form (or redirect, matching other requiresWrite routes) when !canWrite. | `harden` | pages/StaffCreatePage.tsx | — |
| PP-49 | `/qualifications` — Staff qualification expiry | Only active staff are loaded (useStaff({isActive: 'true'})), so an inactive-but-still-employed-on-paper worker's expired qualifications never appear on this compliance view or anywhere else. | For an NDIS compliance surface, silently excluding a subset of staff from the expiry check (rather than showing them in a clearly-labelled separate state) risks an auditor or coordinator assuming 'no issues' means 'no issues for anyone', not 'no issues for active staff'. | Either state the isActive filter explicitly in the page's subtitle, or add a collapsed 'Inactive staff with unresolved issues' section. | `clarify` | pages/QualificationsPage.tsx:109 | — |
| PP-50 | `/qualifications` — Staff qualification expiry | A staff member's name in the accordion header is plain text, not a link to their profile/edit page. | Fixing the root issue (e.g., the wrong qualification flag is checked at all) requires leaving this page, going to /staff, and finding the same person again by scrolling. | Wrap group.staffName in a Link to /staff/{staffId}/edit. | `clarify` | pages/QualificationsPage.tsx:261 | — |
| PP-51 | `/rostering` — Roster board | No bulk operations exist on the board — assignment, unassignment, and deletion are all one-shift-at-a-time (via drag or the per-chip menu); there's no multi-select. | A common real task ('this staff member is on leave for the whole week, reassign or clear everything') requires repeating the same action once per shift. | Add a lightweight multi-select mode (e.g. shift-click chips) feeding the existing single-assign/delete flows in bulk. | `optimize` | pages/rostering/RosterBoardPage.tsx:106-143 | F-13 |
| PP-52 | `/rostering/patterns` — Shift patterns | No search/filter on the patterns table despite it being sortable by participant/day, and no bulk 'generate shifts for all active patterns over range X' action — each pattern must be opened and generated individually. | A coordinator setting up the coming month's roster from patterns must repeat the same generate flow once per participant/pattern rather than doing it once for everyone. | Add a tenant-wide 'Generate shifts for all active patterns' action reusing GeneratePatternDialog's preview-then-confirm shape. | `optimize` | pages/rostering/PatternsPage.tsx:203-212 | F-13 |
| PP-53 | `/rostering/compatibility` — Staff–participant compatibility | No search/filter for staff rows or participant columns in a matrix whose size is the product of two independently-growing lists. | This is the one page in the group most likely to become genuinely unusable purely from data growth — unlike a list page, there's no pagination fallback for a matrix, so a coordinator at a mid-sized tenant scrolls through the full cross-product to find one pairing. | Add a text filter above each axis (reusing the searchable Dropdown pattern already used on RosterBoardPage's participant filter) that hides non-matching rows/columns without changing the underlying data. | `optimize` | pages/rostering/CompatibilityPage.tsx:177-182; pages/rostering/components/WeekToolbar.tsx:85-94 | — |
| PP-54 | `/schedule` — Schedule overview | Clicking to unassign shows a fake 'Unassigned' success chip for exactly 1 second BEFORE the real ConfirmDialog opens and the unassign actually happens — the optimistic success state plays out ahead of, not after, confirmation. | The system visibly lies about what happened: a user sees 'Unassigned' render, then watches it revert while a confirm dialog pops up asking them to confirm the very thing that already appeared to succeed. Cancelling the dialog leaves a user who just saw a false success message. | Only show the optimistic 'Unassigned' transition after the ConfirmDialog's onConfirm actually resolves, not before the dialog even opens. | `harden` | pages/schedule/StatusBadge.tsx:25-31; pages/SchedulePage.tsx:311-317 | — |
| PP-55 | `/schedule` — Schedule overview | Filter and Download icon buttons in the page header have no onClick handler at all; the Timeline view toggle button also has none. | Three visible, apparently-functional controls do nothing when clicked, with no disabled state or tooltip explaining why — a coordinator will click them expecting a filter panel or a CSV export and get silence. | Either wire them up, or remove/disable-with-tooltip until built. | `clarify` | pages/SchedulePage.tsx:126-138 | — |
| PP-56 | `/portal/shifts/:id` — Shift detail | An edited shift note carries no 'edited' indicator even though the timestamp already exists in the API response. | ShiftNoteDto.updatedAt is returned by GET /portal/shifts/{id}/notes but ShiftNotesSection only ever renders note.createdAt — a coordinator reading notes after an incident has no way to tell a note was edited, or when. | Render 'edited <relative time>' next to the timestamp when updatedAt is later than createdAt, the same pattern already used for note.flagsAcknowledgedAt. | `clarify` | frontend/src/pages/portal/components/ShiftNotesSection.tsx:210-211; frontend/src/api/types/rostering.ts:33-40; backend/Odip.Application/DTOs/ShiftNoteDTOs.cs:10-17 | — |
| PP-57 | `/portal` — My Shifts | Week navigation controls sit at the top of the page, outside the one-handed thumb zone. | This page's persona is explicitly a field support worker on a phone, often one-handed and on the go — top-of-screen controls are the least reachable spot, and they're the only interactive controls on the page besides the shift cards themselves. | Consider pinning week navigation to a sticky bottom bar on narrow viewports. | `layout` | frontend/src/pages/portal/PortalShiftsPage.tsx:87-111 | — |
| PP-58 | `/tasks` — Tasks list | The inline status-change dropdown gives no feedback when the mutation fails. | `useUpdateTask` only invalidates queries onSuccess; there's no onError handler and TasksPage doesn't check `updateTask.isError` per row, so a rejected change (e.g. a ReadOnly user, who — per lib/permissions.ts's own comment — sees this exact control enabled while the backend blocks the save) just silently appears to do nothing instead of reverting with an explanation. | Surface `updateTask.isError`/the failed row so the coordinator knows the change didn't save, instead of a silent no-op. | `harden` | pages/TasksPage.tsx:76-90; api/hooks/tasks.ts:31-42 | — |
| PP-59 | `/tasks/new and /tasks/:id/edit` — Task create/edit form | No loading gate while the real task data is fetched in edit mode — the form renders instantly with create-mode defaults, then resets once the background fetch resolves. | Contrast IncidentCreatePage, which explicitly renders 'Loading incident…' and withholds the form until `existingIncident` has loaded — TaskCreatePage has no equivalent, so a coordinator briefly sees the wrong (empty) values under an 'Edit Task' heading. | Gate the form (or show a skeleton) until the fetched task resolves, matching the Incident wizard's pattern. | `harden` | pages/TaskCreatePage.tsx:73-110; pages/IncidentCreatePage.tsx:156-165 | — |
| PP-60 | `/trips/:id` — Trip detail | Active tab is stored only in local component state, never synced to the URL. | Refresh, browser Back, or a shared link always lands on Overview, discarding the coordinator's place mid-task. | Sync `activeTab` to a query param or route segment (`useSearchParams`). | `harden` | pages/TripDetailPage.tsx:17 | — |
| PP-61 | `/trips/:id` — Trip detail | All 8 sub-resource queries (bookings, accommodation, vehicles, staff, tasks, schedule, claims, participants) fire unconditionally on mount regardless of which tab is active. | Opening a trip to glance at Overview still issues ~8-9 network requests. | Gate the less-common tab queries (claims, schedule) behind `enabled: activeTab === '...'` or lazy-load on first tab visit. | `optimize` | pages/TripDetailPage.tsx:20-29 | — |
| PP-62 | `/trips/:id` — Trip detail | Vehicles is the only sub-resource tab with no edit or remove action on an existing assignment — every sibling tab offers both. | A coordinator who assigns the wrong vehicle, or needs to reassign one, has no in-app way to undo it from this tab. | Add the same edit-modal + two-choice ConfirmDialog pattern used in StaffTab/BookingsTab to vehicle assignment cards. | `harden` | pages/trip-detail/VehiclesTab.tsx:68-87; pages/trip-detail/BookingsTab.tsx:546-573 | — |
| PP-63 | `/trips` — Trips list | 'Edit Trip' is implemented twice — this page's inline modal and pages/trip-detail/EditTripModal.tsx — editing the identical 16 fields, but only the detail-page version has `role="dialog"`, `aria-modal`, Escape-to-close and a focus trap. | Two divergent implementations of the same feature will keep drifting further apart and the list-page version is the accessibility regression of the pair. | Delete the inline modal in TripsPage.tsx and reuse EditTripModal.tsx (it already accepts a `trip`/`onClose` pair). | `distill` | pages/TripsPage.tsx:294-296; pages/trip-detail/EditTripModal.tsx:148-157 | — |
| PP-64 | `/trips/new` — Create trip | The Status dropdown on create only offers 3 of the 8 TripStatus values (Draft/Planning/OpenForBookings) while the identical field on EditTripModal offers all 8, with no explanation for the narrower list. | Inconsistent option sets for the same field across surfaces make the system harder to predict and learn. | Either explain why creation is restricted (e.g. helper text: 'trips start in one of these three states') or align the option sets. | `clarify` | pages/TripCreatePage.tsx:160-165; pages/trip-detail/EditTripModal.tsx:238-248 | — |
| PP-65 | `/trips/new` — Create trip | On create failure the form always shows the same generic 'Failed to create trip. Please check your input and try again.' regardless of the actual server error (e.g. an invalid lead coordinator reference). | A coordinator can't self-correct a specific validation failure they're never shown. | Read and display `err.response.data.message`/`errors[0]` the way ClaimsTab's bulk-update catch block already does. | `harden` | pages/TripCreatePage.tsx:90-94; Odip.Api/Controllers/TripsController.cs:118-119; pages/trip-detail/ClaimsTab.tsx:52-58 | — |
| PP-66 | `/accommodation/:id` — Accommodation detail | 'Property not found' is shown for both a real 404 and any other fetch failure. | Nielsen heuristic 9: an error message needs to name the actual problem; a transient network/500 error reading as 'not found' will send a coordinator to recreate a property that still exists. | Check useAccommodationDetail's isError/error state separately from the not-found case and show a distinct 'Failed to load, retry' message. | `clarify` | pages/AccommodationDetailPage.tsx:7-10 | — |
| PP-67 | `/accommodation/:id` — Accommodation detail | Archive/Restore is only reachable from the list page - the detail page offers Edit only. | A coordinator already viewing a property's full record has to navigate back to the grid, re-find the card, and archive from there - an unnecessary round trip for a destructive action they were just looking at. | Add the same Archive/Restore control (with its ConfirmDialog) to the detail header alongside Edit. | `shape` | pages/AccommodationDetailPage.tsx:22-29 | — |
| PP-68 | `/accommodation` — Accommodation list | Archive/Restore icon buttons are nested inside the card's outer <Link>, producing interactive-in-interactive markup. | A <button> inside an <a> is invalid HTML; keyboard/screen-reader traversal and click-target resolution become unpredictable, and click-to-navigate vs click-to-archive can race on the same tap. | Stop wrapping the whole card in <Link>; make the property name/image the link and keep the action buttons as siblings, or use a non-interactive wrapper with onClick + role="link" only on the parts that should navigate. | `harden` | pages/AccommodationPage.tsx:67; pages/AccommodationPage.tsx:73-82 | — |
| PP-69 | `/accommodation` — Accommodation list | The Archive button duplicates I-5's exact anti-pattern (Trash2 glyph, title-only label, sub-3:1 hover color) inline instead of using the shared ActionButtons.tsx. | Two independent implementations of the same broken control means a future fix to ActionButtons.tsx won't reach this page. | Replace the inline button with <ActionButtons> (or extract this page's archive/restore controls into it) once I-5 is fixed. | `harden` | pages/AccommodationPage.tsx:73-82 | I-5 |
| PP-70 | `/accommodation/new and /accommodation/:id/edit` — Accommodation create/edit | Email and website fields have no format validation in the zod schema (only accommodationSchema's z.string().optional()). | Bad data reaches the backend unchecked; a malformed website silently fails to render as a link on the detail page (compounds the AccommodationDetailPage website bug), and a malformed email breaks any future 'contact via email' feature. | Add z.string().email().optional().or(z.literal('')) for email, and normalize/validate the website URL (prepend https:// if missing a protocol) before submit. | `harden` | pages/AccommodationCreatePage.tsx:22-26; pages/AccommodationCreatePage.tsx:180-194 | — |
| PP-71 | `/accommodation/new and /accommodation/:id/edit` — Accommodation create/edit | The generic mutation-error banner doesn't distinguish a validation failure from a permissions 403 or a network error. | Nielsen heuristic 9 (error recovery) requires the message to help the user fix the actual problem; 'check your input' sends a permissions-blocked coordinator down the wrong path entirely. | Surface the backend's actual error/status (e.g. show 'You don't have permission to do this' for 403s) instead of one static string. | `clarify` | pages/AccommodationCreatePage.tsx:131-135 | C-5 |
| PP-72 | `/vehicles` — Vehicles list | The ramp/hoist-details and notes preview blocks check for object keys ('rampHoistDetails' in v, 'notes' in v) that the list query never returns. | useVehicles() resolves VehicleListDto, which has no rampHoistDetails or notes field at all (only VehicleDetailDto does) - so this code can never render on this page; it's permanently dead despite reading as a working feature. | Either have the list endpoint include a lightweight preview field, or delete the dead branch and surface this info from a real vehicle detail view instead (see completion suggestion below). | `harden` | pages/VehiclesPage.tsx:186-197; frontend/src/api/types/vehicles.ts:3-20 | — |
| PP-73 | `/vehicles/new and /vehicles/:id/edit` — Vehicle create/edit | The generic mutation-error banner doesn't distinguish validation failure from a permissions 403. | Same gap as AccommodationCreatePage - sends a permissions-blocked user looking for a typo that isn't there. | Surface the backend's actual error/status in the banner. | `clarify` | pages/VehicleCreatePage.tsx:116-120 | C-5 |
| PP-74 | `(shell)` — App shell | TenantSwitcher and UserSwitcher dropdowns have no keyboard affordances. | No aria-haspopup/aria-expanded, no Escape-to-close, and close-on-outside-click is the only dismiss path — a keyboard-only SuperAdmin cannot operate the impersonation controls at all. | Add aria-expanded/aria-haspopup to the trigger buttons and an Escape handler alongside the existing outside-click listener. | `harden` | odip-prototype/odip/frontend/src/components/layout/TenantSwitcher.tsx:49-55; odip-prototype/odip/frontend/src/components/layout/UserSwitcher.tsx:16-22 | — |
| PP-75 | `/` — Dashboard | "Resolve" links on both dashboard cards only navigate; they never resolve anything, and the task version doesn't even deep-link to the specific task. | Violates match-between-system-and-real-world and recognition — the label promises an action the click doesn't perform, and for tasks it discards the exact item the coordinator just identified. | Point the task link at /tasks/${t.id}/edit for users with write access, and relabel both links "View" since neither currently resolves or dismisses anything. | `clarify` | odip-prototype/odip/frontend/src/pages/DashboardPage.tsx:319-321; odip-prototype/odip/frontend/src/pages/DashboardPage.tsx:359-362 | — |
| PP-76 | `/login` — Login | The password-visibility toggle has no accessible name. | Icon-only button with no aria-label/aria-pressed — a screen reader announces an unnamed control with no indication of what it does or its current state. | Add aria-label ("Show password"/"Hide password") and aria-pressed={showPassword}. | `harden` | odip-prototype/odip/frontend/src/pages/LoginPage.tsx:145-151 | — |
| PP-77 | `/settings` — Settings | No unsaved-changes guard on any Settings tab. | A coordinator or admin can lose typed Provider Settings or Qualification Warning edits by switching tabs or navigating away, despite the app already having a reusable guard for exactly this. | Wire useUnsavedChangesWarning (or an equivalent dirty-check before tab switch) into ProviderSettingsTab and QualificationSettingsTab. | `harden` | odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:250-350 | — |
| PP-78 | `/settings` — Settings | Four different ad hoc success/error colour treatments appear inside one settings module. | A tokenized error-container in ProviderSettingsTab, a raw bg-red-50 error two lines below it in the same tab, a raw green/amber/red-50 sync banner in Public Holidays, and a raw hex #bff285 success banner in TenantFormPanel all mean the same thing but look unrelated. | Route all four through the same semantic tokens (success-container / error-container / warning-container). | `harden` | odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:337-342; odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:666-676; odip-prototype/odip/frontend/src/pages/settings/TenantFormPanel.tsx:524-528 | C-4 |

### P3 — polish (22)

- **PP-79** `/incidents/new and /incidents/:id/edit` — The Basics step packs 8-9 unrelated fields into a single ungrouped card. _(fix: Split into a 'Who' sub-group (participant/reporter/involved staff) and a 'What' sub-group (service type/trip/incident type/severity) with sub-headings, matching the chunking already used at the wizard-step level.; evidence: pages/incidents/steps/BasicsStep.tsx:46-127)_
- **PP-80** `/claims/:id` — Notes textarea has no unsaved-changes guard. _(fix: Wire the existing useUnsavedChangesWarning hook (already used by the incident/intake/profile wizards) around this single field, or auto-save on blur.; evidence: frontend/src/pages/ClaimDetailPage.tsx:149-167; related: C-6)_
- **PP-81** `/billing` — BillableEventFormPanel's ~15 fields have no section grouping or visual breaks. _(fix: Group into Who/What (participant, funding source, service booking, stream), Delivery (dates, day type, quantity/hours, unit price), and Claim metadata (GST code, claim type, approval, reference) with a divider or legend between groups.; evidence: frontend/src/pages/billing/BillableEventFormPanel.tsx:230-423)_
- **PP-82** `/participants/:id` — SectionEditPanel gives no success feedback on save — only failure gets a role="alert" banner. _(fix: Add a brief role="status" confirmation on successful save, mirroring the existing error banner.; evidence: pages/participant-detail/SectionEditPanel.tsx:63-74; related: C-5)_
- **PP-83** `/participants/:id` — `useCreateRestrictivePractice` is still exported from the hooks layer but no page in this group calls it — RestrictivePracticesTab creates only via the bulk endpoint since the PD-2 migration. _(fix: Remove the unused single-create hook (and confirm the matching single-create backend endpoint is genuinely unreferenced) now that bulk-create-with-count-1 covers the same UX.; evidence: api/hooks/restrictive-practices.ts; pages/participant-detail/RestrictivePracticesTab.tsx:4-7; pages/participant-detail/RestrictivePracticesTab.tsx:203-205)_
- **PP-84** `/caregiver-submissions and /caregiver-submissions/:id` — CaregiverSubmissionsPage uses a bare `<h1>` instead of the shared PageHeader component every sibling list page (e.g. Participants) uses. _(fix: Swap the h1 for `<PageHeader title="Caregiver forms" .../>`.; evidence: pages/caregiver-admin/CaregiverSubmissionsPage.tsx:42-46; related: I-9)_
- **PP-85** `/staff/new, /staff/:id/edit` — Generic failure banner ('Failed to update staff member. Please check your input and try again.') doesn't surface the backend's actual message, e.g. the specific 'A user with this email already exists' conflict the controller returns. _(fix: Surface mutation.error's server message when present, falling back to the generic copy only when it's absent.; evidence: pages/StaffCreatePage.tsx:201-205; backend/Odip.Api/Controllers/VehiclesStaffController.cs:352-354,417)_
- **PP-86** `/qualifications` — Expiring-row highlight uses a hardcoded hex (#fef3c7) instead of a token. _(fix: Replace with var(--color-warning-container) or equivalent.; evidence: pages/QualificationsPage.tsx:278; related: C-4)_
- **PP-87** `/rostering` — No print/export of the current week's board (e.g. a PDF/CSV roster to hand to staff without app access). _(fix: Add a simple export action alongside the existing Exceptions button.; evidence: pages/rostering/components/WeekToolbar.tsx:124-131)_
- **PP-88** `/rostering/compatibility` — Every staff×participant cell is rendered unconditionally with its own <select> and hover-reveal wrapper, with no virtualization. _(fix: Virtualize rows once a filter (above) still leaves a large result set, or once tenant size data justifies it.; evidence: pages/rostering/CompatibilityPage.tsx:221-291)_
- **PP-89** `/portal/shifts/:id` — Six always-expanded read-only sections stack with no in-page anchors or collapse. _(fix: Add sticky in-page anchor chips (Summary / Routines / Risks / Medications / Notes) or make risk/routine sections collapsible after first read.; evidence: frontend/src/pages/portal/PortalShiftDetailPage.tsx:85-263)_
- **PP-90** `/trips` — No pagination, sort, or bulk-action controls on the trips grid — only client-side tab/status/search filtering over whatever `useTrips` returns. _(fix: Add DataTable-style pagination or a 'load more' once trip counts grow past a season.; evidence: pages/TripsPage.tsx:70-79)_
- **PP-91** `/trips/new` — Capacity/requirement fields carry no inline help despite driving downstream compliance-relevant checks. _(fix: Add short helper text under the Capacity & Requirements heading.; evidence: pages/TripCreatePage.tsx:192-218)_
- **PP-92** `/bookings` — The Wheelchair column header is icon-only while its sibling boolean columns (High, Night) use plain text headers for the same category of flag. _(fix: Give the wheelchair header the same short text label style as High/Night (e.g. 'WC' or 'Access'), or give all three an icon+label pairing.; evidence: pages/BookingsPage.tsx:83-89)_
- **PP-93** `/accommodation` — Modification badges use hardcoded Tailwind palette colors instead of design tokens. _(fix: Map to --color-success-container / --color-info-container equivalents once C-4's token set exists.; evidence: pages/AccommodationPage.tsx:88-90; related: C-4)_
- **PP-94** `/accommodation` — No empty state renders when a search/filter yields zero properties. _(fix: Reuse EmptyState (already used on VehiclesPage/BookingsPage) for the filtered.length === 0 case, distinguishing 'no results for your search' from 'no properties yet' per reference/product.md.; evidence: pages/AccommodationPage.tsx:62-101; pages/VehiclesPage.tsx:119-125; related: P-7)_
- **PP-95** `/vehicles` — The AccessibleVan icon background/text and the wheelchair-positions summary tile use hardcoded hex colors instead of tokens. _(fix: Introduce a --color-accessible-* token pair once C-4's remediation lands.; evidence: pages/VehiclesPage.tsx:20; pages/VehiclesPage.tsx:189; pages/VehiclesPage.tsx:242; related: C-4)_
- **PP-96** `/vehicles` — The Archived StatusBadge falls open to the default amber/pending color because 'archived' has no entry in STATUS_COLORS. _(fix: Add an 'archived' key to STATUS_COLORS (or colorMap override on this call) once I-10 is fixed platform-wide.; evidence: pages/VehiclesPage.tsx:159; components/StatusBadge.tsx:9-51; related: I-10)_
- **PP-97** `/vehicles/new and /vehicles/:id/edit` — Numeric capacity fields are handled as raw strings with a manual Number()\|\|0 fallback here, versus AccommodationCreatePage's z.coerce.number() for the equivalent kind of field. _(fix: Standardize on z.coerce.number() across both forms.; evidence: pages/VehicleCreatePage.tsx:27-28; pages/AccommodationCreatePage.tsx:31-33)_
- **PP-98** `/` — Qualification-issue counting iterates every active staff member and re-derives expiry math in the component body on every render. _(fix: Memoize the computation with useMemo keyed on allStaff/warningDays, or move the count into the dashboard-summary endpoint alongside the other counts it already returns.; evidence: odip-prototype/odip/frontend/src/pages/DashboardPage.tsx:86-102)_
- **PP-99** `/login` — Success and dev-mode banners use raw hex instead of the token system. _(fix: Route both through --color-success-container / --color-warning-container equivalents.; evidence: odip-prototype/odip/frontend/src/pages/LoginPage.tsx:112-116; odip-prototype/odip/frontend/src/pages/LoginPage.tsx:234-236; related: C-4)_
- **PP-100** `/settings` — Icon-only Edit (Pencil) buttons are labelled only by a native title attribute. _(fix: Add aria-label="Edit template"/"Edit user" alongside the existing title.; evidence: odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:157-163; odip-prototype/odip/frontend/src/pages/settings/UsersTab.tsx:211-218; related: I-5)_

## Persona red flags

### Office coordinator (primary persona)

- [(shell)] The mobile bottom-nav "New Trip" FAB and Trips/People links bypass the same `canWrite`/`canAccessPage` checks the desktop sidebar enforces, so a restricted coordinator on mobile sees links and a FAB that silently bounce them on tap.
- [/login] A forced logout after a 30-minute token expiry looks exactly like a first visit — no "your session expired" message — after possibly losing an in-progress incident report.
- [/] "Resolve" on both Dashboard cards only navigates; the Tasks version doesn't even deep-link to the specific task the coordinator just identified.
- [/trips] The "Edit trip" pencil is only revealed on mouse hover — no keyboard or touch path exists to find it.
- [/trips/new] No "duplicate this trip" entry point anywhere in Trips — a repeat annual trip is retyped from scratch, 16 fields, every season.
- [/trips/:id] Bookmarking or sharing a link to a specific tab (e.g. "send Finance the Claims tab for Trip X") always resets to Overview — tab state isn't in the URL.
- [/participants] No bulk actions exist despite per-row status/archive already being implemented.
- [/participants/:id] Caregiver-link "Revoke" has no confirmation, unlike every other delete on the same page; the audit History tab is gated on the literal string `'Admin'`, excluding Coordinators — the primary persona — entirely.
- [/participants/new and /participants/:id/intake] No unsaved-changes guard, unlike every other create form in the app — several minutes of intake data can be lost to an accidental back-navigation.
- [/caregiver-submissions and /caregiver-submissions/:id] The Reject panel — the coordinator's most common corrective action here — is a hand-rolled div, not the app's own accessible Modal.
- [/accommodation] Property cards show nothing about whether a property is actually free for an upcoming trip — the coordinator's real question has no answer on this screen.
- [/bookings] Insurance status, payment status and the restrictive-practice flag are all fetched but never shown as columns on the one screen that lists every booking in the org.
- [/vehicles] No way to see which trips a vehicle is currently or upcoming assigned to, from this page or any vehicle screen.
- [/tasks] No "assigned to me" quick filter despite the exact backend `ownerId` parameter already existing.
- [/incidents] Archiving a compliance record makes it vanish from both the Active and Archived views with no UI path back — a serious trust problem for a document with statutory retention expectations.
- [/incidents/new and /incidents/:id/edit] Can't record "Family Notified" at the moment of filing — that field only exists in edit mode, forcing a save-and-reopen detour.
- [/settings] Editing another tenant's Provider Settings (bank details, ABN, invoice footer) is only reachable via a multi-step detour through the header's TenantSwitcher.
- [/claims/:id] Marking a claim Submitted/Paid/Rejected fires on a single click with zero confirmation and zero error feedback on a financially consequential, largely one-way transition.
- [/billing] The funding-source Active/Inactive pill mutates on a single click with no confirmation and no toast, on data that controls future billing routing.
- [/billing/claim-batches/new] After confirming an action explicitly labelled "cannot be undone," the app navigates to a dead route — no confirmation screen, no batch reference, no way back.
- [/portal/witness-approvals] No coordinator-facing view exists for a witness request that's stuck at Pending — the only way to notice is spotting it elsewhere, by chance.

### Field worker (Casey — Distracted Mobile User)

- [/caregiver/:token] The public wizard reuses the full 7-step internal Profile wizard for an unfamiliar mobile user, with no time estimate beyond the step rail's own state.
- [/portal] Week navigation sits at the very top of the screen, outside the one-handed thumb zone, and is the page's only interactive control besides the shift cards; no pull-to-refresh or "last updated" indicator exists either.
- [/portal/shifts/:id] An edited shift note carries no "edited" indicator even though the timestamp already exists in the API response; six always-expanded sections mean a long re-scroll to reach one fact mid-shift.

### Finance

- [/billing] A Rejected billable event shows only a status badge — Finance can't see why an event was rejected without going to the API directly.
- [/billing/claim-batches/new] Warning-severity findings render in raw, under-contrast amber while Error-severity correctly uses the token system — on the one screen whose entire job is presenting compliance findings.
- [/billing/claim-batches/:id] The "Submitted to NDIA" badge is driven by a field nothing in the app ever sets — it will read "Draft — not yet submitted" forever, even for a batch Finance has already been paid on.
- [/claims/:id] The legacy TripClaim lifecycle and the newer BillableEvent/ClaimBatch lifecycle have no cross-link or combined total — reconciling a participant's real claimed-to-date amount means checking two systems by hand.

### First-time user (Jordan — Confused First-Timer)

- [/] The bento grid mixes plain counters, a checkmark glyph instead of "0," and colour-coded severity with no legend anywhere on the page.
- [/trips/new] Six capacity/requirement number fields have no tooltips or helper text explaining what they gate downstream.
- [/participants/new and /participants/:id/intake] NDIS-specific tri-state questions (CALD/LGBTIQA+/HIDPA categories) assume prior domain knowledge with no inline definition.
- [/participants/:id/profile] The Community Access step's 43 undifferentiated dropdown rows sit in one screen with no visual grouping beyond a text label.
- [/incidents/new and /incidents/:id/edit] "QSC," "Restrictive Practice," and "reportable incident" are used throughout the wizard with no inline definition.
- [/medications/new and /medications/:id/edit] "Restrictive Practice Authorisation Reference" and "Support Level" carry no inline help or example.

### Accessibility-dependent user (Sam)

- [/login] The login-failure banner has no `role="alert"`; the show/hide password toggle has no accessible name at all.
- [/trips/:id] The 8-tab switcher has no ARIA tab semantics whatsoever — no `role="tablist"/"tab"/"tabpanel"`, no `aria-selected`.
- [/participants/:id] A successful section save gives no screen-reader-audible confirmation — only a failed save gets a `role="alert"` banner.
- [/accommodation] Archive/Restore buttons are nested `<button>`s inside the card's outer `<Link>` — invalid HTML with undefined keyboard/screen-reader behaviour.

### Stress tester (Riley)

- [/incidents] Archiving an incident, then switching to the "Archived" toggle, shows nothing — a feature that visibly exists but silently does not work.
- [/accommodation/new and /accommodation/:id/edit] A website saved without `http(s)://` (never blocked at entry) vanishes entirely from the detail page's render.
- [/vehicles/new and /vehicles/:id/edit] Non-numeric Total Seats/Wheelchair Positions passes validation and silently becomes `0` on save.
- [/tasks/new and /tasks/:id/edit] A failed background fetch in edit mode leaves the form on create-mode defaults with nothing telling the user their edit session is void.
- [/medications] Amending an already-recorded dose (e.g. Administered → Refused) is completely invisible afterwards — no `UpdatedAt` anywhere in the UI.
- [/portal/witness-approvals] A one-tap Approve on a medication row commits an irreversible legal attestation with zero confirmation.

### Power user (Alex)

- [/trips] No bulk select/archive/export on the trips grid despite the sibling BookingsTab already having the pattern.
- [/participants] No keyboard shortcuts, no saved column set, and no export across 100+ rows and 11 columns.
- [/caregiver-submissions and /caregiver-submissions/:id] No per-field accept and no keyboard-only path through Accept/Reject when working through several submissions in a row.
- [/tasks] No bulk-complete, even though DataTable already has the mechanism for exactly this.

### SuperAdmin

- [/settings] Editing another tenant's Provider Settings is only reachable by leaving Tenants, switching the ambient tenant via the header's TenantSwitcher, and finding the ordinary Provider Settings tab — TenantDetailView shows the same fields read-only with no hint the detour exists.


## Per-page completion suggestions

Ordered by App.tsx route order (app shell first, then Login, caregiver token, Dashboard, and onward through the routed tree). Every page carries at least one completion suggestion. Audit scores are `a11y/performance/theming/responsive/anti_patterns` out of 4 each; Nielsen is the sum of all 10 heuristics out of 40.

### `(shell)` — App shell

*Persistent navigation, header search/user chrome, and SuperAdmin tenant/user impersonation controls wrapping every authenticated route.*

**Scores:** Audit a/p/t/r/ap = 2/3/1/2/2 (10/20) · Nielsen 18/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Tenant/user impersonation has no audit trail despite the product's "audit logging on every entity" principle | TenantSwitcher/UserSwitcher already hold the exact tenantId/userId being switched to at the moment of the click. | The switch is a client-only localStorage mutation plus a reload — nothing is recorded server-side, so there is no record of who viewed as whom or when. | Already tracked platform-wide as S-25; wire an audit-log write into the switch endpoints/handlers when that item is picked up. | M | 5 | odip-prototype/odip/frontend/src/components/layout/TenantSwitcher.tsx:57-68; odip-prototype/odip/frontend/src/components/layout/UserSwitcher.tsx:24-44 | S-25 |

**Issues on this page:**
- PP-21 (P1) — Mobile bottom nav bypasses the same permission and write-access checks the desktop sidebar enforces.
- PP-22 (P1) — Switching tenant or impersonating a user has no confirmation and reloads the page immediately.
- PP-74 (P2) — TenantSwitcher and UserSwitcher dropdowns have no keyboard affordances.

**Questions:**
- Does the sidebar need every module visible at once for a coordinator, or would grouping Trips/Rostering/Participants under fewer top-level headings bring the 11-item nav closer to Miller's Law?
- If tenant/user switching is a high-stakes SuperAdmin action, should it require an explicit confirm step rather than firing on the first click of a list item?


### `/login` — Login

*Email/password (Firebase) sign-in, password reset, and a dev-only bypass login for local/staging environments.*

**Scores:** Audit a/p/t/r/ap = 2/4/3/3/3 (15/20) · Nielsen 23/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | No session-expiry context on a forced logout | api/client.ts's 401 handler already distinguishes a failed token refresh from other cases before redirecting. | The reason is never communicated to LoginPage — no query param, no sessionStorage flag — so a user bounced by the 30-minute token expiry mid-task sees an unexplained blank login form. | Have logout() set a short-lived flag (sessionStorage or a query param) and have LoginPage read it once to show "Your session expired — please sign in again." | S | 3 | odip-prototype/odip/frontend/src/api/client.ts:19-28; odip-prototype/odip/frontend/src/pages/LoginPage.tsx:1-52 | C-6 |

**Issues on this page:**
- PP-23 (P1) — Login failures are not announced to assistive tech, and the error message is identical for every failure mode.
- PP-76 (P2) — The password-visibility toggle has no accessible name.
- PP-99 (P3) — Success and dev-mode banners use raw hex instead of the token system.

**Questions:**
- Should the production login path adopt the same 429/404-aware error messaging the dev-login path already has 20 lines below it?
- Now that a 30-minute token silently redirects to /login, should the app tell the user why they landed there?


### `/caregiver/:token` — Public caregiver wizard

*Public, unauthenticated wizard letting a family member or caregiver review and update a participant's profile fields via a time-limited link, reusing the Profile wizard's step components.*

**Scores:** Audit a/p/t/r/ap = 3/3/4/3/4 (17/20) · Nielsen 25/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Fix the caregiver Review step's fallback labels and array rendering | A working, correctly-labelled and safely-serialized diff renderer already exists for the admin side (lib/caregiverDiff.ts's label() and norm() helpers). | The caregiver-facing wizard's own Review step doesn't reuse either helper — it has a cruder fallback that breaks on array fields and truncates to 4 fields per step. | Reuse getFieldMapping/label() for row labels and a safe formatter (reuse or extract norm() from lib/caregiverDiff.ts) for values, and render every field per step instead of slicing to 4. | M | 4 | pages/caregiver/CaregiverWizardPage.tsx:254-261; lib/caregiverDiff.ts:23-31 | — |

**Issues on this page:**
- PP-6 (P1) — The wizard's generic Review-step fallback (used for every step except 'About you') renders raw camelCase field names as labels (e.g. 'personalInterests', 'middleName') and, for any array-valued field (consents on Cultural & Consents, adlAssessments on Daily Living), renders `String(value)` on an array of objects — which produces literal '[object Object]' text.
- PP-43 (P2) — The same Review-step fallback only shows the first 4 fields of each step (`step.fields.slice(0, 4)`).

**Questions:**
- Given the admin-side diff view already solves label mapping and safe serialization correctly, should the caregiver wizard's Review step share that exact code path instead of maintaining a second, weaker one?
- Should the caregiver wizard show a running 'step X of 7, about N minutes' estimate given its audience is an unfamiliar, possibly-interrupted mobile user rather than trained staff?


### `/` — Dashboard

*At-a-glance operational summary: upcoming trips, overdue tasks, qualification issues, and critical participant alerts for the office coordinator's day.*

**Scores:** Audit a/p/t/r/ap = 3/2/2/3/1 (11/20) · Nielsen 20/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Scheduling-conflict count is computed and typed but never shown | The backend already computes ConflictCount from accommodation/vehicle/staff overlap conflicts and returns it on every dashboard load; the frontend type declares conflictCount and even default-initialises it. | DashboardPage never renders d.conflictCount anywhere, and the POST /api/v1/conflicts/recheck admin action has no UI trigger at all. | Add a "Conflicts" tile to the small-stats row linking to wherever conflicts are resolved (rostering/vehicles/accommodation), and consider surfacing a "Recheck conflicts" action for Admin/SuperAdmin. | S | 4 | odip-prototype/odip/frontend/src/pages/DashboardPage.tsx:77; odip-prototype/odip/frontend/src/pages/DashboardPage.tsx:116-123; odip-prototype/odip/frontend/src/api/types/dashboard.ts:9; odip-prototype/odip/backend/Odip.Api/Controllers/TasksDashboardController.cs:409-411; odip-prototype/odip/backend/Odip.Api/Controllers/TasksDashboardController.cs:442-511 | — |
| 2 | Dashboard has no coordinator-facing customization or scoping | Two fixed lists (upcoming trips, overdue tasks), each hard-capped at 5 items via slice(0,5), with no per-user configuration. | No "assigned to me" scoping, no today/this-week toggle, no way to reorder or hide tiles. | Already tracked platform-wide as S-23 (assigned-to-me task filter); pick it up here rather than re-speccing. | M | 3 | odip-prototype/odip/frontend/src/pages/DashboardPage.tsx:230-326 | S-23 |

**Issues on this page:**
- PP-75 (P2) — "Resolve" links on both dashboard cards only navigate; they never resolve anything, and the task version doesn't even deep-link to the specific task.
- PP-98 (P3) — Qualification-issue counting iterates every active staff member and re-derives expiry math in the component body on every render.

**Questions:**
- Would the coordinator rather see fewer, larger, more actionable tiles than the current 8-tile grid?
- Should "Resolve" become a real one-click action (mark task complete / dismiss alert) now that the task API already supports status updates?


### `/trips` — Trips list

*Browse, search, filter and quick-edit the tenant's trips, split into Active/Completed tabs.*

**Scores:** Audit a/p/t/r/ap = 1/3/3/3/3 (13/20) · Nielsen 22/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Archive/cancel trip has no confirmation | The status pill on each card can be flipped directly to Cancelled or Archived in a single click. | No confirmation step before this effectively-irreversible-feeling change, unlike every equivalent action on the trip detail sub-tabs. | Route Cancelled/Archived selections through a ConfirmDialog matching the pattern already used in BookingsTab/AccommodationTab/StaffTab. | S | 3 | pages/TripsPage.tsx:274-280; pages/trip-detail/BookingsTab.tsx:788-837 | — |
| 2 | No bulk or season-end actions on the trips list | Search, status filter, and Active/Completed tabs. | No multi-select, bulk-archive, bulk-status-change, or export, despite the DataTable component already supporting bulk-editable columns elsewhere in this same module. | Reuse DataTable's `selectable`/`bulkEditable` pattern (already used in BookingsTab.tsx and ClaimsTab.tsx) for the trips grid, or add a minimal 'select completed → archive' action. | M | 3 | pages/TripsPage.tsx:244-291; pages/trip-detail/BookingsTab.tsx:406-577 | — |

**Issues on this page:**
- PP-14 (P1) — The per-card 'Edit trip' button is only reachable/visible on `:hover` (`max-w-0 overflow-hidden group-hover:max-w-[2rem]`, `opacity-0 group-hover:opacity-100`) with no `:focus-within` or `:focus-visible` equivalent.
- PP-15 (P1) — Trip status pill changes call `patchTrip.mutate` with no `onError`, and the backend's pre-departure gate can reject a status change to InProgress with a 400.
- PP-63 (P2) — 'Edit Trip' is implemented twice — this page's inline modal and pages/trip-detail/EditTripModal.tsx — editing the identical 16 fields, but only the detail-page version has `role="dialog"`, `aria-modal`, Escape-to-close and a focus trap.
- PP-90 (P3) — No pagination, sort, or bulk-action controls on the trips grid — only client-side tab/status/search filtering over whatever `useTrips` returns.

**Questions:**
- Why does editing a trip exist as two separate, drifting implementations instead of one shared component?
- Should Cancelled/Archived be reachable from a one-click status pill at all, given they read as terminal, compliance-relevant states?


### `/trips/new` — Create trip

*Create a new trip through a single long react-hook-form/zod form covering identity, dates, capacity and notes.*

**Scores:** Audit a/p/t/r/ap = 3/4/3/3/3 (16/20) · Nielsen 26/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Server-side validation errors are discarded on create failure | `createTrip.isError` renders a fixed static banner. | The backend's specific `ApiResponse.Fail` message (e.g. invalid lead coordinator) is never read or shown. | Surface the real error message the same way ClaimsTab.tsx already does for claim mutations. | S | 3 | pages/TripCreatePage.tsx:90-94; pages/trip-detail/ClaimsTab.tsx:52-58 | — |
| 2 | No 'duplicate trip' / create-from-existing beyond Event Template | An Event Template picker pre-fills destination/region/duration for a category of trip. | No way to clone a specific past trip's full field set (capacity, requirements, notes) as a starting point. | Add a 'Duplicate' action on TripsPage/TripDetailPage that navigates to /trips/new pre-populated from a source trip's data. | M | 3 | pages/TripCreatePage.tsx:46-54; pages/TripsPage.tsx:148-159 | — |

**Issues on this page:**
- PP-64 (P2) — The Status dropdown on create only offers 3 of the 8 TripStatus values (Draft/Planning/OpenForBookings) while the identical field on EditTripModal offers all 8, with no explanation for the narrower list.
- PP-65 (P2) — On create failure the form always shows the same generic 'Failed to create trip. Please check your input and try again.' regardless of the actual server error (e.g. an invalid lead coordinator reference).
- PP-91 (P3) — Capacity/requirement fields carry no inline help despite driving downstream compliance-relevant checks.

**Questions:**
- Is the 3-option status restriction at creation intentional, or a leftover from an earlier, shorter list?
- What would 'create trip' feel like starting from 'copy last year's Beach Getaway' instead of a blank 16-field form?


### `/trips/:id` — Trip detail

*Central operating page for one trip: an itinerary/coordination overview plus 7 further tabs (bookings, accommodation, vehicles, staff, tasks, activities, claims) and trip-level metrics.*

**Scores:** Audit a/p/t/r/ap = 2/3/3/3/3 (14/20) · Nielsen 25/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Per-booking funding/plan fields exist in the DTO but are never editable | `BookingDetailDto`/`CreateBookingDto` define `planTypeOverride`, `fundingNotes`, `roomPreference`, `transportNotes`, `equipmentNotes`, `riskSupportNotes`. | BookingsTab's Add-Participant and Edit-Booking forms never render or submit any of these six fields — only status, the four support-flag checkboxes, support-ratio override, plain booking notes, and insurance fields are exposed. | Add a 'Funding & logistics' section (progressive disclosure) to both the create and edit booking forms covering these six fields. | M | 4 | api/types/bookings.ts:39-61; pages/trip-detail/BookingsTab.tsx:171-235 | — |
| 2 | Trip documents endpoint has zero UI consumer | Backend `GET /trips/{id}/documents` and a matching `useTripDocuments` hook already exist and are wired to `TripDocumentDto`. | No 'Documents' tab or any component on the trip detail page calls `useTripDocuments` — the tab list stops at Claims/History, so trip-linked documents (insurance certs, contracts) have no visible home. | Add a Documents tab to `TripDetailPage`'s tab array rendering `useTripDocuments(id)`. | M | 4 | pages/TripDetailPage.tsx:37-47; api/hooks/documents.ts:5-9; Odip.Api/Controllers/TripsController.cs:424-436 | F-4 |
| 3 | Task checklist has no add/complete/template action from the trip page | Backend already auto-creates a 'GenerateNdisClaims' task on trip completion; `TaskDto` carries `CompletedDate`/`Notes`. | TasksTab never lets a coordinator add a trip-scoped task, mark one complete, or apply a checklist template. | Add an 'Add Task' button pre-filled with `tripInstanceId` and a status-cycle control; this is also the natural anchor for S-22's checklist templates. | M | 4 | pages/trip-detail/TasksTab.tsx:1-62; Odip.Api/Controllers/TripsController.cs:263-288 | S-22 |
| 4 | No trip-level cancel/duplicate shortcut from the header | Header offers only 'Back' and 'Edit Trip'. | No quick 'Cancel trip' or 'Duplicate trip' action at the header level, and 'Generate Claim' is buried one tab away even once a trip is Completed. | Add a header action surfacing 'Generate Claim' when `trip.status === 'Completed'`, and a 'Cancel trip' action once S-30's cascade exists. | S | 2 | pages/TripDetailPage.tsx:76-90 | S-30 |

**Issues on this page:**
- PP-12 (P1) — The tab switcher (Overview/Bookings/.../History) lacks ARIA tabs semantics entirely — no `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, or `aria-controls`.
- PP-13 (P1) — TasksTab is entirely read-only: no add, edit, complete, or reassign action, and no link into task creation pre-scoped to this trip.
- PP-60 (P2) — Active tab is stored only in local component state, never synced to the URL.
- PP-61 (P2) — All 8 sub-resource queries (bookings, accommodation, vehicles, staff, tasks, schedule, claims, participants) fire unconditionally on mount regardless of which tab is active.
- PP-62 (P2) — Vehicles is the only sub-resource tab with no edit or remove action on an existing assignment — every sibling tab offers both.

**Questions:**
- If a coordinator bookmarks or shares a link to 'Trip X → Claims', why does that link always open on Overview instead?
- Vehicles is the only sub-resource tab you can't edit or remove once added — was that a deliberate simplification, or just unfinished?


### `/schedule` — Schedule overview

*Grid of staff/vehicles × active trips showing assignment status, with click-to-assign and an availability editor per staff row.*

**Scores:** Audit a/p/t/r/ap = 1/3/2/2/2 (10/20) · Nielsen 19/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Shift/assignment status reaches 'Completed' somewhere | AssignmentStatus (Proposed/Confirmed/Completed/Cancelled) backs every StaffAssignment this page creates and displays. | No control anywhere on this page (or its assign modals) ever sets an assignment to Completed — assignments visibly move only between Available/Assigned/Conflict. | Add a 'Mark trip work completed' action (bulk, at trip level, once the trip ends) that transitions its StaffAssignments to Completed — the natural trigger point for a future billing pipeline. | M | 4 | pages/SchedulePage.tsx; backend/Odip.Domain/Enums/Enums.cs:160-166 | F-7, F-8 |
| 2 | Sleepover-type vs. overnight-eligibility warning in the assign modal | StaffAssignModal lets the coordinator pick a Sleepover Type (Active Night/Passive Night/Sleepover) independently of the isDriver eligibility check, which does warn when the staff member isn't driver-eligible. | No equivalent warning when a sleepover type other than 'None' is chosen for a staff member whose isOvernightEligible flag is false. | Mirror the existing driver-eligibility warning pattern for overnight eligibility. | S | 3 | pages/schedule/StaffAssignModal.tsx:73-99 | — |

**Issues on this page:**
- PP-9 (P1) — The core write interaction on this page — clicking an 'Available' cell to assign, or an 'Assigned' cell to unassign — is implemented as a plain <div onClick> with no role, tabIndex, aria-label, or keyboard handler.
- PP-54 (P2) — Clicking to unassign shows a fake 'Unassigned' success chip for exactly 1 second BEFORE the real ConfirmDialog opens and the unassign actually happens — the optimistic success state plays out ahead of, not after, confirmation.
- PP-55 (P2) — Filter and Download icon buttons in the page header have no onClick handler at all; the Timeline view toggle button also has none.

**Questions:**
- Given RosterBoardPage already has a mature drag-and-drop assign/override flow, should trip-based staff assignment (this page) eventually move onto the same Shift model instead of maintaining a second one?
- Are Filter and Download planned for this cycle, or safe to remove until they are?


### `/participants` — Participants list

*Search, filter, and triage the participant roster; entry point to create a new participant, resume a draft, or open a record.*

**Scores:** Audit a/p/t/r/ap = 3/3/4/2/4 (16/20) · Nielsen 29/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Bulk actions on the participants list | Per-row Active/Inactive toggle and per-row archive/restore (useArchiveRestore) are already implemented. | No row selection or multi-select bulk action bar — closing out a finished program's participants means opening each one individually. | Add DataTable row selection plus a bulk action bar (archive selected / set inactive) that reuses useArchiveRestore's existing mutations. | M | 3 | pages/ParticipantsPage.tsx:36-50 | F-13, S-23 |

**Issues on this page:**
- PP-41 (P2) — The participant list's DataTable renders all 11 columns regardless of viewport, with no column-hiding or responsive collapse strategy.

**Questions:**
- Given the Alerts column already aggregates risk/RP/incident severity per participant, could this list add a lightweight compliance-status column (e.g. 'RP review overdue') so a coordinator can triage without opening each record?
- Is this 11-column table ever viewed below desktop width in practice, or is the list desk-only — which would make the responsive gap theoretical rather than real?


### `/participants/:id` — Participant detail

*The full record for one participant: ~15 Details-tab compliance/support cards plus Contacts, Bookings, Support Profile, Medications, Notes, Routines, Restrictive Practices, and (Admin) History tabs.*

**Scores:** Audit a/p/t/r/ap = 3/3/4/3/4 (17/20) · Nielsen 28/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Give Coordinators and SuperAdmins the participant audit History tab | AuditHistoryTab component and a History tab wired for the literal 'Admin' role. | Coordinators (primary persona) and SuperAdmins cannot see it, despite being able to change everything the tab logs. | Replace the raw localStorage role check with `usePermissions()` and gate on a real canViewAuditHistory-style flag. | S | 4 | pages/ParticipantDetailPage.tsx:34-35; pages/ParticipantDetailPage.tsx:171; pages/ParticipantDetailPage.tsx:278 | — |
| 2 | Confirm before revoking a caregiver link | Caregiver link Generate/Regenerate/Revoke control (CaregiverLinkControl). | Revoke has no confirmation step, unlike every delete elsewhere on this page. | Wrap the Revoke click handler in a ConfirmDialog before calling revoke.mutate. | S | 3 | pages/ParticipantDetailPage.tsx:328-336; pages/participant-detail/RiskEntriesSection.tsx:318-327 | — |
| 3 | Success feedback on section save | Per-section inline role="alert" error banner on failed save. | No equivalent success confirmation on a successful save — the user infers success only from the form closing. | Add a brief role="status" toast/banner on successful SectionEditPanel save. | S | 2 | pages/participant-detail/SectionEditPanel.tsx:63-74 | C-5 |

**Issues on this page:**
- PP-39 (P2) — The History (audit) tab is gated on `currentUser.role === 'Admin'` read directly from localStorage, not on the page's own `usePermissions()` hook used for every other gate on this page.
- PP-40 (P2) — CaregiverLinkControl's 'Revoke' action fires immediately on click with no ConfirmDialog.
- PP-82 (P3) — SectionEditPanel gives no success feedback on save — only failure gets a role="alert" banner.
- PP-83 (P3) — `useCreateRestrictivePractice` is still exported from the hooks layer but no page in this group calls it — RestrictivePracticesTab creates only via the bulk endpoint since the PD-2 migration.

**Questions:**
- Given ~15 Details-tab cards already share SectionEditPanel, would an in-page jump nav (or a single 'review mode' that opens every card at once) reduce the 15-separate-Edit-buttons workflow for a coordinator doing a full annual review?
- Should a ReadOnly viewer of an empty, conditionally-hidden card see an explicit 'nothing recorded' placeholder instead of the card disappearing, so the Details tab's shape doesn't silently change by role?


### `/participants/new and /participants/:id/intake` — Intake wizard

*8-step wizard to capture a new participant's core intake data (or resume an unfinished draft), ending in Complete Intake and handing off to the Profile wizard.*

**Scores:** Audit a/p/t/r/ap = 3/3/4/3/4 (17/20) · Nielsen 28/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Add the app's unsaved-changes guard to the Intake wizard | useUnsavedChangesWarning hook already built and used on 7 other create/edit pages. | Not wired into IntakeWizardPage, even though react-hook-form's formState.isDirty is already available from the existing useForm call. | Wire the hook exactly as pages/StaffCreatePage.tsx does, keyed off formState.isDirty. | S | 4 | pages/intake/IntakeWizardPage.tsx:93; hooks/useUnsavedChangesWarning.tsx:26 | — |

**Issues on this page:**
- PP-5 (P1) — The Intake wizard never calls the app's own `useUnsavedChangesWarning` hook.

**Questions:**
- 'Save as draft' already exists as an explicit action here — should the wizard also autosave periodically (the way the public caregiver wizard already does per-step) rather than relying solely on a manual unsaved-changes guard?


### `/participants/:id/profile` — Profile wizard

*7-step wizard completing the deeper compliance/support profile for an Intake-complete participant, saving each step via PATCH and finishing with Complete Profile (isDraft=false).*

**Scores:** Audit a/p/t/r/ap = 3/3/4/3/4 (17/20) · Nielsen 29/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Extend the unsaved-changes guard to the Profile wizard's in-progress step | Per-step PATCH-on-Next already protects every step once it's been advanced past. | The step currently being typed into has no guard at all. | Same fix as the Intake wizard — wire useUnsavedChangesWarning off the current step's dirty state. | S | 3 | pages/profile/ProfileWizardPage.tsx | — |

**Issues on this page:**
- PP-42 (P2) — Like the Intake wizard, ProfileWizardPage never calls `useUnsavedChangesWarning`.

**Questions:**
- Could the Community Access step's 43 rows be split into two sub-steps (Checklist, then Risk Matrix) now that the wizard shell already comfortably supports many small steps elsewhere in this same flow?


### `/caregiver-submissions and /caregiver-submissions/:id` — Caregiver submissions queue and review

*Coordinator queue to review, accept, or reject a caregiver's proposed profile-field changes submitted via the public caregiver link.*

**Scores:** Audit a/p/t/r/ap = 2/3/4/2/3 (14/20) · Nielsen 27/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Use the shared Modal for the Reject dialog | Modal component with focus trap/Escape/aria-modal already used across the app, including sibling tabs in this same group. | CaregiverSubmissionReviewPage's Reject flow reimplements a dialog inline without any of that behaviour. | Wrap the reject note textarea and its buttons in the shared Modal component. | S | 3 | pages/caregiver-admin/CaregiverSubmissionReviewPage.tsx:109-137 | — |

**Issues on this page:**
- PP-7 (P1) — The Reject panel is a hand-built `role="dialog"` div with no aria-modal, no Escape handler, no focus trap, and no focus return on close.
- PP-44 (P2) — The diff table (Field / Current / Caregiver's value) has no horizontal-scroll container — its parent `<section>` uses `overflow-hidden`, which clips rather than scrolls.
- PP-84 (P3) — CaregiverSubmissionsPage uses a bare `<h1>` instead of the shared PageHeader component every sibling list page (e.g. Participants) uses.

**Questions:**
- Should the diff table reuse the shared DataTable (which already has the responsive/scroll handling this page is missing) instead of a hand-rolled `<table>`?


### `/accommodation` — Accommodation list

*Browse and archive/restore the tenant's accommodation properties.*

**Scores:** Audit a/p/t/r/ap = 2/3/2/3/3 (13/20) · Nielsen 25/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Property cards carry zero booking/availability signal - the product's own differentiator is invisible here | Cards show static capacity/beds/accessibility fields only. | GET /api/v1/accommodation/{id}/reservations and the full ReservationsController (overlap-conflict detection included) are built and never called from this list; a coordinator can't tell which properties are free without opening every trip's Accommodation tab. | Add a lightweight 'next available' or 'N upcoming stays' badge per card, backed by a new list-level aggregate endpoint (or lazy per-card query on hover/expand). | M | 5 | pages/AccommodationPage.tsx:65-100; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:394-408; frontend/src/api/hooks/accommodation.ts | — |
| 2 | Region, wheelchair and capacity filters exist on the API and are invisible in the UI | GET /accommodation supports region, wheelchair and minCapacity query params. | The page only ever sends isActive; the region/wheelchair chips shown on every card can't be used to filter the list itself. | Add a region dropdown and a wheelchair-accessible toggle next to the existing search box, wired to the existing query params. | S | 3 | backend/Odip.Api/Controllers/BookingsAccommodationController.cs:274-283; pages/AccommodationPage.tsx:16-17 | — |

**Issues on this page:**
- PP-68 (P2) — Archive/Restore icon buttons are nested inside the card's outer <Link>, producing interactive-in-interactive markup.
- PP-69 (P2) — The Archive button duplicates I-5's exact anti-pattern (Trash2 glyph, title-only label, sub-3:1 hover color) inline instead of using the shared ActionButtons.tsx.
- PP-93 (P3) — Modification badges use hardcoded Tailwind palette colors instead of design tokens.
- PP-94 (P3) — No empty state renders when a search/filter yields zero properties.

**Questions:**
- If accommodation-led trip planning is the differentiator, why does the accommodation list carry less booking context than the vehicle list carries service/rego context?
- Would a small calendar-strip per card (busy/free by week) replace half of the current stat row and answer the coordinator's actual question faster?


### `/accommodation/new and /accommodation/:id/edit` — Accommodation create/edit

*Create a new accommodation property or edit an existing one's details.*

**Scores:** Audit a/p/t/r/ap = 3/4/3/3/3 (16/20) · Nielsen 25/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | No cross-field sanity check between bedCount, bedroomCount and maxCapacity | Three independent z.coerce.number() fields. | Nothing stops saving maxCapacity: 2 with bedCount: 20, or bedroomCount greater than bedCount - the record silently contradicts itself. | Add a zod .refine() cross-field check (e.g. bedCount >= bedroomCount) surfaced as an inline warning, not necessarily a hard block. | S | 2 | pages/AccommodationCreatePage.tsx:31-33; pages/AccommodationCreatePage.tsx:200-209 | — |

**Issues on this page:**
- PP-18 (P1) — The /accommodation/new and /accommodation/:id/edit routes carry no requiresWrite gate, unlike /trips/new and /participants/new.
- PP-70 (P2) — Email and website fields have no format validation in the zod schema (only accommodationSchema's z.string().optional()).
- PP-71 (P2) — The generic mutation-error banner doesn't distinguish a validation failure from a permissions 403 or a network error.

**Questions:**
- Should a ReadOnly session be able to reach this form at all, or should every write route in the app redirect the way /trips/new already does?


### `/accommodation/:id` — Accommodation detail

*Show full read-only detail for one accommodation property.*

**Scores:** Audit a/p/t/r/ap = 3/4/2/3/3 (15/20) · Nielsen 22/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Property detail has zero visibility into bookings or availability - the product's own stated differentiator | GET /api/v1/accommodation/{id}/reservations is fully implemented, returning trip name, check-in/out dates, status, cost and overlap-conflict flag. | AccommodationDetailPage never calls it; there is no reservations list, calendar, or 'currently booked by' indicator anywhere on the page. | Add a Reservations section (reuse the ReservationDto shape already defined) listing past/upcoming stays, each linking to its trip; optionally a simple month-view availability strip. | M | 5 | pages/AccommodationDetailPage.tsx:1-131; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:394-408; frontend/src/api/hooks/accommodation.ts:1-108 | — |

**Issues on this page:**
- PP-17 (P1) — Website values without an http(s) prefix are silently hidden instead of shown as text.
- PP-66 (P2) — 'Property not found' is shown for both a real 404 and any other fetch failure.
- PP-67 (P2) — Archive/Restore is only reachable from the list page - the detail page offers Edit only.

**Questions:**
- What would this page look like if 'is this property free for these dates' were the first thing on it, rather than the last thing a coordinator finds by going elsewhere?


### `/bookings` — Bookings (cross-trip list)

*Flat, org-wide list of every participant booking across all trips, with inline status editing.*

**Scores:** Audit a/p/t/r/ap = 3/3/3/2/3 (14/20) · Nielsen 23/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Backend tripId/status filters exist and this page never uses them - there is no search or filter at all | GET /api/v1/bookings already accepts tripId and status query params server-side. | useBookings() is always called with no params and there's no SearchInput or status Dropdown on the page, unlike every sibling list page in this group. | Add a SearchInput (by participant/trip name) and a status filter Dropdown, wired to the existing query params. | S | 4 | frontend/src/api/hooks/bookings.ts:10-15; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:21-26; pages/BookingsPage.tsx:12 | — |
| 2 | Insurance, payment and restrictive-practice flags are fetched but never rendered | hasRestrictivePracticeFlag, insuranceStatus and paymentStatus are already on BookingListDto and already downloaded with every list request. | None of the three appear as columns or badges, despite being exactly the kind of compliance-adjacent flag this product treats as core (per PRODUCT.md). | Add 2-3 compact columns/badges reusing the existing StatusBadge component for these fields. | S | 4 | frontend/src/api/types/bookings.ts:14-18; pages/BookingsPage.tsx:38-90 | — |
| 3 | The rich per-booking record is invisible and uneditable from the app's own Bookings section | BookingDetailDto (funding notes, room preference, transport/equipment/risk-support notes, insurance policy detail, cancellation reason) and its GetById endpoint are fully built server-side. | No frontend hook ever calls GetById; the only editing surface for these fields is trip-detail/BookingsTab.tsx, reached by first finding the right trip. /bookings itself only exposes bookingStatus. | Add a booking detail view (modal or /bookings/:id route) reusing BookingsTab's edit panel, so a coordinator working from the master list doesn't need to go trip-hunting first. | M | 4 | api/types/bookings.ts:21-37; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:42-68; pages/BookingsPage.tsx:38-90 | — |

**Issues on this page:**
- PP-16 (P1) — Selecting Cancelled or No Longer Attending in the status pill mutates immediately with no confirmation, unlike every archive action elsewhere in this group.
- PP-92 (P3) — The Wheelchair column header is icon-only while its sibling boolean columns (High, Night) use plain text headers for the same category of flag.

**Questions:**
- Is /bookings meant to be a coordinator's real work surface, or just a sanity-check list? Right now it's read-only theatre for everything except status, which suggests the former was intended but not finished.
- Should a booking's restrictive-practice flag ever be one scroll away from invisible on the one screen that lists every booking in the org?


### `/vehicles` — Vehicles list

*Browse the fleet, see seating/wheelchair/service/rego status per vehicle, archive/restore.*

**Scores:** Audit a/p/t/r/ap = 3/3/2/3/3 (14/20) · Nielsen 24/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | No vehicle detail page and no way to see trip-assignment history, despite the backend fully supporting both | GET /api/v1/vehicles/{id}/assignments and the full VehicleAssignmentsController (create/update/cancel with overlap-conflict detection) are implemented server-side. | There is no /vehicles/:id route at all (only /vehicles/:id/edit), and no hook in api/hooks/vehicles.ts ever calls the assignments endpoint - a coordinator can't tell which trips a given vehicle is booked for without opening every trip individually. | Add a vehicle detail page (or expand the card into an expandable panel) showing upcoming/past assignments via the existing GetAssignments endpoint. | M | 5 | backend/Odip.Api/Controllers/VehiclesStaffController.cs:118-131; frontend/src/api/hooks/vehicles.ts:1-74; frontend/src/App.tsx:111-113 | S-33 |
| 2 | Service/rego expiry is only ever visible per-card, one at a time - no fleet-wide urgent list | getDateStatus color-codes each card's own dates; the list itself is alphabetically ordered. | There's no way to see 'which vehicles need service in the next 30 days' without opening and scanning every card, and no task/worklist integration parallel to the insurance-confirmation tasks already auto-created for bookings. | Sort by soonest expiry by default (or add a small 'N vehicles need attention' banner), and/or emit a TaskItem when service/rego crosses the 30-day warning threshold, mirroring BookingsController's insurance-task pattern. | M | 5 | pages/VehiclesPage.tsx:24-32,128-135; backend/Odip.Api/Controllers/BookingsAccommodationController.cs:124-143 (insurance-task precedent) | — |
| 3 | No search or type filter on the fleet list | Active/Archived tabs only. | Unlike AccommodationPage, there's no text search by name/registration and no filter by vehicle type, so finding a specific vehicle in a larger fleet means scanning cards. | Add a SearchInput matching AccommodationPage's pattern, filtering on vehicleName/registration. | S | 2 | pages/VehiclesPage.tsx:76-114; pages/AccommodationPage.tsx:6,59 | — |

**Issues on this page:**
- PP-72 (P2) — The ramp/hoist-details and notes preview blocks check for object keys ('rampHoistDetails' in v, 'notes' in v) that the list query never returns.
- PP-95 (P3) — The AccessibleVan icon background/text and the wheelchair-positions summary tile use hardcoded hex colors instead of tokens.
- PP-96 (P3) — The Archived StatusBadge falls open to the default amber/pending color because 'archived' has no entry in STATUS_COLORS.

**Questions:**
- If Accommodation gets a detail page and Vehicles doesn't, is that a deliberate call that vehicles need less depth, or just an unfinished corner?
- Would a 'vehicles needing attention' view (overdue service/rego) belong here, on the Tasks dashboard, or both?


### `/vehicles/new and /vehicles/:id/edit` — Vehicle create/edit

*Create a new fleet vehicle or edit an existing one's details.*

**Scores:** Audit a/p/t/r/ap = 3/4/3/3/2 (15/20) · Nielsen 23/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | No cross-field check that Wheelchair Positions doesn't exceed Total Seats | Two independent numeric fields. | A vehicle can be saved with more wheelchair positions than total seats with no warning. | Add a zod .refine() cross-field check. | S | 2 | pages/VehicleCreatePage.tsx:156-163 | — |

**Issues on this page:**
- PP-19 (P1) — Total Seats and Wheelchair Positions are validated as non-empty strings, not as numbers - a non-numeric entry silently becomes 0 on submit.
- PP-20 (P1) — The /vehicles/new and /vehicles/:id/edit routes carry no requiresWrite gate, unlike /trips/new and /participants/new.
- PP-73 (P2) — The generic mutation-error banner doesn't distinguish validation failure from a permissions 403.
- PP-97 (P3) — Numeric capacity fields are handled as raw strings with a manual Number()\|\|0 fallback here, versus AccommodationCreatePage's z.coerce.number() for the equivalent kind of field.

**Questions:**
- Given the silent-zero bug, how many existing fleet vehicles already have a wrong totalSeats or wheelchairPositions value from a mistyped entry that no one was told about?


### `/staff` — Staff list

*List, filter status of, and archive/restore staff members; surface worker-screening and qualification-flag state at a glance.*

**Scores:** Audit a/p/t/r/ap = 2/3/3/2/3 (13/20) · Nielsen 21/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Worker-screening verification metadata (S-10) | A typed WWC/screening number and a typed expiry date, both editable and both shown in the list. | Any record of who verified the number against the NDIS Worker Screening Database or when — a typed-but-unverified number is indistinguishable from a checked one. | Add VerifiedAt/VerifiedByUserId (and eventually an evidence-document link) to the staff shape and surface it as a third state next to the existing Check/Expired icon. | S | 5 | pages/StaffPage.tsx:52-62; pages/StaffCreatePage.tsx:340-347 | S-10 |
| 2 | Route-level write gating for the staff form routes | App.tsx already has a requiresWrite flag on PrivateRoute, used for /trips/new, /tasks/new, and other write-only routes. | /staff/new and /staff/:id/edit omit requiresWrite, and StaffCreatePage never reads usePermissions().canWrite at all — a ReadOnly user who navigates there directly gets a fully live, enabled form that only fails on submit. | Add requiresWrite to both routes, or have StaffCreatePage render a read-only view (matching the SuperAdmin-locked-record pattern it already has) when !canWrite. | S | 3 | App.tsx:114-116; pages/StaffCreatePage.tsx | — |
| 3 | Per-staff contracted/target weekly hours | RosterBoardPage's StaffRow renders a rostered-vs-target hours meter per staff member for the whole tenant. | A per-staff 'contracted hours' field anywhere on this create/edit form — the meter it feeds is driven by a single hardcoded constant (38h) applied identically to every staff member regardless of their actual contract. | Add a ContractedWeeklyHours field to the Staff entity and this form; have RosteringController read it per-staff instead of RosterConflictService.DefaultWeeklyHoursThreshold. | M | 3 | pages/StaffCreatePage.tsx; backend/Odip.Api/Controllers/RosteringController.cs:266; backend/Odip.Domain/Rostering/Services/RosterConflictService.cs:45 | — |

**Issues on this page:**
- PP-45 (P2) — No search input or position/region filter exists, though sibling list pages (Participants, Accommodation) both have a search box.
- PP-46 (P2) — Toggling a staff member's Active/Inactive status pill fires the mutation immediately with no confirmation and no visible success feedback beyond the pill's own re-render.
- PP-47 (P2) — The 'valid worker screening' table cell renders a bare lucide Check icon with no aria-label or sr-only text, while the 'expired' case correctly uses a labelled StatusBadge.

**Questions:**
- Should worker-screening verification block rostering the way expiry already threatens to, or stay purely informational for now?
- With no search box today, at what staff-count does this list stop being scannable — and has that already been crossed?


### `/staff/new, /staff/:id/edit` — Staff create/edit

*Create a new staff member or edit an existing one's profile, account role, and qualification flags/expiry dates.*

**Scores:** Audit a/p/t/r/ap = 3/3/3/3/3 (15/20) · Nielsen 27/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Worker-screening verification fields on the form | Worker screening number and expiry date inputs. | Any field for verification (see S-10) — same gap as the list page, but this is where it would actually be entered. | Add VerifiedAt (read-only, set by a verification action) and a verify button/date, per S-10's proposal. | S | 5 | pages/StaffCreatePage.tsx:340-347 | S-10 |

**Issues on this page:**
- PP-48 (P2) — The form never checks usePermissions().canWrite (only isCoordinator, for role-option filtering) — every field and the submit button render fully enabled regardless of role.
- PP-85 (P3) — Generic failure banner ('Failed to update staff member. Please check your input and try again.') doesn't surface the backend's actual message, e.g. the specific 'A user with this email already exists' conflict the controller returns.

**Questions:**
- Is client-side write-gating on this form intentionally deferred because the backend 403 is considered sufficient, or was it simply missed when other create pages got requiresWrite?


### `/tasks` — Tasks list

*List, filter, quick-complete, and archive/restore trip follow-up tasks.*

**Scores:** Audit a/p/t/r/ap = 3/3/3/3/4 (16/20) · Nielsen 26/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | 'Assigned to me' filter never wired to the existing ownerId API parameter | TasksController.GetAll already accepts and filters by `ownerId`; the current user's id is already available app-wide via `usePermissions().id`. | TasksPage's queryParams never includes `ownerId` — there is no 'My tasks' toggle or owner filter of any kind on this list. | Add an owner quick-filter (a 'My tasks' pill or a staff dropdown) that sets `queryParams.ownerId`. | S | 4 | pages/TasksPage.tsx:22-43; Odip.Api/Controllers/TasksDashboardController.cs:30-38 | S-23 |
| 2 | No bulk-complete for tasks | DataTable's `selectable` row-checkbox mode and per-column `bulkEditable` (with a bulk-change callback) are already implemented and used elsewhere in the app. | TasksPage's status column doesn't pass `selectable`/`bulkEditable`, so there is no way to select several tasks and complete them together. | Enable `selectable` plus a `bulkEditable` config on the status column (or a 'Mark selected complete' action bar), reusing the existing DataTable capability rather than building new UI. | S | 3 | pages/TasksPage.tsx:50-94; components/DataTable.tsx:29,81,276-283 | — |

**Issues on this page:**
- PP-58 (P2) — The inline status-change dropdown gives no feedback when the mutation fails.

**Questions:**
- Would a coordinator's morning routine be better served by a default 'My tasks due this week' view instead of an unfiltered list they filter by hand every session?
- Since a task row doesn't link anywhere (no click-through to the trip or the task's edit page from TasksTab), how does a coordinator get from 'I see this task in a trip' to 'let me update it' today?


### `/tasks/new and /tasks/:id/edit` — Task create/edit form

*Create a new trip task, or edit an existing one's type/owner/priority/due date/status.*

**Scores:** Audit a/p/t/r/ap = 3/2/3/3/3 (14/20) · Nielsen 23/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Task can't be linked to the participant, accommodation reservation, vehicle assignment, or staff assignment it's actually about | BookingTask/TaskDto/CreateTaskDto all already carry `ParticipantBookingId`, `AccommodationReservationId`, `VehicleAssignmentId`, and `StaffAssignmentId`. | `taskSchema` only covers tripInstanceId/taskType/title/ownerId/priority/dueDate/status/completedDate/notes — none of the four FK fields are exposed anywhere in this form (or in TasksTab, the trip-detail read-only task list), so task types like 'Family Contact' or 'Participant Confirmation' can never actually be pointed at the participant they concern. | Add an optional participant picker at minimum (highest value given the task-type list), plus accommodation/vehicle/staff pickers where relevant, wired to the existing DTO fields. | M | 4 | backend/Odip.Domain/Entities/BookingTask.cs:13-20; backend/Odip.Application/DTOs/DTOs.cs:1546-1582; pages/TaskCreatePage.tsx:46-56 | — |
| 2 | No task recurrence or due-date reminders | A single one-off `DueDate`; task types like 'Pre-Departure'/'Post-Trip' that conceptually repeat every trip. | No recurrence rule exists anywhere in the domain model (not just unexposed in the UI — `BookingTask`/`CreateTaskDto` have no such field at all), and no reminder/notification is wired to an approaching or overdue due date beyond the dashboard's own overdue count. | This is a net-new feature (schema + UI), not a hidden-capability wire-up — scope it as its own backlog item alongside the shift/claim-pipeline work (F-7/F-13) rather than a quick fix. | L | 3 | backend/Odip.Domain/Entities/BookingTask.cs; backend/Odip.Application/DTOs/DTOs.cs:1566-1582 | — |

**Issues on this page:**
- PP-10 (P1) — Editing a single task fetches the entire tenant's task list client-side and searches it for the matching id, bypassing TanStack Query entirely.
- PP-11 (P1) — A failed (or empty-result) background fetch in edit mode leaves the form silently on its create-mode defaults, with no error shown.
- PP-59 (P2) — No loading gate while the real task data is fetched in edit mode — the form renders instantly with create-mode defaults, then resets once the background fetch resolves.

**Questions:**
- Given every FK for participant/accommodation/vehicle/staff already exists on BookingTask, was linking ever wired up anywhere, or is the Tasks feature effectively trip-only today in practice?
- If editing a task requires fetching every task in the tenant, what happens once a season's worth of tasks — hundreds across dozens of trips — has accumulated?


### `/incidents` — Incident Reports list

*List, filter (status/severity), and archive/restore NDIS incident reports, surfacing the QSC 24-hour-overdue set.*

**Scores:** Audit a/p/t/r/ap = 3/2/3/3/4 (15/20) · Nielsen 26/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | No bulk actions or export on the incidents table | DataTable already implements `selectable` row checkboxes and per-column `bulkEditable` (used elsewhere in the app). | IncidentsPage never passes `selectable`/`bulkEditable`, and there is no CSV/export action anywhere on this list, even though a compliance team routinely needs to pull a batch of incidents for an audit or QSC submission. | Wire `selectable` + a `bulkEditable` status column (for closing/reviewing several minor incidents at once) and add a simple CSV export of the current filtered view. | M | 3 | pages/IncidentsPage.tsx:76-98; components/DataTable.tsx:29,81 | — |

**Issues on this page:**
- PP-2 (P1) — Archiving an incident (the trash/delete action) sets `IsActive=false` on the backend, but the 'Archived' tab filters on `status=Closed` while GetAll's default `isActive`-true filter still applies underneath it — and Update never writes `IsActive` back to true at all.

**Questions:**
- If archiving an incident behaves invisibly-differently from every other archived entity in the app, should incidents have an 'archive' concept at all, or should Draft/Resolved/Closed status alone be the lifecycle, with no separate soft-delete?
- Should the QSC-overdue banner's severity/family-notification state be visible as a column on this list, so a coordinator can triage compliance risk without opening each row?


### `/incidents/new and /incidents/:id/edit` — Incident report wizard

*Multi-step wizard to report a new NDIS incident or edit/review/close an existing one, including restrictive-practice determination, injuries, witnesses, and (edit-only) QSC/compliance review.*

**Scores:** Audit a/p/t/r/ap = 3/3/3/3/4 (16/20) · Nielsen 28/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | No draft/resume across a browser refresh or crash | `useUnsavedChangesWarning` blocks in-app (react-router) navigation away from a dirty wizard. | Nothing persists the in-progress wizard state to sessionStorage/localStorage — refreshing the tab, or a crash right after a real incident (a realistic moment for a coordinator's attention to be split), loses every field typed so far. | Persist form state keyed by `id ?? 'new'` to sessionStorage on change, restore on mount, clear on successful submit. | M | 4 | pages/IncidentCreatePage.tsx (no localStorage/sessionStorage usage anywhere in the file) | — |

**Issues on this page:**
- PP-26 (P2) — Family/support-coordinator notification can only be recorded after the incident already exists, because the Compliance step is edit-mode-only.
- PP-27 (P2) — A witness's submitted statement is never shown anywhere in the incident wizard.
- PP-28 (P2) — Every save failure — including a ReadOnly/unauthorised user's 403 — shows the same hardcoded message: 'Failed to ... incident report. Please check your input and try again.'
- PP-79 (P3) — The Basics step packs 8-9 unrelated fields into a single ungrouped card.

**Questions:**
- Given how much validation logic is already mirrored client-and-server for the restrictive-practice and injury rules, would a coordinator trust the wizard more if witness statements were visible in the same place, or is that deliberately kept portal-only for a policy reason worth documenting?
- Is the two-save round trip to record family notification (S-7's parallel deadline) an acceptable cost, or does it undermine the urgency the feature is meant to create?


### `/settings` — Settings

*Event templates, activity library, qualification/appearance preferences, provider (organisation) settings, support catalogue import, public holidays, and SuperAdmin tenant/user administration, in one 9-tab surface.*

**Scores:** Audit a/p/t/r/ap = 2/3/2/3/2 (12/20) · Nielsen 22/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | A tenant's Provider Settings can only be edited through an indirect detour, with no link from the Tenants screen | ProviderSettingsController's upsert endpoint is tenant-scoped and already works correctly under SuperAdmin's ambient "view as tenant" context; TenantDetailView already fetches and displays a tenant's full provider settings. | TenantFormPanel only shows the Provider Settings section during tenant creation ({!isEdit && (...)}), and TenantDetailView renders the same data completely read-only with zero edit affordance; TenantsController exposes only a GET for provider-settings, never a PUT. | Either add a PUT admin/tenants/{id}/provider-settings endpoint plus inline edit in TenantDetailView, or at minimum add a "Switch to this tenant to edit" button that pre-sets the TenantSwitcher and deep-links to Settings > Provider. | M | 4 | odip-prototype/odip/frontend/src/pages/settings/TenantFormPanel.tsx:282-415; odip-prototype/odip/frontend/src/pages/settings/TenantDetailView.tsx:194-226; odip-prototype/odip/backend/Odip.Api/Controllers/TenantsController.cs:184-208 | — |
| 2 | Activity Library is read-only despite a full CRUD backend | ActivitiesController supports Create/Update/GetAll for the Activity entity, and the Activities tab already lists every activity with a Status badge. | No "+ New Activity" button and no edit action anywhere in the tab — verified: no useCreateActivity/useUpdateActivity hook exists anywhere in the frontend (only useCreateScheduledActivity/useUpdateScheduledActivity/useDeleteScheduledActivity, which are for the separate day-schedule join entity). | Add create/edit UI for Activity (name, category, location, accessibility/suitability notes, active flag), mirroring the existing Event Template panel pattern. | M | 3 | odip-prototype/odip/frontend/src/pages/SettingsPage.tsx:182-201; odip-prototype/odip/backend/Odip.Api/Controllers/TasksDashboardController.cs:135-183; odip-prototype/odip/frontend/src/api/hooks/activities.ts | — |

**Issues on this page:**
- PP-24 (P1) — Native browser alert() is used for Support Catalogue import failures.
- PP-77 (P2) — No unsaved-changes guard on any Settings tab.
- PP-78 (P2) — Four different ad hoc success/error colour treatments appear inside one settings module.
- PP-100 (P3) — Icon-only Edit (Pencil) buttons are labelled only by a native title attribute.

**Questions:**
- Should Provider Settings for other tenants be editable directly from the Tenants admin screen, since that's clearly where a SuperAdmin looks for it first?
- Now that Activities have full backend CRUD, was hiding create/edit from Settings intentional, or just not wired up yet?


### `/qualifications` — Staff qualification expiry

*Tenant-wide dashboard of expired/expiring/no-date staff qualifications, grouped by staff member, with inline expiry-date editing.*

**Scores:** Audit a/p/t/r/ap = 3/3/3/3/2 (14/20) · Nielsen 26/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Worker-screening verification state on this dashboard | The QUALS table treats Worker Screening as 'has an expiry date at all' — the code comment explicitly notes presence is inferred only from a date being entered, with no boolean flag. | Any signal distinguishing a verified screening from a typed-but-unchecked one; today, typing any plausible-looking date makes the 'issue' vanish from this page. | Once S-10's VerifiedAt exists, add a fifth QualStatus ('unverified') so a present-but-unverified screening still surfaces here rather than reading as fully resolved. | S | 4 | pages/QualificationsPage.tsx:33-41 | S-10 |
| 2 | Bulk update after a group refresher | One-row-at-a-time inline edit. | A way to update the same qualification's expiry date for several staff at once after e.g. a group First Aid refresher session — a common real-world trigger for a batch of identical edits. | Add a lightweight multi-select-then-bulk-set-date action scoped to one qualification type. | M | 3 | pages/QualificationsPage.tsx:280-304 | F-13 |

**Issues on this page:**
- PP-49 (P2) — Only active staff are loaded (useStaff({isActive: 'true'})), so an inactive-but-still-employed-on-paper worker's expired qualifications never appear on this compliance view or anywhere else.
- PP-50 (P2) — A staff member's name in the accordion header is plain text, not a link to their profile/edit page.
- PP-86 (P3) — Expiring-row highlight uses a hardcoded hex (#fef3c7) instead of a token.

**Questions:**
- If a coordinator needs to check an inactive/offboarded worker's qualification history for an audit, where do they do that today?
- Does 'has a date' currently give false assurance for worker screening, since no verification step exists yet?


### `/claims/:id` — Claim Detail (legacy TripClaim pipeline)

*View and progress a single trip-generated NDIS claim through Draft → Submitted → Paid/Rejected, handle per-line no-shows, and download the BPR CSV or a per-booking plan-managed/self-managed invoice.*

**Scores:** Audit a/p/t/r/ap = 2/3/1/2/2 (10/20) · Nielsen 18/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Reconcile this page's money state with the /billing pipeline | A fully worked TripClaim lifecycle here, and a fully worked BillableEvent/ServiceBooking/ClaimBatch lifecycle at /billing — both live, both routed, both able to represent a claim for the same participant. | No cross-link, shared total, or visual indicator anywhere connecting a participant's TripClaim history to their FundingSource/ServiceBooking/BillableEvent history — a coordinator or Finance user has no single place to see total claimed-to-date for a participant across both systems. | This is the product decision S-18 already frames (retire TripClaim into BillableEvent, or have claim generation write ServiceBookingLine.ClaimedAmount) — at minimum, surface a link from ClaimDetailPage to the participant's /billing view scoped to that participant so the two are one click apart instead of requiring a manual search. | L | 4 | frontend/src/pages/ClaimDetailPage.tsx; frontend/src/App.tsx:126-129 | S-18, S-13 |
| 2 | Expose the existing delete-claim capability in the UI | A working DELETE /api/v1/claims/{claimId} endpoint that correctly blocks deletion once a claim is Submitted or Paid, and a matching useDeleteClaim hook already defined in the frontend API layer. | ClaimDetailPage never imports or calls useDeleteClaim — there is no delete button anywhere in the UI, so a mistakenly generated Draft claim can only be removed via direct API access. | Add a 'Delete claim' action (visible only while Status === Draft, matching the backend's own guard) behind a ConfirmDialog, using the already-defined useDeleteClaim hook. | S | 3 | backend/Odip.Api/Controllers/ClaimsController.cs:194-221; frontend/src/api/hooks/claims.ts:70-78; frontend/src/pages/ClaimDetailPage.tsx | — |

**Issues on this page:**
- PP-4 (P1) — No confirmation and no error feedback on claim status changes (Submitted / Paid / Rejected).
- PP-35 (P2) — This page hardcodes raw colors and card styling instead of the token system used elsewhere in the same module.
- PP-80 (P3) — Notes textarea has no unsaved-changes guard.

**Questions:**
- If a coordinator marks a claim Paid by mistake, what is the recovery path today — is retyping the whole claim from the trip the only option?
- Given this page already implements plan-managed/self-managed invoicing correctly, why does S-13 treat that as missing work for the new pipeline rather than a capability to port over?


### `/billing` — Billing (Funding Sources / Service Bookings / Billable Events)

*Manage the pre-claim data foundation for NDIS billing: who has what funding, which PRODA service bookings track remaining balance, and which individual billable events are queued to be claimed or invoiced.*

**Scores:** Audit a/p/t/r/ap = 3/3/2/2/3 (13/20) · Nielsen 22/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Expose a delete/void action for Draft-status billing entities | Full create + edit flows for funding sources, service bookings, and billable events, with claimed events correctly locked against edits. | No DELETE route or UI action for any of the three entities at any status — a mis-entered Draft record is permanent. | Add DELETE endpoints scoped to pre-claim status plus a delete/void button behind ConfirmDialog on each panel. | M | 3 | backend/Odip.Api/Controllers/BillingController.cs; frontend/src/pages/BillingPage.tsx:166-179 | — |
| 2 | Let a service booking be edited after creation | ServiceBookingFormPanel creates a booking with lines; ServiceBookingDetailModal displays it read-only. | No PUT /billing/service-bookings/{id} exists on the backend at all, so a typo'd PRODA reference or wrong claim-window is permanent short of direct DB changes. | Add an update endpoint plus an edit affordance from ServiceBookingDetailModal (or a second FormPanel mode, mirroring FundingSourceFormPanel's isEdit pattern). | M | 3 | backend/Odip.Api/Controllers/BillingController.cs:110-212; frontend/src/pages/billing/ServiceBookingFormPanel.tsx; frontend/src/pages/billing/ServiceBookingDetailModal.tsx | — |

**Issues on this page:**
- PP-36 (P2) — No delete/void action exists anywhere for a mistaken funding source, service booking, or billable event.
- PP-37 (P2) — Rejected billable events never surface their rejection reason in the UI.
- PP-38 (P2) — Funding-source Active/Inactive toggle has no confirmation step and no success/failure feedback.
- PP-81 (P3) — BillableEventFormPanel's ~15 fields have no section grouping or visual breaks.

**Questions:**
- Should deactivating a funding source or leaving a billable event stuck in Draft ever be a silent, single-click action given both are money-adjacent?
- Is a single 15-field drawer the right shape for a billable event, or would a two-step flow (context, then delivery/claim detail) reduce the wall-of-fields on the one form every coordinator fills out most often?


### `/billing/claim-batches/new` — Build Claim Batch

*Let a coordinator select unclaimed billable events, dry-run validate them against booking balances and NDIA rules, and create a PRODA claim batch.*

**Scores:** Audit a/p/t/r/ap = 3/3/2/3/3 (14/20) · Nielsen 24/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Fix the post-create navigation target | A complete select → validate → confirm → create flow that works correctly against the API end-to-end. | The final navigate() call points at a dead route, so the flow's outcome is unreachable from the UI — no toast, no link, nothing. | Correct the path to `/billing/claim-batches/${batch.id}` (trivial one-line change; see issue above). | S | 5 | frontend/src/pages/ClaimBatchBuilderPage.tsx:195; frontend/src/App.tsx:126-129 | — |

**Issues on this page:**
- PP-1 (P0) — 'Create claim batch' navigates to a route that does not exist.
- PP-25 (P2) — Validation Warning-severity pills and row tint use raw Tailwind palette utilities instead of tokens.

**Questions:**
- Has anyone actually clicked 'Create claim batch' end-to-end in a browser since this route was written — does the team already know this currently dead-ends?
- Should the confirm dialog itself carry a 'Go to batch' link independent of navigate(), so a future routing regression can't strand the user again after an irreversible action?


### `/billing/claim-batches/:id` — Claim Batch Detail

*Show a created PRODA claim batch's events and totals, and let the coordinator download the PRODA bulk-file CSV to lodge with NDIA.*

**Scores:** Audit a/p/t/r/ap = 3/3/2/2/3 (13/20) · Nielsen 20/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Build a claim-batches list page | A complete backend endpoint (GetClaimBatches) and frontend hook (useClaimBatches) with a full list DTO. | No route or page anywhere consumes either — the list is entirely unreachable from the UI. | Add ClaimBatchesListPage.tsx at /billing/claim-batches using the module's existing DataTable pattern (columns: FileName, Created, Submitted, Events, Total), with each row linking to the detail page, and a link/tab from BillingPage. | S | 5 | backend/Odip.Api/Controllers/BillingController.cs:329-345; frontend/src/api/hooks/billing.ts:117-125 | — |

**Issues on this page:**
- PP-3 (P1) — No page anywhere lists existing claim batches, even though the backend and the frontend data layer for one are fully built.
- PP-34 (P2) — The 'Submitted to NDIA' badge uses raw bg-blue-100/text-blue-700 instead of a token.

**Questions:**
- Once useClaimBatches has a UI consumer, should the claim-batches list live as a fourth BillingPage tab, or does it deserve its own place given it is effectively the money ledger?
- Is 'download the PRODA file' really the coordinator's last action on this page, or does someone need a place to record what happened after upload (accepted/rejected counts, NDIA batch id) — tying back into S-9's mark-submitted gap?


### `/rostering` — Roster board

*Week-by-week drag-and-drop roster of community shifts (by participant or by staff), with live conflict/finding checks, an override-reason flow, and pattern-driven shift generation upstream.*

**Scores:** Audit a/p/t/r/ap = 4/3/3/3/4 (17/20) · Nielsen 32/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Give the shift lifecycle a real entry point (this is what would take the page from a 3 to a 4) | A full Draft→Published→Completed→Cancelled ShiftStatus enum on the backend, plus a mature, well-designed override/finding flow for the write path that already exists. | Any UI to move a shift through that lifecycle — see the P1 issue above. This single gap is what stands between 'excellent roster editor' and 'roster editor that actually feeds the business's billing and delivery-verification needs'. | Ship the Status field (P1 issue) plus a per-day/per-week 'mark this week's community shifts delivered' bulk action, mirroring GeneratePatternDialog's two-step preview-then-confirm pattern. | M | 5 | pages/rostering/components/ShiftSlideOver.tsx; pages/rostering/components/GeneratePatternDialog.tsx | F-7, F-8 |
| 2 | Per-staff target hours instead of one hardcoded 38h for everyone | StaffRow renders a rostered-vs-target hours meter and an OVER_HOURS-style compliance note per staff row. | TargetHours is RosterConflictService.DefaultWeeklyHoursThreshold — a single constant applied to every staff member regardless of whether they're full-time, part-time, or casual. | Once a per-staff contracted-hours field exists (see Staff-page suggestion), read it here instead of the constant. | M | 3 | pages/rostering/components/StaffRow.tsx:22-23; backend/Odip.Api/Controllers/RosteringController.cs:266; backend/Odip.Domain/Rostering/Services/RosterConflictService.cs:45 | — |

**Issues on this page:**
- PP-8 (P1) — ShiftSlideOver's create/edit form has no Status field at all, and the frontend's CreateShiftDto/UpdateShiftDto type has no status property — so every save through the roster board's own edit UI omits it from the request body.
- PP-51 (P2) — No bulk operations exist on the board — assignment, unassignment, and deletion are all one-shift-at-a-time (via drag or the per-chip menu); there's no multi-select.
- PP-87 (P3) — No print/export of the current week's board (e.g. a PDF/CSV roster to hand to staff without app access).

**Questions:**
- What currently happens operationally when a community shift is actually delivered — is there a paper/verbal process today that this UI should replace, or has nothing filled that gap yet?
- Given how much design care went into the Blocking/Warning override flow, why does the same rigor not extend to closing the lifecycle loop on the entity it's protecting?


### `/rostering/patterns` — Shift patterns

*Manage weekly recurring shift patterns per participant and materialise them into real shifts on the roster over a date range.*

**Scores:** Audit a/p/t/r/ap = 4/3/3/3/4 (17/20) · Nielsen 31/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Bulk pattern generation | Per-pattern generation with a preview count and idempotent re-run safety. | Any way to run that same safe operation across every active pattern at once for a date range (e.g. 'generate next fortnight for everyone'). | Add a page-level action that iterates active patterns through the same generate-pattern endpoint, aggregating results into one summary dialog. | M | 4 | pages/rostering/PatternsPage.tsx; pages/rostering/components/GeneratePatternDialog.tsx | F-13 |

**Issues on this page:**
- PP-52 (P2) — No search/filter on the patterns table despite it being sortable by participant/day, and no bulk 'generate shifts for all active patterns over range X' action — each pattern must be opened and generated individually.

**Questions:**
- How many active patterns does a typical tenant run concurrently — is per-pattern generation still fine at that scale, or already a chore?


### `/rostering/compatibility` — Staff–participant compatibility

*Full staff × participant matrix to mark Preferred/Excluded pairings that feed the roster board's suggestions and conflict warnings.*

**Scores:** Audit a/p/t/r/ap = 3/2/3/2/4 (14/20) · Nielsen 29/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Search/filter the matrix | A full, well-designed matrix with optimistic editing and a clear exclusion-reason flow. | Any way to narrow the visible rows/columns — every other roster-adjacent page in this group (RosterBoardPage, WeekToolbar) already has participant/region filters. | Add staff-name and participant-name filter inputs above the table. | S | 4 | pages/rostering/CompatibilityPage.tsx:177-182 | — |

**Issues on this page:**
- PP-53 (P2) — No search/filter for staff rows or participant columns in a matrix whose size is the product of two independently-growing lists.
- PP-88 (P3) — Every staff×participant cell is rendered unconditionally with its own <select> and hover-reveal wrapper, with no virtualization.

**Questions:**
- At what staff×participant count does this matrix become the slowest or most overwhelming page in the app — has anyone tried it against production-scale data?


### `/medications` — Medications (MAR / Register / Report)

*Daily medication administration record (MAR) and PRN dosing, the cross-participant medication register, and an admin-only administration report.*

**Scores:** Audit a/p/t/r/ap = 3/3/3/3/4 (16/20) · Nielsen 32/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Visible amendment history on a MAR record | MedicationAdministration.UpdatedAt is stamped on every amendment by MedicationsController.UpdateAdministration, and the 'Amend' flow is fully wired end-to-end from the MAR row. | AdministrationDto never carries UpdatedAt (only CreatedAt), so ToAdministrationDto can't map it and neither MarTab nor ReportTab can show a record was changed after it was first saved, when, or by whom. | Add UpdatedAt to AdministrationDto, map it in ToAdministrationDto, and render a small 'Amended <relative time>' note on the MAR row / Report tab row whenever UpdatedAt is later than CreatedAt. | S | 4 | backend/Odip.Application/DTOs/MedicationDTOs.cs:146-178; backend/Odip.Api/Controllers/MedicationsController.cs:749-777; backend/Odip.Domain/Entities/MedicationAdministration.cs:97; frontend/src/pages/medications/MarTab.tsx:212-219 | S-1 |
| 2 | Medication stock/supply tracking | ParticipantMedication models the full prescribing/dosing/compliance surface (form, route, schedule, consent, review date) and MedicationAdministration records every dose given. | No field anywhere records how much stock is on hand or was last supplied, and no administration decrements it — a coordinator/nurse has no in-app signal a script is about to run out. | Add an optional SuppliedQuantity/RemainingQuantity (or a simple 'last resupply' date) to ParticipantMedication, decrement it on each Administered dose in RecordAdministration, and surface a low-stock chip in RegisterTab next to the existing compliance flags. | M | 4 | backend/Odip.Domain/Entities/ParticipantMedication.cs; backend/Odip.Domain/Entities/MedicationAdministration.cs; frontend/src/pages/medications/RegisterTab.tsx:84 | — |
| 3 | Tenant-wide overdue-dose count on the MAR tab | Each MAR entry already computes IsOverdue server-side and MarTab tints an overdue row's background. | Nothing aggregates that into a glanceable count the way IncidentsPage's QSC-overdue banner does — a coordinator scanning today's MAR across many participants has to read every time-group to spot how many doses are overdue. | Add a small overdue-count chip near the date navigator in MarTab, summing entry.isOverdue across the currently loaded day. | S | 3 | backend/Odip.Api/Controllers/MedicationsController.cs:251; frontend/src/pages/medications/MarTab.tsx:181-185 | S-12 |

**Issues on this page:**
- PP-29 (P2) — Warning-state styling is hardcoded Tailwind amber utilities instead of the design token used elsewhere in this module.
- PP-30 (P2) — RecordAdministrationModal's Status control shows five same-weight options with no primary/exception grouping.
- PP-31 (P2) — Modal backdrop click silently discards a partially-filled Record/Amend administration form.

**Questions:**
- Is medication stock/repeat-script tracking genuinely out of scope for ODIP, or just not built yet — and if out of scope, where does Oassist track it today?
- Should an amendment to an already-recorded dose require a reason, the same way a non-Administered status does, given it can rewrite what actually happened?


### `/medications/new and /medications/:id/edit` — Medication form (create / edit)

*Create or edit a participant's medication chart entry, including PRN rules, chemical-restraint/BSP tracking, consent and review scheduling.*

**Scores:** Audit a/p/t/r/ap = 3/4/3/3/4 (17/20) · Nielsen 31/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Link from the medication form to that medication's own dose history | MedicationDetailDto carries PrnDosesInLast24h and the participant's full administration history is queryable via GET /participants/{id}/administrations. | MedicationFormPage's edit view never links to or summarises that medication's administration/refusal history — a coordinator reviewing a medication near its 'Next Review Due' date has to leave the form and re-filter the Report tab by participant to see how it's actually been going. | Add a 'View administration history' link on the edit form to the Report tab pre-filtered to this participant/medication. | S | 3 | frontend/src/pages/MedicationFormPage.tsx:116-127; backend/Odip.Api/Controllers/MedicationsController.cs:495-511 | S-28 |

**Issues on this page:**
- PP-32 (P2) — Save/update failures surface only a generic banner, never the server's actual validation message.

**Questions:**
- Would a 'preview as MAR entry' before saving catch schedule mistakes (e.g. a wrong every-N-days anchor) earlier than waiting for the next day's MAR tab?


### `/portal` — My Shifts

*A field support worker's own week of rostered shifts and trip assignments — the entry point into the portal.*

**Scores:** Audit a/p/t/r/ap = 4/4/4/4/4 (20/20) · Nielsen 33/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Thumb-zone week navigation | Previous week / This week / Next week navigation is fully built and functional, living in the PageHeader's action slot. | All three controls sit at the very top of the viewport — on a one-handed phone (this page's own stated persona) that's the least reachable spot, and it's the page's only interactive control besides the shift cards themselves. | Duplicate or relocate the week-nav control into a sticky bottom bar on narrow viewports so it sits in the thumb zone. | S | 3 | frontend/src/pages/portal/PortalShiftsPage.tsx:87-111 | — |
| 2 | 'As of <time>' freshness indicator | useMyShifts fetches the week's shifts and trip assignments as a standard TanStack Query, with the page rendering isLoading/isError/data states only. | No visible 'Updated <relative time>' indicator or manual refresh control — on a poor-connectivity shift, a worker returning to a backgrounded tab has no way to tell whether the shown roster is current or served from a stale cache. | Surface the query's dataUpdatedAt next to the week range (e.g. 'Updated 4 min ago') with a manual refresh icon button beside it. | S | 3 | frontend/src/api/hooks/portal.ts:5-10; frontend/src/pages/portal/PortalShiftsPage.tsx:61 | — |

**Issues on this page:**
- PP-57 (P2) — Week navigation controls sit at the top of the page, outside the one-handed thumb zone.

**Questions:**
- Would a persistent 'as of <time>' freshness indicator do more for trust here than a pull-to-refresh gesture, given the page already auto-fetches on mount?


### `/portal/shifts/:id` — Shift detail

*Full detail for one of the worker's own shifts — participant summary, routines, risks, active medications, and a shift-notes log.*

**Scores:** Audit a/p/t/r/ap = 4/3/4/4/4 (19/20) · Nielsen 31/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | 'Edited' indicator on shift notes | ShiftNoteDto already returns updatedAt from GET /portal/shifts/{id}/notes, and the frontend's ShiftNoteDto type already carries updatedAt too — the data is fetched and available with no extra API work. | ShiftNotesSection never renders it — only note.createdAt is shown, so a note edited minutes or hours after it was first written (via the author-only Edit action) looks identical to one that was never touched. | Render 'edited <relative time>' next to the existing timestamp whenever updatedAt is later than createdAt, matching the pattern already used for flagsAcknowledgedAt. | S | 3 | frontend/src/pages/portal/components/ShiftNotesSection.tsx:210-211; frontend/src/api/types/rostering.ts:33-40; backend/Odip.Application/DTOs/ShiftNoteDTOs.cs:10-17 | — |

**Issues on this page:**
- PP-56 (P2) — An edited shift note carries no 'edited' indicator even though the timestamp already exists in the API response.
- PP-89 (P3) — Six always-expanded read-only sections stack with no in-page anchors or collapse.

**Questions:**
- Given ShiftNoteDto already returns updatedAt, is withholding an 'edited' indicator intentional (e.g. to avoid implying tampering), or just unbuilt?


### `/portal/witness-approvals` — Witness approvals

*A worker's queue of pending medication and incident witness requests to approve or decline.*

**Scores:** Audit a/p/t/r/ap = 4/4/4/4/4 (20/20) · Nielsen 30/40

| Rank | Suggestion | Exists today | Missing | Fix | Effort | Value | Evidence | Related |
|------|------------|--------------|---------|-----|--------|-------|----------|---------|
| 1 | Distinguish 'already resolved' from a network failure | Approve/decline already report a specific server message when one exists (res.errors?.[0] \|\| res.message), and the backend already returns a precise reason — RespondToWitnessRequestAsync 400s with 'This witness request has already been responded to' once the status has moved past Pending. | The page's catch block collapses every failure to a flat 'Failed to approve.'/'Failed to decline.', and the list has no refetchInterval of its own (only the sidebar badge polls every 60s), so a request answered elsewhere keeps sitting in this list until the worker leaves and returns. | Detect the 'already responded to' message specifically, show 'This request was already handled' instead of the generic failure text, and refetch the list automatically when it's hit. | S | 3 | frontend/src/pages/portal/PortalWitnessApprovalsPage.tsx:59-65; backend/Odip.Api/Controllers/PortalController.cs:344-345 | — |
| 2 | Coordinator visibility of aged pending witness requests | The medications Report tab already shows each administration's witnessStatus (Pending/Approved/Declined/NotRequired) with the witness's name, so a coordinator has some after-the-fact visibility for medication witnessing. | There is no equivalent for incident witness requests at all, and even on the medication side nothing highlights or ages a request stuck at Pending — GetWitnessRequests is a worker-scoped endpoint with no tenant-wide/coordinator counterpart, so a high-risk dose whose witness never responds surfaces nowhere except by a coordinator noticing the badge while scanning the Report tab. | Add an 'age' column/highlight to the Report tab's witness status (e.g. flag Pending > 24h), and extend the same aggregate pattern used elsewhere (e.g. ParticipantAlertsController) to include stuck incident witness requests. | M | 3 | frontend/src/pages/medications/ReportTab.tsx:75-86; backend/Odip.Api/Controllers/PortalController.cs:288-313 | S-12 |

**Issues on this page:**
- PP-33 (P2) — A witness request already resolved elsewhere surfaces only a generic 'Failed to approve/decline.' error with no explanation.

**Questions:**
- Should a coordinator have any visibility into stuck/aged witness requests (e.g. a high-risk dose given days ago still Pending), or is that entirely the field worker's problem to notice?


## Top 15 completion suggestions platform-wide

Ranked by value to the office coordinator/compliance (desc), then effort (asc: S < M < L), tie-broken by compliance relevance.

| Rank | Page | Suggestion | Effort | Value | Why first |
|------|------|------------|--------|-------|-----------|
| 1 | `/billing/claim-batches/new` | Fix the post-create navigation target | S | 5 | The single P0 in the whole audit — a one-line route fix restores the only unreachable terminal screen after an irreversible action. |
| 2 | `/billing/claim-batches/:id` | Build a claim-batches list page | S | 5 | Backend and hook are fully built; wiring a list page turns the newer claim pipeline from bookmark-only into a real, reusable workflow. |
| 3 | `/staff` | Worker-screening verification metadata (S-10) | S | 5 | S-10 in one field pair; resolves the identical gap on three pages (Staff list, Staff form, Qualifications) at once for near-zero cost. |
| 4 | `/staff/new, /staff/:id/edit` | Worker-screening verification fields on the form | S | 5 | Same S-10 fix, entered where the data actually originates — ships together with #3. |
| 5 | `/rostering` | Give the shift lifecycle a real entry point (this is what would take the page from a 3 to a 4) | M | 5 | Closes the one gap between an otherwise-excellent roster editor and a usable shift-to-billing pipeline (unblocks F-7/F-8). |
| 6 | `/accommodation/:id` | Property detail has zero visibility into bookings or availability - the product's own stated differentiator | M | 5 | Reservations endpoint already returns everything needed; without it the product's own stated differentiator is invisible on its own detail page. |
| 7 | `/accommodation` | Property cards carry zero booking/availability signal - the product's own differentiator is invisible here | M | 5 | Same reservations API, applied at the list level — pairs naturally with #6 as one piece of work. |
| 8 | `/vehicles` | No vehicle detail page and no way to see trip-assignment history, despite the backend fully supporting both | M | 5 | Assignments endpoint is fully built; a coordinator currently cannot see which trips a vehicle is booked on from any screen. |
| 9 | `/vehicles` | Service/rego expiry is only ever visible per-card, one at a time - no fleet-wide urgent list | M | 5 | Compliance-relevant (service/rego expiry) and cheap relative to its value — a sort change plus a banner. |
| 10 | `(shell)` | Tenant/user impersonation has no audit trail despite the product's "audit logging on every entity" principle | M | 5 | SuperAdmin impersonation is the single highest-blast-radius action in the app and currently leaves no audit trail at all (S-25). |
| 11 | `/medications` | Visible amendment history on a MAR record | S | 4 | A single DTO field plus one render line makes silent, invisible edits to a clinical record visible again. |
| 12 | `/participants/:id` | Give Coordinators and SuperAdmins the participant audit History tab | S | 4 | One-line permission-check fix restores audit visibility to the primary persona on the app's core compliance record. |
| 13 | `/participants/new and /participants/:id/intake` | Add the app's unsaved-changes guard to the Intake wizard | S | 4 | Wiring an existing hook stops the app's highest-volume compliance form (Intake) from losing data on stray navigation. |
| 14 | `/qualifications` | Worker-screening verification state on this dashboard | S | 4 | Once S-10 exists, this closes the false-assurance gap on the one screen built specifically to catch qualification risk. |
| 15 | `/rostering/compatibility` | Search/filter the matrix | S | 4 | The matrix already has good editing UX; without a filter it will become the least usable page in the app purely from data growth. |

## Questions for the product owner

1. **[/trips]** Why does editing a trip exist as two separate, drifting implementations (`TripsPage.tsx`'s inline modal and `EditTripModal.tsx`) instead of one shared component?
2. **[/incidents]** If archiving an incident behaves invisibly-differently from every other archived entity in the app, should incidents have an "archive" concept at all, or should Draft/Resolved/Closed status alone be the lifecycle, with no separate soft-delete?
3. **[/rostering]** Given how much design care went into the Blocking/Warning override flow, why doesn't the same rigor extend to closing the shift lifecycle loop (no UI ever moves a shift to Published or Completed)?
4. **[/billing/claim-batches/new]** Has anyone actually clicked "Create claim batch" end-to-end in a browser since this route was written — does the team already know this currently dead-ends?
5. **[/claims/:id]** Given this legacy page already implements plan-managed/self-managed invoicing correctly, why does S-13 treat that as missing work for the new BillableEvent pipeline rather than a capability to port over?
6. **[/staff]** Should worker-screening verification block rostering the way expiry already threatens to, or stay purely informational for now?
7. **[/participants/:id]** Should a ReadOnly viewer of an empty, conditionally-hidden Details-tab card see an explicit "nothing recorded" placeholder instead of the card silently disappearing, so the tab's shape doesn't change by role?
8. **[/medications]** Is medication stock/repeat-script tracking genuinely out of scope for ODIP, or just not built yet — and if out of scope, where is it tracked today?
9. **[(shell)]** If tenant/user switching is a high-stakes SuperAdmin action, should it require an explicit confirm step rather than firing on the first click of a list item?
10. **[/vehicles]** If Accommodation gets a detail page and Vehicles doesn't, is that a deliberate call that vehicles need less depth, or just an unfinished corner?

## Recommended next actions

1. **`/impeccable harden`** — targets: the P0 route fix (`/billing/claim-batches/new`); confirmation + error-feedback gaps on `/claims/:id`, `/billing`, `/trips`, `/staff`, `/bookings`; the Incidents archive/restore break (`/incidents`); TenantSwitcher/UserSwitcher confirmation and mobile-nav permission gating (`(shell)`); write-route gating on `/accommodation/new`, `/accommodation/:id/edit`, `/vehicles/new`, `/vehicles/:id/edit`, `/staff/new`, `/staff/:id/edit`; ARIA tab semantics on `/trips/:id`; keyboard access on `/schedule`'s assign/unassign cells; the Intake wizard's missing unsaved-changes guard.
2. **`/impeccable clarify`** — targets: Login's generic error messaging; the repeated generic mutation-error banner on Accommodation/Vehicle/Medication/Trip create forms; Dashboard's mislabelled "Resolve" links; Qualifications' unstated inactive-staff scoping; NDIS domain-term glossary gaps on the Incident wizard and Trip create form.
3. **`/impeccable adapt`** — targets: Participants' 11-column table with no responsive collapse; the Caregiver Submissions diff table's clipped overflow; Portal's week-navigation thumb-zone placement; the Rostering Compatibility matrix's missing filter/virtualization.
4. **`/impeccable distill`** — targets: Participant Detail's 13-15-card Details tab; `BillableEventFormPanel`'s 15-field wall; the Profile wizard's 43-row Community Access step; the Incident wizard's ungrouped 8-9-field Basics step; removing the duplicate Edit-Trip implementation in favour of `EditTripModal`.
5. **`/impeccable audit`** — re-run after the Stage 1 harden/clarify/adapt/distill passes land, to confirm the fixes actually move the platform Audit Health and Design Health scores.
6. **`/impeccable polish`**

You can ask me to run these one at a time, or pick the ones that matter most. Re-run `/impeccable critique` after fixes to measure the change.
