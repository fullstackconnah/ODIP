# Discovery: Participant Detail Page & Tabs

Scope: `frontend/src/pages/ParticipantDetailPage.tsx` (733 lines) and
`frontend/src/pages/participant-detail/*` (barrel-exported via `index.ts`).

## 1. Header

File: `frontend/src/pages/ParticipantDetailPage.tsx:87-169`

Structure:
```
<div className="space-y-6 animate-fade-in">
  <div className="flex items-start gap-4">                          // L89 outer row
    <Link ...><ArrowLeft/></Link>                                    // L90-92 back button, fixed width
    <div className="flex-1">                                        // L93 GROWS TO FILL — flex-1
      <div className="flex items-center gap-3 flex-wrap">           // L94 name+badges row
        <h1 className="text-2xl font-bold">{p.fullName}</h1>        // L95
        <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} /> // L96
        {p.isDraft && <StatusBadge status="Draft" colorMap={{draft: 'bg-[var(--color-warning-container)] ...'}} />} // L97-99  <-- THE "WARNING PILL"
      </div>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{region} · {planType} · Support Ratio: {supportRatio}</p> // L101
      <div className="mt-2"><ServiceStreamBadges value={p.serviceStreams} /></div>  // L102-104
      {p.isDraft && ( ... draft banner with FileEdit icon + "Resume intake" link ... )}  // L105-120
      {canViewAlerts && alertsData && <ParticipantAlertsBanner .../>}  // L121-123
    </div>
    <div className="flex items-center gap-2">                        // L125 right-side action buttons, fixed-ish width
      ... Intake Form PDF button, Participant Profile PDF button, Edit button (canWrite-gated) ...
    </div>
  </div>
  <TabNav tabs={[...]} active={tab} onChange={...} />                // L171-185
  ...tab content...
```

**The "warning pill"** is the conditional `<StatusBadge status="Draft" .../>` at L97-99, styled via
`colorMap={{ draft: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' }}`
(`frontend/src/components/StatusBadge.tsx:53-61` renders `<span className="text-xs px-2 py-0.5 rounded-full ...">`).
It sits inside the `flex items-center gap-3 flex-wrap` row (L94) immediately to the right of the
Active/Inactive `StatusBadge` (L96), which itself sits to the right of the `<h1>{p.fullName}</h1>` (L95).

**Why its size/wrap point varies with the neighbouring container:** the pill row's parent
(`<div className="flex-1">`, L93) is a flex-grow child of the outer `flex items-start gap-4` row
(L89), sandwiched between the fixed-width back-arrow `<Link>` (L90) and the right-side button
cluster (`<div className="flex items-center gap-2">`, L125) which holds up to three buttons
(2 PDF download buttons + a conditional Edit button, `canWrite`-gated). Because the button cluster
is NOT `shrink-0` and its own width is data-dependent (button label toggles between "Intake Form
PDF" / "Preparing…" while a download mutation `isPending`, and the Edit button only renders when
`canWrite` is true), the available width left for the `flex-1` name/badge column shrinks or grows
as those buttons change size/count. The badge row itself uses `flex-wrap`, so at narrower available
widths the Draft pill (and even the h1) wraps onto a new line rather than the row overflowing.

Also present in the header: `ParticipantAlertsBanner` (`frontend/src/components/ParticipantAlertsBanner.tsx`),
a separate list of severity-styled alert rows (Critical/Warning/Info via `ALERT_SEVERITY_STYLES` in
`frontend/src/components/alertSeverityStyles.ts:9-13`), rendered below the draft banner — NOT a
pill, but the other "warning-like" header element if that's what was meant instead. No component
literally named "WarningPill"/"AlertBadge" exists (grepped `pill|badge|warning|alert` case-insensitive
across `src` — only `StatusBadge`, `ServiceStreamBadges`, `ParticipantAlertsBanner`, `alertSeverityStyles.ts`
matched).

## 2. Restrictive Practices Tab

Component: `frontend/src/pages/participant-detail/RestrictivePracticesTab.tsx` (775 lines)

**Single "New entry" flow** (L499-505 button, opens `openCreate()` L222-227 → `modalState={mode:'create'}` → Modal at L564-658):
- Fields: Type (`Dropdown`, `RESTRICTIVE_PRACTICE_TYPES`), Description (`textarea`, required), conditionally
  "Linked medication" (`Dropdown` over `useParticipantMedications`, only when `type === 'ChemicalRestraint'`),
  Authorised by (`input`), Authorisation date (`input type=date`), Review date (`input type=date`),
  and (edit-mode only) an "Active" checkbox.
- Submit handler: `handleSave()` (L256-278) → validates description non-empty (L249-254) → builds
  payload → `createPractice.mutateAsync({ participantId, data: payload })` (uses `useCreateRestrictivePractice`)
  or `updatePractice.mutateAsync({ id, data: payload })` for edit.

**"Bulk add" modal flow** (L490-498 button `openBulk()` → two-step modal, `bulkStep: 'setup' | 'rows' | null`):
- Step "setup" (Modal L671-721): pick one `RestrictivePracticeType` from `BULK_RESTRICTIVE_PRACTICE_TYPES`
  (a narrower list than the single-entry `RESTRICTIVE_PRACTICE_TYPES` — hint text at L701 explicitly
  tells the user to use "New entry" instead for ChemicalRestraint since bulk has no medication picker),
  and a row count (1-50, validated in `continueToBulkRows()` L298-309).
- Step "rows" (Modal L723-771): an editable `DataTable` (`bulkColumns`, L370-470) with per-row
  Description / Authorised by / Authorisation date / Review date inputs + a remove-row button, plus
  an "Add row" button (L763-769, `addBulkRow()`).
- Submit handler: `saveBulk()` (L333-368) — validates every row has non-empty description client-side
  (L336-344), builds `BulkCreateRestrictivePracticeDto { items: [...] }` (all rows share the single
  `bulkType`, `isActive: true` hardcoded, no `relatedMedicationId` field at all), calls
  `bulkCreatePractices.mutateAsync({ participantId, data: payload })` (`useBulkCreateRestrictivePractices`).
  Server-side errors are parsed by `parseBulkErrors()` (L46-70): errors are `"Row N: message"`-prefixed
  strings mapped back to the row's client-side id for `DataTable`'s `rowError` prop, or an unprefixed
  string shown as a general banner.

**Backend:**
- Controller: `backend/Odip.Api/Controllers/RestrictivePracticesController.cs`
- Entity: `backend/Odip.Domain/Entities/RestrictivePractice.cs` — fields `Type` (enum `RestrictivePracticeType`),
  `Description`, `AuthorisedBy`, `AuthorisationDate` (`DateOnly?`), `ReviewDate` (`DateOnly?`),
  `RelatedMedicationId` (`Guid?`, only meaningful for `ChemicalRestraint`), `IsActive` (bool, default true,
  soft-retire — hard delete also allowed per entity doc comment), `CreatedAt`/`UpdatedAt`.
- DTOs: `backend/Odip.Application/DTOs/RestrictivePracticeDTOs.cs`:
  - `RestrictivePracticeDto` (read model, includes `RelatedMedicationName`)
  - `CreateRestrictivePracticeDto` / `UpdateRestrictivePracticeDto` (single-entry, both carry `RelatedMedicationId`)
  - `BulkCreateRestrictivePracticeRowDto` (deliberately NO `RelatedMedicationId` field — see its doc
    comment: a `ChemicalRestraint` row is rejected outright by the controller's `CreateBulk`, not
    silently created unlinked; no data-annotation attributes since validation is manual per-row for
    row-indexed error reporting) and `BulkCreateRestrictivePracticeDto { Items: List<...> }`.

## 3. Routines Tab

Component: `frontend/src/pages/participant-detail/RoutinesTab.tsx` (447 lines)

**Backend entity:** `backend/Odip.Domain/Entities/ParticipantRoutine.cs`
```csharp
public string Title { get; set; } = string.Empty;
public string Description { get; set; } = string.Empty;
public RoutineCategory Category { get; set; }
/// <summary>Null means the routine applies every day.</summary>
public DayOfWeek? DayOfWeek { get; set; }              // <-- nullable .NET enum (System.DayOfWeek, Sunday=0..Saturday=6)
/// <summary>Null (with EndTime also null) means untimed.</summary>
public TimeOnly? StartTime { get; set; }               // <-- nullable TimeOnly
public TimeOnly? EndTime { get; set; }                 // <-- nullable TimeOnly
public bool IsCritical { get; set; }
public bool IsActive { get; set; } = true;
```
DTOs mirror this exactly (`backend/Odip.Application/DTOs/ParticipantRoutineDTOs.cs`):
`ParticipantRoutineDto`, `CreateParticipantRoutineDto`, `UpdateParticipantRoutineDto` all carry
`DayOfWeek? DayOfWeek`, `TimeOnly? StartTime`, `TimeOnly? EndTime` — no `[Required]` on any of the
three, only `Title`/`Description` are `[Required]`.

**Day-of-week is a nullable native `DayOfWeek` enum**, not a string/bitmask/collection — a routine
belongs to at most one day (or none = every day). No multi-day-per-routine support exists.

**Frontend add/edit form** (Modal, `RoutinesTab.tsx:332-432`, driven by `RoutineFormState` L66-76):
```tsx
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const  // L23, Monday-first DISPLAY order, independent of wire's Sunday=0
```
- Title (`input`, required)
- Description (`textarea`, required)
- Category (`Dropdown` over `ROUTINE_CATEGORIES`)
- Day (`Dropdown`, items = `[{value:'', label:'Every day'}, ...WEEKDAYS]` — L387-394; wire value is
  the `DayOfWeek` enum name as a string, e.g. `"Monday"`, or `null`/`''` for every day)
- "Has a specific time window" checkbox (`form.timed`, L395-402) — gates whether Start/End time
  inputs render at all (L403-412)
- Start time / End time: `<input type="time">` pair, only rendered when `form.timed` is true
- Critical checkbox (L413-420), and (edit-mode only) Active checkbox (L421-430)

Validation (`validate()`, L201-208):
```ts
if (form.timed && (!form.startTime || !form.endTime)) next.time = 'Start and end time are required for a timed routine'
```
**End time is required, but only conditionally** — only when the user has checked "Has a specific
time window" (`form.timed`). If `form.timed` is false, both start/end are sent as `null` (untimed
routine, applies all day). There's no way to set a start time without an end time (or vice versa) —
`toApiTime()` (L31-33) converts `"HH:mm"` → `"HH:mm:ss"` for both.

## 4. Notes Tab

Component: `frontend/src/pages/participant-detail/NotesTab.tsx` (348 lines)

**Backend entity:** `backend/Odip.Domain/Entities/ParticipantNote.cs` — `Title`, `Description`,
`IsPinned`, `IsArchived` (soft-hide, never hard-deleted — "record retention"; controller has no
DELETE endpoint at all), `CreatedByName` (string, "Set server-side from JWT claims at creation
time — never client-supplied"), `CreatedAt`/`UpdatedAt`.

Controller: `backend/Odip.Api/Controllers/ParticipantNotesController.cs`
- `GET participants/{participantId}/notes?includeArchived=` 
- `POST participants/{participantId}/notes` (roles: Admin,Coordinator,SupportWorker,SuperAdmin) —
  `CreatedByName = GetCreatedByName()` pulled from `User.FindFirst("fullName")` / `ClaimTypes.Name` claim (L86-89)
- `PUT participants/notes/{id}` (same roles) — used for edit AND for archive/restore (frontend just
  flips `isArchived` via the same update call, see below)

**Notes are created manually only** — every write path in the codebase goes through
`ParticipantNotesController.Create`/`Update`, called only from `NotesTab.tsx`'s `handleSave()`
(L143-167, create or edit), `confirmArchive()` (L169-187, update with `isArchived: true`), and
`restoreNote()` (L189-204, update with `isArchived: false`). There is no scheduled job, event
handler, or other controller that constructs a `new ParticipantNote` anywhere in the backend except
`DbSeeder.cs` (seed data only, not runtime).

**No auto-note / system-generated-note precedent exists anywhere in the backend.** Grepped for
`system.?generated|auto.?generated|side.?effect` and for any `new ParticipantNote`/`ParticipantNotes.Add`
outside the controller/tests/seeder — none found. The closest analogous pattern in the codebase is
NOT a note-creation side effect but a content-scanning one:
`backend/Odip.Domain/Rostering/ShiftNoteFlagging.cs` — `ShiftNoteKeywordScanner.Scan(body)` runs a
compiled-regex keyword/stem match (Falls/Medication/Injury/BehaviourOfConcern) over a **ShiftNote**
body at create/edit time (`PortalController.CreateShiftNote`/`UpdateShiftNote`, per that file's doc
comment) and stores the result as a `[Flags]` enum column (`ShiftNote.FlaggedCategories`) on the
*same* record — it doesn't create a second note. If a new feature needs "add a note automatically as
a side effect of action X," there is no existing helper/service to reuse; it would be a new pattern,
though `ShiftNoteKeywordScanner`'s "compute at save time, server-side only" shape is the nearest
precedent to mirror.

Frontend note form fields (Modal, L277-333): Title (`input`, required), Description (`textarea`,
required), "Pin this note" checkbox (`isPinned`). Cards show `note.createdByName` and a relative
timestamp (`relativeTime()`, L18-29).

## 5. Support Profile Tab

Rendered inline in `ParticipantDetailPage.tsx:686-710` (no separate component file — unlike the
other tabs it was never extracted into `participant-detail/`).

**Read-only display, with no edit path anywhere in the current app** — this is worth flagging
explicitly:
- Frontend: `useSupportProfile(id)` (`frontend/src/api/hooks/participants.ts:39-45`) is a
  `useQuery`-only hook (`GET /participants/{id}/support-profile`) — there is no
  `useUpdateSupportProfile` mutation hook anywhere in `src/api/hooks/`, and no form/wizard step
  references any of `communicationNotes`/`behaviourSupportNotes`/`restrictivePracticeDetails`/
  `manualHandlingNotes`/`medicationHealthSummary`/`emergencyConsiderations`/`travelSpecificNotes`/
  `reviewDate` (grepped `communicationNotes` and `SupportProfile` across all of `src` — only hits
  are `ParticipantDetailPage.tsx` itself, its test, `api/hooks/participants.ts`, and `api/types/participants.ts`).
  `ParticipantCreatePage.tsx`'s `WIZARD_STEPS` has no step touching any support-profile field.
- Backend: the capability to write it DOES exist —
  `backend/Odip.Api/Controllers/ParticipantsController.cs:990` `PUT {id}/support-profile` →
  `UpdateSupportProfile(Guid id, UpdateSupportProfileDto dto, ...)`, upserting a `SupportProfile` row —
  but nothing in the frontend calls it. This looks like an orphaned/unfinished backend endpoint.
- Fields shown (`ParticipantDetailPage.tsx:692-699`), each rendered only `.filter(f => f.value)` (no
  "wall of unanswered rows"): Communication Notes, Behaviour Support, Restrictive Practice Details,
  Manual Handling, Medication & Health, Emergency Considerations, Travel-Specific — plus Review Date
  shown separately (L706) if set. Entity: `backend/Odip.Domain/Entities/SupportProfile.cs` (all
  `string?`, one-to-one with `Participant`, plus `ReviewDate` as `DateOnly?`).

## 6. Details Tab

Rendered inline in `ParticipantDetailPage.tsx:197-~684` (also not extracted to its own component —
it's the largest inline block on the page, a `grid md:grid-cols-2` of `Card`s: Identity, NDIS &
Funding, Key Identifiers, Cultural & Consent, Support Needs & Mobility, Medical, Behaviour &
Communication, Daily Living, Risks & Hazards — see the PDETAIL-01 comment at L187-196 explaining
the card ordering now mirrors `ParticipantCreatePage.tsx`'s `WIZARD_STEPS` order).

**Every field on the Details tab is read-only display — there is NO inline-editable field
anywhere on this page.** Grepped the whole file for `mutate|onClick|<input|<select|<textarea`:
the only two `onClick`/`.mutate(` hits are the two PDF-download buttons in the header (L134, L150);
zero `<input>`/`<select>`/`<textarea>` elements exist outside the tab sub-components
(Notes/Routines/RestrictivePractices, which each own their own modals). There is consequently
**no existing "inline-edit field" component** to reuse for this page (searched for
`InlineEdit`/`InlineField`/`EditableField` filenames — none exist in the repo).

**All editing of Details-tab fields happens off-page**, via the full intake/edit wizard at
`Link to={`/participants/${id}/edit`}` (`ParticipantDetailPage.tsx:164-167`, and again in the
draft-banner's "Resume intake" link at L112-118) → `ParticipantCreatePage.tsx` (same component
handles both create and edit, `isEdit` flag), a multi-step wizard (`WIZARD_STEPS`, L771) with a
review step (`REVIEW_STEP_INDEX`) that groups fields back by step for editing (L3528-3533,
`Edit ${WIZARD_STEPS[group.step].label}` links back into a step).

**Permission gate on the Edit entry point:** `usePermissions().canWrite` — `!isSupportWorker`
(`frontend/src/lib/permissions.ts:85`) — gates both the header's "Edit" button (L163-167) and the
draft banner's "Resume intake" link (L111). This is the broadest write gate in the file: it doesn't
distinguish Admin/Coordinator/SuperAdmin, only excludes SupportWorker (and ReadOnly sees the button
per the hook's own doc comment at L87-90, since the backend blocks the actual mutation — "buttons
visible, backend blocks the save"). Other tabs use narrower gates from the same hook:
`canWriteRestrictivePractices` (SuperAdmin/Admin/Coordinator only, L136), `canWriteRoutines` and
`canWriteNotes` (both include SupportWorker, L117/L123), `canViewAlerts` (SuperAdmin/Admin/Coordinator
only, L176, gates the alerts banner in the header).

**Permission-check idiom used throughout the frontend:** `const { canWrite, canViewAlerts } = usePermissions()`
destructuring (`ParticipantDetailPage.tsx:37`; every sibling tab component does the same, e.g.
`RestrictivePracticesTab.tsx:194` `const { canWriteRestrictivePractices } = usePermissions()`).
`usePermissions()` (`frontend/src/lib/permissions.ts:41-188`) reads the current user/role out of
`localStorage.getItem('odip_user')` (no context/store — a plain hook re-reading localStorage per
call) and returns booleans per-role or per-feature (`canWrite`, `canWriteNotes`, `canWriteRoutines`,
`canWriteRestrictivePractices`, `canViewAlerts`, etc.), each with a doc comment stating which backend
controller's role gate it's meant to mirror. No generic `can(action, resource)` function or role-array
check pattern exists — every gate is its own named boolean derived from `role ===` comparisons.

## 7. Tests

- `frontend/src/pages/ParticipantDetailPage.test.tsx` — page-level (header, tab switching, etc.)
- `frontend/src/pages/participant-detail/RestrictivePracticesTab.test.tsx`
- `frontend/src/pages/participant-detail/RoutinesTab.test.tsx`
- `frontend/src/pages/participant-detail/ContactsTab.test.tsx` (Contacts tab — not in the requested 6, listed for completeness)
- `frontend/src/pages/participant-detail/ParticipantAdlAssessmentsSection.test.tsx`
- `frontend/src/pages/participant-detail/ParticipantConsentsSection.test.tsx`
- `frontend/src/pages/participant-detail/ParticipantHealthConditionsSection.test.tsx`
- `frontend/src/pages/participant-detail/RiskEntriesSection.test.tsx`
- No dedicated test file exists for `NotesTab.tsx` (no `NotesTab.test.tsx`) and none for the inline
  Support Profile / Details tab blocks (they're only covered incidentally by `ParticipantDetailPage.test.tsx`, if at all).
- Backend: `backend/Odip.Tests/RestrictivePractices/{RestrictivePracticeBackfillTests.cs,RestrictivePracticesControllerTests.cs}`,
  `backend/Odip.Tests/Routines/ParticipantRoutinesControllerTests.cs`,
  `backend/Odip.Tests/Notes/ParticipantNotesControllerTests.cs`,
  `backend/Odip.Tests/Rostering/{ShiftNoteKeywordScannerTests.cs,ShiftNoteKeywordVocabularyTests.cs}` (the auto-flagging precedent, tested only for ShiftNote, not ParticipantNote).
