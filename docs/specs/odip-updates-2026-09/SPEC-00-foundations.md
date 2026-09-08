# SPEC 00 — Foundations (CORE-01 wizard shell, CORE-02 partial save)

Four other specs — SPEC-02 (participant form), SPEC-03 (participant tabs), SPEC-04 (incidents),
SPEC-05 (intake/profile split) — are blocked on the two branches below. House style follows
SPEC-01-general.md. Both branches are written against the real `ParticipantCreatePage.tsx`
(3,608 lines), `ParticipantsController.cs`, and `DTOs.cs` as they exist today (2026-09-01), and
against every requirement the four dependent specs stated for these two foundations, reconciled
into one design each.

---

## CORE-01

**Branch:** `feat/core01-wizard-shell` → `frontend/src/components/wizard/`

### Current state

No reusable wizard/stepper exists anywhere in `frontend/src` (confirmed by discovery in SPEC-04 §
IN-1 and independently by grep here). `ParticipantCreatePage.tsx` hand-rolls all of it inline:

- `WIZARD_STEPS: WizardStep[]` — a fixed, module-level array of `{ key, label, fields }`
  (`:771-794`), with a trailing synthetic `{ key: 'review', label: 'Review', fields: [] }` entry
  and `REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1` (`:795`).
- `STEP_SCHEMAS: (z.ZodTypeAny | null)[]` (`:802-818`) — one Zod schema per step index, `null` for
  Review, each built via `baseParticipantSchema.pick(...).superRefine(...)`.
- `stepIndex`/`visitedSteps: Set<number>` state (`:1039-1042`), seeded `isEdit ? all indices : [0]`
  — an edit-vs-create binary hard-coded into the wizard itself, not a caller-supplied flag.
- `fieldToStepIndex: Partial<Record<keyof ParticipantFormData, number>>` (`:1058-1064`), a
  `useMemo` built once off the module-level `WIZARD_STEPS` constant (safe today only because that
  constant never changes shape at runtime).
- `goToStep`/`handleBack`/`handleNext` (`:1085-1113`) — `handleNext` runs `STEP_SCHEMAS[stepIndex]`,
  `setError`s every issue at its exact dot/array path, focuses the first invalid field, and only
  then advances `stepIndex` and adds it to `visitedSteps`.
- `handleInvalidSubmit` (`:1119-1127`) — the Review-step safety net: on a final-submit validation
  failure, jumps back to `fieldToStepIndex[firstInvalidField]` and focuses it.
- The step-pill nav rail (`:2033-2073`), the Review step's `reviewGroups` card grid with
  `<dl>`-based rows and per-card "Edit" links calling `goToStep` (`:3523-3552`), and the nav footer
  (Back / "Save as draft" / Next / Cancel+Submit, `:3554-3604`) are all inline JSX in the same
  component.

Three more consumers need this shell and each needs something `ParticipantCreatePage.tsx` never
needed:

- **SPEC-02** (the participant wizard itself, refactored onto the shell) needs an externally
  supplied `validate(step, values)` so the 3,608-line Zod schema stays out of the shell; a
  jump-anywhere flag decoupled from edit/create; a secondary-action slot for PF-1's "Save changes"
  button (alongside "Save as draft", never both at once — see PF-1's design, they're an exact
  complement); and a review-step row-builder so the shell doesn't have to know what a
  `healthConditions` row summary looks like.
- **SPEC-04** (the incident wizard) needs a **computed step list** — the Restrictive Practice step
  exists only when `incidentType === 'RestrictivePracticeUse'`, the Compliance step only in edit
  mode — and needs the current step to survive that list changing shape mid-session without
  crashing or losing other steps' data (IN-1).
- **SPEC-05** (Intake and Profile wizards) needs step lists built at construction time from
  `fieldsForEntry('intake' | 'profile')`, needs a step contributing zero fields to be omittable
  entirely, and — for the Profile wizard specifically — needs "Next" to actually persist the step
  (a real PATCH call) before advancing, not just validate client-side (PF-10.4).

### Design

**Generic signature.** One hook owns step-machinery state; the JSX chrome (step rail, nav footer,
review step) is three small presentational components built on top of it, so a consumer can also
use just the hook and render its own chrome if it ever needs to (none of the four consumers do
today, but nothing here forces them to use the provided chrome either).

```ts
// frontend/src/components/wizard/types.ts
export type WizardStepDef<V> = {
  key: string
  label: string
  fields: readonly (keyof V)[]
}

/** One field error, keyed by the exact dot/array RHF path (e.g. "riskEntries.0.description"). */
export type WizardFieldError = { path: string; message: string; code?: string }

/**
 * Step-scoped validation, supplied by the consumer — the shell never hard-codes Zod (or anything
 * else). Returning `null`/`[]` means the step is valid and Next may advance.
 *
 * May be async and may itself perform a network call (see "Per-step persistence" below) — the
 * shell awaits it before advancing and exposes `isAdvancing` while it's in flight. A synchronous
 * validator (today's `schema.safeParse`) already satisfies this signature with no wrapping.
 */
export type WizardValidate<V> = (
  step: WizardStepDef<V>,
  values: V,
) => WizardFieldError[] | null | Promise<WizardFieldError[] | null>

export type WizardSecondaryAction = {
  key: string
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
}

export type ReviewRow = { label: string; value: string }
export type ReviewGroup = { stepKey: string; rows: ReviewRow[] }
/** Builds every group's rows in one pass over the current values — not one call per step — since
 * a consumer's row logic (e.g. summarising a healthConditions array) often reads more than one
 * step's fields to produce a single group's display rows. */
export type ReviewBuilder<V> = (values: V, steps: WizardStepDef<V>[]) => ReviewGroup[]

export type UseWizardOptions<V> = {
  /** Caller-computed, may change shape (length, order, membership) between renders — see
   * "Computed step list" below. Does NOT include the review step. */
  steps: WizardStepDef<V>[]
  /** Decoupled from edit/create — the caller decides. Seeds `visitedSteps` with either every
   * step's key or just the first step's key. */
  initialVisited: 'all' | 'linear'
  validate: WizardValidate<V>
  getValues: () => V
  setError: (path: string, err: { type?: string; message: string }) => void
  clearErrors: (paths: readonly string[]) => void
  /** Called with the first invalid field's path after a blocked Next/Submit, so the consumer's
   * existing focus-management (`requestFocus`) keeps working unchanged. */
  onValidationFailed?: (firstPath: string) => void
}

export type UseWizardResult<V> = {
  stepIndex: number                 // position of currentStep within `steps` (never the review step)
  currentStep: WizardStepDef<V>
  isReviewStep: boolean
  visitedSteps: Set<string>         // KEYED BY STEP KEY, never by index — see below
  isAdvancing: boolean              // true while an async validate() is in flight
  goToStep: (key: string) => void   // no-ops if key isn't in visitedSteps
  handleBack: () => void
  handleNext: () => Promise<void>
  /** Mirrors today's handleInvalidSubmit: given RHF's FieldErrors object, jumps to whichever step
   * owns the first error field and reports it via onValidationFailed. */
  handleInvalidSubmit: (formErrors: Record<string, unknown>) => void
}

export function useWizard<V>(options: UseWizardOptions<V>): UseWizardResult<V>
```

Plus three presentational components consuming `UseWizardResult`/`WizardStepDef[]` directly:
`<WizardStepRail steps visitedSteps currentKey onSelect />`, `<WizardNavFooter onBack onNext
isReviewStep secondaryActions submitLabel isSubmitting onSubmit />`, and `<WizardReviewStep
groups={reviewBuilder(values, steps)} steps onEdit={goToStep} renderRow? />`.

**Computed step list.** `steps` is a plain prop the consumer recomputes with its own `useMemo`
(e.g. `useMemo(() => computeSteps(incidentType, isEdit), [incidentType, isEdit])` for SPEC-04, or
`fieldsForEntry('profile')`-derived + CA-conditional for SPEC-05) — the shell adds no special API
for "compute the list," because it doesn't need one: it already accepts an array every render.
What the shell owns is **surviving that array changing shape**:

- Internal state is a **step key** (`currentStepKey: string`), never a bare index — an index is
  meaningless the moment steps are inserted/removed above it.
- `stepIndex`/`currentStep` are *derived* every render: `steps.findIndex(s => s.key ===
  currentStepKey)`. When the key is still present, that's the answer. When it's gone (the exact
  case IN-1 describes — the user was on the Restrictive Practice step, then changed `incidentType`
  away from `RestrictivePracticeUse`), the hook clamps to `steps[Math.min(lastKnownIndex,
  steps.length - 1)]` and corrects `currentStepKey` to that step's key — computed synchronously
  during render (the standard "adjust state during render" React pattern: compare against a ref of
  the previous `steps` array, and if the derived index for `currentStepKey` is `-1`, compute the
  clamped key and call `setCurrentStepKey` before returning JSX) so there's no visible flash of an
  invalid step. `lastKnownIndex` is the index the vanished key held in the *previous* render's
  `steps` array, not 0 — landing on "whatever now occupies roughly the same position" rather than
  bouncing back to the first step.
- **`visitedSteps: Set<string>`, keyed by step key — fixed, not re-litigated.** SPEC-04's IN-1
  flagged this and deferred to this branch; the decision is string keys. The alternative
  (`Set<number>`, recomputed by every consumer on every step-list change) pushes real, easy-to-get-
  wrong bookkeeping onto every consumer of a computed list; string keys make a stale entry
  harmless by construction — a key for a step that's currently absent is simply unreachable via
  `goToStep` (it no-ops for the same reason it always would: the key still isn't in `steps`, not
  because the Set forgot it) until that step reappears, at which point it's already clickable
  again with no re-derivation needed. This is *why* a reappearing Restrictive Practice step doesn't
  need to force the user back through Next: if they'd visited it before, it's still marked visited.
  Field-value clearing when a step disappears (IN-4's "switching `incidentType` away clears
  `restrictivePracticeType`/etc.") is the **consumer's** job (its own `onChange` handler), not the
  shell's — the shell only tracks navigability, never form values.
- `fieldToStepIndex` (numeric) becomes **`fieldToStepKey`**, a `useMemo` keyed on the current
  `steps` array (not a module constant): `steps.forEach(s => s.fields.forEach(f => map[f] =
  s.key))`. `handleInvalidSubmit` uses this internally and calls `goToStep(key)` (which itself is
  key-based, so it survives a same-tick list reshuffle without a second layer of clamping).

**Jump-anywhere, decoupled from edit/create.** `initialVisited: 'all' | 'linear'` seeds
`visitedSteps` once (`'all'` → every current step's key; `'linear'` → just the first step's key).
The participant wizard passes `isEdit ? 'all' : 'linear'` — identical runtime behaviour to today,
now expressed as the caller's own policy rather than a binary the shell hard-codes. This is the
whole of requirement #2; no other consumer needs anything more from it today (SPEC-04's IN-1 §3
explicitly says visited-set gating is sufficient, no stronger "jump anywhere" primitive is needed).

**Secondary-action slot.** `secondaryActions: WizardSecondaryAction[]`, rendered in the footer next
to Back, before Next/Submit. "Save as draft" and PF-1's "Save changes" are each one entry; because
`canSaveDraft`/`canSavePartial` are exact complements (PF-1's design), the array holds at most one
of them at a time — no ordering question to resolve. Multiple simultaneous entries are supported
for a future consumer that needs them, but none of the four dependent specs need more than one.

**Review step — shell owns chrome, consumer owns row content.** This resolves SPEC-02's open
question directly: the shell owns the Review step's layout (a card grid, one `<Card>` per group,
each with an "Edit ↗" button calling `goToStep(group.stepKey)` — exactly today's `:3523-3552`
JSX, extracted verbatim) and a *default* row renderer implementing today's `<dl>`/`dt`/`dd`
pattern. `renderRow?: (row: ReviewRow) => ReactNode` lets a consumer override that per-row
rendering without owning the surrounding card/grid/Edit-link chrome — the shell does **not**
impose `<dl>` semantics on a consumer that wants something else, it just ships a `<dl>`-based
default so nobody has to reimplement it for a case (like today's) that's happy with it. The
`reviewBuilder(values, steps)` signature groups by `stepKey`, not step index, for the same reason
`visitedSteps` does — a group's owning step must survive a list reshuffle.

**Prefill compatibility (IN-8).** No new API. The shell's step-position state (`currentStepKey`)
lives entirely outside react-hook-form and is never touched by `reset()`. A prefill effect calling
the underlying RHF `reset()` after mount repopulates whichever step is currently showing (and every
other step's fields in form state) with zero shell involvement — confirmed by construction, not by
a special case: the shell reads step *definitions* (`fields: readonly (keyof V)[]`) to build
`fieldToStepKey`/the review builder, and reads current *values* only when a consumer explicitly
passes them (`getValues()`, `reviewBuilder`) — it never subscribes to form state changes itself, so
there's nothing for a `reset()` call to desynchronise.

**Per-step persistence (PF-10.4).** `validate` may return a `Promise`. `handleNext` is `async`:
it awaits `validate(currentStep, getValues())`, sets `isAdvancing` while pending, and only advances
`currentStepKey`/adds it to `visitedSteps` if the result is `null`/`[]`. This one generalisation
(no new hook, no second code path) is what lets a step's "Next" *be* a real save: the Profile
wizard's `validate` for a given step runs its Zod check, then (only if that passes) awaits `PATCH
/api/v1/participants/{id}` with that step's fields (CORE-02), and turns a 400's field errors into
the same `WizardFieldError[]` shape a client-side Zod failure would have produced — `handleNext`
treats a server rejection exactly like a validation failure (stays on the step, sets field errors,
focuses the first one). A synchronous validator (participant/incident wizards) already satisfies
this contract without change — `Promise.resolve(result)` awaits transparently.

**State ownership.**

| Owned by the shell | Owned by the consumer |
|---|---|
| Current step key, derived index, clamp-on-shrink | The react-hook-form instance itself (control/register/getValues/setValue/watch) |
| `visitedSteps: Set<string>` | The actual Zod schemas / `validate` implementation |
| Step-rail rendering, nav-footer button layout | Per-step field JSX |
| Review step's card/grid/Edit-link chrome | Review row *content*, draft-save/patch-save mutations |
| `fieldToStepKey` derivation | Prefill effects, the INTAKE-07 conditional-visibility engine (orthogonal — it already operates directly on RHF `control`, never touches step state) |

**Draft-save coexists with step navigation trivially**, because it was never coupled to it: "Save
as draft" reads `getValues()` directly and bypasses `validate` entirely (today's `handleSaveDraft`
does the same) — it's just one `secondaryActions` entry with its own `onClick`, with no interaction
with `stepIndex`/`visitedSteps`/`handleNext` at all.

**A step's validation failing on Next** is exactly today's behaviour, generalised to the async case
above: `setError` is called for every returned `WizardFieldError`, `onValidationFailed(firstPath)`
fires (the consumer's existing `requestFocus`), and `currentStepKey`/`visitedSteps` are left
unchanged — the user stays on the step that failed.

### Implementation

1. **New** `frontend/src/components/wizard/types.ts` — the types above.
2. **New** `frontend/src/components/wizard/useWizard.ts` — the hook: step derivation +
   render-phase clamp, `visitedSteps` management, `fieldToStepKey` memo, `goToStep`/`handleBack`/
   async `handleNext`/`handleInvalidSubmit`.
3. **New** `frontend/src/components/wizard/WizardStepRail.tsx` — extracted from
   `ParticipantCreatePage.tsx:2033-2073`, generalised to `steps: WizardStepDef<unknown>[]`,
   `visitedSteps: Set<string>`, `currentKey: string`, `onSelect: (key: string) => void`. Same
   markup/classes/`aria-current`/keyboard behaviour verbatim.
4. **New** `frontend/src/components/wizard/WizardNavFooter.tsx` — extracted from `:3554-3604`,
   `secondaryActions` rendered where "Save as draft" sits today.
5. **New** `frontend/src/components/wizard/WizardReviewStep.tsx` — extracted from `:3523-3552`,
   generic over `ReviewGroup[]`, default `<dl>` `renderRow`, override prop.
6. **New** `frontend/src/components/wizard/index.ts` — barrel export.
7. **New tests**: `useWizard.test.ts` (step derivation/clamp-on-shrink/visited-set persistence
   across a reshuffle/async-validate-blocks-advance/handleInvalidSubmit-jumps-correctly),
   `WizardStepRail.test.tsx`, `WizardNavFooter.test.tsx`, `WizardReviewStep.test.tsx` (default vs.
   overridden `renderRow`).
8. **`ParticipantCreatePage.tsx`** — refactor onto the shell, behaviour-preserving:
   - `WIZARD_STEPS` drops its trailing `{ key: 'review', ... }` entry; `STEP_REVIEW_FIELDS`/
     `REVIEW_STEP_INDEX` are removed. `STEP_SCHEMAS` drops its trailing `null` and is converted
     from a positional array to `STEP_SCHEMAS_BY_KEY: Record<string, z.ZodTypeAny>` (built by
     zipping `WIZARD_STEPS` against the existing array in the same order — no schema content
     changes).
   - The `stepIndex`/`visitedSteps`/`fieldToStepIndex`/`goToStep`/`handleBack`/`handleNext`/
     `handleInvalidSubmit` block (`:1039-1128`) is replaced by one `useWizard(...)` call:
     `validate = (step, values) => { const schema = STEP_SCHEMAS_BY_KEY[step.key]; const result =
     schema.safeParse(values); return result.success ? null : result.error.issues.map(i => ({
     path: i.path.map(String).join('.'), message: i.message, code: i.code })) }`,
     `initialVisited={isEdit ? 'all' : 'linear'}`.
   - `reviewGroups` (`:1697`+) becomes a `reviewBuilder(values, steps)` function returning
     `{ stepKey, rows }[]` instead of `{ step: number, rows }[]` — same row-construction logic,
     re-keyed.
   - `secondaryActions = canSaveDraft ? [{ key: 'save-draft', label: savingDraft ? 'Saving
     draft...' : 'Save as draft', onClick: handleSaveDraft, disabled: savingDraft ||
     mutation.isPending }] : []` (PF-1 later adds its own conditional entry here, mutually
     exclusive with this one).
   - JSX: `<WizardStepRail steps={WIZARD_STEPS} visitedSteps={wizard.visitedSteps}
     currentKey={wizard.currentStep.key} onSelect={wizard.goToStep} />`; per-step field JSX
     unchanged (still keyed on `wizard.currentStep.key`/`wizard.stepIndex`); `<WizardReviewStep
     .../>` when `wizard.isReviewStep`; `<WizardNavFooter .../>` replacing `:3554-3604`.
9. **`ParticipantCreatePage.test.tsx`** — **not weakened**: every existing assertion on rendered
   text, DOM roles, validation-blocks-Next, step-pill click-through, and Review-step Edit-link
   behaviour continues to pass unmodified, since the extracted components render byte-identical
   markup. Only assertions that reached into now-removed internals (none currently do — discovery
   confirms the test file drives the page through its public DOM, not internal state) would need
   touching, and none are expected to.

### Acceptance

- `ParticipantCreatePage.test.tsx` passes with **no weakened assertions** — this is the regression
  net for "behaviour unchanged," per the orchestrator's fixed decision.
- New `useWizard.test.ts` proves, explicitly (not just in prose): (a) a computed step list that
  removes the current step mid-session clamps to the nearest remaining step without throwing and
  without losing any other step's already-entered values; (b) a step re-added later to the list is
  immediately clickable again if its key was ever in `visitedSteps`, with no re-visit required;
  (c) `handleNext` blocks and sets per-field errors when `validate` returns errors (sync and async
  cases both); (d) `handleInvalidSubmit` jumps to the step owning the first errored field after a
  list reshuffle. This directly satisfies SPEC-04 IN-1's stated acceptance requirement for core01.
- `npm run build` clean, `npm test` green, no new `npm run lint` errors vs. main.

### Consumer contract

- **SPEC-02**: gets `useWizard`/`WizardStepRail`/`WizardNavFooter`/`WizardReviewStep` as designed;
  its own Implementation sections (PF-1's `secondaryActions` entry, PF-9's step-membership edits)
  work against `STEP_SCHEMAS_BY_KEY`/`fieldToStepKey` as described above, not the old positional
  arrays. PF-9's Living-Arrangement-step-move (its one OPEN QUESTION) is now a pure
  `WIZARD_STEPS`/`STEP_SCHEMAS_BY_KEY` edit with **zero** `visitedSteps`-corruption risk, precisely
  because keys — not positions — are load-bearing.
- **SPEC-03**: no dependency on CORE-01 at all (PD-6/PD-7's `SectionEditPanel` is a standalone
  edit-toggle primitive, not built on the wizard shell) — confirmed, not re-derived, from SPEC-03's
  own stated dependency list (core02 only).
- **SPEC-04**: gets the computed-step-list capability (IN-1 requirements #1-#6) verbatim — the
  Restrictive Practice and Compliance steps are ordinary entries filtered out of the `steps` array
  the incident wizard's own `useMemo` computes; `visitedSteps`'s string-keying is what makes
  switching `incidentType` back and forth safe. IN-8's prefill hand-offs need no shell change, per
  "Prefill compatibility" above.
- **SPEC-05**: gets data-driven step defs from `fieldsForEntry(...)` (PF-10.3/PF-10.4) — a
  zero-field step is omitted by the consumer's own `useMemo` before it ever reaches `useWizard`, so
  no shell-side "skip an empty step" logic exists or is needed. PF-10.4's per-step PATCH-on-Next is
  the direct consumer of the async-`validate` generalisation above.

---

## CORE-02

**Branch:** `feat/core02-participant-partial-save` (backend + frontend hook)

### Current state

No PATCH exists anywhere on `ParticipantsController.cs` — only `POST`/`PUT`, plus the `IsDraft`
flag, which relaxes validation *strictness* (`ValidateNames`) but still requires the entire
`CreateParticipantDto`/`UpdateParticipantDto` payload shape (all ~150 flat fields plus the four
dual-write collections). `UpdateParticipantDto : CreateParticipantDto` (`DTOs.cs:560-563`), adding
only `IsActive`.

### The central problem

The dependent specs want partial saves grouped along genuinely different axes:

- **SPEC-02 (PF-1)** wants groups shaped like the wizard's **9 data-collecting steps** (excluding
  Contacts and Review) — "save my current step."
- **SPEC-03 (PD-6, PD-7)** wants groups shaped like **12 detail-tab section cards** — "edit this
  card and save."
- **SPEC-05 (PF-10.4)** will want groups shaped like a **third, not-yet-designed set of Profile-
  wizard steps**, because PF-10.1 redistributes today's 9 wizard steps' fields across two entirely
  new wizards — any contract shaped like *today's* steps is invalidated the moment that ships.

These are not the same partition, and a fourth (PF-10.1's own `entryPhase: 'intake' | 'profile'`
tagging) is a different axis again — it says *which future wizard captures a field*, not *which
fields must be saved together today*. Building `PatchParticipantDto` around any ONE of these three
consumer-shaped views would force the other two into an awkward second write path or an oversized
patch that silently touches fields the caller's UI never displayed.

**Resolution: the canonical unit is a semantic field group. Wizard steps and detail sections both
compose from these groups; neither defines them.** A step's "Next"/"Save changes" patches the N
groups its fields decompose into; a section's Save patches the 1-2 groups it maps to. Verified,
not asserted: every field in `CreateParticipantDto` was walked below and every existing
cross-field Zod refine/backend validator (`equipmentRefine`, `genderRefine`, `fundingSourceRefine`,
`livingArrangementRefine`, `contactMethodRefine`, `addressPostcodeRefine`, `weightHeightRefine`,
`diagnosisOtherRefine`, and their backend twins `ValidateGender`/`ValidateFundingSource`/
`ValidateLivingArrangement`/`ValidateAddressPostcode`/`ValidatePhone`/`ValidateEmail`/
`ValidateWeight`/`ValidateHeight`/`ValidateDiagnoses`) was checked field-by-field — **none spans
two of the groups below.** The one cross-*entity* refine that would span a group boundary (PF-2's
proposed `planType` ↔ `contactRoles` rule) is explicitly, by SPEC-02's own design, never enforced
by Patch — only by the full `PUT`/Review submit — so it isn't a counter-example.

### The field-group partition

20 groups: 16 scalar + 4 collections. `RiskEntries`/`ContactRoles` are excluded entirely (stay on
their existing nested-CRUD endpoints, per the existing create-only precedent both specs confirm);
`IsDraft`/`IsActive` are lifecycle flags, not content, and are never part of any group;
`HasRestrictivePracticeFlag` is derived and was never settable.

| Group | Member fields | Wizard step | Detail-tab section | Notes |
|---|---|---|---|---|
| `personalDetails` | FirstName, LastName, PreferredName, MiddleName, DateOfBirth, Gender, GenderSelfDescription, PlaceOfBirth, Country, Phone, Email | Identity (0) | Identity | `ValidateNames`/`ValidateGender`/`ValidatePhone`/`ValidateEmail` self-contained here. |
| `preferredStaff` | PreferredStaffId | Identity (0) | Identity | Isolated on its own so `StaffCompatibilityLinkService` sync gates on *this* group's presence+diff, not all of Identity. |
| `address` | AddressStreet, AddressSuburb, AddressState, AddressPostcode | Identity (0) | Address & Living Arrangements | `ValidateAddressPostcode` self-contained. |
| `livingArrangement` | LivingArrangement, MainSupportPersonName, MainSupportPersonRelationship, OthersLivingInAccommodation, ResidentialInfo, LivesWithOthers, WhoLivesWith, SilProviderName, SilProviderContactPhone, AccommodationType, OnSiteSupportHours, LivingArrangementNotes | Identity (0) | Address & Living Arrangements | `ValidateLivingArrangement` self-contained. PF-9's OPEN QUESTION (moving this block to the NDIS step) changes only which wizard step *references* this group — the group and CORE-02's contract are untouched either way. |
| `ndisPlan` | NdisNumber, PlanStartDate, PlanEndDate, PlanType, FundingSource, FundingOrganisation, IsDsoa, IsRepeatClient | NDIS & Funding (1) | NDIS & Funding | `ValidateFundingSource` self-contained. IsRepeatClient placed here (not with `serviceProfile`) to match PD-7's card exactly — see resolution note below. |
| `serviceProfile` | Region, ServiceStreams | NDIS & Funding (1) | *(none today)* | No PD-7 section edits these — `ServiceStreamBadges`/region are header-display only per PD-1's current-state read. Kept as its own group so a future editable section doesn't have to be carved out of `ndisPlan` later; the wizard's NDIS & Funding step patches both groups together on save. |
| `keyIdentifiers` | PensionCardNumber/Expiry, MedicareNumber/Expiry, CompanionCardNumber/Expiry, PrivateHealthFund, PrivateHealthMembershipNumber, TaxiCardNumber, HairColour, EyeColour, WeightKg, HeightCm | Key Identifiers (2) | Key Identifiers | `ValidateWeight`/`ValidateHeight` self-contained. 1:1 with both callers — no split needed. |
| `culturalBackground` | IsCald, IsLgbtqi, IsFamilyCommunity, IsAboriginalOrTorresStraitIslander, ReceivedRightsAndResponsibilitiesInfo, ReceivedPrivacyAndConfidentialityInfo, ReceivedFeedbackInfo, ReceivedBeingSafeInfo, ReceivedAdvocacyInfo, PersonalInterests, ChoiceControlNotes | Cultural & Consent (4) | Cultural Background | |
| `consents` *(collection)* | Consents | Cultural & Consent (4) | *(none — own nested CRUD)* | Reuses `UpsertConsentsAsync` verbatim; `ParticipantConsentsSection.tsx`/`ParticipantConsentsController` is a separate, pre-existing write path, unaffected. |
| `supportNeedsMobility` | IsHighSupport, IsIntensiveSupport, SupportRatio, MobilityAidWheelchair, MobilityAidWalker, MobilitySupportOptions, OvernightSupport, OvernightRatio, RequiresHiLoBed, RequiresHoist, RequiresShowerChair, RequiresCommode, RequiresStandingMachine, MobilityNotes, EquipmentRequirements, TransportRequirements, AmbulantStatus, FallsRiskRating, UnevenGroundFlag, LevelOfPersonalCare, Orthotics, ContinenceSupportDetail, BowelCareDetail, MenstruationSupport, SkinIntegrity | Support Needs & Mobility (5) | Support Profile tab (PD-6) | `equipmentRefine` self-contained. Exact match to PD-6's `supportNeedsMobility` group — no split needed, the one case where step-shape and section-shape already coincide. |
| `checklistItems` *(collection)* | ChecklistItems | Support Needs & Mobility (5, rows 0-8) **and** Behaviour & Communication (7, rows 9-20) | *(none — PD-6 explicitly excludes it)* | One flat 21-row collection split across two steps by *row*, not by field — whichever step saves resends the whole array (materialize-all-rows contract), same as today's full submit. |
| `medical` | PrimaryDiagnosis, OtherDiagnoses, HidpaSupportCategories, HidpaNotes, MedicalSummary, AllergiesDetail, IsAnaphylaxisRisk, AllergyManagementNotes | Medical (6) | Medical | `ValidateDiagnoses` self-contained. |
| `healthConditions` *(collection)* | HealthConditions | Medical (6) | *(none — own nested CRUD)* | `ParticipantHealthConditionsSection.tsx`, unaffected. |
| `behaviourCommunication` | Memory, MemoryAids, ImpairedUnderstanding, ImpairedJudgementReasoning, BehavioursOfConcernCurrent, BehavioursOfConcernFiveYearHistory, BehaviourRiskRating, RidsLogged, BspPlanProvided, BocChartProvided, ExpressiveSkills, ReceptiveSkills, ReadingAbility, CommunicationAids | Behaviour & Communication (7) | Behaviour & Communication | |
| `communityAccessBehaviour` | SignsHappyAndSettled, WhatHelpsMeCalmDown, BocTriggers, BocEarlyWarningSigns, BocDeEscalationStrategies, BocWhatNotToDo | Behaviour & Communication (7, CA-gated) | Community Access (with `supportsLookLike`) | |
| `adlAssessments` *(collection)* | AdlAssessments | Daily Living (8) | *(none — own nested CRUD)* | `ParticipantAdlAssessmentsSection.tsx`, unaffected. |
| `mealsAndDiet` | MealAssistanceDetail, ChokingRiskMealDetail, ModifiedDietDetail, PegRegimeMealDetail, SpecialUtensilsDetail, SpecialDietaryNeedsDetail, FavouriteBreakfast, FavouriteLunch, FavouriteDinner, MedicationTricks, FoodsAlwaysEaten | Daily Living (8) | Meals & Diet | |
| `aboutMe` | Goals, SupportAreas, StrengthsFears, ThingsToKnow, WhoIsImportant, LikesDislikes | Daily Living (8) | About Me | |
| `supportsLookLike` | SupportsLookLikeMorning, SupportsLookLikeDay, SupportsLookLikeAfternoonEvening, SupportsLookLikeOvernight | Daily Living (8, CA-gated) | Community Access (with `communityAccessBehaviour`) | |
| `risksHazardsSummary` | BehaviourRiskSummary, Notes | Risks & Hazards (9) | Risks & Hazards Summary | `RiskEntriesSection` stays its own nested CRUD, unaffected. |

**Field that genuinely needed an explicit resolution:** `IsRepeatClient`. PF-10.1 (SPEC-05) tags
`region`/`isRepeatClient`/`serviceStreams` as one unit for *entry-phase* purposes — a different
axis, answering "which future wizard asks for this," not "what must be patched together today."
For CORE-02's purposes, PD-7's Details-tab table lists "Repeat Client" under its **NDIS & Funding**
card, not alongside Region/ServiceStreams (which don't appear as editable in any Details-tab
section at all today — they're header-display only). Resolved: `IsRepeatClient` → `ndisPlan`;
`Region`/`ServiceStreams` → their own `serviceProfile` group. These are two independent
classification systems (patch-grouping vs. entry-phase-tagging) and are not required to agree.

**Atomicity rule — this is the design's load-bearing simplification.** Presence is all-or-nothing
at the **group** level, not the field level: a present group's nested DTO carries every one of its
member fields, mirroring a mini full-submit for that group. This is not a limitation in practice —
every real caller already holds every group-member field in memory when it saves: a wizard step's
RHF state (via `reset()`-from-`existing`) always has the whole form, and a Details-tab
`SectionEditPanel` always edits a whole card's fields together. Nobody needs "send just the one
field I touched, leave the rest of the group untouched" — they need "leave *other groups*
untouched," which is exactly what an **absent** top-level key means. This is also why validation
needs no "merge with the existing entity" step (see below): a present group is validated purely
from its own incoming payload, because every existing validator's fields already sit entirely
inside one group.

### Design — endpoint

**`PATCH /api/v1/participants/{id}`**, one generic endpoint — **not** PD-7's originally-floated
"one PUT route per section" (`PUT .../sections/{section}`). Explicitly overriding that suggestion:
a single endpoint lets a save span more than one group in one atomic call (Identity's "Save" needs
`personalDetails` + `preferredStaff` together), avoids 12 near-identical thin controller methods,
and is what SPEC-02's own core02 draft already assumed — PD-7's alternative would need reconciling
against it anyway.

```csharp
public record PatchParticipantDto
{
    public PatchPersonalDetailsDto? PersonalDetails { get; init; }
    public PatchPreferredStaffDto? PreferredStaff { get; init; }
    public PatchAddressDto? Address { get; init; }
    public PatchLivingArrangementDto? LivingArrangement { get; init; }
    public PatchNdisPlanDto? NdisPlan { get; init; }
    public PatchServiceProfileDto? ServiceProfile { get; init; }
    public PatchKeyIdentifiersDto? KeyIdentifiers { get; init; }
    public PatchCulturalBackgroundDto? CulturalBackground { get; init; }
    public PatchSupportNeedsMobilityDto? SupportNeedsMobility { get; init; }
    public PatchMedicalDto? Medical { get; init; }
    public PatchBehaviourCommunicationDto? BehaviourCommunication { get; init; }
    public PatchCommunityAccessBehaviourDto? CommunityAccessBehaviour { get; init; }
    public PatchMealsAndDietDto? MealsAndDiet { get; init; }
    public PatchAboutMeDto? AboutMe { get; init; }
    public PatchSupportsLookLikeDto? SupportsLookLike { get; init; }
    public PatchRisksHazardsSummaryDto? RisksHazardsSummary { get; init; }

    // Collections reuse the existing item DTOs directly. null = untouched; non-null = replace/
    // upsert the whole collection — same materialize-all-rows contract as a full submit, and
    // exactly the "absent vs. null" distinction PF-10.4 requires.
    public List<CreateParticipantConsentDto>? Consents { get; init; }
    public List<CreateParticipantHealthConditionDto>? HealthConditions { get; init; }
    public List<CreateParticipantAdlAssessmentDto>? AdlAssessments { get; init; }
    public List<CreateParticipantChecklistItemDto>? ChecklistItems { get; init; }
}
```

Each `PatchXDto` is a flat record carrying exactly its group's fields, same types as
`CreateParticipantDto`'s matching properties (all already nullable/optional there, so no new
nullability decisions are needed).

**Controller behaviour** (`ParticipantsController.Patch`, new method, `[HttpPatch("{id:guid}")]`,
`[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]` — identical to `Update`'s existing gate):

1. Load the participant (404 if missing/wrong tenant, standard `ITenantEntity` filter).
2. For each **present** group, run exactly the existing validator(s) whose fields fall inside it,
   against that group's own incoming values (no entity merge needed — see Atomicity rule):
   `PersonalDetails` → `ValidateNames`/`ValidateGender`/`ValidatePhone`/`ValidateEmail`;
   `PreferredStaff` → `IsValidPreferredUserRefAsync`; `Address` → `ValidateAddressPostcode`;
   `LivingArrangement` → `ValidateLivingArrangement`; `NdisPlan` → `ValidateFundingSource`;
   `KeyIdentifiers` → `ValidateWeight`/`ValidateHeight`; `SupportNeedsMobility` → the existing
   `MobilitySupportOptions` inline check + `equipmentRefine`'s backend twin (extract if it doesn't
   already exist server-side — confirm at implementation time); `Medical` → `ValidateDiagnoses`.
   Groups with no existing validator (`ServiceProfile`, `CulturalBackground`,
   `BehaviourCommunication`, `CommunityAccessBehaviour`, `MealsAndDiet`, `AboutMe`,
   `SupportsLookLike`, `RisksHazardsSummary`) skip this step — there is nothing to check, matching
   today's full submit exactly (these fields have no server-side format rules today either).
3. Apply each present group's fields onto the entity via plain property assignment — literally the
   same statements `Update` already has, scoped to the present group(s)' properties only.
4. For each present collection, call the existing `UpsertConsentsAsync`/`UpsertHealthConditionsAsync`/
   `UpsertAdlAssessmentsAsync`/`UpsertChecklistItemsAsync` — no new upsert logic.
5. If `PreferredStaff` is present and its `PreferredStaffId` differs from the entity's current
   value, call `StaffCompatibilityLinkService.SyncFromParticipantPreferredStaffAsync` with the
   old/new values — same diffing `Update` already does at `:941`, just gated on group presence
   instead of always running.
6. `SaveChangesAsync`, return the updated `ParticipantDetailDto` — same response shape as `PUT`.
7. **`PatchParticipantDto` has no `IsDraft` field at all** — not merely ignored, structurally
   absent — so a partial save can neither finalise a draft nor draft a finalised participant.
   That distinction stays exclusively `PUT`'s job.

**Validation differs from a full submit** exactly as much as the field-group partition allows, no
more: every existing single-step Zod refine/backend validator was confirmed self-contained within
one group (see "The central problem" above), so Patch's per-group validation is a straight
slice of today's Create/Update validation, not a redesign. The one deliberately-deferred rule is
PF-2's proposed `PlanType` ↔ `ContactRoles` cross-entity refine — SPEC-02 already rules this is
**never** enforced by Patch (only by the full submit), and `ContactRoles` isn't a patchable group
at all, so there is nothing for Patch to reconcile here.

**Concurrency: last-write-wins per group, no version/ETag — recommended, not left open.**
Evidence: `RowVersion`/`ConcurrencyToken`/`[Timestamp]`/ETag has **zero** hits anywhere in
`Odip.Domain`/`Odip.Infrastructure`/`Odip.Api` (grepped). Today's whole-payload `PUT` is *already*
last-write-wins across all ~150 fields with no concurrency check whatsoever. A per-group PATCH
with the same policy, scoped to only the fields in the group(s) being saved, is a strict reduction
in collision blast radius versus today — two coordinators editing different sections
"simultaneously" can no longer clobber each other's *unrelated* fields the way two overlapping
`PUT`s can right now. Introducing the codebase's first version/ETag mechanism to solve a problem
that's already smaller than today's status quo would be a disproportionate, precedent-setting
change for this branch to make unilaterally.

**`ContactRoles` stays excluded — confirmed, not challenged.** It has its own full nested-CRUD
controller (`ParticipantContactRolesController`) already used everywhere contacts are added/edited
post-creation; giving it a second write path through Patch would directly reopen the
"which write wins" question SPEC-02's own Dual-write-inconsistency section flags as deliberately
avoided for `riskEntries`/`contactRoles`.

**Authorisation.** PATCH uses `[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]` — byte-identical
to `Update`'s existing gate, not the frontend's broader `canWrite` (`!isSupportWorker`, which SPEC-03
independently found is looser than the real backend gate on `PUT`). The frontend's
`usePatchParticipant()` hook and every consumer of it (PF-1's "Save changes", PD-6's
`supportNeedsMobility` panel, PD-7's 11 section panels) must be gated by `canWriteParticipantDetails`
(the new boolean SPEC-03/PD-6 introduces, `isSuperAdmin || isAdmin || isCoordinator`) — never the
broader `canWrite`. This is the same gate PD-6/PD-7 already independently converged on; CORE-02
confirms it's the correct one rather than inventing a second.

**Frontend hook.** One generic hook, not 12 or 9 separate ones (reconciling SPEC-02's
`usePatchParticipant()` naming against SPEC-03's `useUpdateParticipantSection(section)`
alternative — the former wins, since a single hook already accepts "however many groups this
save needs" without a per-section wrapper):

```ts
// frontend/src/api/hooks/participants.ts
export function usePatchParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PatchParticipantDto }) =>
      apiPatchRaw<ParticipantDetailDto>(`/participants/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
    },
  })
}
```
Same invalidate-on-success shape as `useUpdateParticipant` (`participants.ts:55-64`). `apiPatchRaw`
is a new thin wrapper in `api/client.ts` mirroring `apiPutRaw`/`apiPostRaw` — confirm the exact
existing helper names at implementation time.

### Implementation

1. **New** `backend/Odip.Application/DTOs/ParticipantPatchDTOs.cs` — `PatchParticipantDto` and its
   16 nested `PatchXDto` records, per the group table above.
2. **`backend/Odip.Api/Controllers/ParticipantsController.cs`** — new `Patch(Guid id,
   PatchParticipantDto dto, CancellationToken ct)` per the controller behaviour above. Where a
   validator method's signature currently takes `CreateParticipantDto`, either overload it to
   accept the narrower group DTO's own shape or construct a minimal transient object satisfying
   the existing signature — pick whichever keeps the *existing* Create/Update call sites
   untouched; this is an implementation-time call, not a design one, since both are equally
   behaviour-preserving.
3. **New test**: `backend/Odip.Tests/Controllers/ParticipantsControllerPatchTests.cs` — one group
   patched in isolation leaves every other group's fields and every collection untouched;
   validation runs only for present groups; `PreferredStaff` absent never triggers the
   compatibility-link sync; a 404 for a wrong-tenant/missing id; `PatchParticipantDto` has no way
   to express `IsDraft` (compile-time property, not a runtime test).
4. **New** `frontend/src/api/types/participant-patch.ts` — TypeScript types mirroring all 20
   groups (16 scalar interfaces + the 4 collection fields, reusing existing item types).
5. **`frontend/src/api/hooks/participants.ts`** — `usePatchParticipant()` as designed above.
6. **`frontend/src/api/client.ts`** — `apiPatchRaw` helper, if one doesn't already exist.

### Acceptance

- `PATCH /api/v1/participants/{id}` with `{ "ndisPlan": { "fundingSource": "Other" } }` and no
  `fundingOrganisation` returns the existing `ValidateFundingSource` error; with both present,
  saves and a re-fetch shows only those two fields changed.
- Patching `personalDetails` alone never touches `preferredStaff`, `address`, or any other group's
  columns, and never calls `StaffCompatibilityLinkService`.
- Patching `supportNeedsMobility` alone never touches `checklistItems`, and vice versa.
- No request body can set `IsDraft` through this endpoint (it isn't a member of the DTO).
- `dotnet build`/`dotnet test` clean; `npm run build`/`npm test` clean for the new hook/types.

### Consumer contract

- **SPEC-02 (PF-1)**: `STEP_TO_PATCH_GROUP: Record<number, keyof PatchParticipantDto>` (PF-1's
  Implementation §2) must become **`STEP_TO_PATCH_GROUPS: Record<number, (keyof
  PatchParticipantDto)[]>`** — a correction to PF-1's draft, flagged explicitly since it's real,
  if small, rework: each wizard step composes from 1-4 groups, not exactly 1.
  `0 → ['personalDetails','preferredStaff','address','livingArrangement']`,
  `1 → ['ndisPlan','serviceProfile']`, `2 → ['keyIdentifiers']`, `4 →
  ['culturalBackground','consents']`, `5 → ['supportNeedsMobility','checklistItems']`,
  `6 → ['medical','healthConditions']`, `7 →
  ['behaviourCommunication','communityAccessBehaviour','checklistItems']`,
  `8 → ['adlAssessments','mealsAndDiet','aboutMe','supportsLookLike']`,
  `9 → ['risksHazardsSummary']` (steps 3/10 excluded, as PF-1 already specifies).
- **SPEC-03 (PD-6/PD-7)**: gets its 12 groups exactly — `supportNeedsMobility` (PD-6, unsplit);
  `personalDetails`+`preferredStaff` (Identity); `address`+`livingArrangement` (Address & Living
  Arrangements); `ndisPlan` (NDIS & Funding); `keyIdentifiers`; `culturalBackground`; `medical`;
  `behaviourCommunication`; `communityAccessBehaviour`+`supportsLookLike` (Community Access);
  `mealsAndDiet`; `aboutMe`; `risksHazardsSummary`. `canWriteParticipantDetails` is confirmed as
  the correct gate for all of them. PD-6's separate `supportProfile` group (the `/support-profile`
  sub-resource) is confirmed **out of scope for `PatchParticipantDto`** — it keeps using the
  existing, unchanged `PUT /support-profile` endpoint, exactly as PD-6 already assumed.
- **SPEC-04**: no dependency on CORE-02 — incidents use their own entities/DTOs entirely.
- **SPEC-05 (PF-10.3/PF-10.4)**: PF-10.3 (Intake) needs **no** new backend primitive — intake
  completion is a single `POST`, confirmed. PF-10.4 (Profile) is the consumer this design is
  future-proofed for: because these 20 groups are independent of *any* wizard's step boundaries,
  PF-10.1's restructuring of today's 9 steps into two new wizards does not invalidate this
  contract — the Profile wizard's own (still-to-be-designed) steps will each compose from whichever
  of these same 20 groups their fields intersect, the same way today's 9 steps do. When PF-10.2's
  `CommunityAccessRiskItems` collection and `OverallCommunityAccessRiskRating` scalar land, they
  extend `PatchParticipantDto` with one new collection member and one new scalar (folded into a
  follow-up `communityAccessRisk` group or added to `communityAccessBehaviour` — a small, additive
  change at that time, not a redesign) — flagged as a known future extension, not built now.

---

## Consumer impact matrix

| Item | Needs CORE-01 | Needs CORE-02 | What breaks if that piece shipped differently |
|---|---|---|---|
| PF-1 | Yes (secondary-action slot) | Yes (PATCH, `STEP_TO_PATCH_GROUPS`) | A step-shaped-only Patch (SPEC-02's original draft) would already work for PF-1 alone, but would need reworking the moment PD-7 or PF-10.4 landed — see PD-7/PF-10.4 rows. |
| PF-2 | No | Indirectly (Patch must NOT enforce the PlanType↔ContactRoles rule) | If Patch hard-enforced it, an edit-mode participant with a temporarily-missing Plan Manager could never save any other field via "Save changes" — directly defeats PF-1. |
| PF-3 | No | No | Verification-only; nothing to break. |
| PF-4 | Yes (shell instance exists) | No (existing nested-CRUD endpoint) | None — independent of both. |
| PF-5 / PF-6 | Yes (shell instance exists) | No | None — independent of both. |
| PF-7 / PF-8 | No (component-level only) | No | None. |
| PF-9 | Yes (string-keyed `visitedSteps`/`fieldToStepKey`) | No | A numeric-index shell would silently corrupt `visitedSteps`/jump-to-step behaviour the moment Living Arrangement moves between steps — the exact risk CORE-01's fixed decision #1 exists to prevent. |
| PD-1 through PD-5 | No | No | Independent frontend/backend work, no foundation dependency. |
| PD-6 | No | Yes (`supportNeedsMobility` group) | If CORE-02 had merged support fields into a larger step-shaped group instead of isolating `supportNeedsMobility`, PD-6's tab would over-patch fields it doesn't display. |
| PD-7 | No | Yes (11 groups) | **The central case for semantic groups over step-shaped ones**: "Address & Living Arrangements" isn't a wizard step at all (it's half of Identity) — a step-shaped-only Patch would force this section to resend all of Identity's fields (including ones it never displays) on every save, or require a second, incompatible endpoint. |
| IN-1 through IN-8 | Yes (computed step list, string keys) | No | Incidents have no participant-patch dependency; IN-1's own acceptance criteria are satisfied entirely by CORE-01. |
| PF-10.1 | No directly (sets up `fieldsForEntry()` consumed later) | No | None yet — its `entryPhase` tagging is orthogonal to CORE-02's groups (see resolution note above). |
| PF-10.2 | No | Extends CORE-02 later (flagged, not built now) | If the new `CommunityAccessRiskItems` collection isn't added as its own group later, PF-10.4's per-step save for the CA risk grid would have no patchable home. |
| PF-10.3 | Yes (data-driven steps) | No (confirmed — plain `POST` only) | None. |
| PF-10.4 | Yes (data-driven steps, CA-conditional section, async-`validate`-as-PATCH-on-Next) | Yes, heavily (per-step save composing from these 20 groups) | If CORE-02 had shipped step-shaped-only (matching *today's* 9 steps), PF-10.1's restructuring would invalidate the entire contract on arrival — semantic groups are specifically what survives that restructuring. |
| PF-10.5 / PF-10.6 / PF-10.7 | No | No | Independent lifecycle/document/migration work. |
