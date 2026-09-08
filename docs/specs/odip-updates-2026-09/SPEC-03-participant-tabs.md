# SPEC 03 — Participant detail page: header and tabs

Source backlog items (verbatim), all on `frontend/src/pages/ParticipantDetailPage.tsx` and
`frontend/src/pages/participant-detail/*`:

- PD-1 (Header): *"The warning pill should be adjusted so it doesn't change in size depending on
  the container to its left, it should probably be in its own container underneath the header
  details."*
- PD-2 (Restrictive Practices): *"Combine the new entry and bulk add to just use the bulk add
  modal"*
- PD-3 (Routines): *"Allow for the ability to only have a start time as the time window may just
  be the time the task needs to be done rather than a time period."*
- PD-4 (Routines): *"For the day, we should have a check box for every day and if not every day
  then a day check box for each day the task should be completed is required as some tasks could
  be every other day or only on the weekends etc, it should display all 7 days with the ability to
  select which days that task is required"*
- PD-5 (Notes): *"Pull from relevant fields in the add participant form and automatically create
  notes for those items."*
- PD-6 (Support Profile): *"Should be able to edit the support profile directly from the tab
  rather than the edit form"* + *"Assess which field should be added to this tab as well"*
- PD-7 (Details): *"Some fields are editable, and some arent, we should ensure that all fields are
  directly editable if the user has the correct permissions."*

Discovery evidence: `discovery/03-participant-tabs.md`, `discovery/02-participant-form.md`.

**Fixed constraints for this whole spec** (decided by the orchestrator, not re-litigated here):
PD-6 merges the `/support-profile` sub-resource and the wizard's Support Needs & Mobility fields
into one tab; PD-7 is section-level edit panels, not per-field inline editing; PD-5 is limited to
allergies, behaviours of concern, restrictive practices, risks/hazards, and falls risk; every new
form control uses `Dropdown`/`SearchableSelect`, every new table uses `DataTable`; every new
permission gate is a named boolean in `usePermissions()` mirroring a real backend role gate — no
generic `can(action)` function. `feat/core02-participant-partial-save` lands before PD-6/PD-7 and
supplies the partial-update primitive neither currently has (today there is only a whole-payload
`POST`/`PUT` plus a looser `isDraft` draft-save, per `discovery/02-participant-form.md` §4/obstacle 3).

---

## PD-1 — Header warning pill in its own container

**Branch:** `feat/pd01-header-warning-pill`

### Current state

`frontend/src/pages/ParticipantDetailPage.tsx:89-124`:

```tsx
<div className="flex items-start gap-4">
  <Link to="/participants" className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
    <ArrowLeft className="w-5 h-5" />
  </Link>
  <div className="flex-1">
    <div className="flex items-center gap-3 flex-wrap">
      <h1 className="text-2xl font-bold">{p.fullName}</h1>
      <StatusBadge status={p.isActive ? 'Active' : 'Inactive'} />
      {p.isDraft && (
        <StatusBadge status="Draft" colorMap={{ draft: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' }} />
      )}
    </div>
    <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{p.region || 'No region'} · {p.planType} · Support Ratio: {p.supportRatio}</p>
    <div className="mt-2"><ServiceStreamBadges value={p.serviceStreams} /></div>
    {p.isDraft && ( /* draft banner, L105-120 */ )}
    {canViewAlerts && alertsData && <ParticipantAlertsBanner ... />}
  </div>
  <div className="flex items-center gap-2"> {/* PDF buttons + Edit, L125-165 */} </div>
</div>
```

The Draft `StatusBadge` (the "warning pill" — it's the only badge using the amber
`--color-warning-container` styling; Active/Inactive uses the plain `StatusBadge` default palette)
sits inline in the `flex items-center gap-3 flex-wrap` name row (L94), sharing a line with the
`<h1>` and the Active/Inactive badge. That row lives inside `<div className="flex-1">` (L93),
which is squeezed or widened by its two siblings: the fixed-width back-arrow `<Link>` (L90) and
the right-side button cluster (L125), whose width is **not** `shrink-0` and varies with download
button label ("Intake Form PDF" ⇄ "Preparing…") and whether the `canWrite`-gated Edit button
renders at all. So the Draft pill's wrap point moves whenever those buttons change — this is the
bug.

### Design

Move only the Draft pill — Active/Inactive is core identity status, always shown, and isn't a
"warning," so it stays next to the name. The Draft pill gets a new, dedicated full-width row,
placed directly under the meta line + `ServiceStreamBadges`, still left-aligned with the header
details (inside the same `flex-1` column, so it lines up with the name/meta text above it), but on
**its own block-level line** rather than sharing a line with the `<h1>`. On its own line, its wrap
behaviour depends only on its own content and the column's width — never on whether it's sharing a
line with a variably-sized neighbour.

Build the new row to hold more than one pill (`flex flex-wrap gap-2`) even though only one
(`Draft`) exists today — this is the natural home for any future compact status pill, without
needing another restructure. `ParticipantAlertsBanner` and the draft explanatory banner are
full-width blocks already (not pills) and don't share this bug — leave them where they are, below
the new pill row. When there is no Draft pill (and no other future pill), the row doesn't render at
all — same conditional pattern as today, no empty gap.

### Implementation

1. `frontend/src/pages/ParticipantDetailPage.tsx`
   - Remove the Draft `StatusBadge` from the name row (delete L97-99, keep L95-96 — h1 +
     Active/Inactive only).
   - After the `ServiceStreamBadges` block (L102-104) and before the draft banner (L105), insert:
     ```tsx
     {p.isDraft && (
       <div className="mt-2 flex flex-wrap gap-2">
         <StatusBadge status="Draft" colorMap={{ draft: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]' }} />
       </div>
     )}
     ```
   - No change to the draft banner (L105-120) or `ParticipantAlertsBanner` (L121-123) — they stay
     exactly where they are, still below the new pill row.

### Acceptance

- With the Edit button hidden (`canWrite=false`, e.g. sign in as ReadOnly) vs. shown, and with the
  PDF download buttons in their normal vs. `isPending`/"Preparing…" state, the Draft pill's
  position and wrap point are unaffected in both a wide and a narrow (mobile-width) viewport.
- A non-draft participant renders no empty row where the pill would have been (assert no stray
  `mt-2` wrapper div in the DOM when `p.isDraft` is false — extend
  `ParticipantDetailPage.test.tsx`'s existing header assertions).
- `npm run build` clean, `npm test` green, no new lint errors.

---

## PD-2 — Restrictive Practices: bulk-add becomes the only add path

**Branch:** `feat/pd02-restrictive-practices-bulk-only`

### Current state

Two separate create flows in `frontend/src/pages/participant-detail/RestrictivePracticesTab.tsx`:

- **"New entry"** (L499-505 button → `openCreate()` L222-227 → single-item Modal, L564-658):
  Type (`Dropdown`, all 6 `RESTRICTIVE_PRACTICE_TYPES`), Description (required), conditional
  "Linked medication" `Dropdown` (only when `type === 'ChemicalRestraint'`, sourced from
  `useParticipantMedications`), Authorised by, Authorisation date, Review date.
- **"Bulk add"** (L490-498 → two-step modal, `bulkStep: 'setup' | 'rows'`): setup step picks one
  type from `BULK_RESTRICTIVE_PRACTICE_TYPES` (`RESTRICTIVE_PRACTICE_TYPES` **minus**
  `ChemicalRestraint` — `frontend/src/api/types/restrictive-practices.ts:76`) and a row count
  (1-50, default `'3'`, L213); rows step is an editable `DataTable` with Description/Authorised
  by/Authorisation date/Review date columns only — **no medication column at all**.

Chemical restraint is deliberately excluded from bulk: `BulkCreateRestrictivePracticeRowDto` has no
`RelatedMedicationId` field (`backend/Odip.Application/DTOs/RestrictivePracticeDTOs.cs:62-81`), and
`RestrictivePracticesController.CreateBulk` (`backend/Odip.Api/Controllers/RestrictivePracticesController.cs:134-138`)
rejects any row with `Type == ChemicalRestraint` outright:

```csharp
if (row.Type == RestrictivePracticeType.ChemicalRestraint)
{
    errors.Add($"{label}: Chemical restraint entries need a linked medication — add these individually from the single-entry form, not bulk-add.");
    continue;
}
```

That rejection message is exactly the seam this item removes: once bulk-add is the *only* path,
chemical restraint must be creatable through it.

### Design

- Delete the single-entry **create** flow (button, `openCreate`, `PracticeFormState`'s
  create-mode usage). The single-item Modal (L564-658) is **kept but retargeted to edit-only** —
  editing one existing entry (`openEdit`, L229-242) is unrelated to which *creation* flow is used
  and stays as today; there is no sane way to "bulk edit" one already-existing row.
- The bulk modal becomes the only add path, renamed **"Add entries"** (was "Bulk add") since
  "bulk" now covers the 1-row case too.
- Default row count changes from `'3'` to `'1'` — the setup step still exists (it's where Type is
  picked, shared by every row in the batch) but a single addition now takes the same number of
  clicks as before minus one modal.
- Chemical restraint becomes selectable in the setup step's Type dropdown (use the full
  `RESTRICTIVE_PRACTICE_TYPES`, not the filtered `BULK_RESTRICTIVE_PRACTICE_TYPES` — delete that
  const). When the selected batch type is `ChemicalRestraint`, the rows table grows a 5th column,
  "Linked medication" (`Dropdown` per row, same options/hint as the single-entry form's medication
  picker: `medications.length === 0` shows the "no active medications" hint, otherwise
  `{value: '', label: 'None'} + medications.map(...)`). For every other type, the table has no
  medication column, unchanged from today.
- Row validation gains: when batch type is `ChemicalRestraint`, a row's `RelatedMedicationId` is
  optional client-side (server still validates it belongs to the participant if set) — chemical
  restraint entries are still meaningfully useful unlinked (e.g. logged before the medication
  record exists), so this doesn't force a medication pick, it just makes one possible.
- Remove the now-obsolete hint text ("Adding a chemical restraint? Use New entry instead...").

### Implementation

1. **`backend/Odip.Application/DTOs/RestrictivePracticeDTOs.cs`**
   - `BulkCreateRestrictivePracticeRowDto`: add `public Guid? RelatedMedicationId { get; init; }`.
     Update its doc comment — it no longer categorically excludes chemical restraint.

2. **`backend/Odip.Api/Controllers/RestrictivePracticesController.cs`** — `CreateBulk`
   (L110-184):
   - Delete the `if (row.Type == RestrictivePracticeType.ChemicalRestraint) { errors.Add(...); continue; }`
     block (L134-138).
   - Per row, if `row.RelatedMedicationId.HasValue`, call the existing
     `ValidateRelatedMedicationAsync(row.Type, row.RelatedMedicationId.Value, participantId, ct)`
     helper (already used by `Create`/`Update`) and add its error (prefixed `"{label}: "`) to the
     row's error list instead of a fresh success.
   - In the `practices = dto.Items.Select(...)` projection (L158-169), change
     `RelatedMedicationId = null` to `RelatedMedicationId = row.RelatedMedicationId`.
   - Update the method's XML doc comment (L92-109) — it currently documents the exclusion as
     deliberate; that reasoning no longer applies.

3. **`backend/Odip.Tests/RestrictivePractices/RestrictivePracticesControllerTests.cs`** — update
   or add a bulk-create test asserting a `ChemicalRestraint` row with a valid
   `RelatedMedicationId` succeeds, and one with a medication belonging to a different participant
   still fails with the existing `ValidateRelatedMedicationAsync` error text.

4. **`frontend/src/api/types/restrictive-practices.ts`**
   - `BulkCreateRestrictivePracticeRowDto`: add `relatedMedicationId?: string | null`.
   - Delete `BULK_RESTRICTIVE_PRACTICE_TYPES` and its doc comment; call sites use
     `RESTRICTIVE_PRACTICE_TYPES` directly.

5. **`frontend/src/pages/participant-detail/RestrictivePracticesTab.tsx`**
   - Delete: the "New entry" button (L499-505), `openCreate` (L222-227), and the create-mode branch
     of `handleSave`/`validate` — `modalState`'s `mode` becomes `'edit'`-only, so simplify
     `useState<{ mode: 'create' | 'edit'; practice?: ... }>` to `useState<RestrictivePracticeDto | null>`
     (just the practice being edited; `null` = modal closed) and drop the single-item Modal's
     "New restrictive practice entry" title branch (L567).
   - Rename `openBulk`/the button label to "Add entries"; change `bulkCountInput` default from
     `'3'` to `'1'` (L213).
   - `bulkColumns` (L370-470): make it a function of `bulkType` (currently a plain array) so a
     `ChemicalRestraint` batch inserts a "Linked medication" column between "Review date" and
     "Remove row", reusing the same `Dropdown` + `medications` data the single-entry form used.
   - `BulkRowState` (L27-33): add `relatedMedicationId: string`.
   - `saveBulk` (L333-368): include `relatedMedicationId: bulkType === 'ChemicalRestraint' ? (row.relatedMedicationId || null) : null` in each item's payload.
   - Update the setup step's Type dropdown to `RESTRICTIVE_PRACTICE_TYPES` and drop the now-false
     hint text (L701).

6. **`frontend/src/pages/participant-detail/RestrictivePracticesTab.test.tsx`** — the
   `describe('RestrictivePracticesTab', ...)` block (L99-280) covers the single-entry form; its
   create-path tests (creating an entry, description-required validation, chemical-restraint
   medication linking on create) move into the
   `describe('RestrictivePracticesTab — bulk add (RP-01)', ...)` block (L280+) as 1-row bulk-add
   assertions. Tests that exercise **editing** an existing entry via the single-item modal are
   unaffected (that modal is unchanged). Add a new bulk test for the chemical-restraint column
   appearing/disappearing based on the selected batch type, and for a mixed-type batch being
   impossible (type is still one-per-batch, unchanged).

### Acceptance

- No UI path exists to create a restrictive practice entry other than "Add entries."
- Creating a single `ChemicalRestraint` entry with a linked medication via "Add entries" (1 row,
  default count) produces the same persisted row shape as the old single-entry form did.
- Creating a mixed batch of non-chemical entries still works exactly as before.
- `dotnet build`, `dotnet test` clean; `npm run build`, `npm test` clean; no new lint errors.

---

## PD-3 — Routines: allow a start-time-only (or end-time-only) window

**Branch:** `feat/pd03-routine-partial-time-window`

### Current state

The backend already supports any combination independently —
`backend/Odip.Domain/Entities/ParticipantRoutine.cs:33-34` has `StartTime`/`EndTime` both
`TimeOnly?`, and neither DTO (`ParticipantRoutineDTOs.cs`) marks them `[Required]`. **But the
frontend does not let a user reach a start-only or end-only state.** `RoutinesTab.tsx`'s
`RoutineFormState` has one `timed: boolean` gate (L71) controlling both fields together, and
`validate()` (L201-208):

```ts
if (form.timed && (!form.startTime || !form.endTime)) next.time = 'Start and end time are required for a timed routine'
```

requires **both** once `timed` is checked — there is no way to submit only a start time or only an
end time. `formatRoutineTime` (L37-40) is similarly binary:

```ts
if (!startTime || !endTime) return 'Untimed'
return `${formatShiftTime(startTime)}–${formatShiftTime(endTime)}`
```

so a hypothetical start-only routine would already render as "Untimed," which is wrong. **Verdict:
this is real, scoped work, not a no-op verification task** — the backend/DTO layer is ready, the
frontend form and display are not.

### Design

Remove the `timed` checkbox entirely; Start time and End time become two independent, always-
visible, optional `<input type="time">` fields (no gating checkbox — this matches the backend
model exactly: 2² states, all valid). Add one new validation rule that didn't exist before: when
**both** are set, End must be after Start (prevents a nonsensical inverted window; there was no
ordering check before because both-set was already validated together, but that check only proved
presence, not order).

`formatRoutineTime` grows two new branches:
- Start only → `"From {formatShiftTime(startTime)}"`
- End only → `"By {formatShiftTime(endTime)}"`
- Both / neither unchanged.

`groupRoutines`'s `sortWithin` (L44-51) currently sorts by `startTime`, treating any routine with
no `startTime` as sort-last (lumping true "Untimed" routines together with new "By {time}"
end-only routines, which do have a real time constraint). Change the sort key to
`a.startTime ?? a.endTime` so an end-only routine sorts among timed routines by its deadline,
and only routines with neither sort to the bottom.

### Implementation

1. **`frontend/src/pages/participant-detail/RoutinesTab.tsx`**
   - `RoutineFormState` (L66-76): remove `timed: boolean`.
   - `EMPTY_FORM` (L78-81): remove `timed: false`.
   - `openEdit` (L179-194): remove the `timed: !!(routine.startTime && routine.endTime)` line;
     `startTime`/`endTime` prefill directly via `toTimeInputValue` as today.
   - `validate` (L201-208): replace the `form.timed && (!form.startTime || !form.endTime)` check
     with: `if (form.startTime && form.endTime && form.endTime <= form.startTime) next.time = 'End time must be after start time'`.
   - `handleSave` (L210-233) payload: `startTime: form.startTime ? toApiTime(form.startTime) : null`,
     `endTime: form.endTime ? toApiTime(form.endTime) : null` (drop the `form.timed ? ... : null`
     wrapper).
   - Modal JSX (L403-412): remove the "Has a specific time window" `FormField`/checkbox (L395-402)
     and the `{form.timed && (...)}` wrapper — Start time / End time `FormField`s always render,
     side by side, both `required={false}` (visually no `required` marker on either, since neither
     is mandatory alone).
   - `formatRoutineTime` (L37-40): add the two new branches described above.
   - `groupRoutines`'s `sortWithin` (L44-51): change every `a.startTime`/`b.startTime` comparison
     input to `a.startTime ?? a.endTime` / `b.startTime ?? b.endTime`.

2. **`frontend/src/pages/participant-detail/RoutinesTab.test.tsx`** — add cases: creating a
   start-only routine, an end-only routine, submitting End before Start shows the new validation
   message, and `formatRoutineTime`'s two new render branches show up in the rendered card text
   (`"From 7:00am"` / `"By 5:00pm"`).

### Acceptance

- A routine can be saved with only `startTime` set, only `endTime` set, both, or neither — no
  client-side block on any of the four combinations except End-before-Start.
- The routines list renders "From {time}" / "By {time}" / "{start}–{end}" / "Untimed" correctly
  for each of the four states.
- `npm run build` clean, `npm test` green, no new lint errors. No backend change needed (already
  supports this).

---

## PD-4 — Routines: multi-day selection (not just single-day-or-every-day)

**Branch:** `feat/pd04-routine-multi-day`

### Current state

`ParticipantRoutine.DayOfWeek` (`backend/Odip.Domain/Entities/ParticipantRoutine.cs:30`) is a
single nullable **native** `System.DayOfWeek` enum — a routine belongs to at most one day, or
`null` meaning every day. There is no way to express "Mon/Wed/Fri" or "weekends only." This is a
genuine schema change, not a display-only fix.

### Design — representation

**Recommendation: a `[Flags] enum ParticipantRoutineDays`, stored as a plain `int` column**,
replacing `DayOfWeek? DayOfWeek`:

```csharp
[Flags]
public enum ParticipantRoutineDays
{
    None = 0,
    Monday = 1 << 0, Tuesday = 1 << 1, Wednesday = 1 << 2, Thursday = 1 << 3,
    Friday = 1 << 4, Saturday = 1 << 5, Sunday = 1 << 6,
    All = Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday,
}
```

This mirrors an **already-established idiom in this exact codebase** for the same shape of
problem: `ShiftNoteFlagCategory` (`backend/Odip.Domain/Rostering/ShiftNoteFlagging.cs:12-20`,
"`[Flags] enum, plain int column, no HasConversion` ... same storage idiom as
`Odip.Domain.Enums.ServiceStreams`"). A bounded, small (≤7-bit) day-of-week set queries and
displays with simple bitwise ops (`flags.HasFlag(day)` / `(flags & dayBit) != 0`) with no join —
cheaper and simpler than a child collection table for a set this small and this rarely mutated
per-row, and avoids a second EF `Include` on every routines list load. A plain `int` bitmask
(rather than the enum) would work identically at the storage layer but loses the type safety and
`HasFlag` ergonomics the flags-enum gives for free — no reason to give that up.

`None` (0) is **not** used to mean "every day" — that would make "no days selected" (an invalid
state) indistinguishable from "every day" (a very common, intentional state). Instead **`All`
(127, all 7 bits) means every day** — it's the literal, unambiguous encoding ("applies Monday AND
Tuesday AND ... AND Sunday" *is* every day), and it composes correctly with the existing
`groupRoutines` "does this routine apply on day X" query with no special case. `None` becomes an
invalid, rejected value (a routine must apply on ≥1 day).

The wire DTO does **not** expose the raw flags int — it stays a `List<DayOfWeek>` of
`System.DayOfWeek` values (JSON-serializes as day-name strings, e.g. `["Monday","Wednesday"]`),
keeping the wire format close to today's single day-name-string convention and decoupling it from
the storage representation. Conversion between `List<DayOfWeek>` ⇄ `ParticipantRoutineDays`
happens in the controller's DTO-mapping methods via two small helpers (`ToFlags`/`ToDayList`).

### Design — data migration

Existing rows: `DayOfWeek == null` → `Days = All`; `DayOfWeek == X` → `Days = <bit for X>`. Bit
positions are chosen to match the frontend's **existing** Monday-first `WEEKDAYS` display order
(`RoutinesTab.tsx:23`) rather than .NET's `DayOfWeek` (Sunday=0) wire order, so the two conventions
line up for anyone reading both sides. The migration's `Up()` needs an explicit
`System.DayOfWeek` → bit mapping (Sunday=0 doesn't line up with any convenient formula against
Monday=bit0), via one SQL `CASE` per value:

```csharp
migrationBuilder.Sql(@"
    UPDATE ""ParticipantRoutines""
    SET ""Days"" = CASE ""DayOfWeek""
        WHEN 1 THEN 1    -- Monday    -> bit0
        WHEN 2 THEN 2    -- Tuesday   -> bit1
        WHEN 3 THEN 4    -- Wednesday -> bit2
        WHEN 4 THEN 8    -- Thursday  -> bit3
        WHEN 5 THEN 16   -- Friday    -> bit4
        WHEN 6 THEN 32   -- Saturday  -> bit5
        WHEN 0 THEN 64   -- Sunday    -> bit6
        ELSE 127         -- NULL -> every day
    END;
");
```

run **after** the new `Days int NOT NULL DEFAULT 127` column is added and **before** the old
`DayOfWeek` column is dropped, so the source data is still present when the `UPDATE` runs.

> **CLAUDE.md gotcha:** `Program.cs` contains raw-SQL self-healing tied to *specific* migration
> IDs (`backend/Odip.Api/Program.cs:379-412` — pre-populates/repairs `__EFMigrationsHistory` rows
> for `20260320104626_AddIncidentReports`, `20260327121732_AddNdisClaiming`, etc.). This migration
> must be **added new, at the end of the existing chain** (`backend/Odip.Infrastructure/Migrations/`,
> currently ending at `20260831160529_AddShiftNoteFlagging`) — never renamed, reordered, or
> inserted between existing ones. It doesn't touch or need to touch the self-healing block at all
> (that block only references migrations older than `AddNdisClaiming`); the risk is purely
> "don't disturb the existing migration IDs while adding this one."

### Implementation

1. **`backend/Odip.Domain/Entities/ParticipantRoutine.cs`**: add the `ParticipantRoutineDays`
   enum (new file `backend/Odip.Domain/Enums/ParticipantRoutineDays.cs`, alongside the sibling
   `RoutineCategory` enum); replace `public DayOfWeek? DayOfWeek { get; set; }` with
   `public ParticipantRoutineDays Days { get; set; } = ParticipantRoutineDays.All;`.

2. **New EF Core migration** (`dotnet ef migrations add AddParticipantRoutineMultiDay`, run from
   `backend`): adds `Days int NOT NULL DEFAULT 127`, runs the data-migration SQL above, drops
   `DayOfWeek`. Verify `OdipDbContextModelSnapshot.cs` updates accordingly (generated).

3. **`backend/Odip.Application/DTOs/ParticipantRoutineDTOs.cs`**: replace `DayOfWeek? DayOfWeek`
   with `IReadOnlyList<DayOfWeek> Days { get; init; } = Array.Empty<DayOfWeek>();` on all three
   DTOs (`ParticipantRoutineDto`, `CreateParticipantRoutineDto`, `UpdateParticipantRoutineDto`).

4. **`backend/Odip.Api/Controllers/ParticipantRoutinesController.cs`**: add
   `ToFlags(IReadOnlyList<DayOfWeek> days)` / `ToDayList(ParticipantRoutineDays flags)` helpers
   using the bit table above; use them in `Create`/`Update`'s entity construction and in `ToDto`.
   Add validation: reject `dto.Days.Count == 0` with `"At least one day is required"` (this is the
   new "must apply on ≥1 day" rule — previously impossible to violate since `null` meant every
   day and was always valid).

5. **`backend/Odip.Tests/Routines/ParticipantRoutinesControllerTests.cs`**: add tests for
   multi-day create/update, the empty-days rejection, and a specific `ToFlags`/`ToDayList`
   round-trip test (or a dedicated unit test file if those helpers are extracted to a static class
   for testability — recommended, e.g. `ParticipantRoutineDayMapper`).

6. **`frontend/src/pages/participant-detail/RoutinesTab.tsx`**:
   - `RoutineFormState.dayOfWeek: string` → `days: string[]` (day names, e.g. `['Monday','Wednesday']`).
   - Replace the single "Day" `Dropdown` (L387-394) with: an "Every day" checkbox plus 7 individual
     day checkboxes (`WEEKDAYS`, already Monday-first at L23), laid out as a `fieldset` (mirroring
     the wizard's `MOBILITY_SUPPORT_OPTIONS` checkbox-group pattern,
     `ParticipantCreatePage.tsx:2700-2722`, since this is now the same shape of control). Interaction
     rule: "Every day" is a **derived** checkbox with no independent stored value —
     `checked = days.length === 7`; checking it sets `days` to all 7; unchecking it (only possible
     while all 7 are checked) clears `days` to `[]`, forcing an explicit re-pick. Checking/unchecking
     an individual day toggles it in the `days` array directly; the derived "Every day" checkbox
     naturally becomes checked once all 7 end up selected this way too.
   - `validate` (L201-208): add `if (form.days.length === 0) next.days = 'Select at least one day'`.
   - `openEdit` (L179-194): `days: routine.days` (already an array from the DTO change).
   - `handleSave` payload: `days: form.days` (the array, matching the new `CreateParticipantRoutineDto.Days` shape).
   - `groupRoutines` (L43-64): change `routines.filter(r => !r.dayOfWeek)` (every-day bucket) to
     `r.days.length === 7`, and each weekday bucket's filter from `r.dayOfWeek === day` to
     `r.days.includes(day) && r.days.length < 7` — **a Mon/Wed/Fri routine now appears in all
     three of those day groups** (not just one), which is the correct behaviour: a support worker
     checking Wednesday's routines needs to see it.
   - `ParticipantRoutineDto` type (`frontend/src/api/types/routines.ts`): `dayOfWeek: string | null` → `days: string[]`.

7. **`frontend/src/pages/participant-detail/RoutinesTab.test.tsx`**: update the existing
   "groups routines into Every day and weekday sections" test for the new multi-bucket membership;
   add a test for a Mon/Wed/Fri routine appearing in all three groups, and for the 0-days
   validation message.

### Acceptance

- A routine can be set to any non-empty subset of the 7 days, "Every day," or a single day.
- A routine spanning multiple (but not all 7) days appears once per applicable day-group in the
  list, and never in "Every day."
- The EF Core migration runs cleanly against a database seeded under the old schema (`DayOfWeek`
  populated, some `null`) and preserves every routine's original day(s) exactly.
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` all clean; no new lint errors.

---

## PD-5 — Auto-generated notes for safety-critical fields

**Branch:** `feat/pd05-safety-auto-notes`

### Current state

**No auto-note precedent exists anywhere in the backend.** Every `ParticipantNote` write goes
through `ParticipantNotesController.Create`/`Update`
(`backend/Odip.Api/Controllers/ParticipantNotesController.cs`), called only from
`NotesTab.tsx`'s manual `handleSave`/`confirmArchive`/`restoreNote`. The nearest analogous pattern
is `ShiftNoteKeywordScanner.Scan()` (`backend/Odip.Domain/Rostering/ShiftNoteFlagging.cs:90-109`),
which flags an *existing* `ShiftNote` record at save time — it doesn't spawn a second record, so
it solves a different problem (classification, not note creation). Its one transferable idea is
"compute at save time, server-side only" (see that file's remarks, L80-88) — the frontend never
re-implements backend business logic like this. There is also no `NotesTab.test.tsx` today.

Field sourcing, verified against `backend/Odip.Application/DTOs/DTOs.cs` and the Details tab
render (`ParticipantDetailPage.tsx`):

| Category | Field(s) | Wizard step | Editable via |
|---|---|---|---|
| Allergies | `AllergiesDetail`, `IsAnaphylaxisRisk`, `AllergyManagementNotes` (DTOs.cs:428-433) | Medical | `ParticipantsController.Create`/`Update` |
| Behaviours of concern | `BehavioursOfConcernCurrent`, `BehavioursOfConcernFiveYearHistory` (DTOs.cs:464-465) | Behaviour & Communication | `ParticipantsController.Create`/`Update` |
| Falls risk | `FallsRiskRating` (DTOs.cs:445, `RiskRatingLevel?`) | Support Needs & Mobility | `ParticipantsController.Create`/`Update` |
| Risks/hazards | `BehaviourRiskSummary`, `Notes` (DTOs.cs:356,358) **plus** the `ParticipantRiskEntry` collection — same "Risks & Hazards" wizard step, but a genuinely separate write path (see Trigger coverage below) | Risks & Hazards | `ParticipantsController.Create`/`Update` (flat fields) + `ParticipantsController.Create` (entries, create-time only, `:711-714`) + `ParticipantRiskEntriesController` (entries, ongoing) |
| Restrictive practices | **not** a `Participant`/wizard field — `Participant.HasRestrictivePracticeFlag` is explicitly derived (DTOs.cs:342 comment: *"intentionally NOT here — it is derived"*), computed from the Restrictive Practices register | n/a | `RestrictivePracticesController.Create`/`Update`/`CreateBulk`/`Delete` |

The "restrictive practices" category is therefore triggered from a **different** controller than
the other four — it cannot be pulled from "the add participant form" the way the request literally
says, because that field was deliberately moved off the form and into its own register (see
`RestrictivePracticesController.cs:12-20`'s doc comment). This is flagged, not silently reinterpreted.

### Design

**Idempotency mechanism** (the crux, per the brief): add four columns to `ParticipantNote` — two
nullable strings and two non-nullable bools:

```csharp
/// <summary>Non-null only for a system-generated note; identifies which safety-critical field
/// group produced it (e.g. "safety:allergies"). Unique per (ParticipantId, SourceKey) — enforced
/// by a partial unique index (WHERE "SourceKey" IS NOT NULL) so manual notes (SourceKey == null)
/// are never constrained. A manually-edited note KEEPS its SourceKey (never nulled out) — see
/// IsManuallyEdited below for why that's what prevents a duplicate.</summary>
public string? SourceKey { get; set; }

/// <summary>PRODUCT DECISION (resolved): once a human edits an auto-generated note, that edit
/// STICKS — the sync (see below) never overwrites this note's content again, permanently, even
/// after the source field changes further. A clinician's own wording is usually more accurate
/// than generated text, and silently destroying it would be worse than a stale note. Set to true
/// by ParticipantNotesController.Update whenever it's called on a note with a non-null SourceKey
/// (any edit — title-only, description-only, or both — counts; the controller has no way to tell
/// which fields changed within one PUT, so any human-initiated save on this note is treated as
/// full manual ownership going forward).</summary>
public bool IsManuallyEdited { get; set; }

/// <summary>A normalised snapshot of the source field value(s) at the moment content was last
/// machine-generated, OR last acknowledged as current by a human (see "Regenerate"/"Dismiss"
/// below) — e.g. for allergies, "{AllergiesDetail}|{IsAnaphylaxisRisk}|{AllergyManagementNotes}".
/// The ORIGINAL GENERATED TEXT is not recoverable once a human overwrites Description, so drift
/// is detected by comparing source VALUES, not text: on every sync pass, the current source value
/// string is computed and compared against this snapshot. Null for a manual (non-auto) note.</summary>
public string? SourceValueSnapshot { get; set; }

/// <summary>True when IsManuallyEdited is true AND the live source field value(s) no longer match
/// SourceValueSnapshot — i.e. the field changed after a human took ownership of this note's text.
/// Drives the "source field has changed" hint in NotesTab. Recomputed by the sync service on every
/// pass; never true for a non-auto note (SourceKey == null) or one that's still machine-managed.</summary>
public bool HasSourceDrift { get; set; }
```

`SourceKey` values (one per category, per orchestrator's fixed scope): `"safety:allergies"`,
`"safety:behavioursOfConcern"`, `"safety:restrictivePractices"`, `"safety:risksHazards"`,
`"safety:fallsRisk"`.

**Sync algorithm** (a new internal service, `SafetyNoteSyncService`, called from inside the same
`SaveChangesAsync` transaction as the triggering write — never a separate request):

For each category, given the current field value(s), first compute `currentSnapshot` (the
normalised source-value string described above):

1. **Value is empty/unset** and an auto-note exists for that `(ParticipantId, SourceKey)`:
   - If `IsManuallyEdited == false`: archive it (`IsArchived = true`) — the condition it described
     no longer applies.
   - If `IsManuallyEdited == true`: leave content/archived state untouched entirely (a human owns
     this note now); still recompute `HasSourceDrift = currentSnapshot != SourceValueSnapshot` (an
     empty value is still "a change" worth flagging — e.g. the clinician documented an allergy that
     was since removed from the record, which is exactly the kind of drift the hint exists for).
2. **Value is non-empty**:
   - No existing note for that key → create one (`IsAutoGenerated` is implied by `SourceKey != null`;
     no separate column needed), with generated title/body (e.g. title `"Allergies (auto)"`, body
     composed from the relevant field(s)), and `SourceValueSnapshot = currentSnapshot`.
   - Existing note, `IsManuallyEdited == false` → update its `Description` only if the generated
     content actually differs from current (`Description`) — an idempotent no-op write is skipped
     to avoid `UpdatedAt` churn on every unrelated participant save. Also un-archive it
     (`IsArchived = false`) if the value became non-empty again after being cleared, and always
     refresh `SourceValueSnapshot = currentSnapshot` (machine-managed notes track the source
     exactly, so drift is never possible while `IsManuallyEdited` is false).
   - Existing note, `IsManuallyEdited == true` → **content and archived state are never touched**;
     only recompute `HasSourceDrift = currentSnapshot != SourceValueSnapshot`. This is also what
     keeps `SourceKey` idempotency intact under edit-sticks: the lookup by `(ParticipantId,
     SourceKey)` still finds this note (its `SourceKey` was never cleared), so the sync recognises
     "a note for this category already exists" and never creates a second, duplicate note
     alongside the manually-owned one — it only ever updates the drift flag.

`IsManuallyEdited` is set to `true` by `ParticipantNotesController.Update` (the human-facing
endpoint) whenever it's called on a note with a non-null `SourceKey` — the sync service uses its
own internal write path (direct `_db.ParticipantNotes` mutation, not the controller action), so
this cleanly separates "system touched it" from "human touched it" with no extra flag needed on
the write call itself.

**Title is editable too, and editing only the title still sets `IsManuallyEdited`.** `NotesTab`'s
existing edit modal already has both Title and Description fields for every note, auto-generated
or not — nothing in this spec restricts which field a human can change. Because
`ParticipantNotesController.Update` takes the whole note payload in one `PUT` (per its existing
shape), it has no way to tell "only the title changed" from "only the description changed" — any
successful human-initiated save on a `SourceKey`-carrying note sets `IsManuallyEdited = true`,
full stop. This keeps the rule simple (one flag, one meaning: "a human touched this note") rather
than tracking per-field provenance, which nothing else in this spec needs.

**Where triggered**: server-side (not client-side — this must be correct regardless of which
client calls the API, and per `ShiftNoteKeywordScanner`'s established precedent for "compute at
save time, server-side only"). Four categories sync from inside
`ParticipantsController.Create`/`Update` (both — a draft-saved or newly-finalised participant can
already have allergies/behaviours/falls-risk/risks filled in); the restrictive-practices category
syncs from inside `RestrictivePracticesController.Create`/`Update`/`CreateBulk`/`Delete`, in the
same place that controller already recomputes `Participant.HasRestrictivePracticeFlag`
(mirroring that existing "sync-write in the same `SaveChangesAsync`" comment idiom, e.g.
`RestrictivePracticesController.cs:76-85`) — the trigger condition there is simply "does
`HasRestrictivePracticeFlag` end up true," reusing the value that controller already computes.

**Trigger coverage — every real write path that can change a source field.** Grepped (not
reasoned about) every assignment site for each field, across the whole backend:

| Source | Wizard save (`ParticipantsController.Create`/`Update`) | Core02 partial-save endpoint (PD-6/PD-7 section groups) | Sub-resource controller | Seed data (`DbSeeder.cs`) |
|---|---|---|---|---|
| Allergies | **Yes** — `:671-672` (Create), `:898-899` (Update); hook added, Implementation §4 | **No — HOLE.** PD-7's `medical` group (`ParticipantIdentitySection`... table row "Medical") carries `AllergiesDetail`/`IsAnaphylaxisRisk`/`AllergyManagementNotes`. Fix: PD-7's `medical` partial endpoint must also call the sync (see fix below) | n/a — no separate controller for these fields | Direct `p.AllergiesDetail = ...` (`DbSeeder.cs:2874,2879,2900`) — accepted gap, see below |
| Behaviours of concern | **Yes** — `:682-683` (Create), `:909-910` (Update); hook added, Implementation §4 | **No — HOLE.** PD-7's `behaviourCommunication` group carries both fields. Same fix. | n/a | Direct writes (`DbSeeder.cs:2835,2846-2847,2892-2893,2912,2929`) — accepted gap |
| Falls risk | **Yes** — `:674` (Create), `:901` (Update); hook added, Implementation §4 | **No — HOLE.** PD-6's `supportNeedsMobility` group carries `FallsRiskRating`. Same fix. | n/a | Direct writes (`DbSeeder.cs:2830,2841,2855,2861,2885,2905,2920,2927,2938`) — accepted gap |
| Risks/hazards (flat fields) | **Yes** — `:655` (Create), `:887` (Update, `BehaviourRiskSummary`; `Notes` on the adjacent line); hook added, Implementation §4 | **No — HOLE.** PD-7's `risksHazardsSummary` group carries both fields. Same fix. | n/a | Direct writes in the seeded `Participant` literals (`DbSeeder.cs:297,303,309,314` and others) — accepted gap |
| Risks/hazards (`ParticipantRiskEntry` rows) | **No — HOLE**, distinct from the flat fields above even though it's the same controller/action: `ParticipantsController.Create`'s `foreach (var entry in dto.RiskEntries)` loop (`:711-714`) inserts rows directly, outside the flat-field sync call. Fix below. | n/a — `RiskEntriesSection` (Details tab) is explicitly out of PD-7's scope; its own controller is the only ongoing path (next column) | **No — HOLE.** `ParticipantRiskEntriesController.Create`/`Update`/`Delete` (`:44-`, edit-mode's only path per that controller's own doc comment) never calls the sync today. Fix below. | `context.RestrictivePractices`-style direct seeding of `ParticipantRiskEntry`? Not found — seed data only sets the flat fields, no seeded risk-entry rows |
| Restrictive practices | n/a — not a wizard/`Participant` field (derived) | n/a — not part of any PD-7/PD-6 section group (PD-6 keeps `HasRestrictivePracticeFlag` read-only) | **Yes** — `RestrictivePracticesController.Create`/`Update`/`CreateBulk`/`Delete`; hook added, Implementation §5 | `DbSeeder.cs:2213-2306` seeds `RestrictivePractice` rows directly via `context.RestrictivePractices.AddRange(...)`, **and separately** hand-sets `sophie.HasRestrictivePracticeFlag = true` etc. (`:2220,2258,2273,2287,2300`) rather than deriving it — accepted gap, same reasoning, though this is also a pre-existing latent seed-data inconsistency (the flag statement could drift from the rows it's meant to mirror) unrelated to this branch |

**Every "No — HOLE" cell above gets closed, not accepted, except the seed-data column:**
- **Core02 partial endpoints** (4 holes: `medical`, `behaviourCommunication`,
  `risksHazardsSummary`, `supportNeedsMobility`): added as an explicit requirement on those
  endpoints in **both PD-6's and PD-7's core02-requirements text** — any section endpoint whose
  field group includes a safety-critical field must call
  `_safetyNoteSync.SyncFromParticipantAsync(participant, ct)` in the same `SaveChangesAsync` as
  its own save, identically to how the wizard-save hook works. This is cross-referenced from
  PD-7's Implementation list too (see that item), so the requirement travels with the endpoints
  themselves rather than living only here where it could be missed when core02 is actually built.
- **`ParticipantsController.Create`'s `RiskEntries` loop**: extend the existing
  `SyncFromParticipantAsync` create-time call to also read `participant.RiskEntries` (available in
  the same tracked-entity graph, same transaction) when computing the risks/hazards category's
  "value present" condition and generated content.
- **`ParticipantRiskEntriesController`**: add a sibling call,
  `_safetyNoteSync.SyncRiskEntryNotesAsync(participantId, ct)`, in `Create`/`Update`/`Delete`,
  same "sync-write in the same `SaveChangesAsync`" shape as `RestrictivePracticesController`'s own
  hook.
- **Seed data (`DbSeeder.cs`)**: accepted gap, not closed. Seed data is dev/demo-only, runs at
  startup outside any controller, and isn't a write path a real user or the frontend can trigger —
  a seeded participant simply won't have auto-notes unless `DbSeeder` is separately updated to
  either call the sync service itself or hand-author matching `ParticipantNote` rows alongside the
  literals it already writes (both are reasonable, low-priority follow-ups, not part of this
  branch).

**Reliability of "call the sync service from every write path" as a strategy going forward —
recommendation: (a), reinforced with a bounded (b) safety net; reject (c).**

This codebase already has a directly relevant precedent for exactly this trade-off:
`Participant.HasRestrictivePracticeFlag` is kept in sync by explicit writes at every mutation
point (`RestrictivePracticesController`'s four actions) **for other consumers that read the raw
stored column** (`RosteringController`/`PortalController`, per that controller's own doc comment)
— but `ParticipantsController`'s own read endpoints (`GetAll`/`GetById`, `:444`/`:506`) don't trust
that stored column at all; they **live-recompute** it as
`p.RestrictivePractices.Any(rp => rp.IsActive)` on every request instead. That's already a
belt-and-suspenders shape in this exact file: explicit sync-writes for precision/other-consumers,
plus a live recomputation at the one read path where staleness would matter most.

Recommend the same shape here:
- **(a), primary**: explicit `SafetyNoteSyncService` calls at every write path in the table above
  (now fully enumerated, not partially). This is the only option that keeps notes fresh
  immediately, without extra cost on every read, and it's the pattern this codebase already uses
  twice over (`_compatLink.SyncFromParticipantPreferredStaffAsync`, and
  `HasRestrictivePracticeFlag`'s own sync-writes) — not a new idiom.
- **(b), bounded, as a safety net only**: when `NotesTab` loads a participant's notes
  (`GET participants/{id}/notes`), run one extra reconciliation pass — for any of the 5 categories
  with a non-empty current value and no existing auto-note, generate one inline before returning.
  This mirrors the *other* half of the `HasRestrictivePracticeFlag` precedent (recompute live at
  the read path that matters) and means a future 6th write path someone forgets to wire doesn't
  silently and permanently break the feature — it self-heals the next time anyone opens the Notes
  tab, rather than never. It does **not** replace (a): it only fills gaps between explicit calls,
  and it never touches a manually-edited note's content (same rules as the sync service itself, it
  IS the sync service, just also invoked from a read path).
- **(c), rejected**: an EF Core `SaveChanges` interceptor keyed on `Participant`/`RestrictivePractice`/
  `ParticipantRiskEntry` changes would be the only option that's structurally impossible to miss a
  future write path with, but it's also the first interceptor this codebase would have — CLAUDE.md
  is explicit that the architecture is "deliberately flat" and controllers call
  Infrastructure/`OdipDbContext` directly, with a standing warning against adding framework
  machinery "to match a pattern" that isn't already in force (its MediatR/AutoMapper note is the
  same warning applied to a different temptation). An interceptor would also need to attribute
  *which* field changed on a tracked `Participant` (EF's change-tracking gives entity-level, not
  always clean property-level, diffs across every one of that entity's ~100+ columns) and guard
  against re-entrancy (its own note-save is itself a tracked write), both of which are exactly the
  kind of hard-to-debug magic CLAUDE.md's flat-architecture stance is trying to avoid. (a)+(b)
  closes the same practical gap — a forgotten write path stops being invisible-forever and becomes
  "fixed on next Notes tab view" — without introducing it.

**Visual distinction in `NotesTab`**: a note whose `sourceKey` (added to `ParticipantNoteDto`) is
non-null renders a small "Auto-generated" tag next to the title (same `Tag`/small-pill idiom used
elsewhere on the page), distinguishing it from manual notes at a glance.

**Editing/deleting**: a user can edit an auto-generated note through the normal `NotesTab` edit
flow exactly like any other note — doing so sets `IsManuallyEdited = true` server-side (per
above), permanently detaching it from the sync. There is no delete endpoint for notes at all
(`ParticipantNotesController` has none — archive is the only removal, per
`discovery/03-participant-tabs.md` §4), so "deleting" an auto-note means archiving it, same as any
note; archiving one manually also sets `IsManuallyEdited = true` (routed through the same
`Update` call `confirmArchive` already uses), so a re-triggering save won't silently un-archive it.

**Source field changes — settled (product decision): a human's edit sticks, permanently.** The
generator never overwrites a manually-edited note's content again, even after the source field
changes further — a clinician's own wording is usually more accurate than generated text, and
destroying it would be worse than a stale note. Instead of silently diverging or overwriting, the
UI surfaces a **"source data has changed" hint**:

- **Trigger**: the sync service (running on every triggering save, per "Where triggered" above)
  recomputes `HasSourceDrift` for every manually-edited auto-note, per the algorithm's step 1/2
  "leave untouched, only recompute drift" branches. Detection compares source *values*, not text —
  the original generated text isn't recoverable once a human overwrites `Description`, so drift is
  `currentSnapshot != SourceValueSnapshot`, not a diff against lost text.
- **Where it renders**: in `NotesTab`'s `NoteCard`, directly under the existing "Auto-generated"
  tag — a small amber inline hint, *"Source data has changed since this note was edited,"* shown
  only when `note.hasSourceDrift` is true (new `ParticipantNoteDto` field).
- **Two actions on the hint** (recommendation: include both — they serve different intents and
  neither is a good substitute for the other):
  - **"Dismiss"** — acknowledges the drift without touching the note's text: sets
    `SourceValueSnapshot = currentSnapshot` and `HasSourceDrift = false`. For "yes, I saw the field
    changed, my note is still accurate, stop flagging it." Doesn't re-arm until the source changes
    *again* from this new baseline.
  - **"Regenerate"** — an explicit, opt-in escape hatch back into machine-managed text: sets
    `IsManuallyEdited = false`, replaces `Description` with freshly generated content, and sets
    `SourceValueSnapshot = currentSnapshot`/`HasSourceDrift = false`. This re-enters the normal
    auto-sync lifecycle (future source changes will update it automatically again, per the
    `IsManuallyEdited == false` branch). Needed because "edits stick forever" without an undo would
    otherwise trap a coordinator who deliberately wants back to the generated wording after, say,
    an allergy is fully resolved and rewritten from scratch — recommended over leaving no way back.
  - Both are new, dedicated actions (not overloads of the existing `Update` endpoint, since neither
    is "edit the text") — see Implementation.

### Implementation

1. **`backend/Odip.Domain/Entities/ParticipantNote.cs`**: add `SourceKey`, `IsManuallyEdited`,
   `SourceValueSnapshot`, `HasSourceDrift`.
2. **New migration** `AddParticipantNoteSourceKey`: adds all four columns (`SourceKey`/
   `SourceValueSnapshot` nullable string, `IsManuallyEdited`/`HasSourceDrift bool NOT NULL DEFAULT false`)
   and a partial unique index
   `CREATE UNIQUE INDEX ... ON "ParticipantNotes" ("ParticipantId", "SourceKey") WHERE "SourceKey" IS NOT NULL`.
3. **New** `backend/Odip.Infrastructure/Services/SafetyNoteSyncService.cs` implementing the
   algorithm above (including `HasSourceDrift` recomputation on every pass), injected into
   `ParticipantsController` and `RestrictivePracticesController`.
4. **`backend/Odip.Api/Controllers/ParticipantsController.cs`**: call
   `_safetyNoteSync.SyncFromParticipantAsync(participant, ct)` at the end of `Create` (after
   `SaveChangesAsync`, or folded into the same call if the service takes the tracked entity before
   save — prefer folding in, same transaction, same pattern as `_compatLink.SyncFromParticipantPreferredStaffAsync`
   already does at `:766`/`:941`) and `Update`.
5. **`backend/Odip.Api/Controllers/RestrictivePracticesController.cs`**: call
   `_safetyNoteSync.SyncRestrictivePracticeNoteAsync(participant, ct)` alongside each existing
   `HasRestrictivePracticeFlag` recomputation (`Create` L85, `CreateBulk` L179, `Update` L218,
   `Delete` L243).
5a. **`backend/Odip.Api/Controllers/ParticipantsController.cs`** — `Create`'s `RiskEntries` loop
   (`:711-714`): extend `SyncFromParticipantAsync` (or its call site) to also read
   `participant.RiskEntries` (same tracked graph, same transaction) so the risks/hazards category
   treats a create-time risk entry the same as a non-empty `BehaviourRiskSummary`/`Notes` value —
   closes the "Risks/hazards (`ParticipantRiskEntry` rows)" hole in the Trigger coverage table for
   the create path.
5b. **New**, `backend/Odip.Api/Controllers/ParticipantRiskEntriesController.cs`: call
   `_safetyNoteSync.SyncRiskEntryNotesAsync(participantId, ct)` in `Create`/`Update`/`Delete`, same
   "sync-write in the same `SaveChangesAsync`" shape as `RestrictivePracticesController`'s hook —
   closes that table's hole for the ongoing (post-creation) edit path.
5c. **core02 requirement, cross-referenced from PD-6/PD-7**: every new partial-update section
   endpoint whose field group includes a safety-critical field (`medical`,
   `behaviourCommunication`, `risksHazardsSummary` — all three added by PD-7 — and
   `supportNeedsMobility`, added by PD-6) must call `_safetyNoteSync.SyncFromParticipantAsync` in
   its own `SaveChangesAsync`, identically to the whole-participant `Update` hook in item 4. This
   is the fix for all four "core02 partial-save endpoint" holes in the Trigger coverage table —
   state it as an explicit acceptance item on core02/PD-6/PD-7's own PRs, not just here.
5d. **New**, `ParticipantNotesController`'s `GetForParticipant` (notes list read): add the bounded
   read-time reconciliation pass recommended in "Reliability..." above — for any of the 5
   categories with a non-empty current source value and no existing note for its `SourceKey`,
   generate one inline (same code path as the sync service, just also invoked here) before
   returning the list. This is a safety net only, not a substitute for items 4/5/5a/5b/5c.
6. **`backend/Odip.Api/Controllers/ParticipantNotesController.cs`**: add two new actions,
   `PUT participants/notes/{id}/dismiss-drift` and `PUT participants/notes/{id}/regenerate`, both
   gated the same as the existing `Update` (roles: Admin,Coordinator,SupportWorker,SuperAdmin —
   per `discovery/03-participant-tabs.md` §4), implementing the "Dismiss"/"Regenerate" semantics
   above. Both 404 or no-op harmlessly if called on a note with `SourceKey == null` (nothing to
   dismiss/regenerate on a manual note) or `HasSourceDrift == false`.
7. **`backend/Odip.Application/DTOs/DTOs.cs`** (`ParticipantNoteDto` — check exact file, likely
   `NotesDTOs.cs` or within `DTOs.cs`): add `SourceKey`, `HasSourceDrift`.
8. **`backend/Odip.Tests/Notes/`**: new test file `SafetyNoteSyncServiceTests.cs` covering:
   create → note created; edit same value twice → no duplicate, no spurious `UpdatedAt` bump;
   clear field → note archived (when not manually edited); manually edit then clear field → note
   NOT archived, `HasSourceDrift` becomes true; manually edit then change field → content NOT
   overwritten, `HasSourceDrift` becomes true; Dismiss clears `HasSourceDrift` without touching
   content; Regenerate restores machine-managed content and clears `IsManuallyEdited`.
9. **`frontend/src/api/types/notes.ts`**: add `sourceKey: string | null` and
   `hasSourceDrift: boolean` to `ParticipantNoteDto`; add `useDismissNoteDrift()`/
   `useRegenerateNote()` mutation hooks (`frontend/src/api/hooks/notes.ts` or equivalent).
10. **`frontend/src/pages/participant-detail/NotesTab.tsx`**: render an "Auto-generated" `Tag` next
    to the title when `note.sourceKey` is set (in `NoteCard`, near the existing `Pin` icon usage,
    L58-61); when `note.hasSourceDrift` is also true, render the amber hint with "Dismiss"/
    "Regenerate" buttons directly beneath it.
11. **New** `frontend/src/pages/participant-detail/NotesTab.test.tsx` (does not exist today, per
    discovery §7) — this is a required new file, covering at minimum: the archive/restore flow,
    the auto-generated tag rendering, the drift hint rendering + both its actions, and that editing
    an auto-note doesn't crash/lose data.

### Acceptance

- Saving a participant with allergies filled in creates exactly one note; saving again unchanged
  creates zero more and doesn't touch `UpdatedAt`.
- Clearing allergies later archives that note (only if it was never manually edited).
- **Manually editing an auto-note's text, then changing the source field again: the note's text is
  byte-for-byte unchanged, `HasSourceDrift` becomes true, and the drift hint renders in `NotesTab`
  with working Dismiss and Regenerate actions** — Dismiss clears the hint and leaves the text
  alone; Regenerate replaces the text with freshly generated content and re-arms auto-sync.
- A manually-edited note never spawns a duplicate note for the same `SourceKey`, before or after
  drift is detected.
- Editing only a note's title (leaving description alone) still sets `IsManuallyEdited` and
  behaves identically to editing the description for all of the above.
- Adding a restrictive practice entry (via PD-2's new "Add entries" flow) creates/updates the
  restrictive-practices auto-note; deleting the last active entry archives it.
- **Every non-seed-data cell in the Trigger coverage table is exercised by a test**: a risk entry
  added at participant-creation time triggers the risks/hazards note (item 5a); a risk entry added
  or edited afterward via `ParticipantRiskEntriesController` also triggers it (item 5b); once
  core02/PD-6/PD-7 land, a save through any of the 4 flagged partial-update section endpoints
  triggers the matching category's note (item 5c) — track this as a follow-up acceptance item on
  those branches specifically, since core02 doesn't exist yet on this branch.
- Opening the Notes tab for a participant whose safety-critical fields were changed by a write
  path that (hypothetically) forgot to call the sync service still shows the correct auto-note
  after that view loads (item 5d's safety net).
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` clean; no new lint errors.

---

## PD-6 — Support Profile tab: single editable home for support-related fields

**Branch:** `feat/pd06-support-profile-tab-merge`

### Current state

Two unrelated things share the name "support profile" (`discovery/02-participant-form.md`
§3, "Support profile fields"):

1. **The `/support-profile` sub-resource** — `SupportProfile` entity (one-to-one with
   `Participant`): `CommunicationNotes`, `BehaviourSupportNotes`, `RestrictivePracticeDetails`,
   `ManualHandlingNotes`, `MedicationHealthSummary`, `EmergencyConsiderations`,
   `TravelSpecificNotes`, `ReviewDate`. Rendered read-only at
   `ParticipantDetailPage.tsx:686-710`. `useSupportProfile` (`frontend/src/api/hooks/participants.ts:39-45`)
   is `useQuery`-only — **no `useUpdateSupportProfile` mutation hook exists anywhere**, even
   though `PUT /api/v1/participants/{id}/support-profile` already works server-side
   (`ParticipantsController.cs:988-1005`, gated `Authorize(Roles = "Admin,Coordinator,SuperAdmin")`).
   Note `RestrictivePracticeDetails` is server-side **read-only-by-design already** — the
   controller comment (`ParticipantsController.cs:997-998`) says it's "intentionally left
   untouched — the register replaces it as the write path"; `UpdateSupportProfileDto` has no field
   for it at all.
2. **The wizard's "Support Needs & Mobility" step** (`ParticipantCreatePage.tsx`, `stepIndex===5`,
   `:2656-2901`) — plain `Participant` columns, six cards: "Support Needs" (High Support,
   Intensive Support, Support Ratio), "Mobility Aids & Support" (Wheelchair/Walker,
   `mobilitySupportOptions`), "Overnight Support" (type + conditional ratio), "Equipment" (5
   checkboxes), "Support Notes" (Mobility/Equipment/Transport notes), "Mobility & Functional"
   (Ambulant Status, Falls Risk Rating, Level of Personal Care, Uneven Ground, Orthotics,
   Continence Support, Bowel Care, Menstruation, Skin Integrity) — plus a 7th, CA-gated card
   ("Community Access — additional," a `checklistItems` checklist) that this spec **excludes**
   (see Design). All 6 in-scope cards are mirrored read-only in the Details tab's "Support Needs &
   Mobility" `Card` (`ParticipantDetailPage.tsx`, one of the 12 Details-tab cards, including the
   derived, read-only `p.hasRestrictivePracticeFlag` row).

### Design

**The Support Profile tab becomes the single home for both.** All 6 in-scope wizard-step cards'
fields, plus all 7 `SupportProfileDto` fields (minus the already-non-editable
`RestrictivePracticeDetails`, which stays visible but read-only with a pointer to the Restrictive
Practices tab), move onto the Support Profile tab as **editable section panels** (same
Edit→Save/Cancel-per-section shape PD-7 establishes — see that item; this tab is built with the
same primitive). The "Support Needs & Mobility" card is **removed from the Details tab entirely**
— having the same fields editable in two places is exactly the dual-write-path inconsistency
`discovery/02-participant-form.md`'s obstacle 2 already flags for consents/health/ADL, and this
spec doesn't repeat it.

Two distinct partial-update groups live on this one tab, because they're genuinely different
resources with different (real, existing) permission gates:
- **`supportNeedsMobility`** — the 6 wizard-step cards' `Participant` columns. New core02 partial
  endpoint, gated by a new `canWriteParticipantDetails` boolean (mirrors
  `ParticipantsController`'s real `PUT /{id}` gate, `Authorize(Roles = "Admin,Coordinator,SuperAdmin")`
  at `:786` — **not** the broader existing `canWrite`, which is `!isSupportWorker` and is
  therefore wider than what the backend actually allows; see PD-7 for why this new boolean is
  introduced there too).
- **`supportProfile`** — the 7 `SupportProfileDto` fields. Reuses the **existing, unchanged**
  `PUT /api/v1/participants/{id}/support-profile` endpoint (no core02 dependency — this endpoint
  already does a full-resource `PUT`, and the resource is small/flat enough that "partial" and
  "whole" are the same shape here). Gated by a new `canWriteSupportProfile` boolean mirroring that
  endpoint's existing `Authorize(Roles = "Admin,Coordinator,SuperAdmin")` gate exactly.

**Fields to add to the tab** (answering "assess which fields should be added"):
- Everything in the 6 wizard-step cards above (was: nowhere editable post-creation; now: editable
  here) — this is the bulk of "what's added."
- `p.hasRestrictivePracticeFlag`, moved from the (now-deleted) Details tab card as a **read-only**
  row (it's server-derived, not directly editable per DTOs.cs:342's comment) in the new
  "Support Needs" section, with a link to the Restrictive Practices tab as its source of truth.

**Excluded, with reasoning**: the CA-gated "Community Access — additional" checklist card
(`ParticipantCreatePage.tsx:2853-2895`) stays wizard-only. Unlike the other 6 cards (plain
`Participant` columns), it's backed by the `checklistItems` collection, which already has its own
independent CRUD (`ParticipantChecklistItemsController.cs`) — structurally it's a sibling of
Consents/HealthConditions/ADL (per-item upsert sections), not a flat-field card, and folding it in
here would conflate two different partial-update shapes in one branch. Moving it is a reasonable
future item, not a blocker for this one.

**Wizard step disposition — recommendation: split by mode.**
- **Create mode: keep the step exactly as-is.** These are real, meaningful upfront fields for a
  brand-new participant (e.g. High Support, mobility aids) — `SupportProfileDto` fields
  literally *can't* be entered here regardless (the sub-resource's `PUT` needs an existing
  participant `Id`, which doesn't exist yet mid-wizard — confirmed by discovery: "no form/wizard
  step references any of communicationNotes/.../reviewDate"). So create-mode intake is unaffected.
- **Edit mode: turn the step into a read-only summary card linking to the Support Profile tab** —
  exactly the pattern the codebase **already uses twice** for "this data now lives elsewhere
  post-creation": Contacts (step 3, edit-mode-inert, links to the Contacts tab,
  `ParticipantCreatePage.tsx:2452-2460`) and Risk Entries (step 9, edit-mode-inert, links to the
  Risks section, `:3452-3460`). This is deliberately the *opposite* choice from the dual-path
  precedent (consents/healthConditions/ADL, editable in both wizard-edit-mode and their own detail
  sections) — discovery already flagged that dual-path as an inconsistency worth resolving, not
  one to extend to a 4th data area.
- `onSubmit`/`handleSaveDraft`'s edit-mode payload already strips `riskEntries`/`contactRoles`
  (`ParticipantCreatePage.tsx:1616-1617`, `:1660-1661`); the 6 Support-step fields are **not**
  stripped the same way, since `reset()` still loads their current values from `existing` and the
  read-only card doesn't mutate them — the full-participant `PUT` still round-trips their
  unchanged current values harmlessly alongside whatever else changed on other (still-editable)
  wizard steps. No stale-data risk, since nothing on this step can go stale without the read-only
  card being re-rendered from a fresh `reset()`.

### Implementation

1. **core02 dependency**: the partial-update endpoint for `supportNeedsMobility` (see PD-7's
   "core02 requirements" — this group is one of the ones core02 must provide).
2. **`frontend/src/lib/permissions.ts`**: add `canWriteParticipantDetails` and
   `canWriteSupportProfile` (both `isSuperAdmin || isAdmin || isCoordinator`, each with its own
   doc comment naming the controller/route it mirrors, per the file's existing per-feature-boolean
   convention).
3. **New** `frontend/src/api/hooks/participants.ts`: `useUpdateSupportProfile()` mutation hook
   (was missing entirely) wrapping the existing `PUT /participants/{id}/support-profile`;
   `useUpdateParticipantSection(section)` (or one hook per section) wrapping core02's new
   endpoint(s).
4. **`frontend/src/pages/ParticipantDetailPage.tsx`**: delete the "Support Needs & Mobility" Card
   from the Details tab (the block containing the fields enumerated in Current State); replace the
   `tab === 'support'` block (L686-710) with a new component (see next item).
5. **New** `frontend/src/pages/participant-detail/SupportProfileTab.tsx`: composes 7 section
   panels (6 `supportNeedsMobility` sections mirroring the wizard cards 1:1, plus 1
   `supportProfile` section for the sub-resource fields, `RestrictivePracticeDetails` rendered
   read-only within it) using the shared edit-panel component PD-7 introduces (see that item's
   Implementation §2 — land PD-7's shared component first, or duplicate a minimal version here and
   reconcile at merge time if sequencing runs the other way; see Dependency order).
6. **`frontend/src/pages/ParticipantCreatePage.tsx`**: in edit mode, replace `stepIndex === 5`'s
   editable JSX with a read-only summary card + "Support Needs & Mobility is now managed from the
   participant's Support Profile tab" link, mirroring the Contacts/Risk-Entries pattern exactly
   (same card chrome, same link styling).
7. **Tests**: extend `ParticipantDetailPage.test.tsx` (Details tab no longer shows the removed
   card), add `SupportProfileTab.test.tsx` (new file) covering each section's edit/save/cancel and
   the two distinct permission gates, and extend `ParticipantCreatePage.test.tsx`'s edit-mode
   assertions for the now-read-only step.

### Acceptance

- Every field from the 6 wizard-step cards, plus the 6 non-legacy `SupportProfileDto` fields, is
  directly editable from the Support Profile tab by a user with `canWriteParticipantDetails`/
  `canWriteSupportProfile` respectively, and read-only (no Edit button) for one without.
- `RestrictivePracticeDetails` displays but has no edit control anywhere on the tab.
- The Details tab no longer has a "Support Needs & Mobility" card.
- In edit mode, the wizard's step 5 shows a read-only summary + link, matching Contacts/Risk
  Entries' existing pattern; create mode is unchanged.
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` clean; no new lint errors.

---

## PD-7 — Details tab: section-level editing wherever permitted

**Branch:** `feat/pd07-details-tab-section-edit`

### Current state

**The Details tab is 100% read-only.** Grepping the whole render block
(`ParticipantDetailPage.tsx:197-684`, per discovery) for `mutate|onClick|<input|<select|<textarea`
turns up nothing but the two PDF-download buttons in the header — zero form controls anywhere in
this tab. All editing happens off-page via the wizard's edit mode
(`Link to={`/participants/${id}/edit`}`, gated by the existing broad `canWrite` = `!isSupportWorker`).
That gate is **broader than the real backend gate** on the endpoint it triggers —
`PUT /api/v1/participants/{id}` is `Authorize(Roles = "Admin,Coordinator,SuperAdmin")`
(`ParticipantsController.cs:786`), which excludes ReadOnly *and* SupportWorker, while `canWrite`
only excludes SupportWorker. (This mismatch already exists today — ReadOnly sees the Edit button
and gets a 403 on save, per `permissions.ts:87-90`'s own doc comment — this spec doesn't change
that pre-existing wizard-entry-point behaviour, but it does mean the *new* section-level edit
buttons below use the tighter, correct gate rather than copying the existing looser one.)

Section inventory (after PD-6 removes "Support Needs & Mobility" from this tab — 11 remaining
section-edit panels across the Details tab's cards, one panel per `Card` in the JSX, since PD-7 is
section-level not per-field):

| Section (Card) | Key fields | Partial-update group | Permission gate |
|---|---|---|---|
| Identity | First/Last/Preferred/Middle Name, DOB, Gender, Place of Birth, Phone, Email, Preferred Staff | `identity` | `canWriteParticipantDetails` |
| Address & Living Arrangements | Address, Living Arrangement, Main Support Person, Others Living in the Accommodation, Residential Information, Lives With Others, Who They Live With, SIL Provider, Accommodation Type, On-Site Support Hours, Living Arrangement Notes | `addressLiving` | `canWriteParticipantDetails` |
| NDIS & Funding | Funding Source, NDIS Number, Plan Start/End Date, Funding Organisation, DSOA, Repeat Client | `ndisFunding` | `canWriteParticipantDetails` |
| Key Identifiers | Pension Card, Medicare, Companion Card, Private Health Fund, Taxi Card, Hair/Eye Colour, Weight/Height | `keyIdentifiers` | `canWriteParticipantDetails` |
| Cultural Background | CALD, LGBTIQA+, Family/Community, Aboriginal/Torres Strait Islander, 5 "Received: ..." toggles, Personal Interests, Choice & Control Notes | `culturalBackground` | `canWriteParticipantDetails` |
| Medical | Primary Diagnosis, Other Diagnoses, HIDPA Categories/Notes, Medical Summary, Allergies, Anaphylaxis Risk, Allergy Management Notes | `medical` | `canWriteParticipantDetails` |
| Behaviour & Communication | Memory(+Aids), Impaired Understanding/Judgement, Behaviours of Concern (current/history), Behaviour Risk Rating, RIDS Logged, BSP/BOC provided, Expressive/Receptive Skills, Reading Ability, Communication Aids | `behaviourCommunication` | `canWriteParticipantDetails` |
| Community Access | Signs Happy/Settled, What Helps Calm Down, BOC Triggers/Early Warning/De-Escalation/What Not To Do, What My Supports Look Like | `dailyLivingCommunityAccess` | `canWriteParticipantDetails` |
| Meals & Diet | Meal Assistance, Choking Risk, Modified Diet, PEG Regime, Special Utensils, Special Dietary Needs, Favourite Meals, Medication Tricks, Foods Always Eaten | `dailyLivingMeals` | `canWriteParticipantDetails` |
| About Me | Goals, Support Areas, Strengths/Fears, Things to Know, Who/What Is Important, Likes & Dislikes | `dailyLivingAboutMe` | `canWriteParticipantDetails` |
| Risks & Hazards Summary | Behaviour Risk Summary, General Notes | `risksHazardsSummary` | `canWriteParticipantDetails` |

`RiskEntriesSection` (the free-form list below the Risks & Hazards Summary card) is **out of
scope** — it already has its own CRUD (`useRiskEntries`/etc.), unaffected by this item.

All 11 sections share the same gate (`canWriteParticipantDetails`, new — see PD-6, which
introduces the same boolean) because they're all plain `Participant` columns behind the one
`ParticipantsController` `PUT`-equivalent role gate; there's no finer-grained backend role split
among these fields today, so inventing per-card gates here would be gate-washing, not precision.

### Design

Each `Card` gains an **Edit** button in its header (visible only when `canWriteParticipantDetails`
is true). Clicking it swaps that card's read-only spans for the equivalent inputs (using the
existing wizard's field-to-control mapping exactly — same `Dropdown`/`SearchableSelect`/checkbox/
`YesNoToggleField` choices already used for these fields at `ParticipantCreatePage.tsx`, not
reinvented), with a Save/Cancel footer inside the card. Save calls that section's core02 partial
endpoint with only that card's fields; Cancel reverts to the last-saved read display with no
network call. Only one section is editable at a time is **not** enforced — independent cards can
be mid-edit simultaneously, since each saves independently and they don't share form state
(matches how the wizard's own steps are already independent `.pick()` schemas).

**Extraction recommendation**: yes, extract. `ParticipantDetailPage.tsx` is already flagged in
discovery as "the largest inline block on the page" (§6) and is 733 lines with none of these 11
cards factored out. Rather than 11 near-duplicate bespoke files, build **one shared component**,
`frontend/src/pages/participant-detail/SectionEditPanel.tsx`, providing just the shared chrome —
Edit button, Save/Cancel footer, in-flight/error state, and a `dirty` guard on Cancel (confirm if
the user made changes) — as a wrapper (`children` render-prop style: `{(editing) => editing ? <EditFields/> : <ReadFields/>}`), reused by PD-6's `SupportProfileTab.tsx` sections too. Each of
the 11 cards still gets its own small file (e.g. `ParticipantIdentitySection.tsx`,
`ParticipantAddressSection.tsx`, ...) with its own bespoke field JSX (conditional rendering like
"Overnight Ratio only if Overnight Support ≠ None" or the tri-state toggles doesn't generalize
cleanly into one config-driven renderer, and forcing it to would fight the existing wizard's own
per-step-bespoke-JSX style) — but each is now small (just field JSX, no chrome) because
`SectionEditPanel` carries the repeated part.

**core02 requirements** (this item's answer to "which field groups must be independently
savable"): one partial-update group per row in the table above, plus `supportNeedsMobility` from
PD-6 — 12 groups total. Recommended shape: a dedicated endpoint per group rather than a generic
JSON-merge-PATCH, matching this codebase's existing style (concrete per-resource DTOs/endpoints
throughout, no generic patch machinery anywhere) — e.g.
`PUT /api/v1/participants/{id}/sections/identity` with a new, narrow
`UpdateParticipantIdentitySectionDto` carrying only that group's fields, one such DTO+route per
group. **Validation must be re-scoped per section**: the wizard's cross-field `superRefine`s
(`genderRefine`, `weightHeightRefine`, etc., `ParticipantCreatePage.tsx:33-449`) each read fields
from a single step already (they're used via `STEP_SCHEMAS[stepIndex].pick()|`), so the equivalent
section DTOs should carry the same validation attributes/refinements, scoped to exactly that
DTO's fields — core02 must confirm no existing refine spans two of the new section boundaries (a
quick audit item for that branch, not this one, since the groups are fixed by this table). Each
endpoint's response returns the updated `ParticipantDetailDto` so the frontend can refresh via the
existing `useParticipant` query-cache invalidation, consistent with how `useUpdateParticipant`
already invalidates today (`participants.ts:55-64`).

> **PD-5 cross-reference:** the `medical`, `behaviourCommunication`, and `risksHazardsSummary`
> groups here (plus `supportNeedsMobility` from PD-6) each carry a safety-critical field PD-5
> auto-generates notes from. Per PD-5's Trigger coverage table, **each of these 4 endpoints must
> call `SafetyNoteSyncService.SyncFromParticipantAsync` in its own `SaveChangesAsync`** — without
> it, editing that section here silently stops updating its matching auto-note. Land this
> alongside the endpoint itself, not as a follow-up.

### Implementation

1. **core02** provides the 12 endpoints/DTOs per the table above (this branch's dependency, not
   its own work).
2. **New** `frontend/src/pages/participant-detail/SectionEditPanel.tsx` — shared edit-toggle
   chrome described above.
3. **New**, one file per row in the table: `ParticipantIdentitySection.tsx`,
   `ParticipantAddressLivingSection.tsx`, `ParticipantNdisFundingSection.tsx`,
   `ParticipantKeyIdentifiersSection.tsx`, `ParticipantCulturalBackgroundSection.tsx`,
   `ParticipantMedicalSection.tsx`, `ParticipantBehaviourCommunicationSection.tsx`,
   `ParticipantCommunityAccessSection.tsx`, `ParticipantMealsDietSection.tsx`,
   `ParticipantAboutMeSection.tsx`, `ParticipantRisksHazardsSummarySection.tsx` — each wraps
   `SectionEditPanel`, read mode reuses the exact existing JSX/labels from
   `ParticipantDetailPage.tsx`, edit mode reuses the exact existing field controls from the
   matching wizard step.
4. **`frontend/src/pages/participant-detail/index.ts`**: export all 11.
5. **`frontend/src/pages/ParticipantDetailPage.tsx`**: replace each inline Card block (L197-684,
   minus the already-removed-by-PD-6 Support Needs & Mobility card) with the corresponding new
   component; the file shrinks substantially.
6. **`frontend/src/lib/permissions.ts`**: `canWriteParticipantDetails` (added once — PD-6 and PD-7
   both reference it; whichever branch lands first adds it, the other reuses it — see Dependency
   order).
7. **Tests**: one `*.test.tsx` per new section component (edit/save/cancel, validation, gate
   hidden for a non-`canWriteParticipantDetails` role), plus updates to
   `ParticipantDetailPage.test.tsx`'s existing "Details tab groups (PDETAIL-01)" describe block
   (L156) so it still finds the same rendered text through the new component boundaries.

### Acceptance

- Every field listed in the table is directly editable in place, without leaving the Details tab,
  for a user with `canWriteParticipantDetails`; read-only (no Edit button, no behaviour change)
  otherwise.
- Editing one section and saving does not require re-entering or re-validating any other section.
- Cancelling a section mid-edit with unsaved changes prompts for confirmation and, once confirmed,
  reverts exactly to the last-saved server values (no stale client-only edits linger visually).
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` clean; no new lint errors.

---

## Dependency order

1. **`feat/core02-participant-partial-save`** (external prerequisite) — must land before PD-6 and
   PD-7; provides the 12 section partial-update endpoints PD-7's table enumerates (one of which,
   `supportNeedsMobility`, PD-6 also consumes) and the reused-as-is `PUT /support-profile` PD-6
   needs no new work from core02 for.
2. **PD-1** — independent, frontend-only, no dependency on anything else in this spec. Land
   whenever.
3. **PD-2** — independent (backend DTO/controller + frontend, no core02 dependency — Restrictive
   Practices already has its own full CRUD). Land before PD-5, since PD-5's
   restrictive-practices trigger hooks into `RestrictivePracticesController.CreateBulk`, which
   PD-2 also modifies — landing PD-2 first avoids PD-5 rebasing over PD-2's DTO/controller change.
4. **PD-3** then **PD-4** — both touch `RoutinesTab.tsx`, `ParticipantRoutine.cs`, and the routines
   DTOs/controller/tests, but different fields (time window vs. day representation). No hard
   dependency, but land PD-3 first to keep PD-4's (larger, schema-migrating) diff smaller and
   reduce merge-conflict surface in the shared files.
5. **PD-5** — depends on PD-2 (see above) for the restrictive-practices category; the other four
   categories have no dependency beyond the existing `ParticipantsController.Create`/`Update`.
6. **PD-6** — depends on core02 (`supportNeedsMobility` group). Land before PD-7: PD-7 extracts
   the *remaining* Details-tab cards into section components, and doing that extraction after
   PD-6 has already removed "Support Needs & Mobility" avoids extracting a card that's about to be
   deleted, and avoids two branches fighting over introducing `canWriteParticipantDetails` at the
   same time (PD-6 introduces it; PD-7 reuses it).
7. **PD-7** — depends on core02 (all 11 remaining groups) and, per above, on PD-6 landing first.
