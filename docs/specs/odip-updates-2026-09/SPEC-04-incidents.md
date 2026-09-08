# SPEC 04 — Incident Reporting Wizard

Source backlog items (verbatim):
- *"Update form to be a wizard similar to the new participant wizard"*
- *"Should ask for the person involved first with that field being searchable for all participants"*
- *"The first tab should have the title and staff member reporting it with the user currently
  logged in as the default option with the involved staff member as another optional field as
  well as the service type, incident type and serverity"*
- *"The second tab should check if the incident type is restrictive practice, then it should
  display all the restrictive practices already entered for that user as well as the option to
  add in the information if it is not an approved one. Note that if one isnt selected and an
  unapproved restrictive practice is used, we should not enter it as a restrictive practice for
  that participant."*
- *"Next is incident details which if an injury is selected as the incident type, a diagram of
  the body should be displayed with the ability to select where on the body the injury happened
  as well as the ability to type in a description for each injury and what kind of injury as a
  selectable field."*
- *"Incident details should contain the date and time, location, description of what happened,
  immediate actions taken and where emergency services called fields."*
- *"The next tab will be the witnesses tab, where you can select from other staff members who
  witnessed the incident as well as the ability to just add in other people as text. This should
  use the same witness approval method as the medication field to allow for other users to
  approve of their witness and offer a witness statement optionally"*
- *"Ensure that the existing automated workflow for incidents for medications are applied to this
  new form flow"*

Discovery evidence: `discovery/04-incidents.md`. Current form: `frontend/src/pages/IncidentCreatePage.tsx`
(730 lines, single non-wizard page). Backend: `backend/Odip.Api/Controllers/IncidentsController.cs`,
`backend/Odip.Domain/Entities/IncidentReport.cs`.

**Foundation dependency:** all of IN-1 through IN-8 build on `feat/core01-wizard-shell`, which lands
first and produces a reusable Wizard/Stepper shell in `frontend/src/components/wizard/`. No such
shell exists today — `ParticipantCreatePage.tsx` (3,608 lines) hand-rolls its own step machinery
inline and is not extractable as-is. IN-1 below specs what the incident wizard needs FROM that
shell as requirements, it does not build the shell itself.

---

## Proposed wizard structure

| # | Step key | Label | Rendered when | Fields | Validation gate (blocks Next) |
|---|---|---|---|---|---|
| 0 | `basics` | Details | always | `involvedParticipantId` (first field), `title`, `reportedByStaffId` (default = current user), `involvedStaffId`, `serviceType`, `tripInstanceId` (conditional), `incidentType`, `otherTypeSpecify` (conditional), `severity` | `title` required, `reportedByStaffId` required, `incidentType` required, `severity` required, `tripInstanceId` required iff `serviceType==='Trip'`, `otherTypeSpecify` required iff `incidentType==='Other'` |
| 1 | `restrictivePractice` | Restrictive Practice | only when `incidentType==='RestrictivePracticeUse'` — **removed from the step list entirely otherwise**, not just hidden | `restrictivePracticeType`, `restrictivePracticeId` (pick from participant's approved practices of that type), `unapprovedRestrictivePracticeDetails` (shown when no approved practice is picked) | `restrictivePracticeType` required; exactly one of {`restrictivePracticeId` set} or {`unapprovedRestrictivePracticeDetails` non-empty} — see IN-4 |
| 2 | `details` | Incident Details | always | `incidentDateTime`, `location`, `description`, `immediateActionsTaken`, `wereEmergencyServicesCalled`, `emergencyServicesDetails` (conditional); plus, only when `incidentType==='Injury'`: `injuries[]` (`region`, `injuryType`, `description` each) | `incidentDateTime` required, `description` required; when `incidentType==='Injury'`, at least one injury row required, each row's `region`/`injuryType`/`description` required |
| 3 | `witnesses` | Witnesses | always | `witnesses[]` — each row either `{ witnessUserId, statementText? }` (staff) or `{ witnessName, statementText? }` (external text) | none required — witnesses are optional, matching today's form |
| 4 | `compliance` | Review & Compliance | **edit mode only** (`isEdit === true`) — absent from the step list on create | `status`, `qscReportingStatus`, `qscReferenceNumber`, `qscReportedAt`, `reviewedByStaffId`, `reviewNotes`, `correctiveActions`, `familyNotified`/`familyNotifiedAt`, `supportCoordinatorNotified`/`supportCoordinatorNotifiedAt` | none — every field here is optional today and stays optional |
| 5 | `review` | Review | always, always last | no inputs of its own — one card per earlier step with an Edit link back (`goToStep`), same as `ParticipantCreatePage`'s review step | none |

Two of these steps are **conditionally absent from the step array itself** (`restrictivePractice`,
`compliance`) — this is new relative to `ParticipantCreatePage`'s fixed 11-step array, and is the
central new capability IN-1 asks of the wizard shell.

---

## IN-1 — Wizard shell requirements (on `feat/core01-wizard-shell`)

**Branch:** `feat/in01-incident-wizard-shell-requirements` (a requirements/consumption doc + the
incident wizard's own step-list/schema scaffolding; does not implement the shell itself)

### Current state
No generic `Wizard`/`Stepper` component exists in `frontend/src` (confirmed by discovery, filename
search). `ParticipantCreatePage.tsx` hand-rolls: a fixed `WIZARD_STEPS: WizardStep[]` array
(`:771-793`), `stepIndex` state, `currentStepFieldSet` (fields owned by the active step, used to
scope the error summary), `goToStep`/`handleBack`/`handleNext` (`:1078-1112`), a `visitedSteps: Set<number>`
gating which steps are clickable in the step rail (`:2043-2045`), per-step schemas validated on
Next (`STEP_SCHEMAS`, referenced `:297-344`), and a synthetic last `review` step
(`REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1`) rendering one card per earlier step with an
"Edit" button that calls `goToStep`. The incident wizard needs everything that pattern provides,
plus one capability `ParticipantCreatePage` never needed: a **step list that changes shape at
runtime**, not just fields that show/hide within a fixed step.

### Design
IN-1 does not build the shell — `feat/core01-wizard-shell` does. This item specs the contract the
incident wizard needs from it, so core01 can be built to satisfy a real second consumer instead of
just extracting `ParticipantCreatePage`'s exact shape 1:1.

Required shell capabilities:
1. **Ordered step list**: `{ key, label, fields }[]`, same shape as `WizardStep` today.
2. **Per-step validation gating**: Next runs a step-scoped schema's `safeParse` against current
   form values before advancing, setting field errors and focusing the first invalid field on
   failure — same behaviour as `handleNext`/`handleInvalidSubmit` today.
3. **`visitedSteps`-gated jump navigation**: the step rail's buttons are clickable only for
   indices already visited (`goToStep` no-ops otherwise) — same as today. No stronger "jump
   anywhere" capability is needed; back-navigation via visited-set already covers every real use
   case in this form.
4. **A synthetic terminal Review step** with per-earlier-step "Edit" cards jumping back via
   `goToStep` — same as today.
5. **NEW: a computed, not fixed, step list.** The shell must accept a step list that is itself
   derived from live form values (e.g. `useMemo(() => computeSteps(incidentType, isEdit), [incidentType, isEdit])`)
   rather than a module-level constant, and must handle the current step disappearing from a
   recomputed list gracefully: if `stepIndex` no longer has a corresponding entry (e.g. the user
   was on the Restrictive Practice step and then changed `incidentType` away from
   `RestrictivePracticeUse` via the step rail's Back button), the shell clamps `stepIndex` to the
   nearest still-valid step rather than rendering nothing or throwing. `visitedSteps` indices
   likewise need to be interpreted against the CURRENT list, not stale absolute positions — the
   simplest correct rule (and what this spec assumes core01 implements): key `visitedSteps` by
   step `key` (a `Set<string>`), not by numeric index, so a list reshuffle never invalidates it.
6. **Prefill compatibility**: the shell must not fight the existing "apply router-state prefill
   once, via `reset()` inside a `useRef`-guarded `useEffect`" idiom (INC-03/NOTES-02, see IN-8) —
   i.e. calling the underlying react-hook-form's `reset()` after mount must repopulate the active
   step's fields correctly without the shell needing its own separate prefill API. No new shell
   capability is required here beyond "don't assume `defaultValues` are final at construction
   time" — see IN-8 for why no step-skipping/auto-advance mechanism is needed either.

### Implementation
1. This branch does not touch `IncidentCreatePage.tsx`. It defines, for review alongside
   core01's own spec, the exact TypeScript contract above (step list shape, `visitedSteps: Set<string>`,
   the Next-validation callback signature) so core01 is built against a real second use case.
2. Scaffolding the incident wizard's OWN step-list function and per-step schema objects belongs to
   IN-3/IN-4/IN-5/IN-6/IN-7 (each step's own branch owns its slice); this item only fixes the
   shell-level contract they all depend on.
3. **Resolver workaround carries forward unchanged.** `IncidentCreatePage`'s hand-rolled `Resolver`
   (`:94-103`) exists because `@hookform/resolvers` v3's `zodResolver` reads `ZodError.errors`, a
   getter zod v4 dropped — same issue `ParticipantCreatePage` works around. The wizard keeps a
   single combined schema + hand-rolled resolver for the final submit-time validation (defense in
   depth, mirrors `ParticipantCreatePage`), separate from the per-step schemas used for Next-button
   gating. Do not attempt to reintroduce `zodResolver` as part of this rewrite.

### Acceptance
- This is a design/contract document, not shippable code on its own — acceptance is that IN-3
  through IN-7 can each be implemented against the contract here without requesting a change to
  core01 mid-flight.
- core01's own acceptance criteria (owned by that spec, not this one) must include a test proving
  a computed step list correctly removes/re-adds a step at runtime without crashing and without
  losing already-entered data in the remaining steps.

> **OPEN QUESTION:** should core01 key `visitedSteps` by step `key` (string) or keep it as a
> `Set<number>` and require every consumer to recompute it on a step-list change? This spec
> assumes string keys (point 5 above) because it is strictly safer, but the actual core01 spec
> owns this decision — flag it there if it lands differently.

---

## IN-2 — `ParticipantPicker` extraction

**Branch:** `feat/in02-participant-picker`

### Current state
No dedicated participant picker exists (discovery, confirmed zero matches for `ParticipantPicker`/
`StaffPicker`). `IncidentCreatePage.tsx:479-488` does it ad hoc:
```tsx
<SearchableSelect
  value={involvedParticipantId ?? ''}
  onChange={v => setValue('involvedParticipantId', v, { shouldDirty: true })}
  items={[
    { value: '', label: 'None' },
    ...participants.map((p: ParticipantListDto) => ({ value: p.id, label: p.fullName || `${p.firstName} ${p.lastName}` })),
  ]}
/>
```
backed by `const { data: participants = [] } = useParticipants({ isDraft: 'false' })`
(`:116`, the INTAKE-08 "exclude drafts" convention). `GEN-1` (SPEC-01) separately lists
`BookingsTab.tsx:232` as a pending native-`<select>`→`SearchableSelect` migration for its own
Participant field, which will become a second ad hoc copy of this exact mapping once that branch
lands. A third consumer (a participant-contacts flow) was named in this work's brief but not
independently confirmed in this pass — treat it as unverified, not a blocking justification.

### Design
Extract the fetch-and-map into one component now that the incident wizard makes the participant
field more prominent (first field, first step) and a second real consumer (`BookingsTab.tsx`) is
already scheduled. This is a genuine "picker with built-in data fetching" of the kind discovery's
§6 flagged as missing.

```tsx
// frontend/src/components/ParticipantPicker.tsx
export type ParticipantPickerProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** Renders a leading '' / 'None' item for optional-participant use cases. Default false. */
  allowNone?: boolean
  noneLabel?: string
  /** INTAKE-08 convention: exclude draft participants. Default true. */
  excludeDrafts?: boolean
  placeholder?: string
  id?: string
  'aria-labelledby'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}
```
Internally wraps `useParticipants(excludeDrafts ? { isDraft: 'false' } : undefined)` +
`SearchableSelect`, forwarding all labelling props exactly as `SearchableSelect` does today (so it
drops into `FormField` the same way). Loading/empty states pass through `SearchableSelect`'s own
`loading`/`emptyMessage` props, driven by the query's `isLoading`/`data`.

This branch wires `ParticipantPicker` into the incident wizard only. Migrating `BookingsTab.tsx`
onto it is a natural follow-up once GEN-1 lands but is NOT part of this branch's acceptance —
call it out in the PR description as a suggested follow-up, don't silently expand scope.

### Implementation
1. **New** `frontend/src/components/ParticipantPicker.tsx` — component as designed above.
2. **New** `frontend/src/components/ParticipantPicker.test.tsx` — loading state, empty state,
   `allowNone` rendering, `excludeDrafts` toggling the query param, and that selecting an item
   calls `onChange` with the participant id (not the label).
3. **`frontend/src/pages/IncidentCreatePage.tsx`** (or its post-IN-3 successor location) — step 0
   uses `<ParticipantPicker allowNone noneLabel="None" value={involvedParticipantId ?? ''} onChange={...} />`
   in place of the ad hoc `SearchableSelect` block.

### Acceptance
- `ParticipantPicker.test.tsx` passes.
- The incident wizard's step 0 participant field behaves identically to today's (same options,
  same "None" semantics, same exclude-drafts behaviour) — no regression in `IncidentCreatePage.test.tsx`'s
  participant-related assertions once ported (see IN-3).
- `npm run build` clean, `npm test` green, no new lint errors.

---

## IN-3 — Step 1: Basics

**Branch:** `feat/in03-wizard-step-basics`

### Current state
Today these fields are split across two `Card`s — "Incident Details" (`:401-463`: title, service
type, conditional trip, incident type, conditional other-specify, severity, date/time, location)
and "People Involved" (`:469-500`: reported by, involved participant, involved staff) — with
date/time and location living in the same card as classification, which this spec moves to the
`details` step (IN-6) since the backlog groups them there instead.

Native `<select>` elements in scope for THIS step (3 of the 6 total in-scope call sites GEN-1
excluded pending this rewrite): `serviceType` (`:407`), `tripInstanceId` (`:416`), `incidentType`
(`:426`), `severity` (`:448`). `reportedByStaffId`/`involvedStaffId` already use `SearchableSelect`
(no migration needed, just relocation into the new step component).

`reportedByStaffId` currently has NO default — the field starts empty and the reporter must pick
themselves from the list every time (`IncidentCreatePage.tsx:132-144`'s `defaultValues` has no
`reportedByStaffId` entry). The signed-in user's id is available via `usePermissions().id`
(`frontend/src/lib/permissions.ts:50`), sourced from the `odip_user` localStorage blob's `id`
field (`AuthResponseDto.id`, written at login, overwritten by `UserSwitcher.selectUser` under
SuperAdmin "view as" — so this stays correct if a SuperAdmin is impersonating a user when filing a
report on their behalf).

### Design
- `involvedParticipantId` becomes the visually and structurally FIRST field on step 0 (backlog:
  "ask for the person involved first"), using `ParticipantPicker` (IN-2) with `allowNone`.
- `reportedByStaffId` defaults to `usePermissions().id` when present. This is a DEFAULT, not a
  lock — same "nudge, not force" convention already used elsewhere in this codebase (e.g. the QSC
  auto-escalation doc comment, `IncidentsController.cs:276-282`): the reporter can still pick a
  different staff member (e.g. a coordinator filing on behalf of someone else, or the signed-in
  account has no matching staff row). When `usePermissions().id` is `null` (no resolvable user —
  matches the field's own null-collapse convention), the field starts empty exactly as today.
- `involvedStaffId` stays a separate, independent, optional field — never conflated with
  `reportedByStaffId`. This is worth stating explicitly because both are "which staff member"
  fields sitting next to each other: reported-by defaults to you, involved-staff never does.
- `serviceType`/`tripInstanceId`/`incidentType`/`severity` migrate off native `<select>` per GEN-1's
  deferred-to-here scope:
  - `serviceType`: `Dropdown` `variant="form"`, items built from `INCIDENT_SERVICE_TYPES` (same
    source array, `IncidentCreatePage.tsx:39`) — no duplicated literal list.
  - `tripInstanceId`: `SearchableSelect` (trips are a data-driven, potentially large, list — same
    class of field as participants/staff per `components/README.md`'s "Picking a picker").
  - `incidentType`: `Dropdown` `variant="form"`, items built from the `IncidentType` enum values
    (currently 11 hardcoded `<option>`s, `:427-437` — replace with one `INCIDENT_TYPE_LABELS`
    map plus `Object.keys`/a shared const array, not a second hardcoded list).
  - `severity`: `Dropdown` `variant="form"`, items from a small `IncidentSeverity` labels map.
  - Each becomes an RHF `<Controller>` per GEN-1's rule 2 (register→Controller), forwarding
    `field.onChange`/`field.value`/`field.onBlur`.

### Implementation
1. **New** `frontend/src/pages/incidents/steps/BasicsStep.tsx` — renders the fields above inside
   `FormField`s, receiving `control`/`errors`/`setValue`/`useWatch`-derived values as props (or via
   a shared step-props contract IN-1's shell defines) from the parent wizard page.
2. **New** `frontend/src/api/types/enums.ts` additions (or confirm existing) — `INCIDENT_TYPE_LABELS: Record<IncidentType, string>`
   and `INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string>`, single source for both the
   `Dropdown` items and any read-only display elsewhere (e.g. the Review step, `IncidentsPage.tsx`
   badges if they don't already have one — check before adding a duplicate).
3. **`frontend/src/pages/IncidentCreatePage.tsx`** — becomes the wizard shell instance: imports
   `BasicsStep` and the other step components (IN-4/IN-6/IN-7/compliance/review), wires the
   `defaultValues.reportedByStaffId` seed from `usePermissions().id` alongside the existing static
   defaults (`serviceType: 'None'`, `severity: 'Medium'`, etc., `:134-143`) — only for CREATE mode;
   edit mode's `reset()` from `existingIncident` (`:190-227`) already sets `reportedByStaffId`
   explicitly and must keep taking priority over the current-user default.
4. Step 0's schema (`basicsSchema`) — a standalone zod object with its own `superRefine` covering
   the trip-required-when-Trip and otherType-required-when-Other rules (RP-type-required lives on
   IN-4's `restrictivePracticeSchema` instead, since that step owns `restrictivePracticeType` now).

### Acceptance
- Opening `/incidents/new` shows the participant picker as the first control on step 0, and
  `reportedByStaffId` pre-selects the signed-in user (verify via a test that seeds `odip_user` in
  localStorage and asserts the `SearchableSelect`'s displayed value).
- Switching the signed-in user (simulate a `UserSwitcher` "view as" change) before the reporter
  field has been touched updates the default; after it's been manually changed, the wizard never
  silently overwrites the reporter's explicit choice (same "default, not lock" contract as the
  QSC/DIAG-02 precedents elsewhere in this codebase — add an explicit test for this, it is the
  one point in this step most likely to regress into "silently overwrites user input").
- `grep -rn "<select" frontend/src/pages/incidents --include=*.tsx` (or the new step file's path)
  returns zero matches for `serviceType`/`tripInstanceId`/`incidentType`/`severity`.
- Existing INC-01/INC-02 test coverage (trip-required, other-type-required) is ported to exercise
  step 0's own Next-button validation rather than a single-page submit.
- `npm run build` clean, `npm test` green, no new lint errors.

---

## IN-4 — Step 2: Restrictive Practice (conditional)

**Branch:** `feat/in04-wizard-step-restrictive-practice`

### Current state
Today this is a single always-rendered-when-relevant `Card` (`:503-604`) with: an RP-type
`Dropdown`, a conditional "link to an authorised practice" `Dropdown` filtered to
`matchingPractices` (active practices of the involved participant matching the selected type,
`:167-171`), and a live authorised/unauthorised preview banner (create) or frozen banner (edit).
There is currently **no way to record "an unapproved practice was used"** beyond simply not
linking one — `RestrictivePracticeId` stays null and the backend's
`DetermineRestrictivePracticeAuthorisationAsync` (`IncidentsController.cs:97-105`) computes
`IsRestrictivePracticeAuthorised = false` if the participant has no ACTIVE practice of that type
at all, but there's no field capturing WHAT was actually done if it wasn't one of the registered
practices. `useRestrictivePractices` (`frontend/src/api/hooks/restrictive-practices.ts:8-17`)
defaults to active-only (`includeInactive` param, default `false`).

### Design
This step is **absent from the step list entirely** unless `incidentType === 'RestrictivePracticeUse'`
(IN-1's computed-step-list requirement exists specifically for this step).

Layout:
1. `restrictivePracticeType` — `Dropdown`, same as today (unchanged control, just relocated).
2. A list of the involved participant's ACTIVE practices of that type (`matchingPractices`,
   unchanged query/filter logic) rendered as selectable rows (radio-style — exactly one may be
   picked), each showing description + review-date hint exactly as today's linked-practice
   `Dropdown` does.
3. Below the list: **"None of these — an unapproved practice was used"**, a mutually-exclusive
   option with the list above. Selecting it reveals a required `unapprovedRestrictivePracticeDetails`
   textarea ("Describe the restrictive practice that was used"). Selecting a listed practice
   clears `unapprovedRestrictivePracticeDetails`; typing into the unapproved-details field clears
   `restrictivePracticeId`. Exactly one of the two is ever set — enforced by the step schema's
   `superRefine`, not just UI convention.
4. A **"Show inactive/retired practices"** disclosure toggle, off by default, purely informational
   — when on, the participant's inactive practices of the selected type render read-only below the
   active list (no selectable control on them). Rationale for defaulting off and keeping them
   unselectable rather than selectable: `IsRestrictivePracticeAuthorised`'s definition is
   specifically "an ACTIVE register entry existed" (`IncidentReport.cs:63-73`'s doc comment) — a
   participant whose only matching practice is retired is, by that definition, in the SAME
   unauthorised bucket as one with no matching practice at all. Letting the picker select an
   inactive entry as "the practice used" would misrepresent that determination; showing it
   read-only for context (a reporter recognizing "oh, this used to be authorised but was retired")
   is useful without corrupting the authorisation semantics.
5. The existing live preview banner (create) / frozen banner (edit) stays, unchanged logic
   (`previewRpAuthorisation`, `IncidentsController.DetermineRestrictivePracticeAuthorisationAsync`).

**The critical rule, stated unambiguously**: when `unapprovedRestrictivePracticeDetails` is set
(i.e. no approved practice was linked), the incident records that text on ITSELF
(`IncidentReport.UnapprovedRestrictivePracticeDetails`, new column). **Nothing is ever written to
the participant's `RestrictivePractice` register as a side effect of this incident** — there is no
new-practice-creation code path anywhere in this design, on either Create or Update. The register
stays exclusively owned by `RestrictivePracticesController`, unchanged.

QSC auto-escalation is **already correct and untouched**: `RestrictivePracticeUse` is already in
`IncidentsController.QscRequiredTypes` (`:20-24`), so every RP incident gets
`QscReportingStatus.Required` regardless of the authorisation outcome — the `isRpAuthorised == false`
branch of that `||` (`:283`) is belt-and-braces, per its own doc comment. This wizard step does not
touch `Create`'s escalation logic at all; it only adds one new nullable string field to persist.

### Implementation
Backend:
1. **`backend/Odip.Domain/Entities/IncidentReport.cs`** — add
   `public string? UnapprovedRestrictivePracticeDetails { get; set; }` next to
   `IsRestrictivePracticeAuthorised`, with a doc comment cross-referencing this field's mutual
   exclusivity with `RestrictivePracticeId` (whichever the frontend sent).
2. **New migration** `AddIncidentUnapprovedRestrictivePracticeDetails` — one nullable
   `text`/`varchar` column, no backfill.
3. **`backend/Odip.Application/DTOs/DTOs.cs`** — add `UnapprovedRestrictivePracticeDetails` to
   `CreateIncidentDto` (`[StringLength(2000)]`, nullable) and `IncidentDetailDto`/`IncidentListDto`
   as appropriate (detail only — list view doesn't need it, matches how `RestrictivePracticeId`
   itself is detail-only today).
4. **`backend/Odip.Api/Controllers/IncidentsController.cs`** — in `Create` and `Update`, persist
   `dto.UnapprovedRestrictivePracticeDetails` verbatim (trimmed, empty→null). No new validation
   beyond what the frontend schema already enforces is strictly required, but add a defence-in-depth
   check mirroring the frontend's mutual-exclusivity rule: reject (400) a request where BOTH
   `RestrictivePracticeId` and `UnapprovedRestrictivePracticeDetails` are set, since that's an
   incoherent state no legitimate client should ever produce.

Frontend:
5. **New** `frontend/src/pages/incidents/steps/RestrictivePracticeStep.tsx` — layout as designed
   above, receiving `matchingPractices`/`involvedParticipantId`/`restrictivePracticeType` the same
   way today's inline block does.
6. **`frontend/src/api/hooks/restrictive-practices.ts`** — no change needed; `includeInactive` param
   already exists for the disclosure toggle.
7. **`frontend/src/lib/incidentPrefill.ts`** — `previewRpAuthorisation` unchanged (it only reasons
   about active practices, which this step's core selection logic still matches exactly).

### Acceptance
- Changing `incidentType` away from `RestrictivePracticeUse` after visiting this step removes it
  from the step rail immediately (IN-1's computed-step-list requirement) and clears
  `restrictivePracticeType`/`restrictivePracticeId`/`unapprovedRestrictivePracticeDetails` from
  the form state so a later switch back starts clean.
- Submitting with an unapproved practice described creates the incident with
  `UnapprovedRestrictivePracticeDetails` populated and `RestrictivePracticeId == null`, and a
  DB-level assertion (integration test) that **no row was inserted into `RestrictivePractices`**
  for the involved participant as a result.
- A request with both `RestrictivePracticeId` and `UnapprovedRestrictivePracticeDetails` set is
  rejected 400 by the backend even if a modified/malicious client sends it (existing frontend
  mutual-exclusivity is not the only enforcement).
- INC-04/INC-05's existing test coverage (authorised/unauthorised preview, frozen banner on edit,
  linked-practice prefill) ported to the new step, still green.
- Inactive practices render read-only under the toggle and are never selectable as the linked
  practice.
- `npm run build`/`dotnet build` clean, `npm test`/`dotnet test` green, no new lint errors.

---

## IN-5 — Body diagram (Injury incidents)

**Branch:** `feat/in05-wizard-body-diagram` (depends on IN-6 landing first — see Dependency order)

### Current state
**Nothing exists.** Grepped `frontend/src` for `BodyMap`/`body-map`/`BodyDiagram`/inline `<svg>`
outside icon/logo contexts — zero matches (discovery §8). This is a from-scratch build and, per
the brief, the highest-risk item in this spec.

### Design
Rendered only inside the `details` step (IN-6), only when `incidentType === 'Injury'`. A new
`injuries: { region: BodyRegion; injuryType: InjuryType; description: string }[]` field, backed by
`useFieldArray` — same established pattern as `ParticipantCreatePage`'s `riskEntries`/`contactRoles`
(`ParticipantCreatePage.tsx:1032,1034`), the only repeatable-row precedent in this codebase.

**The interactive control is a keyboard-navigable region list, not the SVG.** This directly
answers the accessibility risk called out for this item: a click-only SVG region map is unusable
by keyboard or screen reader. Design:
- A `<fieldset>` containing one `<button type="button" aria-pressed>` per `BodyRegion`, grouped
  under four `<legend>`-equivalent headings (Head & Torso / Arms / Legs / Other), always visible,
  always keyboard-operable (Tab between buttons, Enter/Space to add that region to the current
  injury draft). This list is the PRIMARY interface — it is fully sufficient on its own with no
  pointer or SVG rendering at all.
- The SVG (front/back toggle, two `<svg>` diagrams sharing the same `BodyRegion` value space —
  e.g. `LeftUpperArm` is a clickable path on both views, `Chest` only exists on the front view,
  `UpperBack` only on the back view) is a SUPPLEMENTARY, progressively-enhanced layer: each named
  `<path>`/`<circle>` region ALSO gets an `onClick` calling the exact same select handler as its
  list-button counterpart, and highlights (fill colour change) whichever region is currently
  focused/selected in the list — but the SVG is `aria-hidden="true"` in its entirety (the
  accessible interaction happens exclusively through the button list; the diagram is decoration
  layered on top of a fully-functional list-based control, not an alternate path to the same
  functionality that could fall out of sync).

**Region enumeration** (`BodyRegion`, 33 members, deliberately view-independent — a region is a
body part, not "body part as seen from the front"):
`Head, Face, Neck, Chest, Abdomen, Pelvis, UpperBack, LowerBack, Buttocks, LeftShoulder,
RightShoulder, LeftUpperArm, RightUpperArm, LeftElbow, RightElbow, LeftForearm, RightForearm,
LeftWrist, RightWrist, LeftHand, RightHand, LeftHip, RightHip, LeftThigh, RightThigh, LeftKnee,
RightKnee, LeftLowerLeg, RightLowerLeg, LeftAnkle, RightAnkle, LeftFoot, RightFoot, Other`.

**Injury type enumeration** (`InjuryType`, selectable field per injury row):
`Bruise, Laceration, Abrasion, Burn, Fracture, SprainOrStrain, Bite, PressureInjury, Swelling,
Other`.

Both enums are **new backend enums** in `Enums.cs` (mirroring the `IncidentType`/`IncidentSeverity`
declaration style) with a matching frontend `as const` array + labels map (mirroring
`RESTRICTIVE_PRACTICE_TYPES`/`RESTRICTIVE_PRACTICE_TYPE_LABELS` in
`frontend/src/api/types/restrictive-practices.ts`) rather than a frontend-only string union, since
these need to round-trip through the DTO/entity exactly like every other incident enum
(`JsonStringEnumConverter` is already globally registered per `Enums.cs`'s `ServiceStreams` doc
comment, so no extra list-conversion plumbing is needed).

**Multiple injuries per incident**: the field array supports any number of rows; each row is
independently `region`/`injuryType`/`description`. Added/removed rows render in a `DataTable`
(per this spec's platform-wide convention: "any new table uses `DataTable`") with columns Region,
Injury type, Description, and a Remove action — `keyField` is the `useFieldArray` row's own RHF-
generated `id` (stable across re-renders, not the eventual server id, which doesn't exist yet for
new rows).

**Backend persistence** — new child entity, since this is a genuine one-to-many (an
`IncidentReport` has zero or many `IncidentInjury` rows), not columns on the parent:
```csharp
public class IncidentInjury
{
    public Guid Id { get; set; }
    public Guid IncidentReportId { get; set; }
    public IncidentReport IncidentReport { get; set; } = null!;
    public BodyRegion Region { get; set; }
    public InjuryType InjuryType { get; set; }
    public string Description { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```
No `TenantId`/`ITenantEntity` — `IncidentReport` itself has neither (confirmed: it has no
`TenantId` column and is not in `OdipDbContext`'s `HasQueryFilter` list, `OdipDbContext.cs:1283-1441`;
same-tenant scoping for incidents comes transitively through its `ReportedByUser`/`InvolvedParticipant`
FKs, per `IncidentsController`'s own validation-helper doc comments). `IncidentInjury` follows the
same shape as its parent rather than introducing a new tenancy pattern one level down.

Update (edit mode) replaces the full injuries collection on save — delete all existing
`IncidentInjury` rows for the incident and re-insert the submitted list — the same "form owns the
full list, always sends the full list" contract the frontend's `useFieldArray` already implies, and
avoids needing a diffing/reconciliation algorithm for a handful of rows per incident.

### Implementation
Backend:
1. **`backend/Odip.Domain/Enums/Enums.cs`** — add `BodyRegion` (33 members, above) and
   `InjuryType` (10 members, above), placed near the other incident-related enums.
2. **New** `backend/Odip.Domain/Entities/IncidentInjury.cs` — entity as designed above.
3. **`backend/Odip.Infrastructure/Data/OdipDbContext.cs`** — `DbSet<IncidentInjury> IncidentInjuries`,
   `modelBuilder.Entity<IncidentInjury>` config: FK to `IncidentReport` with
   `OnDelete(DeleteBehavior.Cascade)` (an injury row has no meaning once its incident is gone —
   contrast with `IncidentReport.TripInstanceId`'s `Restrict`, which protects a still-meaningful
   trip from deletion).
4. **New migration** `AddIncidentInjuries`.
5. **`backend/Odip.Application/DTOs/DTOs.cs`** — `CreateIncidentInjuryDto { Region, InjuryType, Description }`,
   `IncidentInjuryDto { Id, Region, InjuryType, Description }`; add
   `public List<CreateIncidentInjuryDto> Injuries { get; init; } = new()` to `CreateIncidentDto`
   (mirrors `CreateParticipantDto.RiskEntries`'s insert-loop pattern) and `Injuries: List<IncidentInjuryDto>`
   to `IncidentDetailDto`.
6. **`backend/Odip.Api/Controllers/IncidentsController.cs`**:
   - `Create`: after inserting the incident, loop `dto.Injuries` inserting one `IncidentInjury`
     each (mirrors `ParticipantsController.Create`'s `RiskEntries` loop, `:712-724`). Validate
     server-side that `Injuries` is non-empty only when `dto.IncidentType == IncidentType.Injury`
     (mirrors `ValidateServiceTypeAndIncidentType`'s existing cross-field style — add this rule
     into that same method rather than a second ad hoc check).
   - `Update`: `_db.IncidentInjuries.RemoveRange(existing)` then re-insert `dto.Injuries`, same
     "full replace" contract as above.
   - `GetById`: `.Include(i => i.Injuries)` and map to `IncidentDetailDto.Injuries`.

Frontend:
7. **New** `frontend/src/pages/incidents/BodyDiagramPicker.tsx` — the button-list + SVG component
   designed above. Props: `injuries: InjuryRow[]`, `onAdd(region, injuryType, description)`,
   `onRemove(index)`.
8. **New** `frontend/src/api/types/enums.ts` additions — `BODY_REGIONS`/`BODY_REGION_LABELS`,
   `INJURY_TYPES`/`INJURY_TYPES_LABELS`, same `as const` + labels-map convention as
   `RESTRICTIVE_PRACTICE_TYPES`.
9. **`frontend/src/pages/incidents/steps/IncidentDetailsStep.tsx`** (from IN-6) — renders
   `BodyDiagramPicker` + the injuries `DataTable` when `incidentType === 'Injury'`, wired to
   `useFieldArray({ control, name: 'injuries' })`.

### Acceptance
- Every `BodyRegion` value is reachable and selectable via Tab + Enter alone, with no mouse —
  automated test using Testing Library's keyboard events, not just an assertion that the buttons
  exist.
- The SVG diagrams carry `aria-hidden="true"` and are never the only way to reach a region — a
  test asserts clicking an SVG path and activating the equivalent list button produce identical
  form state.
- Submitting an Injury incident with zero injury rows is blocked at the `details` step's Next
  validation with a clear error; submitting with ≥1 row succeeds and the injuries persist,
  verified via `GET /incidents/{id}` returning the same rows.
- Editing an existing injury incident, removing a row, and saving results in exactly the remaining
  rows in the database (full-replace semantics verified, not an accumulating append).
- Switching `incidentType` away from `Injury` after adding rows clears `injuries` from the form
  state (mirrors IN-4's RP-field-clearing rule) so switching back starts clean.
- `dotnet build`/`dotnet test` and `npm run build`/`npm test` clean; new backend tests for the
  Create/Update injury-replace behaviour and the Injury-requires-at-least-one-row validation.

---

## IN-6 — Step 3: Incident Details (base fields)

**Branch:** `feat/in06-wizard-step-incident-details`

### Current state
Backlog fields and their existing `IncidentReport` mapping — **all six already exist as entity
columns, no new columns needed for this item**:

| Backlog field | Entity column | DTO field | Notes |
|---|---|---|---|
| Date and time | `IncidentDateTime` (`IncidentReport.cs:81`) | `CreateIncidentDto.IncidentDateTime` | required, `datetime-local` input today |
| Location | `Location` (`:82`) | `CreateIncidentDto.Location` | optional |
| Description of what happened | `Description` (`:78`) | `CreateIncidentDto.Description` | required |
| Immediate actions taken | `ImmediateActionsTaken` (`:85`) | `CreateIncidentDto.ImmediateActionsTaken` | optional |
| Were emergency services called | `WereEmergencyServicesCalled` (`:86`) | `CreateIncidentDto.WereEmergencyServicesCalled` | checkbox, reveals `EmergencyServicesDetails` |
| (implied) emergency services detail | `EmergencyServicesDetails` (`:87`) | `CreateIncidentDto.EmergencyServicesDetails` | optional, conditional on the checkbox |

Today these live in the "Incident Details" card mixed with classification fields (`:401-463`) and
the separate "What Happened" card (`:607-625`). This item consolidates them into one wizard step,
per the backlog's explicit grouping ("Incident details should contain the date and time,
location...").

### Design
Plain `FormField`-wrapped native `input`/`textarea`/checkbox — none of these six are `<select>`s,
so no GEN-1 dropdown migration applies here. No entity/DTO change. This step is also where IN-5's
conditional body-diagram block renders (`incidentType === 'Injury'`).

### Implementation
1. **New** `frontend/src/pages/incidents/steps/IncidentDetailsStep.tsx` — the six fields above,
   ported verbatim from `:607-625` (What Happened) and the date/location controls from
   `:456-462` (Incident Details), plus IN-5's `BodyDiagramPicker` conditional block.
2. Step schema (`detailsSchema`) — `incidentDateTime`/`description` required; no cross-field
   `superRefine` needed here beyond IN-5's injury-row-required-when-Injury rule (owned by IN-5,
   applied within this same step's schema since both live in one step).

### Acceptance
- All six fields round-trip unchanged through Create/Update — no entity/DTO diff for this item
  alone (verify by running the existing backend `IncidentsControllerTests.cs` unmodified and
  green, since nothing server-side changes here).
- Existing "What Happened"/date-time/location assertions in `IncidentCreatePage.test.tsx` port to
  this step with no behavioural change other than which step they're gated behind.
- `npm run build` clean, `npm test` green, no new lint errors.

---

## IN-7 — Step 4: Witnesses

**Branch:** `feat/in07-wizard-step-witnesses` (highest-risk item after IN-5)

### Current state
Today's "Witnesses" card (`:628-636`) is two free-text fields — `witnessNames` (comma-separated
names, `input`) and `witnessStatements` (`textarea`) — with **no entity, no user link, no approval
flow** (discovery §1/§2). This is unrelated to the medication witness mechanism, which the backlog
now asks this form to adopt.

The medication pattern to copy (discovery §4), exactly:
- Nominated at record time (`RecordAdministrationModal.tsx`, when `isHighRisk && status === 'Administered'`).
- Persisted on `MedicationAdministration`: `WitnessUserId: Guid?`, `WitnessName: string?` (display
  name, back-compat), `WitnessStatus: Pending|Approved|Declined|NotRequired`,
  `WitnessRequestedAt`/`WitnessRespondedAt: DateTime?`.
- Discovered pull-based: the nominated witness sees it on `PortalWitnessApprovalsPage.tsx`, backed
  by `GET /api/v1/portal/witness-requests`, polling every 60s (`usePendingWitnessRequests`,
  `frontend/src/api/hooks/portal.ts:60-66`).
- Only the named `WitnessUserId` may `POST /portal/witness-requests/{id}/approve|decline` — 404
  identically for "not found", "belongs to someone else", or "caller unresolvable" (anti-
  enumeration, `PortalController.cs:15-33`'s class doc).
- Self-witness blocked both client-side (belt-and-suspenders, `RecordAdministrationModal.tsx:212-213`)
  and server-side (`MedicationsController.cs:372-373`).
- No statement-text field exists on this precedent — decline's confirm dialog copy is UI-only, not
  persisted.
- `usePendingWitnessRequests` has TWO existing consumers beyond its own page: `AppLayout.tsx:85`
  (sidebar nav badge count) and `PortalShiftsPage.tsx:65` (a "Witness approvals" button badge) —
  both use ONLY `.length`, never individual fields, which materially simplifies the merge design
  below.

Differences this step must design for (mandated by the brief):
1. An incident can have MANY witnesses → needs a child collection entity, not columns on the
   parent (unlike `MedicationAdministration`, which only ever has one witness per dose).
2. Witnesses can be free-text non-staff people with no user to approve, coexisting in the same
   list as staff witnesses, visually distinguished.
3. An OPTIONAL witness statement — new capability, no medication precedent has this field.

### Design

**New entity**, one-to-many from `IncidentReport`, same "no `TenantId`, scoped transitively via
the parent FK" shape as IN-5's `IncidentInjury` (same justification: `IncidentReport` itself has
no tenant column):
```csharp
public class IncidentWitness
{
    public Guid Id { get; set; }
    public Guid IncidentReportId { get; set; }
    public IncidentReport IncidentReport { get; set; } = null!;

    /// Set when a staff user was nominated — drives the approval workflow below.
    /// Null for a free-text/external witness, who has nothing to approve.
    public Guid? WitnessUserId { get; set; }
    public User? WitnessUser { get; set; }

    /// Always populated: the nominated staff member's name (denormalised) or the typed free-text
    /// name — same "always populated regardless of path" convention as
    /// MedicationAdministration.WitnessName.
    public string WitnessName { get; set; } = string.Empty;

    public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
    public DateTime? WitnessRequestedAt { get; set; }
    public DateTime? WitnessRespondedAt { get; set; }

    /// NEW beyond the medication precedent (brief: "offer a witness statement optionally").
    /// Populated by the witness themself when they respond (approve or decline), never by the
    /// reporter at creation time — see the portal endpoint changes below.
    public string? StatementText { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```
Reuses the existing `WitnessStatus` enum verbatim (`NotRequired|Pending|Approved|Declined`) — no
new enum needed. `NotRequired` covers a free-text witness exactly the way it already covers "no
staff witness selected" on the medication side (nothing for anyone to approve).

**Coexistence and visual distinction**: one `witnesses[]` field array holds both kinds of row —
`{ witnessUserId: string | null; witnessName: string; ... }`. The wizard step's `DataTable`
(platform convention: new tables use `DataTable`) shows a "Type" column rendering a `StatusBadge`-
style chip: "Staff" for `witnessUserId != null`, "External" otherwise; a second "Status" column
shows the live `WitnessStatus` **only in edit mode reading a persisted incident** ("Pending" /
"Approved" / "Declined") — on a brand-new incident nothing has been persisted yet, so a staff row
instead shows static hint text "Will be asked to approve after this report is submitted," matching
this form's existing "nothing exists until submit" convention (the MAR/shift-note prefill banners
already say the equivalent, `IncidentCreatePage.tsx:376,387`).

**Self-witness rule**, adapted from medication's "can't witness your own administration" to this
form's equivalent identity — the REPORTER, not an "administerer": a nominated witness user id
equal to `reportedByStaffId` is rejected. Enforced client-side (exclude `reportedByStaffId` from
the staff-witness picker's `items`) and server-side (400 if any `dto.Witnesses[].WitnessUserId == dto.ReportedByStaffId`).

**Adding a row**: an inline mini-form above the `DataTable` — a toggle between "Staff member"
(`SearchableSelect` over `useStaff()`, excluding the current `reportedByStaffId`) and "Someone
else" (a plain text name input), plus an "Add" button pushing into the `useFieldArray`. No
statement field at add-time — per the design above, the statement is captured later, by the
witness, not the reporter.

**Portal integration** — `GET /portal/witness-requests` today returns only medication rows. This
step must surface incident witness requests on the SAME page/badge without breaking the two
existing `.length`-only consumers:
- Extend the response DTO with a `SourceType` discriminator and enough incident-specific fields to
  render an incident card, keeping every existing medication field (nullable now, populated only
  for medication rows):
  ```csharp
  public record PortalWitnessRequestDto(
      Guid Id, string SourceType, // "Medication" | "Incident"
      Guid ParticipantId, string ParticipantName,
      Guid? MedicationId, string? MedicationName, string? Strength, string? DoseDescription, string? DoseGiven,
      Guid? IncidentReportId, string? IncidentTitle, IncidentType? IncidentType, IncidentSeverity? IncidentSeverity,
      string RecordedByName, // "recorded by" (medication) or "reported by" (incident)
      DateTime? AdministeredAt, string? AdministeredAtTimeZone, // medication only
      DateTime? IncidentDateTime, // incident only
      WitnessStatus WitnessStatus, DateTime? WitnessRespondedAt, DateTime CreatedAt);
  ```
  `GetWitnessRequests` unions both `MedicationAdministrations` and `IncidentWitnesses` pending rows
  for the caller into one list, ordered by `CreatedAt`. Because both existing consumers
  (`AppLayout.tsx`, `PortalShiftsPage.tsx`) only read `.length`, this is a non-breaking extension —
  their imported type name just needs to widen to the new shape (one-line type import touch, no
  logic change).
- Approve/decline for **medication** rows stays exactly as-is: `POST /portal/witness-requests/{id}/approve|decline`,
  unchanged contract, still bodiless.
- **New** endpoints for incident rows, since they act on a different table and now accept an
  optional statement: `POST /portal/incident-witness-requests/{id}/approve` and `.../decline`,
  body `{ statementText?: string }`, matched against `IncidentWitness.WitnessUserId` with the same
  404-for-anything-not-yours anti-enumeration shape as the medication endpoints. On success, sets
  `WitnessStatus`, `WitnessRespondedAt = UtcNow`, and `StatementText` (only if provided — never
  overwrites a previously-typed statement with `null`).
- The frontend `sourceType` discriminator on each merged-list row tells
  `PortalWitnessApprovalsPage.tsx` which mutation hook to call for that row (`useApproveWitnessRequest`
  vs a new `useApproveIncidentWitnessRequest`).

### Implementation
Backend:
1. **New** `backend/Odip.Domain/Entities/IncidentWitness.cs` — entity as designed above.
2. **`backend/Odip.Infrastructure/Data/OdipDbContext.cs`** — `DbSet<IncidentWitness> IncidentWitnesses`,
   FK to `IncidentReport` with `OnDelete(DeleteBehavior.Cascade)`, FK to `User` (`WitnessUserId`)
   `OnDelete(DeleteBehavior.Restrict)` (mirrors `MedicationAdministration.WitnessUserId`'s own FK
   behaviour — don't cascade-delete a witness record if a user row is ever removed).
3. **New migration** `AddIncidentWitnesses`.
4. **`backend/Odip.Application/DTOs/DTOs.cs`** — `CreateIncidentWitnessDto { WitnessUserId?, WitnessName }`,
   `IncidentWitnessDto { Id, WitnessUserId, WitnessName, IsStaffWitness, WitnessStatus, WitnessRequestedAt, WitnessRespondedAt, StatementText }`;
   `CreateIncidentDto.Witnesses: List<CreateIncidentWitnessDto>`; `IncidentDetailDto.Witnesses: List<IncidentWitnessDto>`.
5. **`backend/Odip.Api/Controllers/IncidentsController.cs`**:
   - `Create`: after inserting the incident, loop `dto.Witnesses`; for each row with
     `WitnessUserId` set, validate it resolves to an active `User` (reuse `IsValidUserRefAsync`)
     and reject (400) `WitnessUserId == dto.ReportedByStaffId` (self-witness); insert
     `IncidentWitness` with `WitnessStatus = Pending, WitnessRequestedAt = UtcNow` when
     `WitnessUserId` is set, else `WitnessStatus = NotRequired`.
   - `Update`: full-replace the `IncidentWitnesses` collection, same pattern as IN-5's injuries —
     **except** a row whose `WitnessStatus` is already `Approved`/`Declined` (i.e. the witness has
     already responded) must not be silently reset to `Pending` by a full replace if the reporter
     re-submits the form without changing that row. Implementation: match incoming rows to
     existing ones by `Id` where the frontend echoes back persisted witness ids for
     already-responded rows (new witnesses added during this edit have no id and are always
     inserted fresh as `Pending`/`NotRequired`); rows dropped from the submitted list are deleted;
     rows matched by id keep their existing `WitnessStatus`/`WitnessRespondedAt`/`StatementText`
     untouched (only `WitnessName` is updatable, matching the medication amend flow's "amending
     only edits the legacy free-text name" convention).
   - `GetById`: `.Include(i => i.Witnesses).ThenInclude(w => w.WitnessUser)`, map to `IncidentDetailDto.Witnesses`.
6. **`backend/Odip.Api/Controllers/PortalController.cs`**:
   - Extend `PortalWitnessRequestDto` and `GetWitnessRequests` as designed above (union query).
   - Add `POST incident-witness-requests/{id:guid}/approve` / `.../decline`, body
     `PortalRespondIncidentWitnessRequestDto(string? StatementText)`, shared handler mirroring
     `RespondToWitnessRequestAsync` but against `_db.IncidentWitnesses`.

Frontend:
7. **New** `frontend/src/pages/incidents/steps/WitnessesStep.tsx` — add-row mini-form + `DataTable`,
   `useFieldArray({ control, name: 'witnesses' })`.
8. **`frontend/src/api/types/portal.ts`** (or wherever `PortalWitnessRequestDto` is typed) — widen
   to the merged shape; add `sourceType: 'Medication' | 'Incident'`.
9. **`frontend/src/api/hooks/portal.ts`** — add `useApproveIncidentWitnessRequest`/
   `useDeclineIncidentWitnessRequest`, same `apiPostRaw` + invalidate-`portal-witness-requests`
   shape as the existing medication hooks, accepting `(id, statementText?)`.
10. **`frontend/src/pages/portal/PortalWitnessApprovalsPage.tsx`** — branch rendering per
    `request.sourceType` (medication card unchanged; new incident card showing title/type/severity/
    participant/reported-by/datetime); Approve/Decline for an incident row open the existing
    `ConfirmDialog` (its `message` prop is already `ReactNode`, so no prop-shape change to
    `ConfirmDialog` itself is needed) with an added optional `<textarea>` for the statement, wired
    to local component state, passed through to whichever mutation fires on confirm. Medication
    rows keep today's exact interaction (immediate Approve, confirm-only Decline, no statement UI
    ever rendered).
11. **`frontend/src/components/layout/AppLayout.tsx`** / **`frontend/src/pages/portal/PortalShiftsPage.tsx`** —
    no logic change; update the imported `PortalWitnessRequestDto` type reference if it was a
    narrower alias anywhere (both already only read `.length`).

### Acceptance
- Adding a staff witness excludes the current `reportedByStaffId` from the picker; attempting to
  submit a nominated witness equal to the reporter is rejected 400 server-side even if the
  frontend exclusion is bypassed.
- A submitted incident with 2 staff witnesses + 1 external witness persists 3 `IncidentWitness`
  rows, the two staff rows `Pending`, the external row `NotRequired`.
- The nominated witness's portal `GET /portal/witness-requests` includes the incident row
  alongside any medication rows, and `AppLayout`'s badge count reflects the combined total (add a
  test asserting the badge count sums both sources).
- Approving an incident witness request with a statement persists `WitnessStatus = Approved`,
  `WitnessRespondedAt` set, `StatementText` populated; approving with no statement leaves
  `StatementText` null. Declining behaves the same with `Declined`.
- A second approve/decline attempt on an already-responded incident witness request 400s
  ("already been responded to"), mirroring the medication endpoint's own guard.
- Editing an incident and re-submitting the Witnesses step without touching an already-`Approved`
  row does NOT reset it to `Pending` (regression test for the Update full-replace-but-preserve-
  responded-rows rule above) — this is the one point in this step most likely to silently regress.
- `dotnet build`/`dotnet test` and `npm run build`/`npm test` clean, no new lint errors.

---

## IN-8 — Preserve the medication + shift-note automated hand-offs

**Branch:** `feat/in08-wizard-prefill-handoffs`

### Current state
**This is not a backend workflow** — discovery §3 is emphatic: no `Incident`/`Medication` FK or
reference exists anywhere server-side; the entire "automated workflow" is a client-side
`navigate(..., { state })` router hand-off, and nothing is persisted until the incident form is
submitted like any other.

Two independent producers, both landing on `IncidentCreatePage`:
1. **MAR prefill** (INC-03) — `RecordAdministrationModal.goToIncident` (`:164-185`) builds a
   `MarIncidentPrefillState` (source, outcome, participant id/name, medication name/strength/dose,
   scheduled/administered timestamps+tz, `recordedByName`/`recordedByUserId`, reason, notes,
   trip instance id) and `navigate('/incidents/new', { state: prefill })`. Consumed by
   `IncidentCreatePage.tsx:244-263` via a `useRef`-guarded `useEffect` calling `reset()` once,
   mapping onto: `serviceType`/`tripInstanceId` (from `marPrefill.tripInstanceId`), `incidentType`
   (hardcoded `'MedicationError'`), `severity` (`suggestedIncidentSeverity(outcome)`), `title`/`description`
   (skeleton builders in `frontend/src/lib/incidentPrefill.ts`), `involvedParticipantId`,
   `reportedByStaffId` (`marPrefill.recordedByUserId` — resolved by id ONLY, never by name; INC-03's
   test coverage specifically guards against a same-name-different-id regression here), `incidentDateTime`.
2. **Shift-note prefill** (NOTES-02) — `ShiftNotesSection.tsx`'s "file an incident report" banner
   builds a `ShiftNoteIncidentPrefillState` and does the same `navigate('/incidents/new', { state })`.
   Consumed by `IncidentCreatePage.tsx:268-286`, mapping onto the same field set except
   `reportedByStaffId` is deliberately left blank (the portal doesn't know who will end up filing
   it) and `incidentType` comes from `suggestedIncidentTypeForShiftNote` (keyword-category-driven)
   rather than a hardcoded value.

Both prefill TYPES/producers live entirely outside this spec's scope (`RecordAdministrationModal.tsx`,
`ShiftNotesSection.tsx`, `frontend/src/lib/incidentPrefill.ts`'s builder functions) and are
UNCHANGED by this item — only the CONSUMING side (inside the incident form) needs to adapt to the
wizard's step structure.

### Design
**Every prefilled field maps onto step 0 (`basics`) or step 2 (`details`) — never step 1
(`restrictivePractice`, since neither producer ever sets `incidentType` to `RestrictivePracticeUse`)
or step 3 (`witnesses`).** Concretely:
- Step 0 fields touched: `involvedParticipantId`, `title`, `reportedByStaffId`, `serviceType`,
  `tripInstanceId`, `incidentType`, `severity`.
- Step 2 fields touched: `description`, `incidentDateTime`.

**Prefilled steps are NOT auto-advanced, merely pre-populated.** The wizard mounts on step 0 as
normal in every case (create, no special-cased "jump to step 2" behaviour). This is a deliberate
simplification, not a gap: because prefill still runs through the exact same single `reset()` call
as today (IN-1's shell-compatibility requirement exists specifically so this needs no new API),
ALL prefilled fields — spanning both step 0 and step 2 — land atomically in one `reset()` before
the user interacts with anything. Clicking Next on step 0 validates against already-populated
required fields (title, reportedByStaffId, incidentType, severity all arrive pre-filled from
either producer), so in practice advancing through the prefilled steps is immediate/frictionless
without the wizard needing any dedicated "skip a filled step" mechanism. This directly answers the
brief's question about what happens when prefill spans multiple steps: **there is no ambiguity to
resolve, because nothing is applied in stages** — one `reset()`, same as today, and the user still
walks Next through each step in order (RP step never appears; Witnesses step is always reached
last and is never prefilled by either producer).

The one interaction change from today: since IN-3 makes `reportedByStaffId` default to the
signed-in user (`usePermissions().id`) on a page with NO prefill, prefill's own explicit value
must keep taking priority for MAR incidents (`marPrefill.recordedByUserId`) — the prefill
`useEffect` already runs `reset()` with an explicit `reportedByStaffId`, which naturally overrides
whatever IN-3's `defaultValues` seeded, since it fires after initial mount. No special-casing
needed here either, just confirm the ordering (prefill effect must not run before, and must not be
clobbered by, IN-3's default-seeding) stays correct once both changes land on the same file.

### Implementation
1. **`frontend/src/pages/IncidentCreatePage.tsx`** (wizard shell instance) — the two existing
   `useEffect`/`useRef`-guard blocks (`:244-263` MAR, `:268-286` shift-note) port unchanged in
   logic; only their location (still top-level in the wizard page component, calling the same
   underlying react-hook-form `reset()`) needs confirming against wherever IN-1's shell places
   the form instance. No new prefill-specific step/visited-set logic is added (see Design above).
2. **No changes** to `frontend/src/pages/medications/RecordAdministrationModal.tsx`,
   `frontend/src/pages/portal/components/ShiftNotesSection.tsx`, or
   `frontend/src/lib/incidentPrefill.ts`'s prefill-state types/builders — call this out explicitly
   in the PR description so a reviewer doesn't go looking for a diff there.
3. Confirm (via test) that `NOTES-02`'s post-submit fire-and-forget
   `apiPost('/portal/notes/{id}/acknowledge-flags')` (`IncidentCreatePage.tsx:345-349`) still fires
   from the wizard's final submit handler — this logic lives in the submit function, not any
   individual step, and must be preserved verbatim (including its error-swallowing behaviour).

### Acceptance
- INC-03's full existing test suite (banner text, field population across what are now two
  different steps, the same-name-different-id regression guard) ported and green, now asserting
  field values after the relevant step is reached rather than on a single page.
- NOTES-02's shift-note prefill test ported the same way, including the post-submit
  acknowledge-flags fire-and-forget behaviour (success and swallowed-failure cases).
- A new test: triggering the MAR prefill, then clicking Next through step 0 without changing
  anything, succeeds (proves the "already valid from prefill" claim above rather than asserting it
  only in prose).
- A new test: triggering MAR prefill when the signed-in user's `usePermissions().id` differs from
  `marPrefill.recordedByUserId` — the FORM shows `recordedByUserId`, never the signed-in user's own
  default (proves prefill wins over IN-3's new default).
- `npm run build` clean, `npm test` green, no new lint errors.

---

## Edit-mode-only fields and the zod resolver workaround

Not a numbered IN item on its own — cross-cutting concerns the brief asked to be covered
explicitly.

**Status / QSC Reporting Status / Review & Compliance section** (`status`, `qscReportingStatus`,
`qscReferenceNumber`, `qscReportedAt`, `reviewedByStaffId`, `reviewNotes`, `correctiveActions`,
`familyNotified(+At)`, `supportCoordinatorNotified(+At)`): these only ever apply when editing an
already-submitted incident — they have no meaning while first reporting one. They become the
`compliance` step (see the Proposed wizard structure table), which is **entirely absent from the
step list on create** (`isEdit === false`) and present as the second-to-last step (right before
Review) when `isEdit === true`. This is the SECOND conditional-step case in this design besides
IN-4's restrictive-practice step, reinforcing why IN-1 requires the shell to support a genuinely
computed step list rather than a fixed one. `status`/`qscReportingStatus` (native `<select>`s
today, `:643,654`) migrate to `Dropdown` `variant="form"` as part of this step's own implementation,
closing out the last 2 of GEN-1's 6 incident-page selects deferred to this spec (the other 4 —
`serviceType`, `tripInstanceId`, `incidentType`, `severity` — are IN-3's).

**The zod v4 / `@hookform/resolvers` v3 hand-rolled resolver workaround carries forward as-is** —
see IN-1's Implementation section. No part of this rewrite should attempt to reintroduce
`zodResolver` or otherwise "fix" this workaround; it is a known, deliberate, cross-file convention
(shared with `ParticipantCreatePage`) that this spec is not in a position to change unilaterally.

---

## Dependency order

1. **`feat/core01-wizard-shell`** lands first — everything below depends on it. IN-1 is a
   requirements input to that branch, not a follow-on to it; ideally IN-1's contract is agreed
   before core01 is implemented, not after.
2. **IN-2** (`ParticipantPicker`) has no dependency on core01 and can land in parallel with it —
   it's a standalone component with a single new consumer (this wizard) wired in once IN-3 lands.
3. **IN-3** (Basics step) depends on core01 + IN-2. It establishes the wizard shell instance inside
   `IncidentCreatePage.tsx` that every other step plugs into — land it first among the step
   branches.
4. **IN-4** (Restrictive Practice step) and **IN-6** (Incident Details base fields) both depend
   only on IN-3 (the shell instance existing) and can land in parallel with each other.
5. **IN-5** (body diagram) depends on IN-6, since it extends the same `details` step file IN-6
   creates — land IN-6 first.
6. **IN-7** (Witnesses step) depends on IN-3 (for `reportedByStaffId`, needed by the self-witness
   exclusion rule) but not on IN-4/IN-5/IN-6 — can land in parallel with those once IN-3 is in.
7. **IN-8** (prefill hand-offs) depends on IN-3 (reporter-default interaction) and IN-6 (the
   `description`/`incidentDateTime` fields it prefills) — land last among the step branches, as a
   final integration/regression pass once every step it prefills into exists.
8. The edit-mode `compliance` step and its 2 remaining dropdown migrations can land any time after
   IN-3 (it needs the shell instance) — no other step depends on it, so it's a safe candidate to
   run in parallel with IN-4 through IN-7 rather than serialised at the end.

Recommended landing sequence: `core01` → `IN-2` (parallel) → `IN-3` → {`IN-4`, `IN-6`, `IN-7`,
`compliance` step} in parallel → `IN-5` (after IN-6) → `IN-8` (last, integration pass) → full
regression of the ported `IncidentCreatePage.test.tsx` suite end to end.
