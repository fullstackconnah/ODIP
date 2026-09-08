# SPEC 02 — Participant Create/Edit Wizard

Source backlog items (verbatim from the user), scope PF-1..PF-10. Discovery evidence:
`discovery/02-participant-form.md`, `discovery/03-participant-tabs.md`. House style follows
`SPEC-01-general.md`.

All line numbers below are against `frontend/src/pages/ParticipantCreatePage.tsx` (3,608 lines,
as of 2026-09-01) unless another file is named.

## Fixed constraints from the orchestrator

- **`feat/core01-wizard-shell`** lands first: a reusable Wizard/Stepper shell in
  `frontend/src/components/wizard/`, providing an ordered steps array, per-step validation
  gating, visited/linear-vs-jump-anywhere modes, and a review step. This spec is written
  **against** that shell — every PF item below assumes `ParticipantCreatePage.tsx`'s inline
  `WIZARD_STEPS`/`stepIndex`/`goToStep`/`visitedSteps`/`handleNext`/`handleBack` machinery
  (`:669-820`, `:1039-1128`) has already been refactored onto it. §"Requirements on core01" below
  is this spec's contribution back to that shell's design.
- **`feat/core02-participant-partial-save`** lands first: a partial-update primitive for
  participants. PF-1 depends entirely on it. §"Requirements on core02" below specifies its shape.
- **PF-10** (intake/profile split) is deferred — see the placeholder section at the end.
- Every control this spec touches or adds uses `Dropdown` / `SearchableSelect`
  (`frontend/src/components/`) — never a raw `<select>`. GEN-1 (SPEC-01) explicitly excluded this
  file's native selects so they land here instead.

## Requirements on core01 (wizard shell)

The participant wizard needs from the shell:
1. **Per-step "Next" validation gating** driven by an externally-supplied schema/validator per
   step index, returning field-level errors keyed by dot/array path (mirrors today's
   `STEP_SCHEMAS[stepIndex].safeParse` + RHF `setError` at `handleNext`, `:1092-1112`) — the shell
   must not hard-code Zod; it needs to accept "validate(stepIndex, values) -> errors" as a prop so
   the 3,608-line schema stays in the participant form, not in the shell.
2. **Jump-anywhere mode keyed on a caller flag**, not just "edit vs create" — today's
   `visitedSteps = isEdit ? all : [0]` (`:1041`) is a participant-specific policy; the shell should
   expose `initialVisited: 'all' | 'linear'` so PF-1's "save from any step" doesn't accidentally
   couple to a wizard-wide edit/create binary the shell owns.
3. **A step-level "extra action" slot** in the nav footer, alongside Back/Next/Submit — today's
   "Save as draft" button is rendered once at `:3571` inside the shared footer; PF-1's new
   per-step "Save changes" button (edit mode) needs the same slot, so the shell must accept an
   array of secondary actions (label, onClick, disabled, pending-label) rather than hard-coding
   exactly one optional draft button.
4. **A review step that groups fields back by originating step** for "Edit ↗" links (today's
   `reviewGroups`/`WIZARD_STEPS[group.step].label` at `:3523-3550`) — the shell's review step
   needs to accept a caller-supplied `(step) => { label, rows }[]` builder, since the "how do I
   summarize a healthConditions array row" logic is participant-specific.

> **OPEN QUESTION:** core01's brief says "a review step" as a shell primitive — confirm whether
> the shell owns the `<dl>` rendering (and this spec only supplies row data) or whether the shell
> only owns navigation/gating and every wizard (participant, incident) still renders its own
> review JSX. This spec's file-by-file steps below assume the latter (lower risk, smaller diff)
> — flag if core01 decided otherwise.

## Requirements on core02 (partial save) — superseded by SPEC-00, kept as a changelog note

CORE-02's authoritative design now lives in `SPEC-00-foundations.md` (`## CORE-02`), written after
this spec's original draft below was compared against SPEC-03 (PD-6/PD-7) and SPEC-05 (PF-10.4)'s
conflicting needs for the same primitive. **Everything this section originally specified is
superseded — do not implement the shape below; it is preserved only so the reasoning that got
corrected is visible.**

**What was wrong with it:** this spec originally proposed `PatchParticipantDto` grouped by wizard
**step** — 9 nested DTOs mirroring `STEP_X_FIELDS` (`Identity`, `NdisFunding`, `KeyIdentifiers`,
`CulturalConsent`, `Support`, `Medical`, `BehaviourCommunication`, `DailyLiving`, `Risks`).
SPEC-00 rejected that shape: SPEC-03's Details-tab wants 12 section-shaped groups, and SPEC-05's
future Profile wizard will redistribute today's 9 steps' fields entirely — a contract shaped like
*today's* steps would be invalidated the moment either lands, forcing a second write path or a
breaking rework of the first one.

**What replaced it:** SPEC-00 defines **20 semantic field groups** (16 scalar + 4 collections —
`consents`, `healthConditions`, `adlAssessments`, `checklistItems`) that wizard steps AND
detail-tab sections both *compose from*; neither defines the groups, and a step or a section can
span more than one group. See SPEC-00's `## CORE-02` for: the full group-to-fields table, the
`PatchParticipantDto` shape (16 nested `PatchXDto` records + 4 collection fields), the atomicity
rule (all-or-nothing per group, not per field), the controller behaviour, the concurrency policy
(last-write-wins per group, deliberately no version/ETag), and the authorisation gate
(`canWriteParticipantDetails`, not the broader `canWrite`).

**This spec's remaining job is the step → groups mapping** — SPEC-00's own "Consumer contract"
section already derives it for SPEC-02 specifically; it is restated, enumerated, and checked for
coverage gaps in PF-1's Implementation section below, since that's what an implementer of *this*
spec needs to copy verbatim.

---

## PF-1 — Save current changes without walking every tab

**Branch:** `feat/pf01-partial-save`
**Depends on:** `feat/core01-wizard-shell`, `feat/core02-participant-partial-save`

### Current state
Edit mode has exactly one write path to the server: the Review step's `<button type="submit">`
(`:3590-3595`), which runs `handleSubmit(onSubmit, handleInvalidSubmit)` — the FULL
`participantSchema` resolver (`:483-491`) against the WHOLE form, then `onSubmit` (`:1607-1638`)
sends the WHOLE `UpdateParticipantDto`. "Save as draft" (`handleSaveDraft`, `:1652-1673`) is
available on every step but is gated to `canSaveDraft = !isEdit || existing?.isDraft === true`
(`:1688`) — **an already-finalized participant (the overwhelmingly common edit case) cannot use it
at all**, by explicit product ruling (INTAKE-08 fix round 1, Finding 1a: "un-finalising is not a
product capability"). So today, editing one field on step 2 of a finalized participant still
requires clicking Next through every remaining step (or using the jump-anywhere step pills) to
reach Review and submit the entire form, and a full-schema validation failure anywhere blocks it.

### Design
Add a **"Save changes"** button, distinct from "Save as draft", available on every step **only in
edit mode and only for an already-finalized (non-draft) participant** — the exact complement of
`canSaveDraft`'s gate, so the two buttons never both render for the same participant/step
combination:
```ts
const canSaveDraft = !isEdit || existing?.isDraft === true          // unchanged
const canSavePartial = isEdit && existing?.isDraft !== true          // new
```
Clicking it:
1. Runs **only the current step's schema** (`STEP_SCHEMAS[stepIndex].safeParse`) — the same
   validator `handleNext` already uses, so "Save changes" never blocks on an unrelated step's
   missing field the way today's full-submit does.
2. On success, builds **one** `PatchParticipantDto` covering every semantic group that step's
   fields decompose into — **1 to 4 groups per step, per CORE-02's group table** (SPEC-00), not
   the 1-group-per-step shape this spec originally assumed (see Implementation §2's
   `STEP_TO_PATCH_GROUPS` mapping below for the exact per-step list). The existing
   `buildPayload(data, false)` machinery already knows how to transform every field (tri-state
   collapse, array upserts, etc.); wrap it so it slices the current step's transformed fields into
   their respective `PatchXDto` groups and calls the new `usePatchParticipant()` hook (`PATCH
   /api/participants/{id}`, CORE-02) **once**, with all of that step's groups in the one request —
   never one PATCH call per group.
3. Shows an inline "Saved" confirmation (small toast/checkmark near the button, 2-3s auto-dismiss)
   and **does not navigate away** — the point is staying on the wizard and continuing to the next
   step, unlike full-submit's `navigate(`/participants/${id}`)`.
4. `reset()` is called with just the freshly-saved step's fields merged into current form state
   (mirrors `flushSync(() => reset(...))`'s dirty-clearing role at `:1620`) so
   `useUnsavedChangesWarning(isDirty)` (`:1690`) doesn't warn about changes that were, in fact,
   just saved.
5. The Contacts step (3) and Risks step's risk-entries block (9) do NOT get a "Save changes"
   button — they already render no editable UI in edit mode at all (`:2452-2460`, `:3452-3460`),
   unchanged by this item; contact-role/risk-entry saves continue through their own nested-CRUD
   tabs.

### Implementation
1. **`frontend/src/api/hooks/participants.ts`**: new `usePatchParticipant()` mutation hook,
   `PATCH /api/participants/{id}` with a `PatchParticipantDto`-shaped body, same
   invalidate-queries-on-success pattern as `useUpdateParticipant` (`:55-65`).
2. **`ParticipantCreatePage.tsx`**:
   - New `canSavePartial` flag (`:1688` vicinity, next to `canSaveDraft`).
   - New `STEP_TO_PATCH_GROUPS: Record<number, (keyof PatchParticipantDto)[]>` — **an array per
     step, not one group per step.** This is the CORE-02 correction (SPEC-00): a wizard step
     composes from 1-4 semantic groups, never exactly 1, because the groups are shared with
     SPEC-03's detail-tab sections and SPEC-05's future Profile wizard, neither of which cuts the
     fields along today's step boundaries. Enumerated exactly per SPEC-00's own "Consumer
     contract" section for SPEC-02 (`SPEC-00-foundations.md`, CORE-02) — copy verbatim, do not
     re-derive:
     ```ts
     const STEP_TO_PATCH_GROUPS: Partial<Record<number, (keyof PatchParticipantDto)[]>> = {
       0: ['personalDetails', 'preferredStaff', 'address', 'livingArrangement'],
       1: ['ndisPlan', 'serviceProfile'],
       2: ['keyIdentifiers'],
       // 3 (Contacts) intentionally absent — no patchable group, see Design point 5.
       4: ['culturalBackground', 'consents'],
       5: ['supportNeedsMobility', 'checklistItems'],
       6: ['medical', 'healthConditions'],
       7: ['behaviourCommunication', 'communityAccessBehaviour', 'checklistItems'],
       8: ['adlAssessments', 'mealsAndDiet', 'aboutMe', 'supportsLookLike'],
       9: ['risksHazardsSummary'],
       // 10 (Review) intentionally absent — no fields of its own.
     }
     ```
   - **Coverage check — done, no gaps found.** Team-lead flagged this as the concrete risk: if a
     step's fields didn't fully cover every field of the group(s) it patches, saving that step
     would null out the group's other fields (the group's atomicity rule is all-or-nothing —
     SPEC-00's `PatchXDto` carries every member field, not just the ones a caller happened to
     touch). Checked every group's member-field list (SPEC-00's group table) against the matching
     `STEP_X_FIELDS` constant it maps to — `STEP_IDENTITY_FIELDS` (`:669`), `STEP_NDIS_FIELDS`
     (`:679`), `STEP_KEY_IDENTIFIERS_FIELDS` (`:683`), `STEP_CULTURAL_CONSENT_FIELDS` (`:696`),
     `STEP_SUPPORT_FIELDS` (`:712`), `STEP_MEDICAL_FIELDS` (`:730`),
     `STEP_BEHAVIOUR_COMMUNICATION_FIELDS` (`:740`), `STEP_DAILY_LIVING_FIELDS` (`:753`),
     `STEP_RISK_FIELDS` (`:762`) — **every group's fields are a strict subset of its step's own
     field list, for all 9 patchable steps.** No step patches a group whose fields it doesn't
     fully render; there is no data-loss gap to fix here.
   - **Correction (verified against the actual controller code, not assumed):** `checklistItems`
     is a single flat 21-row collection split **by row, not by field**, across step 5 (rows 0-8,
     Community Mobility & Transport Risk) and step 7 (rows 9-20, Community Behaviours of Concern) —
     both steps' `STEP_TO_PATCH_GROUPS` entries include it. **The handler must send ONLY the item
     types the saving step owns — never the full 21-row array.**
     `UpsertChecklistItemsAsync` (`ParticipantsController.cs:163-181`, and the identical pattern in
     `UpsertConsentsAsync`/`UpsertHealthConditionsAsync`/`UpsertAdlAssessmentsAsync`) upserts **by
     type key, iterating only the incoming list** — an item type absent from the submitted array is
     never touched, not cleared, not deleted (proven by
     `Update_ChecklistItemsPartialPayload_LeavesOmittedPreviouslySetItemUntouched`,
     `Odip.Tests/Controllers/ParticipantsControllerCommunityAccessTests.cs:107`). So step 5 sends
     only rows 0-8's types, step 7 sends only rows 9-20's — each step already only ever *has*
     answers for its own rows in its own rendered UI, so this is simply "send what you have," no
     merging or full-array reconstruction required.
     **The behaviour that must NOT be confused with this:** a type **present** in the array with
     null `Value`/`Notes` is not skipped — it falls through to `ApplyAnswer` and clears/overwrites
     the existing row (the skip-on-no-existing-row-and-no-answer guard only prevents a *new* blank
     row from being created; it does not protect an *existing* row from being nulled once its type
     is present in the payload). So the earlier instruction in this section to "resend the full
     21-row array" was itself the dangerous option: sending all 21 types with nulls for the 12-13
     rows the saving step doesn't own would have wiped the other step's answers. Omitting them
     entirely is what leaves them alone. Every other collection (`consents`, `healthConditions`,
     `adlAssessments`) is fully contained within one step already, so this omitted-vs-present-null
     distinction never arises for them in practice — but the same two behaviours apply if a future
     caller ever needs to update a subset of any of these four collections.
   - New `handleSavePartial` function (sibling to `handleSaveDraft`, `:1652-1673`): validate current
     step via `STEP_SCHEMAS[stepIndex]`, on success build one `PatchParticipantDto` populating
     every group listed in `STEP_TO_PATCH_GROUPS[stepIndex]` from `buildPayload`'s transformed
     output (per the coverage check above, that output already has everything each scalar group
     needs). **Exception, per the correction above:** when the current step's groups include
     `checklistItems`, filter `buildPayload`'s full 21-row `checklistItems` array down to only the
     item types this step owns (`COMMUNITY_MOBILITY_RISK_ITEM_TYPES` for step 5,
     `COMMUNITY_BEHAVIOUR_OF_CONCERN_ITEM_TYPES` for step 7 — both already exist, per discovery
     §1's reference to `ParticipantCreatePage.tsx`'s checklist-type constants) before attaching it
     to the patch DTO — never pass the full array through unfiltered. Call
     `patchParticipant.mutateAsync` **once** with all of a step's groups together.
   - Render the new button in the shared nav footer (`:3571` vicinity) beside "Save as draft",
     gated on `canSavePartial && STEP_TO_PATCH_GROUPS[stepIndex] !== undefined`.
3. **`frontend/src/api/types/participant-patch.ts`** (new — this is CORE-02's own deliverable,
   per SPEC-00's Implementation §4; PF-1 consumes it, it does not define it): TypeScript types
   mirroring SPEC-00's 20 groups (16 scalar interfaces + the 4 collection fields, reusing existing
   item types). Do not duplicate these under `participants.ts`.

### Acceptance
- Editing only step 5 (Support Needs & Mobility) of a finalized participant and clicking "Save
  changes" sends **one** PATCH containing both its groups (`supportNeedsMobility` AND
  `checklistItems`, the latter carrying only rows 0-8's item types) together (verified via a
  re-fetch/GET), does not require any other step's required fields to be valid, and does not
  navigate off the wizard.
- Saving step 5 (sending only its own 9 item types) leaves step 7's half of `checklistItems`
  (rows 9-20) unchanged, and saving step 7 (sending only its own 12 item types) leaves step 5's
  half (rows 0-8) unchanged — because each step's payload simply omits the other's types, not
  because anything was resent. Test both directions explicitly.
- A `checklistItems` payload that includes a row from the OTHER step's range with a null
  `value`/`notes` — i.e. present-but-null, not omitted — DOES clear that row's existing answer.
  This is a distinct case from the one above and must be pinned by its own test, so the
  omitted-vs-present-null distinction can't silently regress: "omit it" is safe, "include it with
  nulls" is not.
- A step whose `STEP_TO_PATCH_GROUPS` entry has 2+ groups (e.g. step 0's four groups) sends them
  in a single PATCH request, not one request per group.
- The button never renders for a draft participant (where "Save as draft" already covers this) or
  in create mode (no id to PATCH yet).
- `useUnsavedChangesWarning` doesn't fire immediately after a successful "Save changes" for the
  fields that were just saved.
- New tests: `ParticipantCreatePage.test.tsx` — "Save changes" visible only when
  `isEdit && !existing.isDraft`; clicking it with an invalid OTHER step's data still succeeds;
  clicking it with an invalid CURRENT step's data blocks with the same per-field errors `handleNext`
  would show; the three `checklistItems` cases above (step 5 omits step 7's types and vice versa,
  plus the present-with-null-clears case).

---

## PF-2 — Plan-type-conditional required fields

**Branch:** `feat/pf02-plan-type-requirements`
**Depends on:** `fix/wizard-registered-provider-flag` only (see below). No longer depends on PF-5
— see the Dependency-order note at the end of this section for why.

### Current state
`PlanType` (`SelfManaged | PlanManaged | AgencyManaged`, `backend/Odip.Domain/Enums/Enums.cs:3-8`)
today drives **zero** participant-level field requirements — the Plan Type `Dropdown` at
`:2298-2317` has no companion conditional-visibility or required-field logic at all (unlike
`FundingSource`'s `Other → fundingOrganisation` gate, FUND-02). The *only* PlanType-conditional
rule anywhere in the codebase lives one layer down, on **contact roles**, in
`ContactRoleRules.Validate` (`backend/Odip.Domain/Enums/ContactRoles.cs:113-127`):
```csharp
if (roleType == ContactRoleType.PlanManager && participantPlanType != PlanType.PlanManaged)
    return "Plan Manager contacts are only available for plan-managed participants.";
if (roleType == ContactRoleType.ProviderContact
    && participantPlanType == PlanType.AgencyManaged
    && registeredProviderFlag != true)
    return "Agency-managed participants can only record registered-provider contacts.";
```
Both are **availability/consistency gates on a role IF one is added**, not "this plan type
requires that a matching contact exist" — there's no check today that an Agency-managed
participant has *any* `ProviderContact` row, or that a Plan-managed one has *any* `PlanManager`
row. `Participant.PlanManagerContactId` (`Participant.cs:186-187`) is a **legacy**, unrelated FK
into the old `Contact` entity, absent from `CreateParticipantDto` entirely (confirmed: zero
matches for `PlanManagerContact` across `DTOs.cs`) — it is not a live candidate for "agency
details".

**A separate, already-scheduled fix removes a related bug ahead of this item:**
`fix/wizard-registered-provider-flag` (landing ahead of everything in this spec) corrects
`buildPayload`'s hard-coded `registeredProviderFlag: null` for every contact row it submits
(`:1522`+) — before that fix, selecting AgencyManaged and adding a ProviderContact via the
wizard's Contacts step always failed `ContactRoleRules.Validate` server-side, since the wizard
could never send `true`. PF-2 is written **against the corrected behaviour** — it assumes a
ProviderContact row's `RegisteredProviderFlag` reaches the server as whatever value was actually
set, not a hard-coded `null`. This spec does not re-describe or re-fix that bug; see the fix
branch for its own scope.

### Design — product decision: warn, never block, in both create and edit

> **Product owner decision (overrides this spec's original recommendation of hard-block-on-create
> / soft-warning-on-edit):** plan-type↔contact-role consistency is **advisory only, in both
> directions**. Neither `POST /api/participants` nor `PUT`/`PATCH /api/participants/{id}` ever
> rejects a save because a Plan Manager or registered provider contact is missing. The rule still
> exists and still evaluates on every read/write — it simply never surfaces as a blocking
> validation error, only as a warning the UI displays.

| PlanType | Advisory condition |
|---|---|
| `SelfManaged` | None (no candidate field exists in the entity/DTOs for this branch). |
| `PlanManaged` | Warn if there is no **active** `ParticipantContactRole` row with `RoleType = PlanManager`. |
| `AgencyManaged` | Warn if there is no **active** `ParticipantContactRole` row with `RoleType = ProviderContact` AND `RegisteredProviderFlag = true` — "agency details" *are* `ProviderContact`'s existing `OrganisationName`/`RoleTitle`/`RegistrationNumber`/`RegisteredProviderFlag` fields (`ParticipantContactRole.cs`); no new entity/columns needed. |

**This is a materially simpler design than the blocking version**, because warn-only removes the
create-vs-edit asymmetry entirely: both modes can compute the SAME advisory value from the SAME
source — the participant's persisted, active `ContactRoles` — rather than create checking the
submitted DTO and edit checking something else. Concretely:
- Create's transactional `ContactRoles` rows are inserted first (unchanged, existing behaviour),
  then the response is built from what actually landed in the database — not from the submitted
  DTO — so a row that failed some other validation and never persisted can't produce a false
  "satisfied" reading.
- Edit already has no `contactRoles` in its payload (`:1616-1617`) and never did — nothing changes
  there; the advisory value is computed from the participant's live `ContactRoles` navigation
  exactly as it would be for create's post-save read.

**Backend behaviour, precisely:**
1. New pure function `ContactRoleRules.PlanTypeComplianceWarning(PlanType planType, IEnumerable<(ContactRoleType RoleType, bool? RegisteredProviderFlag, ContactRoleStatus Status)> activeRoles) : string?`
   in `backend/Odip.Domain/Enums/ContactRoles.cs`, beside `Validate`/`ValidateUniqueness` — same
   file, same style, returns a human-readable warning string or `null`, **never thrown, never a
   validation error**.
2. New computed field `PlanTypeComplianceWarning: string?` on `ParticipantDetailDto`
   (`DTOs.cs:38`+) — populated wherever that DTO is built from a `Participant` entity (its
   `GetById`, and the response bodies of `Create`/`Update`/the new `Patch` from core02 — confirm
   the exact mapping location(s) at implementation time), by loading the participant's active
   `ContactRoles` and calling the new function.
3. **No new validator is called from `Create`, `Update`, or `Patch`'s request-handling path.**
   `ValidatePlanType` as a *blocking* method (as originally specified) is **removed from this
   design** — it never existed in the codebase and this revision does not add it. The only
   server-side code this item adds is the pure warning function above plus the DTO field/mapping
   to expose it.
4. **No narrow case where the server still rejects.** The one rule that keeps hard-blocking is the
   pre-existing, unrelated `ContactRoleRules.Validate` check ("Agency-managed participants can only
   record registered-provider contacts") — that rule answers a different question ("is the role
   row you're adding *valid*"), not PF-2's question ("does a matching role row *exist at all*"),
   and the product decision above only concerns the latter. It is untouched by this item and
   continues to reject an AgencyManaged `ProviderContact` row submitted with
   `RegisteredProviderFlag` false/unset, exactly as it does today.

**Frontend behaviour — concrete UI, so nothing is left to guess:**
1. **Where it renders**: a warning banner (same visual treatment as the existing draft banner on
   `ParticipantDetailPage.tsx`, amber/warning-container styling) in three places, all reading the
   SAME computed value so they can never disagree:
   - The wizard's **NDIS & Funding step** (`:2267-2391`), directly under the Plan Type field.
   - The wizard's **Contacts step** card (`:2449-2587` in create mode, and the link-only card at
     `:2452-2460` in edit mode, or its PF-4 replacement once that lands).
   - The **Review step**'s NDIS & Funding and Contacts summary groups (`reviewGroups`,
     `:3523-3550`) — Review is just another rendering of the same underlying data, so it shows the
     identical banner text rather than a differently-worded summary.
2. **Source of the value, per mode**:
   - **Edit**: `existing.planTypeComplianceWarning`, straight from the `GET`/`Update`/`Patch`
     response (backend-computed, per above) — no client-side reimplementation of the rule.
   - **Create**: computed **client-side**, live, via a new `planTypeComplianceWarning(planType,
     contactRoles)` helper in `frontend/src/api/types/contacts.ts` (mirrors
     `contactRoleGateError`'s existing mirrored-logic pattern in that same file) evaluated against
     the in-progress `contactRoles` field array with `useWatch` — there is nothing to fetch from
     the server yet since the participant doesn't exist until submit. Once created, the very next
     read of the participant (the post-create navigation to the detail page, or reopening it for
     edit) switches over to the backend-computed value, so the two sources are consistent at every
     point where either is actually available.
3. **Step-nav indicator**: yes — the NDIS & Funding and Contacts step pills in the wizard's stepper
   show a small warning dot/icon when their respective condition is unmet, so a coordinator
   clicking straight to Review doesn't miss it. This needs core01 to expose a per-step
   "has-warning" flag on the stepper (a step can carry a boolean/severity in addition to its
   validation-error state); if core01's contract doesn't yet include this, treat it as an
   additive, non-blocking ask on that shell — the two banners above satisfy the requirement on
   their own even without a stepper indicator.
4. **Reappears on Review**: yes (see point 1) — Review is not a "final gate" for this rule the way
   it is for a blocking Zod refine; it's just another place the same warning renders.
5. **Persists after save**: yes, deliberately — the underlying condition (no matching contact
   role exists) doesn't change just because a save succeeded, so the banner is not dismissed or
   suppressed by a successful submit/PATCH. It clears only when the condition is actually resolved
   (a qualifying contact role is added via the Contacts tab, PF-4's inline add, or PF-5/PF-6's
   flow) and the participant is re-fetched. There is no "dismiss" affordance — this is a data-
   completeness signal, not a transient toast.

### Implementation
1. **`backend/Odip.Domain/Enums/ContactRoles.cs`**: new
   `ContactRoleRules.PlanTypeComplianceWarning(...)` pure function, per the Design section.
2. **`backend/Odip.Application/DTOs/DTOs.cs`**: add `PlanTypeComplianceWarning: string? { get; init; }`
   to `ParticipantDetailDto`.
3. **`backend/Odip.Api/Controllers/ParticipantsController.cs`**: populate the new field wherever
   `ParticipantDetailDto` is built from a `Participant` (confirm exact call sites at
   implementation time — at minimum `GetById`, `Create`'s response, `Update`'s response, and
   core02's new `Patch`'s response). No change to any `ValidateX`/gating method — this item adds
   no new call in the request-validation path.
4. **`frontend/src/api/types/participants.ts`** (or wherever `ParticipantDetailDto`'s TS type
   lives): add `planTypeComplianceWarning: string | null`.
5. **`frontend/src/api/types/contacts.ts`**: new `planTypeComplianceWarning(planType, contactRoles)`
   client-side mirror, for create-mode's live (pre-save) computation.
6. **`ParticipantCreatePage.tsx`**: banner JSX in the NDIS & Funding step, the Contacts step card
   (both modes), and the Review step's relevant summary groups; wire the per-step stepper
   indicator if core01 supports it (see Design point 3).
7. **`backend/Odip.Tests/Controllers/ParticipantsControllerTests.cs`** (or a new
   `ContactRoleRulesTests.cs` case set): `PlanTypeComplianceWarning` returns the expected message
   for each PlanType/role combination and `null` when satisfied; a `Create`/`Update`/`Patch` call
   that leaves the condition unmet still returns 200/201 (the actual regression this decision
   guards against).
8. **`frontend/src/pages/ParticipantCreatePage.test.tsx`**: banner renders/doesn't render per mode
   and per PlanType/contactRoles combination; a create submission with the condition unmet
   succeeds (no blocked submit); the banner persists across a "Save changes"/full-submit round
   trip (re-fetch still shows it when still unmet).

### Acceptance
- Creating an AgencyManaged participant with no ProviderContact, or a PlanManaged participant with
  no PlanManager, **succeeds** — the response includes a non-null `planTypeComplianceWarning`.
- The existing `ContactRoleRules.Validate` rejection (AgencyManaged + an unregistered
  ProviderContact row) still fires exactly as today — unaffected by this item.
- Editing an already-finalized participant with the condition unmet shows the same warning text in
  all three places (NDIS & Funding step, Contacts step, Review), and PF-1's "Save changes" on any
  other step still succeeds.
- The warning is still present after a successful save/reload, until a qualifying contact role
  actually exists.
- `dotnet build`/`dotnet test`, `npm run build`/`npm test` all clean.

**Dependency-order note:** because this item never blocks a save, it no longer needs PF-5's
per-role field-surfacing to be "satisfiable" — an unmet condition just means the warning persists,
which is correct, not broken. PF-2 now depends only on `fix/wizard-registered-provider-flag`
(external, landing ahead of everything) and can land independently and early — see the revised
Dependency order at the end of this document.

---

## PF-3 — Preferred staff member ↔ rostering compatibility

**Branch:** none — **verification only, no code change**.

### Verdict: already fully implemented, bidirectionally, today.

Discovery (§5) traced the complete path and it holds up on independent read of the same files:
- `ParticipantsController.Create`/`Update` call
  `StaffCompatibilityLinkService.SyncFromParticipantPreferredStaffAsync` on every save
  (`ParticipantsController.cs:766` create, `:941` update), passing the participant's
  `PreferredUserId` before/after values.
- `StaffCompatibilityLinkService.cs` (135 lines, read in full): picking a preferred staff member
  auto-creates/refreshes a `Preferred`-level `StaffParticipantCompatibility` row
  (`AutoLinked = true`); changing away from a staff member removes that row **only if still
  `AutoLinked`** — a human's explicit Allowed/Excluded judgement in the matrix is never
  overwritten. The reverse direction (`SyncFromCompatibilityUpsertAsync`, called from
  `RosteringController.UpsertCompatibility`) fills an *empty* `PreferredUserId` when a matrix cell
  is marked Preferred, and clears it if that exact pair is moved off Preferred.
- `frontend/src/pages/rostering/CompatibilityPage.tsx` (read in full) renders exactly this data —
  `useCompatibilityMatrix` reads the same `StaffParticipantCompatibility` rows the sync service
  writes, with no separate/stale cache path.
- A draft participant's preferred-staff pick is deliberately excluded (`isDraft` param skips row
  creation) — consistent with drafts being excluded from every other rostering surface.

**No gap exists.** This item reduces to a manual verification pass:
1. Open a non-draft participant's edit wizard → Identity step → set "Preferred Staff Member" to a
   staff member with no existing compatibility row for this participant → save.
2. Open Rostering → Staff–Participant Compatibility → confirm that cell now reads **Preferred**.
3. On the participant, change "Preferred Staff Member" to a different staff member → save.
4. Confirm the *old* staff member's cell reverts to Allowed (blank) and the *new* one shows
   Preferred.
5. In the Compatibility matrix, manually mark a staff/participant pair **Excluded** with a reason.
   Go set that same participant's Preferred Staff Member to that staff member in the wizard, save.
   Confirm the matrix cell **stays Excluded** (the human judgement is not overwritten) — this is
   the one behaviour most worth a deliberate regression check, since it's the one a naive
   "just sync it" reimplementation would get wrong.

### Acceptance
- All 5 steps above observed exactly as described, on the deployed/dev environment. No
  code/test changes — `backend/Odip.Tests/Rostering/StaffCompatibilityLinkServiceTests.cs` already
  covers this at the unit level per discovery §6.

---

## PF-4 — Add contacts from the edit screen

**Branch:** `feat/pf04-edit-add-contacts`

### Current state
Edit mode's Contacts step (stepIndex 3) renders no editor — just a link to the detail page's
Contacts tab (`:2452-2460`):
```tsx
{isEdit ? (
  <Card title="Contacts" className="space-y-3">
    <p className="text-sm text-[var(--color-muted-foreground)]">
      Contacts are managed from the{' '}
      <Link to={`/participants/${id}?tab=contacts`} className="...">Contacts tab</Link>{' '}
      on this participant's detail page.
    </p>
  </Card>
) : ( /* full add-row UI, create-mode only */ )}
```
This is a deliberate, documented design choice (create-time contact rows are transactional with
the new participant via `CreateParticipantDto.ContactRoles`; post-creation, contacts go through
`ParticipantContactRolesController`'s nested CRUD, already used by `ContactsTab.tsx`) — **not a
bug**, but the user's ask is explicitly "add contacts from the edit screen as well as the contacts
tab", i.e., a second entry point into the same nested-CRUD flow, not a return to the create-mode
transactional shape.

### Design
Replace the link-only card with an inline **"Add contact"** affordance that opens the exact same
add-contact form `ContactsTab.tsx` already renders in its own modal — reused as a shared
component, not duplicated:
1. Extract `ContactsTab.tsx`'s add/edit contact form (person picker or new-person fields + role
   type + role-specific fields via `CONTACT_ROLE_FIELD_MAP`) into a standalone
   `AddContactRoleForm` component, parameterized by `participantId`, `onSaved`, `onCancel`.
   `ContactsTab.tsx` renders it inside its existing modal, unchanged behaviourally.
2. The wizard's edit-mode Contacts card renders the same `AddContactRoleForm` (in a `Modal` or
   inline expand — inline expand fits this step's card-per-row layout better, matching how the
   Cultural & Consent / Health Conditions grids already expand a sub-block per row rather than
   opening a dialog) below the "Contacts are managed from the Contacts tab" text, which stays as
   context, not replaced.
3. Submitting calls the existing `useCreateParticipantContactRole` mutation
   (`ParticipantContactRolesController`'s `POST` — already used by `ContactsTab.tsx`), **not**
   a wizard-form-state array — this keeps PF-4 fully inside the existing nested-CRUD write path,
   with zero change to `buildPayload`/`onSubmit`/`CreateParticipantDto.ContactRoles`
   (still create-mode-only, per discovery §1/§4's precedent for that array).
4. On success, invalidate the participant query (`useUpdateParticipant`'s existing
   `qc.invalidateQueries({ queryKey: ['participant', id] })` pattern) so `existing.contactRoles`
   refreshes — the wizard reads that same query, so a newly-added contact is immediately visible
   without navigating to the detail page.
5. Existing contact rows for this participant render read-only underneath the add form (name,
   role, primary flag) with an "Edit ↗ / Remove" link out to the Contacts tab — matching the
   read-mostly, edit-elsewhere pattern the Restrictive Practices/Routines tabs already use for
   anything beyond their own primary CRUD action.

### Implementation
1. **New**: `frontend/src/components/contacts/AddContactRoleForm.tsx` — extracted from
   `ContactsTab.tsx`'s existing modal body (identify the exact JSX range during implementation;
   `ContactsTab.tsx` is not in this spec's read set, confirm via `ContactsTab.test.tsx` for the
   exact prop/field contract before extracting).
2. **`frontend/src/pages/participant-detail/ContactsTab.tsx`**: replace its inline form with
   `<AddContactRoleForm participantId={id} onSaved={...} onCancel={...} />` inside its existing
   modal — behaviour-preserving refactor, covered by the existing `ContactsTab.test.tsx`.
3. **`ParticipantCreatePage.tsx`** (`:2452-2460` region): replace the link-only card with the
   "existing contacts read-only list + Add contact (expands `AddContactRoleForm`)" card described
   above. Uses `existing.contactRoles` (already fetched by `useParticipant(id)`).
4. **New test**: `frontend/src/pages/ParticipantCreatePage.test.tsx` — edit mode's Contacts step
   renders existing contacts, "Add contact" expands the form, submitting calls
   `useCreateParticipantContactRole` and the new row appears without a page navigation.
5. **Updated test**: `ContactsTab.test.tsx` — assert it still behaves identically after the
   extraction (no new failures from the refactor).

### Acceptance
- From the edit wizard's Contacts step, a coordinator can add a new contact role (existing or new
  person) without leaving the wizard or losing in-progress edits on other steps.
- The same role-type gating (`contactRoleGateError`/`availableContactRoleTypes`) applies here as on
  the Contacts tab — no duplicated, potentially-drifting gating logic.
- `ContactsTab.tsx`'s own tests still pass unmodified in behaviour after the extraction.
- `npm run build`/`npm test` clean.

---

## PF-5 + PF-6 — Multi-role contacts, and person-matching on add

**Branch:** `feat/pf05-06-contact-roles-and-matching`
**Depends on:** none directly; land after/with PF-4 (shares the extracted `AddContactRoleForm`).
No longer sequenced relative to PF-2 — PF-2's plan-type check is now warn-only (product decision)
and no longer needs this item's field-surfacing to be satisfiable; see PF-2's Design section.

These two are one design problem — PF-5 asks for multi-role selection per person, PF-6 asks for
matching that person against existing contacts on add — so they're specified together.

### Current state
- **Data model (hard constraint, not negotiable in this spec):** `Person` ↔ `Participant` is
  many-to-many via `ParticipantContactRole` join rows (`ParticipantContactRole.cs`); `RoleType` is
  a **single** `ContactRoleType` enum column per join row (14 values, `ContactRoles.cs:24-38`).
  "A person with multiple roles" is, and must remain, **multiple join rows sharing one `PersonId`**
  — never a multi-select column on one row.
- **Wizard UI today** (`:2449-2587`, create-mode only): one row per contact, `ToggleGroup` for
  Existing/New person, `SearchableSelect` over `usePersons()` for existing, plain text
  First/Last name for new, single-select `Dropdown` for `RoleType` (`:2540-2551`). No search-as-
  you-type matching against existing people when typing a *new* person's name — the existing/new
  choice is an upfront toggle, not a live search.
- **Per-role field visibility already has an authoritative, dual-implemented source** —
  `CONTACT_ROLE_FIELD_MAP` (`frontend/src/api/types/contacts.ts:216`+, e.g.
  `Guardian: ['appointingTribunal', 'orderScopeDomains', 'orderStartDate', 'orderReviewDate', 'orderEndDate']`)
  mirrors backend `ContactRoleFieldRules.RelevantFields`
  (`backend/Odip.Domain/Enums/ContactRoles.cs`, the `Dictionary<ContactRoleType, HashSet<string>>`
  near the bottom of that file) — kept in sync **by hand**, no shared codegen, per that class's own
  doc comment. This is exactly the union-rule building block PF-5 needs; it is NOT currently used
  by the wizard's Contacts step at all (only the create-mode row shows Role/Relationship/Primary —
  no role-specific fields render there today; `ContactsTab.tsx`'s modal is the only place
  `CONTACT_ROLE_FIELD_MAP` actually drives rendering, per discovery — confirm this at
  implementation time since `ContactsTab.tsx` itself wasn't in this spec's read set).
- **Person search already exists server-side**: `GET /api/persons?search=` matches
  `FirstName + " " + LastName`, `Organisation`, `Email` via SQL `Contains`
  (`backend/Odip.Api/Controllers/PersonsController.cs:36-42`), wired to `usePersons(search)`
  (`frontend/src/api/hooks/persons.ts:7`). `PersonDto` already returns `Phone`, `DateOfBirth`,
  `ActiveRoleCount` for display.

### Design — PF-5: multi-select roles fan out to N join rows
On the (now-shared, see PF-4) `AddContactRoleForm`:
1. Replace the single-select Role Type `Dropdown` with a **multi-select** control (a
   `Dropdown`-family multi-select variant, or a checkbox group styled like the Service Streams
   picker at `:2341-2384` if no multi-select `Dropdown` variant exists — confirm which exists in
   `components/Dropdown.tsx` before choosing; do not build a bespoke third pattern).
2. On submit, one `CreateParticipantContactRoleDto`/`POST .../contact-roles` call is made **per
   selected role**, sharing the same `PersonId` (or the same newly-created `Person`, created once
   then reused for the remaining role POSTs — see implementation note below), each carrying only
   that role's fields.
3. **Field union rule**: while roles are being selected (before submit), the form renders the
   **union** of `CONTACT_ROLE_FIELD_MAP[role]` across every currently-selected role, each
   role-specific field labelled with which role(s) it belongs to when more than one role shares a
   generically-named field slot (e.g. `OrganisationName` appears in `SupportCoordinator`,
   `PlanManager`, `Gp`, `Specialist`, `Pharmacy`, `ProviderContact`, `Advocate`, `Interpreter`,
   `Solicitor`'s sets — shown once, not 9 times, since it's genuinely one value shared across the
   person's roles at this org... but see the OPEN QUESTION below, this is a judgment call). Fields
   unique to one selected role are grouped under a small heading naming that role (e.g. "Guardian
   details: Appointing Tribunal, Order Scope, …").
4. **On edit, removing a role**: the corresponding `ParticipantContactRole` row is deleted via
   `DELETE /api/participants/contact-roles/{id}` (existing endpoint) — never soft-cleared — since
   CONTACT-03's model is "one row per role"; a removed role has no row to retain. If it was the
   only role for that person on this participant, the person disappears from this participant's
   contact list (the underlying `Person` record itself is untouched — they may hold roles for
   other participants). Adding a role back later creates a fresh row (new `Id`), not a resurrection
   of the deleted one — no soft-delete/undo semantics exist on `ParticipantContactRole` today
   (`ContactRoleStatus` has `Expired`/`Superseded`, not `Deleted` — a genuinely removed row is a
   hard delete per the existing `DELETE` endpoint's behaviour, unchanged by this spec).
5. `ContactRoleRules.ValidateUniqueness`'s existing per-role-type limits (e.g. "max one active
   PlanManager") apply per role independently — selecting `[Guardian, PlanManager]` for one person
   validates each against the participant's OTHER roles exactly as today's single-role add already
   does, just run twice (once per selected role) instead of once.

> **OPEN QUESTION:** shared-slot fields (OrganisationName, RegistrationNumber, ScopeNotes,
> AuthorisationDocumentReference — each listed under 2+ role types in `RelevantFields`) are columns
> on the SAME `ParticipantContactRole` row, so when a person has 2 roles they are **2 separate rows
> with 2 separate values for the same-named column** — e.g. a person who is both `PlanManager` and
> `Specialist` for one participant has one row with its own `OrganisationName` and another row with
> its own, independently-set `OrganisationName`. Confirm whether the UI should visually imply "one
> shared value" (a single input feeding both rows' POST bodies) or "independent per-role values"
> (the technically-accurate but more tedious-to-fill option, matching the data model exactly). This
> spec defaults to **independent per-role values** — it matches the schema with no surprise, and
> avoids a wizard-side "which one wins" question the data model doesn't answer — but flags it since
> it's more form-filling than a shared-value UI would be.

### Design — PF-6: merge existing/new person tabs into a search-first flow
Replace the upfront `ToggleGroup` (existing vs. new person) with a single **name field that
searches as you type**:
1. Typing in the name field debounces (~300ms) a call to the existing `usePersons(search)` hook —
   **no new backend endpoint**; the existing `GET /api/persons?search=` (name/org/email substring
   match) is reused verbatim, since discovery confirms it's already wired to a working hook.
   **Recommendation and justification**: build on this existing, working, tenant-scoped endpoint
   rather than adding a second one — the only gap is that it doesn't also match on phone/DOB, and
   the fix for that is additive (see step 3), not a rewrite.
2. Results render inline below the name field as selectable cards: full name, phone (if any), DOB
   (if any), organisation (if any), and `ActiveRoleCount` (already on `PersonDto`) as an
   "already a contact for N other participant(s)" hint — enough for a coordinator to visually
   disambiguate two "John Smith"s without a fuzzy-matching algorithm. Selecting a card sets
   `personId` and fills read-only preview fields (mirrors the existing "existing person" branch's
   `SearchableSelect`, `:2494-2513`, just triggered by typing instead of an explicit toggle).
3. An explicit **"None of these — create new"** action (button, not an auto-fallback) always
   sits below the results (or in the empty-results state) — switches the field into "new person"
   mode: First/Last name (pre-filled from whatever was typed) plus the rest of `CreatePersonDto`'s
   optional fields (phone, mobile, email, address, organisation, DOB) so a genuinely new person can
   be captured with more than just a name on first add, closing a small existing gap (today's
   create-mode "new person" branch only captures First/Last name, `:2515-2529`).
4. **Match criteria — name substring (existing server behaviour) is the primary signal, displayed
   with phone/DOB as secondary, human-verified disambiguators** — no automated "these are probably
   the same person" scoring. Rationale: this codebase has no fuzzy-name-matching library, and
   guessing wrong (auto-merging two different people, or missing a genuine duplicate because a
   nickname doesn't substring-match a legal name) is worse than a coordinator visually confirming
   from a short list. If DOB/phone matching should also narrow the *query* (not just the display),
   that needs a `PersonsController.GetAll` query-param addition (`?phone=`/`?dob=`) — flagged as
   optional, additive, out of this spec's minimum scope.
5. This search-first flow lands in the same shared `AddContactRoleForm` from PF-4/PF-5 — one form,
   used from the wizard's Contacts step (create AND edit, per PF-4) and the Contacts tab.

> **OPEN QUESTION:** should the "already a contact for N other participants" hint
> (`ActiveRoleCount`) block or just inform? This spec treats it as informational only — the same
> person can legitimately be a Support Coordinator for many participants — but flag if the product
> owner wants a confirmation step when `ActiveRoleCount` is high (possible data-entry-error signal).

### Implementation
1. **`frontend/src/components/contacts/AddContactRoleForm.tsx`** (from PF-4): add the search-as-
   you-type name field (debounced `usePersons(search)`), the result-card list, the "create new"
   fallback with the fuller `CreatePersonDto` field set, and the multi-select role picker with the
   `CONTACT_ROLE_FIELD_MAP` union-rendering logic.
2. **`frontend/src/api/types/contacts.ts`**: add a helper `unionRelevantFields(roleTypes:
   ContactRoleType[]): ContactRoleFieldKey[]` (dedup across `CONTACT_ROLE_FIELD_MAP[role]` for each
   selected role) — pure function, easy to unit test in isolation.
3. **`frontend/src/pages/participant-detail/ContactsTab.tsx`**: multi-role add/remove wired through
   the same shared form; role removal calls the existing `DELETE
   /api/participants/contact-roles/{id}`.
4. **`ParticipantCreatePage.tsx`**: create-mode's Contacts step (`:2449-2587`) also gets the
   multi-select role picker and search-first person field — the create-mode `contactRoles`
   `useFieldArray` row shape needs a `roleTypes: ContactRoleType[]` field instead of one
   `roleType`; `buildPayload`'s contact-role expansion (`:1508-1522`) fans one row out into N
   `CreateParticipantContactRoleDto` entries (one per selected role, sharing one `personId`/
   `newPersonFirstName`/etc.) before submission.
5. **New/updated tests**:
   - `frontend/src/api/types/contacts.test.ts` (or wherever `contacts.ts` is tested today) —
     `unionRelevantFields` dedup + ordering.
   - `AddContactRoleForm.test.tsx` (new) — search-as-you-type surfaces existing people; "create
     new" fallback always available; multi-role selection renders the union of fields; submit fans
     out to N calls (mocked) with correct per-role field bodies.
   - `ContactsTab.test.tsx` — role removal deletes the row, not a soft-clear.
   - `ParticipantCreatePage.test.tsx` — create-mode Contacts step: selecting 2 roles for one new
     person produces 2 `contactRoles` entries in the final payload sharing one `newPersonFirstName`/
     `newPersonLastName`.
   - `backend/Odip.Tests/Contacts/ParticipantContactRolesControllerTests.cs` — no backend change is
     required for PF-5/PF-6 (multi-role is already "just POST twice" against the existing
     single-role endpoint), but add a test asserting two roles for the same `PersonId`+
     `ParticipantId` pair both persist correctly and independently.

### Acceptance
- Adding a contact and selecting Guardian + PlanManager renders both roles' field sets (union,
  deduplicated on shared slots per the OPEN QUESTION default), and submitting creates two
  `ParticipantContactRole` rows sharing one `PersonId`.
- Typing a name that matches an existing person shows them as a selectable result with phone/DOB/
  org visible; selecting them sets `personId` without creating a duplicate `Person`; "None of
  these — create new" is always reachable.
- Removing one of a person's two roles on the participant leaves the other role's row and the
  `Person` record intact.
- `ContactRoleRules.ValidateUniqueness`'s existing limits (e.g. one active PlanManager) still hard-
  block correctly when multi-role selection would violate them.
- `npm run build`/`npm test`, `dotnet build`/`dotnet test` all clean.

---

## PF-7 — Compact Cultural & Consent / merged Diagnoses & Health Conditions

**Branch:** `feat/pf07-cultural-consent-health-density`

### Current state — Consent & Terms
`:2615-2645` (Cultural & Consent step, `stepIndex===4`):
```tsx
<Card title="Consent & Terms" className="space-y-4 md:col-span-2">
  ...
  <div className="space-y-3">
    {CONSENT_TYPES.map((type, index) => (
      <div key={type} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
        <YesNoToggleField control={control} name={`consents.${index}.granted`} label={CONSENT_TYPE_LABELS[type]} />
        {granted === 'true' && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Signed by">...</FormField>
            <FormField label="Date signed">...</FormField>
          </div>
        )}
      </div>
    ))}
  </div>
</Card>
```
7 fixed rows, each a full bordered block (`p-3 rounded-lg border`) stacked vertically
(`space-y-3`), each with its own `YesNoToggleField` (a `ToggleGroup`, not a compact switch) — on a
typical viewport this card alone is several screens tall once 2-3 consents are granted (each
adding a 2-column Signed-by/Date-signed sub-row).

### Current state — Diagnoses / HIDPA / Health Conditions
Three separate `Card`s in the Medical step (`stepIndex===6`, `:2901-3145`): "Diagnoses"
(`:2903-2999`, Primary Diagnosis select + Other Diagnoses checkbox grid + custom-entry chips),
"HIDPA Support Categories" (`:3001-3038`), "Health Conditions" (`:3113-3144`, a fixed 10-row grid,
same bordered-block-per-row pattern as Consents). The Health Conditions card's own comment
(`:3096-3103`) is explicit that this is deliberately NOT a duplicate of Diagnoses — it's
support-planning detail (severity/plan-provided/training-required) versus a diagnosis label — so
"combine" cannot mean "one shared list"; it must mean **one compact layout that keeps the two data
sets visibly distinct**, per the discovery/orchestrator brief's own framing ("look at how we can
combine ... being explicit about whether they remain separate data models underneath" — **yes,
they remain separate**: `Participant.PrimaryDiagnosis`/`OtherDiagnoses` vs. the
`ParticipantHealthCondition` collection, no schema change here).

### Design
**Consent & Terms — row-per-line with expandable detail**, replacing the bordered-block stack:
```
┌──────────────────────────────────────────────────────────┐
│ Rights and Responsibilities Consent      [ Yes ○ No ○ ]  │  ← one row, no border, dividers between rows
│ Privacy and Confidentiality Consent      [ Yes ○ No ○ ]  ⌄│  ← expanded (Yes selected): reveals
│    Signed by [___________]   Date signed [___/___/____]  │     Signed-by/Date inline, indented
│ ...                                                       │
└──────────────────────────────────────────────────────────┘
```
- A plain `divide-y` list (`DataTable`-style row dividers, no per-row `border rounded-lg` box) —
  each row is `label + compact Yes/No control` on one line (`flex justify-between items-center`,
  not a stacked card).
- Compact control: keep `YesNoToggleField`'s `ToggleGroup` (already accessible, already wired to
  tri-state) but render it at a smaller/inline size variant if `ToggleGroup` supports one, rather
  than introducing a new control — confirm `ToggleGroup.tsx`'s prop surface for a `size="sm"` or
  equivalent before adding one.
- Signed-by/Date only appears (indented, still no border) when granted — same conditional logic as
  today, purely a layout change.
- Net effect: 7 one-line rows instead of 7 full bordered cards — collapses roughly 3-4x the
  vertical space when few/no consents are granted yet (the common state for a fresh intake).

**Diagnoses + Health Conditions — one card, two clearly-labelled sections, not two cards:**
```tsx
<Card title="Diagnoses & Health Conditions" className="space-y-6 md:col-span-2">
  <section>
    <h4 className="text-sm font-semibold">Diagnoses</h4>
    {/* Primary Diagnosis Dropdown (PF-migrated, see below) + Other Diagnoses chip picker — unchanged content, just re-parented under this heading instead of its own Card chrome */}
  </section>
  <div className="border-t border-[var(--color-border)]" />
  <section>
    <h4 className="text-sm font-semibold">Health Conditions</h4>
    <p className="text-xs text-[var(--color-muted-foreground)]">Support-planning detail — distinct from the diagnosis labels above.</p>
    {/* the 10-row grid, same row-per-line treatment as Consent & Terms above, not a card-per-row stack */}
  </section>
</Card>
```
- One `Card` (one bordered container) replaces two, with an internal `border-t` divider between
  the Diagnoses and Health Conditions sections — visually "one place for clinical labels + their
  planning detail" without merging the underlying arrays/fields.
- The Health Conditions grid gets the SAME row-per-line-with-expand treatment as Consent & Terms
  (currently `p-3 rounded-lg border` per row, `:3117`) — has/severity/plan-provided/training-
  required/notes only expand once "Yes" is selected, exactly mirroring the Consent pattern so the
  two "fixed-row-grid-with-conditional-detail" UIs in this wizard finally share one visual idiom.
- HIDPA Support Categories stays its own card (it's a checkbox multi-select, not a fixed-row grid —
  a different shape, no density problem to solve here) — not folded in, to avoid conflating two
  already-distinct concerns further.

### Implementation
1. **New**: `frontend/src/components/wizard/CompactGridRow.tsx` (or similar shared name) — a
   `{ label, control, expanded?: ReactNode }` row component implementing the row-per-line-with-
   optional-expand pattern once, used by both Consent & Terms and Health Conditions (and reusable
   later for ADLs, PF-8). Avoids writing the same `flex justify-between` + conditional-indent JSX
   twice.
2. **`ParticipantCreatePage.tsx`**:
   - `:2615-2645` (Consent & Terms): replace the per-row bordered block with `CompactGridRow`.
   - `:2901-3145`: merge the "Diagnoses" and "Health Conditions" `Card`s into one, with the
     `<section>`/`border-t` structure above; Health Conditions' rows also move to `CompactGridRow`.
     HIDPA Support Categories keeps its own `Card`, unchanged.
3. **`ToggleGroup.tsx`**: only touched if a compact size variant needs adding — confirm existing
   prop surface first; if it already supports sizing, no change needed here.
4. **Updated tests**: `ParticipantCreatePage.test.tsx`'s Cultural & Consent and clinical-enrichment
   `describe` blocks (discovery §6) assert on `getByRole`/`getByLabelText` queries that shouldn't
   need updating for a pure layout/class change — but the Diagnoses/Health-Conditions merge changes
   the DOM's Card/heading structure, so any test querying by `getByRole('heading', { name:
   'Diagnoses' })` or similar structural query needs updating to match the new `<section>` heading
   level.

### Acceptance
- Visual: the Consent & Terms card with zero consents granted fits in materially less vertical
  space than today (screenshot diff or manual measurement — no numeric regression test needed).
- Functional: every existing Consent/Health-Condition test assertion (values, validation, payload
  shape) still passes — this is a layout-only change, not a data/behaviour change.
- Diagnoses and Health Conditions remain separate arrays/fields in the submitted payload (no schema
  change) — verified by the existing payload-shape tests (discovery §6, INTAKE-07 exact-key-set
  assertions) continuing to pass unmodified in their VALUE assertions.
- `npm run build`/`npm test` clean.

---

## PF-8 — Daily Living / ADLs spacing

**Branch:** `feat/pf08-adl-spacing`

### Current state
`:3268-3300` (Personal ADLs) and `:3302-3334` (Community & Domestic ADLs) — same
"fixed-row-grid, one bordered block per row" pattern as Consents/Health Conditions:
```tsx
<div className="space-y-3">
  {PERSONAL_ADL_TYPES.map((type) => (
    <div key={type} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
      <h4 className="text-sm font-medium">{label}</h4>
      <AdlLevelToggleField ... />
      {level && <FormField label="Notes">...</FormField>}
      {level && isVisible(...) && <FormField label="How To Help Me">...</FormField>}
    </div>
  ))}
</div>
```
20 rows total across the two cards (`ADL_TYPES`), each currently a full bordered block regardless
of whether Notes/How-To-Help are showing — same density problem as PF-7's grids, explicitly called
out by the user as "the same as the above item."

### Design
Apply the **same `CompactGridRow` component from PF-7** — row-per-line for the ADL type label +
`AdlLevelToggleField` (I/S/A/F), with Notes and (CA-gated) "How To Help Me" appearing as an
indented expand section once a level is set, exactly mirroring Consent & Terms/Health Conditions'
new treatment. This is the direct reuse the orchestrator brief asked for ("spacing adjustments the
same as the above item") — no new pattern invented, just applied a third time.

### Implementation
1. **`ParticipantCreatePage.tsx`**: `:3268-3300` and `:3302-3334` — both ADL card bodies converted
   to `CompactGridRow` (same component PF-7 introduces; this branch can land independently but
   should merge after `CompactGridRow` exists — see Dependency order).
2. **Updated tests**: `ParticipantCreatePage.test.tsx`'s Daily Living `describe` block (ADL
   grid/Meals/About Me, discovery §6) — value/payload assertions unchanged; any structural
   `getByRole`/DOM-shape query updated to match the new row markup.

### Acceptance
- All 20 ADL rows render in materially less vertical space with no level set (the common
  fresh-intake state).
- Existing ADL-grid test assertions (level selection, conditional Notes/How-To-Help visibility,
  payload shape) pass unmodified in their VALUE assertions.
- `npm run build`/`npm test` clean.

---

## PF-9 — Full field audit: reordering

**Branch:** `feat/pf09-field-reordering`
**Depends on:** land after PF-2/PF-5/PF-7/PF-8 (reordering a step whose internal layout those
items are also changing in the same PR cycle risks a much larger merge conflict than sequencing
this last — see Dependency order).

### Current state — full step-by-step field order

Below is the field order for all 11 steps exactly as `WIZARD_STEPS`/the per-step JSX declare it
today (`:669-793` for the field-list constants, JSX ranges per discovery §1's table).

| # | Step | Current field order |
|---|---|---|
| 0 | Identity | First, Last, Preferred, Middle, DOB, Gender, (Gender self-desc), Place of Birth, Phone, Email — *then, separate card* — Preferred Staff — *then, separate card* — Street, Suburb, State, Postcode, Country — *then, separate card* — Living Arrangement, (arrangement-specific fields), Living Arrangement Notes |
| 1 | NDIS & Funding | Funding Source, NDIS Number, Plan Start, Plan End, Plan Type, Region, Funding Organisation, Repeat Client, DSOA — *then, separate card* — Service Streams |
| 2 | Key Identifiers | Pension Card #/Expiry, Medicare #/Expiry, Companion Card #/Expiry — *then* — Private Health Fund/Membership #, Taxi Card # — *then* — Hair Colour, Eye Colour, Weight, Height |
| 3 | Contacts | (create-mode only) Person mode, Person/New name, Role Type, Relationship, Primary — per row |
| 4 | Cultural & Consent | CALD, LGBTIQA+, Family/Community, Aboriginal/TSI — *then* — 5 "Information Received" toggles — *then* — Personal Interests, Choice & Control Notes — *then* — 7-row Consent grid |
| 5 | Support Needs & Mobility | High Support, Intensive Support, Support Ratio — *then* — Mobility Aids (Wheelchair/Walker), Mobility Support Options — *then* — Overnight Support, Overnight Ratio — *then* — Equipment (5 checkboxes) — *then* — Mobility/Equipment/Transport Notes — *then* — Ambulant Status, Falls Risk, Level of Personal Care, Uneven Ground, Orthotics, Continence, Bowel Care, Menstruation, Skin Integrity — *then, CA-gated* — Community Mobility & Transport Risk checklist |
| 6 | Medical | Primary Diagnosis, (Specify Other), Other Diagnoses — *then* — HIDPA categories, HIDPA Notes — *then* — Medical Summary — *then* — Allergies, Anaphylaxis Risk, Allergy Notes — *then* — 10-row Health Conditions grid |
| 7 | Behaviour & Communication | Memory, Memory Aids, Impaired Understanding, Impaired Judgement — *then* — Behaviours of Concern (current/5yr), Behaviour Risk Rating, RIDS Logged, BSP Provided, BOC Chart — *then* — Expressive/Receptive Skills, Reading Ability, Communication Aids — *then, CA-gated* — Signs Happy/Settled, What Helps Calm Down, Boc Triggers/Early Warning/De-escalation/What Not To Do — *then, CA-gated (split half, see STEP_SUPPORT_FIELDS doc)* — Community Behaviours of Concern checklist |
| 8 | Daily Living | 20-row ADL grid (Personal, then Community & Domestic) — *then* — Meals & Diet (11 fields) — *then* — About Me (6 fields) — *then, CA-gated* — What My Supports Look Like (4 shift-window fields) |
| 9 | Risks & Hazards | Behaviour Risk Summary, General Notes — *then* — Risk Entries (create-mode only) |
| 10 | Review | (summary only, no inputs) |

### Design — proposed reordering

The audit surfaces two real problems, not eleven: (1) **Identity mixes core PII with three
loosely-related card groups** (staff preference, address, living arrangement) that don't share a
mental model with "who is this person," and (2) **NDIS & Funding buries Service Streams**, a
choice that gates visibility on FOUR other steps (Support/Medical/Behaviour all have CA-gated
blocks keyed on it), at the bottom of a card the user fills in last. Everything else is already
reasonably grouped by the sub-wave labelling in the code comments — this audit does not recommend
a wholesale shuffle, which would both contradict "no schema change" and blow up every step-scoped
test in discovery §6's list for no functional gain.

| # | Step | Proposed field order | Change from today |
|---|---|---|---|
| 0 | Identity | First, Last, Preferred, Middle, DOB, Gender, (self-desc), Place of Birth, Phone, Email, Preferred Staff — *then* — Street, Suburb, State, Postcode, Country | Preferred Staff merges into the Personal Information card (no separate "Staff Preferences" card) — it's a single field, not a group, and doesn't need its own card chrome. Living Arrangement **moves to step 1** (see below). |
| 1 | NDIS & Funding | **Service Streams first** — *then* — Funding Source, NDIS Number, Plan Start, Plan End, Plan Type, Region, Funding Organisation, Repeat Client, DSOA — *then* — **Living Arrangement + its conditional fields (moved from Identity)** | Service Streams promoted to the top of the step it already lives on (no step reassignment, matches `STEP_NDIS_FIELDS`'s existing field-list membership) since it's a gate for later steps, not an afterthought. Living Arrangement moves here from Identity — "how/where they live" is closer to "what services/funding apply" than to core name/DOB identity, and unlike Preferred Staff it's a genuine multi-field group worth keeping visually separate rather than folded into Personal Information. |
| 2 | Key Identifiers | unchanged | — |
| 3 | Contacts | unchanged | — |
| 4 | Cultural & Consent | unchanged | — |
| 5 | Support Needs & Mobility | unchanged internal order | — |
| 6 | Medical | unchanged | — |
| 7 | Behaviour & Communication | unchanged | — |
| 8 | Daily Living | unchanged | — |
| 9 | Risks & Hazards | unchanged | — |
| 10 | Review | unchanged | — |

> **OPEN QUESTION:** moving Living Arrangement out of Identity means `STEP_IDENTITY_FIELDS` and
> `STEP_NDIS_FIELDS` (and their `STEP_SCHEMAS` picks/refines — `livingArrangementRefine` moves from
> step 0's chain to step 1's) both change, which touches `fieldToStepIndex` (used by
> `handleInvalidSubmit` to jump back to the right step on a Review-triggered validation failure,
> `:1118-1128`) and every discovery-§6 test that asserts step-scoped validation ("an error on one
> step doesn't block another"). This is a real, if mechanical, ripple — confirm the product owner
> wants this specific move (vs. leaving Living Arrangement in place and only doing the
> Preferred-Staff-merge + Service-Streams-reorder, which are both zero-step-membership-change,
> pure-JSX-order edits) before implementing, since it's the one change in this table with a real
> cost/benefit tradeoff rather than a free reorder.

### Implementation
1. **`ParticipantCreatePage.tsx`**:
   - Merge the "Staff Preferences" card's JSX into "Personal Information" (`:2085-2163` region);
     delete the now-empty separate card.
   - Move Service Streams' `Card` JSX to render before the "NDIS & Funding" card within
     `stepIndex===1`'s block (`:2267-2391`).
   - If the Living Arrangement move is confirmed (OPEN QUESTION above): move
     `mainSupportPersonName`..`livingArrangementNotes` out of `STEP_IDENTITY_FIELDS` into
     `STEP_NDIS_FIELDS`, move `livingArrangementRefine` from `STEP_SCHEMAS[0]`'s chain to
     `STEP_SCHEMAS[1]`'s, move the corresponding JSX block from the Identity step's render to the
     NDIS & Funding step's render, and update `fieldToStepIndex`'s derivation (wherever it's built
     — locate at implementation time; discovery didn't cite its exact line).
2. **Updated tests**: every test in `ParticipantCreatePage.test.tsx` asserting Living-Arrangement
   validation fires "on step 0" needs its expected step index bumped to 1 if that move proceeds;
   Preferred-Staff-related tests (Review step's keyboard-only-selection test, discovery §6) updated
   only if they query by card title ("Staff Preferences") rather than by field id.

### Acceptance
- Every existing field is still present and still submits to the identical payload key — this is a
  presentation/order change only, `buildPayload`'s output is byte-identical for a given set of
  filled values.
- `handleInvalidSubmit`'s jump-to-owning-step behaviour still lands on the correct step for every
  field after the reorder (this is the one behaviour a reorder can silently break — test it
  explicitly, not just "does the field render").
- `npm run build`/`npm test` clean; discovery's "exact payload key set" tests (INTAKE-07) still pass
  unmodified in their key/value assertions.

---

## GEN-1 completion — native `<select>` migration (in-scope inventory)

Per the fixed constraint above, this spec — not GEN-1 — migrates every native `<select>` in
`ParticipantCreatePage.tsx`. **13 call sites** (grep confirms 13, not the 12 estimated in
SPEC-01/discovery §1 — the 13th is the dynamic per-row `riskEntries.{index}.atRiskParty` select
inside a `.map()`, easy to undercount by a static line-count pass):

| Field | Line | Enum source | Target | Notes |
|---|---|---|---|---|
| Gender | `:2111` | `GENDERS` | `Dropdown` form | Empty-option "Not specified" → `label` prop, GEN-1 rule 3. |
| Address State | `:2178` | `AU_STATES` | `Dropdown` form | |
| Living Arrangement | `:2200` | `LIVING_ARRANGEMENTS` | `Dropdown` form | Moves step per PF-9 if that OPEN QUESTION resolves yes — migrate wherever it lands. |
| Funding Source | `:2271` | `FUNDING_SOURCES` | `Dropdown` form | **Preserve `handleFundingSourceChange`'s custom onChange** (confirm-before-data-loss dialog, GEN-1 rule 4) — wire it through `Dropdown`'s `onChange` prop, not `register`. |
| Overnight Support | `:2740` | `OVERNIGHT_SUPPORT_TYPES` | `Dropdown` form | |
| Overnight Ratio | `:2749` | `SUPPORT_RATIOS` | `Dropdown` form | Conditionally rendered (`overnightSupportValue !== 'None'`) — unchanged. |
| Ambulant Status | `:2816` | `AMBULANT_STATUSES` | `Dropdown` form | |
| Falls Risk Rating | `:2825` | `RISK_RATING_LEVELS` | `Dropdown` form | |
| Level of Personal Care | `:2834` | `PERSONAL_CARE_LEVELS` | `Dropdown` form | |
| Primary Diagnosis | `:2905` | `DIAGNOSIS_OPTIONS` + sentinel | `Dropdown` form | 14 curated + 1 "Other — specify" sentinel = 15 items, short enough for `Dropdown` (not `SearchableSelect` — this is a fixed curated list, GEN-1's own criterion). |
| Memory | `:3149` | `MEMORY_LEVELS` | `Dropdown` form | |
| Behaviour Risk Rating | `:3165` | `RISK_RATING_LEVELS` | `Dropdown` form | |
| Risk Entry — At Risk Party | `:3475` | `AT_RISK_PARTIES` | `Dropdown` form | Per-row inside `riskEntryFields.map(...)` — bind via `Controller` + `setValue` at the row's path, same pattern the Contacts step's per-row Role Type `Dropdown` already uses (`:2540-2551`). |

All 13 follow GEN-1's 6 migration rules verbatim (FormField wrapping, `register`→`Controller`,
empty-option→`label`, preserve custom onChange, preserve required/disabled/error wiring, build
`DropdownItem[]` from the existing enum constant — no duplicated literal lists).

### Acceptance
- `grep -rn "<select" frontend/src/pages/ParticipantCreatePage.tsx` returns zero matches once this
  spec's branches all land (GEN-1's own acceptance criterion, SPEC-01, already names this file as
  excluded from its own count pending this spec).
- Every migrated field's existing test coverage (discovery §6) still passes, with `getByRole`
  queries updated from `combobox`/native-select role to whatever `Dropdown` exposes.

---

## PF-10 — Intake form / participant profile split (deferred)

Deferred to a separate spec, once the source documents (Intake Coversheet vs. Participant Profile
form) are extracted and the split's actual boundary is confirmed against them — discovery flags
three structural obstacles (one monolithic component/schema/payload; inconsistent create-vs-edit
data ownership across `riskEntries`/`contactRoles` vs. `consents`/`healthConditions`/
`adlAssessments`; no partial-save primitive to build on) that this spec's PF-1/core02 partly
resolves (the partial-save primitive) but does not attempt to resolve the other two, since doing so
without the source documents in hand would be guessing at the split's actual shape. No design work
for the split itself is included here.

---

## Dual-write inconsistency — precedent this spec follows

Discovery flags a real, pre-existing inconsistency: `riskEntries`/`contactRoles` are **create-only**
on the wizard (stripped from every edit-mode payload, `:1616-1617`/`:1660-1661`) and managed solely
via nested-CRUD tabs after creation, while `consents`/`healthConditions`/`adlAssessments`/
`checklistItems` are **dual-write** — the wizard's edit-mode full-submit still includes and saves
them (`CreateParticipantDto`'s doc comments at `:418-426`/`:435-441`/`:479-485` are explicit: "read
by BOTH Create and Update"), AND the detail page's per-section tabs independently upsert the same
rows via their own endpoints (`useUpsertConsent`/`useUpsertHealthCondition`/`useUpsertAdlAssessment`).

**This spec follows the `riskEntries`/`contactRoles` precedent (create-only, nested-CRUD-managed
thereafter), not the dual-write one, for everything it touches:**
- **PF-4** adds edit-mode contact management via the *existing nested-CRUD endpoint*
  (`ParticipantContactRolesController`), not by un-stripping `contactRoles` from the edit payload —
  keeping exactly one write path for contact roles, consistent with how they already work.
- **PF-1/core02**'s new `PatchParticipantDto` deliberately has **no `ContactRoles` group** — contact
  saves stay on the nested-CRUD path (PF-4), never the new PATCH, for the same reason.
- **PF-1/core02** DOES include `Consents`/`HealthConditions`/`AdlAssessments`/`ChecklistItems` in
  their respective patch groups, matching their EXISTING dual-write status (they're already
  writable via full `PUT` in edit mode today) — this spec does not widen the inconsistency, since
  `Patch` for those groups reuses the same `UpsertXAsync` helpers `Update` already calls, and does
  not add a third write path.

**Why this matters more with PF-4 in scope**: PF-4 adds a *second UI entry point* (the wizard) into
an already-existing write path for contact roles — this is safe precisely because it's the same
endpoint the Contacts tab uses, not a new one. If a future item ever proposed un-stripping
`contactRoles`/`riskEntries` from the edit-mode wizard payload (reverting to dual-write for those
too), it would need to resolve the same "which write wins on a near-simultaneous edit" question the
existing `consents`/`healthConditions`/`adlAssessments` dual-write already carries unresolved —
out of scope here, flagged for awareness only.

---

## Dependency order

```
fix/wizard-registered-provider-flag   (external prerequisite — lands ahead of everything below)
feat/core01-wizard-shell        (external prerequisite — lands before everything below)
feat/core02-participant-partial-save   (external prerequisite — lands before PF-1)
        │
        ├─→ feat/pf02-plan-type-requirements
        │        (warn-only, per the product decision — needs only the fix branch + core01;
        │         no longer gated on PF-5. Low-risk, can land early/in parallel with pf01/pf04.)
        │
        ├─→ feat/pf01-partial-save              (needs core01 + core02)
        │
        ├─→ feat/pf04-edit-add-contacts         (needs core01 only; independent of PF-1)
        │        │
        │        └─→ feat/pf05-06-contact-roles-and-matching
        │                 (shares AddContactRoleForm with PF-4 — land PF-4 first,
        │                  or merge them into one PR if the extraction is trivial
        │                  enough that splitting adds more risk than it saves)
        │
        ├─→ feat/pf07-cultural-consent-health-density   (independent — introduces CompactGridRow)
        │        │
        │        └─→ feat/pf08-adl-spacing        (reuses CompactGridRow from PF-7 — land after)
        │
        └─→ feat/pf09-field-reordering
                 (land LAST among the UI items — touches step/field-order structure that
                  PF-2 (banners), PF-5 (Contacts card), PF-7 (Cultural & Consent,
                  Medical), and PF-8 (Daily Living) are also editing; sequencing it last
                  minimizes merge conflicts even though it has no hard functional dependency
                  on any of them)
```

PF-3 has no branch (verification only) and can happen at any point, independently.
PF-6 has no independent branch — it is folded entirely into `feat/pf05-06-contact-roles-and-matching`.
PF-10 is deferred, not sequenced.

**Recommended landing order**: `fix/wizard-registered-provider-flag` → `core01` → `core02` →
`pf02` → `pf01` → `pf04` → `pf05-06` → `pf07` → `pf08` → `pf09`, with PF-3's verification done
whenever convenient (no code dependency on anything else in this list). PF-2 moved from
"after pf05-06" to right after core01 because the product's warn-only decision removed its
dependency on PF-5's field-surfacing work.
