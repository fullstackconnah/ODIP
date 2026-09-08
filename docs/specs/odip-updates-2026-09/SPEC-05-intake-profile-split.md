# SPEC 05 — Intake / Participant Profile split

Source backlog item, verbatim:

> Are we able to split the form into 2 parts. An intake form and a participant profile as per the
> examples given. The intake should lead into the participant profile and any common fields should
> be removed for the time being.

"The examples given" are the four Oassist paper forms inventoried in `discovery/05-oassist-forms.md`:
Intake Client Needs Assessment, Client Overview (a derived cheat-sheet, not a form to build), the
general Participant Profile V2026 (which doubles as a holiday/STA booking form), and the Profile —
Community Access variant (HIDPA-as-a-section plus an itemised risk-assessment matrix).

Discovery evidence: `discovery/05-oassist-forms.md` (the four forms), `discovery/02-participant-form.md`
(the current 11-step wizard), `discovery/03-participant-tabs.md` (the detail page).

**Foundation dependency, not re-litigated here:** `feat/core01-wizard-shell` (a reusable
Wizard/Stepper under `frontend/src/components/wizard/`) and `feat/core02-participant-partial-save`
(a real partial-update primitive; today there is no PATCH anywhere on `ParticipantsController` —
only whole-payload `POST`/`PUT` plus a same-endpoint, looser `isDraft` variant). Every branch below
assumes both exist. §"Requirements on the foundation branches" states exactly what this spec needs
from each, for the teams building those branches.

## A finding that changes the shape of this work

This is **not a green-field split**. Nine prior sub-waves (INTAKE-01 through INTAKE-09, DIAG-01/02,
CONTACT-01/02/03, LIVING-01..04, FUND-01/02, DOC-01) already did the hard analytical part of this
exact job, for a different consumer — the PDF export pipeline:

- `frontend/src/lib/documentMapping.ts` (`DOCUMENT_MAPPING`, 130+ entries) tags **every** wizard
  field with `sources: ('intake' | 'profile' | 'shared')[]`, cross-referenced against the same four
  Oassist documents this spec was asked to use, complete with Master Data Dictionary ids and
  per-field gap/ambiguity notes.
- `backend/Odip.Infrastructure/Services/ParticipantDocumentFieldMap.cs` is a hand-kept C# mirror of
  the same tagging, consumed by `ParticipantDocumentComposer.ComposeIntakeForm`/`ComposeParticipantProfile`
  to produce two separate PDFs today — "Intake Form" and "Participant Profile" — from the **same**
  Participant row, already split by these exact tags, already handling the Community-Access-gated
  section as a conditional subset of one Profile document (`includeCommunityAccess` bool), already
  landed and tested (`GET /api/participants/{id}/documents/intake`, `.../documents/profile`,
  frontend buttons on `ParticipantDetailPage.tsx`).

So the field-level "does this belong on the Intake document or the Profile document" analysis this
spec was asked to produce **already exists, at higher precision than a fresh read of the four
Oassist docs would produce** (it also resolves ambiguities the raw inventory flags, e.g. the
NDIS-number-vs-plan-number question). §PF-10.1's job is to promote that existing *document*-tagging
into an *entry*-tagging (which wizard captures a field, not just which PDF prints it) and to plug the
gaps left by fields with `sources: []` (ODIP-operational fields the 4 Oassist docs don't mention at
all — these still need a home in one of the two new wizards). The real, non-trivial delta this spec
adds on top of the prior work is: (1) the wizard is still a single 3,608-line monolith with one
schema and one payload — nothing has actually been split as *separate UIs* yet; (2) two genuine
content gaps remain unbuilt (Financial Administrator contact type, Community Access risk-rating
matrix — §2); (3) the intake→profile *progression* (create-now-vs-later, resume, bookability) has
never been designed, because until now there was only ever one wizard to resume.

---

## PF-10.1 — Intake/Profile field-allocation contract & de-duplication

**Branch:** `feat/pf1001-field-allocation-contract`

### Current state
`DOCUMENT_MAPPING` answers "which PDF renders this field" via `sources`. Nothing today answers
"which wizard captures this field" — that question doesn't exist yet because there is only one
wizard. A `sources: []` field (no Oassist backing) has no signal at all for the new split.

### Design

**Allocation principle:** **Intake** captures what is needed to safely accept a referral and start
support — identity, contacts, funding status, immediate safety/behaviour flags, and day-one
mobility/equipment needs. **Profile** captures the depth that accumulates once support has begun —
structured clinical detail, daily-living preferences, key-identifier cards, and anything scoped to a
single service stream (Community Access). A field present on **both** Oassist source forms
(`sources: ['shared']`) is captured **once, at Intake**, and merely **displayed** (read-only) on the
Profile wizard/detail page — never re-asked. This directly implements "any common fields should be
removed for the time being."

**Mechanism:** add a required `entryPhase: 'intake' | 'profile'` to every `DocumentMappingEntry` in
`documentMapping.ts`. For a `sources: ['shared']` field, `entryPhase` is always `'intake'` (it is
entered once, there). For `sources: ['intake']` or `['profile']`, `entryPhase` matches. For
`sources: []` fields, this branch is what actually decides the value (table below). This keeps one
authoritative file — no second parallel list, no C#/TS drift beyond what already exists between
`documentMapping.ts` and `ParticipantDocumentFieldMap.cs` (that pre-existing, hand-kept mirror is
unaffected — it stays scoped to PDF rendering and needs no `entryPhase`).

### The split — full field allocation

Legend: **Entry** = which wizard captures the field. **On Profile?** = for an Intake-entry field,
whether it is displayed (read-only) on the Profile wizard/detail page. "—" = not applicable (already
Profile-entry, or the field has no Profile-side existence).

#### Participant Details (Identity step)

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| firstName, lastName, preferredName | Intake | Yes | shared |
| dateOfBirth | Intake | Yes | shared |
| phone, email | Intake | Yes | shared |
| addressStreet/Suburb/State/Postcode | Intake | Yes | shared |
| middleName | Profile | — | profile-only, no Intake contacts-table column |
| gender, genderSelfDescription | Profile | — | Intake coversheet has no gender field |
| placeOfBirth, country | Profile | — | profile-only |
| preferredStaffId | Profile | — | ODIP rostering match; not essential to accept a referral safely (§2, keep/drop table) |
| livingArrangement + LIVING-01..04 block (mainSupportPersonName/Relationship, othersLivingInAccommodation, residentialInfo, livesWithOthers, whoLivesWith, silProviderName, silProviderContactPhone, accommodationType, onSiteSupportHours, livingArrangementNotes) | **Intake** | Yes (display) | ODIP-only (no Oassist backing) but directly answers "who else is in the home / is a SIL provider already involved" — needed to plan support safely from day one, so allocated to Intake despite `sources: []`. Loosely echoes Profile's "Living Situation" free text. |

#### NDIS & Funding

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| ndisNumber, planStartDate, planEndDate, planType, fundingSource | Intake | Yes | shared |
| fundingOrganisation | Intake | Yes | elaboration of fundingSource=Other |
| region, isRepeatClient, serviceStreams | Intake | Yes | ODIP-only, but service-stream/region routes the referral to the right team on day one |
| isDsoa | Profile | — | Key-Identifiers-adjacent, profile-only per source |

#### Key Identifiers — **entire step moves to Profile**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| pensionCardNumber/Expiry, medicareNumber/Expiry, companionCardNumber/Expiry, privateHealthFund, privateHealthMembershipNumber, taxiCardNumber, hairColour, eyeColour, weightKg, heightCm | Profile | — | all profile-only per source; none of this blocks starting support |

#### Contacts

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| contactRoles (Next of Kin, Support Coordinator, Plan Manager, Plan Nominee, GP, etc.) | Intake | Yes (via Contacts tab, unchanged) | shared — captured once at intake, the existing detail-page Contacts tab remains the only place to add/edit roles after creation, exactly as today |

#### Support Needs & Mobility — **fissions**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| mobilityAidWheelchair, overnightSupport, overnightRatio, requiresHiLoBed/Hoist/ShowerChair/Commode/StandingMachine, supportRatio | Intake | Yes | shared — day-one physical support needs |
| isHighSupport, isIntensiveSupport | Intake | Yes | ODIP billing/support-level flags; needed for initial rostering/billing setup |
| mobilityAidWalker | Intake | No | intake-only per source (Intake's equipment checklist; Profile models it differently, under Non-Ambulant) |
| mobilitySupportOptions, mobilityNotes, equipmentRequirements, transportRequirements, ambulantStatus, fallsRiskRating, unevenGroundFlag, levelOfPersonalCare, orthotics, continenceSupportDetail, bowelCareDetail, menstruationSupport | Profile | — | all profile-only per source (Client Functional Information table) |

#### Medical — **fissions**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| medicalSummary, hidpaNotes | Intake | Yes | shared / deliberately-Shared deviation (see `documentMapping.ts` comment) — the free-text "Health Conditions/Diagnoses" line both source forms carry |
| primaryDiagnosis, otherDiagnoses, hidpaSupportCategories, allergiesDetail, isAnaphylaxisRisk, allergyManagementNotes, healthConditions (structured grid) | Profile | — | all profile-only — the structured Diagnoses & Medical Conditions table and Dietary allergy row are Profile-only in the source forms |

#### Cultural & Consent — **fissions**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| isCald, isLgbtqi, isFamilyCommunity, isAboriginalOrTorresStraitIslander, receivedRightsAndResponsibilitiesInfo, receivedPrivacyAndConfidentialityInfo, receivedFeedbackInfo, receivedBeingSafeInfo, receivedAdvocacyInfo | **Intake** | Yes | shared — "the clearest one-to-one duplicate in the whole set" (identical table, identical wording, on both source forms) |
| personalInterests, choiceControlNotes | Profile | — | profile-only |
| consents — PhotoVideo, Privacy, EmergencyMedical | Profile | — | profile-only, **ungated** (every participant, regardless of service stream — these appear in both Profile source documents unconditionally) |
| consents — Alcohol, OtcMedication, TravelInsurance, TermsAndConditions | Profile | — | profile-only, **conditional**: rendered/collectible only when `serviceStreams` includes `STA` (see §PF-10.4's gating predicate) — settled per product decision, no longer an open question |

#### Behaviour & Communication — **fissions**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| behavioursOfConcernCurrent, behavioursOfConcernFiveYearHistory, expressiveSkills | Intake | Yes | shared |
| memory, memoryAids, impairedUnderstanding, impairedJudgementReasoning, behaviourRiskRating, ridsLogged, bspPlanProvided, bocChartProvided, receptiveSkills, readingAbility, communicationAids | Profile | — | all profile-only |

#### Daily Living — **entire step moves to Profile**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| adlAssessments (all 20 rows), mealAssistanceDetail, chokingRiskMealDetail, modifiedDietDetail, pegRegimeMealDetail, specialUtensilsDetail, specialDietaryNeedsDetail, favouriteBreakfast/Lunch/Dinner, medicationTricks, foodsAlwaysEaten, goals, supportAreas, strengthsFears, thingsToKnow, whoIsImportant, likesDislikes | Profile | — | all profile-only per source |

#### Community Access (entire section, `CommunityAccessDailyLiving` stream only) — **Profile**

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| signsHappyAndSettled, whatHelpsMeCalmDown, bocTriggers, bocEarlyWarningSigns, bocDeEscalationStrategies, bocWhatNotToDo, supportsLookLikeMorning/Day/AfternoonEvening/Overnight, checklistItems (21-row Mobility & Behaviour checklist) | Profile | — | belongs to the Community Access *variant* of the Profile — see §2's one-vs-two-profile decision |

#### Risks & Hazards

| Field | Entry | On Profile? | Notes |
|---|---|---|---|
| behaviourRiskSummary | Intake | Yes | shared |
| notes (general) | Intake | Yes | referral-time catch-all; see §2 keep/drop for whether a second, profile-stage notes field is also wanted |
| riskEntries (at-risk-party register) | Intake | Yes (via detail-page Risks section, unchanged) | already create-mode-only in today's wizard — this allocation just formalises existing behaviour: an immediate safety register belongs at intake |

### Implementation
1. `frontend/src/lib/documentMapping.ts` — add `entryPhase: 'intake' | 'profile'` to
   `DocumentMappingEntry` and set it on every one of the ~140 entries per the tables above. Add
   `fieldsForEntry(phase: 'intake' | 'profile')` alongside the existing `fieldsForDocument`, used by
   PF-10.3/PF-10.4 as the single source of truth for each wizard's field set — **no hand-authored
   duplicate field list in either wizard component**.
2. Extract the current inline `baseParticipantSchema` + every `superRefine` (`ParticipantCreatePage.tsx:33-460`)
   out of that file into **new** `frontend/src/lib/participantSchema.ts`. Keep the single flat
   `ParticipantFormData` type (no reason to split it — a partial-update payload is still a subset of
   the same shape). Add `intakeParticipantSchema` / `profileParticipantSchema` built via `.pick()`
   from `fieldsForEntry('intake')` / `fieldsForEntry('profile')`, mirroring today's
   `STEP_SCHEMAS[...] = baseParticipantSchema.pick({...})` pattern exactly.
3. `backend/Odip.Infrastructure/Services/ParticipantDocumentFieldMap.cs` — no code change; its
   existing doc comment already declares itself an independent, hand-kept mirror of
   `documentMapping.ts`'s `sources` (not `entryPhase`). Add one line to that doc comment
   cross-referencing this spec so a future reader knows a third file (`entryPhase`) now exists
   alongside it, without conflating the two purposes.

### Acceptance
- Every entry in `DOCUMENT_MAPPING` has a non-null `entryPhase`.
- `fieldsForEntry('intake')` ∩ `fieldsForEntry('profile')` is empty (no field is claimed by both).
- `intakeParticipantSchema`/`profileParticipantSchema` compile and, unioned, `.pick()` the same key
  set `baseParticipantSchema` covers today (minus the four fixed-array collections, which stay
  Profile-entry per PF-10.1's tables above — a new test asserts this via `Object.keys(...)`).
- `npm run build` clean, `npm test` green (this branch changes no runtime behaviour — no wizard yet
  reads `entryPhase` — so no existing test should need updating).

---

## PF-10.2 — Closing the two genuine content gaps

**Branch:** `feat/pf1002-content-gaps`

### Current state
Every other field the four Oassist documents ask for already has a backing Participant/child-entity
field (nine prior sub-waves built it). Two do not:

1. **Financial Administrator** — Profile V2026's contact block explicitly separates "Financial
   Administrator" from Guardian/Plan Nominee/Plan Manager/Solicitor. `ContactRoleType`
   (`backend/Odip.Domain/Enums/ContactRoles.cs`, 14 values) has no such member —
   `frontend/src/api/types/contacts.ts:142` currently labels the closest existing role
   `Solicitor: 'Solicitor / Financial Administrator'`, bundling two distinct real-world roles under
   one enum member and one display label.
2. **Community Access Risk Assessment — itemised rating matrix.** Profile — Community Access
   §10 asks for 22 named risk items across three categories (Road & Traffic Safety, Behaviours of
   Concern, Health & Personal Safety), each rated Low/Med/High/Critical **with a free-text
   Support/Strategy note per item**, plus an overall rating. The existing `checklistItems`
   (`ChecklistItemType`, `ChecklistItemValue = 'No'|'Yes'|'NotApplicable'`) is a Yes/No/NA checkbox
   list, not a rated matrix — genuinely a different shape, not a relabelling. `riskEntries`
   (INTAKE-09) is explicitly documented as *not* this: "NOT the same structured tool as the source
   spec's §4.10 Risk Assessment (FRAT-style scored register) — flagged there as a separate, much
   larger design effort, not yet built" (`documentMapping.ts:387-389`). This is that effort.

A third, softer gap — Community Access §2's 12-item consolidated "Diagnosis" multi-select
(Intellectual Disability, Mental Health, Autism (ASD), Vision/Hearing Impairment, Epilepsy, Diabetes,
Asthma, Dysphagia, Acquired Brain Injury, Physical Disability, Other) — is **not** recommended for a
new field: `otherDiagnoses` already supports free-entry chips alongside `primaryDiagnosis`'s curated
list, so every one of those 12 values is already expressible. Building a second, parallel
consolidated-checklist field would duplicate `primaryDiagnosis`/`otherDiagnoses` for no new
capability. Not built; no branch item below for it.

### Design
- Add `FinancialAdministrator = 14` to `ContactRoleType` (additive — no renumbering of the existing
  14 values). Revert the `Solicitor` label back to plain "Solicitor". This is additive-only and
  needs a migration (new enum value stored as an int) but no data backfill — no existing
  `Solicitor` row is reclassified automatically (see Acceptance; an operator can manually retype
  rows they know are actually Financial Administrators via the existing Contacts tab edit form,
  post-deploy).
- New entity `ParticipantCommunityAccessRiskItem` (one row per rated item, same
  "fixed-enumerated-set, materialize all N rows" shape as `ParticipantHealthCondition`/
  `ParticipantAdlAssessment`/`ParticipantChecklistItem`): `ParticipantId`, `ItemType` (new
  `CommunityAccessRiskItemType` enum, 22 values across 3 categories, fixed declaration order
  mirroring `AdlTypeGroups`/`ChecklistItemTypeGroups`'s precedent), `Rating` (reuse the existing
  `RiskRatingLevel` enum — Low/Medium/High/Critical, already shared by `fallsRiskRating` and
  `behaviourRiskRating`, per that enum's own doc comment inviting reuse), `StrategyNotes` (string?).
  A 23rd, non-itemised field `OverallCommunityAccessRiskRating: RiskRatingLevel?` lives directly on
  `Participant` (single value, not a row) alongside the item collection.
  This is Profile-entry, Community-Access-gated (§PF-10.1 "Community Access" section), so it lands
  in PF-10.4 (the Profile wizard), not PF-10.3.

### Implementation
1. **New migration** `backend/Odip.Infrastructure/Migrations/` — add `FinancialAdministrator` to the
   `ContactRoleType` enum (C# enum change only; EF stores it as an int column, so no schema DDL is
   needed for this half — confirm via `dotnet ef migrations add PF10_02_ContactRoleFinancialAdmin`
   that EF agrees, since some other migration in this codebase may model role types differently).
2. `frontend/src/api/types/enums.ts` — add `'FinancialAdministrator'` to `CONTACT_ROLE_TYPES`.
   `frontend/src/api/types/contacts.ts:142` — revert `Solicitor` label to `'Solicitor'`; add
   `FinancialAdministrator: 'Financial Administrator'`.
3. **New** `backend/Odip.Domain/Enums/CommunityAccessRisk.cs` — `CommunityAccessRiskItemType` enum
   (22 values, fixed order: 5 Road & Traffic Safety, 8 Behaviours of Concern, 9 Health & Personal
   Safety, verbatim labels from `discovery/05-oassist-forms.md` §10) plus a
   `CommunityAccessRiskItemTypeGroups` static class mirroring `AdlTypeGroups`'s shape
   (`RoadTraffic`, `BehavioursOfConcern`, `HealthAndPersonalSafety`, `CategoryOf(type)`).
4. **New** `backend/Odip.Domain/Entities/ParticipantCommunityAccessRiskItem.cs` — fields as designed
   above; `[Table]`/FK to `Participant` matching the sibling entities' conventions exactly.
5. `backend/Odip.Domain/Entities/Participant.cs` — add
   `public RiskRatingLevel? OverallCommunityAccessRiskRating { get; set; }` in the Community-Access
   field group (near `signsHappyAndSettled` etc.), with a doc comment cross-referencing this spec.
6. **New migration** for the new table + the new `Participant` column.
7. `backend/Odip.Application/DTOs/DTOs.cs` — add `CommunityAccessRiskItems: List<CreateParticipantCommunityAccessRiskItemDto>`
   to `CreateParticipantDto` (materialize-all-22-rows shape, same pattern as `HealthConditions`) and
   `OverallCommunityAccessRiskRating: RiskRatingLevel?` scalar.
8. `ParticipantsController.cs` — wire the new collection through Create/Update exactly like
   `HealthConditions`/`ChecklistItems` are wired today (same materialize/validate helper shape).
9. `frontend/src/api/types/enums.ts` — add `COMMUNITY_ACCESS_RISK_ITEM_TYPES` (22-value array,
   fixed order) + groups, mirroring `CHECKLIST_ITEM_TYPES`'s existing pattern.
10. `frontend/src/lib/documentMapping.ts` — add the 23 new fields, `entryPhase: 'profile'`,
    `serviceStreams: ['CommunityAccessDailyLiving']` (matching the rest of the CA section).
11. `backend/Odip.Infrastructure/Services/ParticipantDocumentFieldMap.cs` +
    `ParticipantDocumentComposer.cs` — add a `BuildCommunityAccessRiskTable` builder (columns: Item,
    Category, Rating, Strategy) so the existing Participant Profile PDF picks the new matrix up
    automatically, `caGated: true`, matching every other CA-section entry's precedent exactly.
12. UI: a new `DataTable`-based grid on the Profile wizard's Community Access section — one row per
    `CommunityAccessRiskItemType` (pre-materialized, same "all N rows always rendered" UX as the
    ADL/Health-Condition grids), `Dropdown` for Rating (never a native `<select>`, per GEN-1's
    house rule), textarea for Strategy Notes. Plus one `Dropdown` for the overall rating, outside
    the grid.

### Acceptance
- `Enum.GetValues<ContactRoleType>()` includes `FinancialAdministrator`; existing
  `ContactRoleRules`/`ContactRoleFieldRules` gating tests still pass unmodified (additive enum value,
  no existing gate references it yet).
- Creating/updating a participant with a full 22-row `CommunityAccessRiskItems` payload round-trips;
  omitting the collection defaults to 22 blank materialized rows on next read (same contract as
  `HealthConditions`).
- The Participant Profile PDF for a `CommunityAccessDailyLiving` participant with rated items renders
  the new table; a non-CA participant's PDF does not.
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` all green.

---

## PF-10.3 — Intake wizard (new UI)

**Branch:** `feat/pf1003-intake-wizard`

### Current state
No standalone intake UI exists. All intake-tagged fields (§PF-10.1) currently live inside
`ParticipantCreatePage.tsx`'s steps 0 (Identity), 1 (NDIS & Funding), 3 (Contacts), plus scattered
fields inside steps 4 (Cultural & Consent), 5 (Support Needs & Mobility), 6 (Medical), 7
(Behaviour & Communication), and 9 (Risks & Hazards) — i.e. every current step except 2 (Key
Identifiers), 8 (Daily Living), and 10 (Review, which has no fields of its own) contributes at least
one Intake-entry field, per PF-10.1's fission calls.

### Design
A new route (`/participants/new` takes over this URL; see PF-10.7 for what happens to the old
`ParticipantCreatePage.tsx` route) renders a **new**, smaller wizard built on `feat/core01`'s
Wizard/Stepper shell, covering **only** `fieldsForEntry('intake')`. Steps re-group the intake-tagged
fields under the same section headings PF-10.1's tables use (Participant Details, NDIS & Funding,
Contacts, Cultural Considerations, Support Needs [day-one subset], Medical Summary, Behaviour
Summary, Risks & Hazards) — fewer, and each thinner, than today's 11 wizard steps, since every
Profile-only field is simply absent.

### Requirements this places on `feat/core01-wizard-shell`
- Step definitions must be data-driven (an array of `{key, label, fields, isVisible?}`), not
  hard-coded JSX branches — both this wizard and PF-10.4's need to configure step membership from
  `fieldsForEntry(...)`-derived field lists without forking the shell component itself. **PF-10.4
  needs this generalised to N independently-gated conditional steps/sub-sections, not a single
  hard-coded Community-Access special case** — see PF-10.4's Design section for the concrete
  `{ key, label, fields, isVisible: (participant) => boolean }` shape this drives (Community Access
  and, per the settled product decision, Holiday/STA consents, both use it; a future third gate is a
  new list entry, not new branching logic).
- The shell must support a step contributing **zero** fields being skipped from the step-pill header
  entirely (some section headings above may end up thin enough that a later content shuffle removes
  them — the shell shouldn't require a step to always render). The same applies one level down: a
  step whose `isVisible` is true but whose only *sub-block* is gated off must still render its
  always-visible content (Consents & Terms with `STA` absent still shows PhotoVideo/Privacy/
  EmergencyMedical — only the Holiday/STA sub-block disappears).
- Per-step Zod-schema validation gating on Next, matching today's `handleNext`/`STEP_SCHEMAS` contract
  (safeParse → set RHF field errors at exact path → focus first invalid field) — this wizard reuses
  that exact validation shape via `intakeParticipantSchema.pick(...)` per step.
- A "Save as draft" affordance available from any step (mirrors today's `handleSaveDraft`), because
  Intake itself can be abandoned partway.

### Requirements this places on `feat/core02-participant-partial-save`
- The Intake wizard's **final** submit is a normal `POST /api/participants` with
  `CreateParticipantDto` — no partial-save primitive is required for Intake completion itself, since
  a brand-new Participant row is created in one shot (see PF-10.5's progression model). Partial save
  is needed only for **mid-intake** drafts (today's `isDraft` "save as draft" already does this via a
  looser floor on the same whole-payload endpoint) — so PF-10.3 needs **no new backend primitive**,
  only continuation of the existing draft-save contract. Flag this explicitly to whoever scopes
  core02's minimum surface: **Intake does not require PATCH.** PF-10.4 (Profile) is what needs it.

### Implementation
1. **New** `frontend/src/pages/ParticipantIntakePage.tsx` — replaces `ParticipantCreatePage.tsx` at
   the create route. Built on `components/wizard/*` (core01). Field set: `fieldsForEntry('intake')`
   via `documentMapping.ts`. Validation: `intakeParticipantSchema` (PF-10.1) + the subset of today's
   `superRefine`s that apply to intake-only fields (`fundingSourceRefine`, `addressPostcodeRefine`,
   `contactMethodRefine`, `contactRolesRefine`; `genderRefine`/`weightHeightRefine`/
   `diagnosisOtherRefine`/`equipmentRefine`/`livingArrangementRefine` move to PF-10.4 or are dropped
   if their target field moved to Profile — audit each refine against PF-10.1's table before
   porting).
2. Reuse verbatim from `ParticipantCreatePage.tsx`: the Contacts step's existing/new-person toggle
   UI (:2478-2529), role `Dropdown` (:2540-2551), `useFieldArray('contactRoles')` wiring — this
   content doesn't change, only its container does.
3. `onSubmit` — `createParticipant.mutateAsync(buildIntakePayload(data))` →
   `navigate(`/participants/${res.data.id}/profile`)` on success (not the detail page — routes
   straight into PF-10.4's Profile wizard, per the progression model in §PF-10.5below).
4. `buildIntakePayload` — a trimmed `buildPayload` (today's `ParticipantCreatePage.tsx:1490-1596`)
   covering only intake fields; every Profile-entry field is omitted (not sent as null — omitted, so
   the backend's existing null-collapse behaviour doesn't need to distinguish "explicitly cleared"
   from "not part of this form").
5. `frontend/src/App.tsx` (or wherever routes are declared) — `/participants/new` →
   `ParticipantIntakePage`.
6. Tests: **new** `ParticipantIntakePage.test.tsx`, porting the subset of
   `ParticipantCreatePage.test.tsx`'s 19 `describe` blocks that test intake-tagged behaviour
   (navigation, per-step validation, INTAKE-05 gender — wait, gender is Profile-entry, drop that
   one; FUND-01/FUND-02 funding gating, CONTACT-02/03 contacts, INTAKE-08 save-as-draft,
   INTAKE-07 conditional payload for intake-relevant scenarios). Do not attempt to preserve the
   "exact final-submit payload shape" assertions verbatim — the payload shape has genuinely changed
   (smaller); rewrite those assertions against the new, smaller expected key set.

### Acceptance
- A new participant can be created through the Intake wizard alone, ending on the Profile wizard
  (empty/default) rather than the detail page.
- Every field in `fieldsForEntry('profile')` is absent from this wizard's DOM (a new smoke test
  asserts no profile-only field label renders).
- `npm run build`, `npm test` green; `grep -rn "<select" ParticipantIntakePage.tsx` returns nothing
  (GEN-1's rule applies to new code from day one, not just the audited legacy inventory).

---

## PF-10.4 — Profile wizard (new UI)

**Branch:** `feat/pf1004-profile-wizard`

### Current state
No standalone profile UI exists; today's `ParticipantDetailPage.tsx` Details tab is **read-only**
display of everything, with all editing routed back through the one monolithic wizard in edit mode.

### Design
A new route `/participants/{id}/profile` renders a second wizard, also on the `core01` shell,
covering `fieldsForEntry('profile')`, pre-filled from the existing participant (same `reset()`
pattern `ParticipantCreatePage.tsx`'s edit mode uses today, :1266-1490). Steps: Key Identifiers,
Cultural Depth (Personal Interests, Choice & Control), Consents & Terms (with a conditional
Holiday/STA consent block — see below), Medical Detail (structured diagnoses/HIDPA/allergies/
health-conditions grid), Mobility & Functional Detail, Behaviour & Cognition Detail, Daily Living
(ADLs, meals, goals), and — **only when `serviceStreams.includes('CommunityAccessDailyLiving')`** —
a Community Access section (About Me, Behaviours of Concern narrative, Supports Look Like, the
checklist, and PF-10.2's new risk-rating grid). This is the
**one-profile-with-conditional-sections** design — see the explicit call below.

The profile now has **two independently-gated conditional regions, not one**: the Community Access
section (gated on `CommunityAccessDailyLiving`) and, within the Consents & Terms step, the
Holiday/STA consent sub-block (gated on `STA` — see "Holiday/STA consents" below). The design must
therefore generalise to **N independently-gated conditional sections/sub-sections**, not
special-case Community Access as if it were the only one. Concretely: step/section membership is
computed once, at wizard-construction time, as a list of `{ key, label, fields, isVisible:
(participant) => boolean }` entries, where `isVisible` defaults to `() => true` and only
Community-Access-gated and Holiday/STA-gated entries override it — the same shape either gate uses,
so a third future gate (e.g. a `Trip`-stream-specific section) is a new entry in the list, not a new
branch of conditional logic. This is exactly the "computed step list" capability §"Requirements this
places on `feat/core01-wizard-shell`" already asks for — that requirement is what makes N gated
sections free instead of a special case; it is restated below with the sub-section-level nuance
(Consents & Terms is one *step* containing one *conditionally-rendered sub-block*, not two steps) made
explicit.

### One profile vs. two profile variants — explicit decision

**Decision: one Profile wizard/entity/DTO with conditionally-rendered sections, not two (or more)
separate profile variants.**

Justification:
- This is not a new design — it is the pattern the codebase already committed to and shipped.
  INTAKE-03/04 already added every Community-Access-only field onto the **same** `Participant`
  entity and the **same** wizard, gated purely by `serviceStreams.includes('CommunityAccessDailyLiving')`,
  and `ParticipantDocumentComposer` already renders the Community Access section into the **same**
  "Participant Profile" PDF conditionally (`includeCommunityAccess` bool), not as a second document.
  Forking into two profile entities now would contradict nine already-landed sub-waves and reopen
  the exact field-duplication problem this whole restructure exists to close (Profile V2026 and
  Profile — Community Access share the vast majority of their content — Participant Details, NDIS
  Plan, Cultural table, Diagnoses, Personal Care, Meal Support, About Me/goals — verbatim or
  near-verbatim per `discovery/05-oassist-forms.md`'s cross-document map; only the itemised risk
  matrix, the HIDPA-as-one-section framing, and the shorter consent wording are genuinely distinct).
- The two Profile documents' real deltas (V2026's NDIS-plan/financial/holiday-T&Cs content vs.
  Community Access's itemised risk matrix) are **already** modelled as ungated-vs-gated content
  within the one entity today (Key Identifiers/consents are ungated; the CA section is gated) — the
  new risk matrix (PF-10.2) simply extends that same pattern with one more gated section, it does
  not require a second variant.
- **Settled (product decision):** the holiday/STA-specific consent block reuses this exact same
  conditional-section mechanism rather than introducing a second one — see "Holiday/STA consents"
  immediately below. This is the consistency argument for choosing the gate over leaving the block
  ungated: the codebase now has one mechanism for "this content only applies to some participants",
  not two.

#### Holiday/STA consents — gating predicate, storage, and the stream-change edge case

**Decision (settled): the Alcohol, OtcMedication, TravelInsurance, and TermsAndConditions consent
types are gated by service stream — they render, and are collectible, only for a participant whose
`serviceStreams` includes `STA`.** PhotoVideo, Privacy, and EmergencyMedical remain ungated (every
participant, regardless of stream) — those three are general safeguarding consents that appear in
both Profile source documents unconditionally, unlike the four holiday/booking-specific ones.

- **Exact predicate, exact location:** `Participant.ServiceStreams` (`backend/Odip.Domain/Enums/Enums.cs:610-620`,
  `[Flags] enum ServiceStreams { None = 0, STA = 1, BSP = 2, InHomeSupport = 4, Trip = 8, HIDPA = 16,
  CommunityAccessDailyLiving = 32, CommunityNursing = 64 }`). Backend gate:
  `participant.ServiceStreams.HasFlag(ServiceStreams.STA)`. Frontend gate:
  `serviceStreams.includes('STA')` against `SERVICE_STREAMS` (`frontend/src/api/types/enums.ts:110-112`,
  the same comma-separated-names wire format `CommunityAccessDailyLiving`'s gate already uses — no
  new enum, no new field; `STA` already exists precisely to mean "Short Term Accommodation
  /holiday" per its existing doc comment).
- **Edge case — a participant is later moved off the `STA` stream after already having holiday
  consents recorded: consent data is retained and hidden, never cleared.** Justification: a consent
  record is evidence of what was actually agreed to, and when — clearing it the moment a service
  stream flag changes would destroy an auditable compliance record for no operational benefit (the
  stream flag can change for administrative reasons unrelated to whether the historical consent is
  still true/relevant, e.g. a coordinator toggling streams while reorganising a caseload). This
  mirrors the codebase's existing precedent for exactly this shape of problem:
  `StaffCompatibilityLinkService`'s `AutoLinked` marker never deletes a human-entered value out from
  under a later automated change, only ever adds/refreshes; the same conservative bias applies here.
  Concretely: the `ParticipantConsent` rows for the four gated types are **never deleted or nulled**
  by a `serviceStreams` change (no cascade, no side-effecting update) — the Profile wizard's Consents
  & Terms step simply stops **rendering** that sub-block once `STA` is absent, exactly as
  `AdlAssessmentsTable`'s "How To Help" column is omitted (not blanked) when Community Access is off.
  If the participant is later moved back onto `STA`, the previously-recorded consent values reappear
  unchanged (materialize-all-N-rows semantics already guarantee this — the row was never removed).
- **Profile PDF behaviour in that case:** `ParticipantDocumentComposer.BuildConsentsTable` must apply
  the same `STA`-gate the wizard applies — a non-`STA` participant's Participant Profile PDF omits
  the four gated consent rows entirely (not "Not Recorded" placeholder rows), consistent with how
  `includeCommunityAccess` already omits whole CA-gated fields/sections rather than rendering them
  blank. This needs one small `ParticipantDocumentComposer`/`ParticipantDocumentFieldMap` change,
  captured as an added Implementation step below (row-level gating within the `consents` table,
  which today has no gating at all — a new column-or-row-level gate, not a whole-section one, since
  `consents` currently renders as a single table regardless of stream).

### Requirements this places on `feat/core02-participant-partial-save`
This is where a real partial-update primitive is required, not optional:
- **Per-step save**, not just a final whole-payload submit — a participant with a completed Intake
  but no Profile yet needs to be able to save Key Identifiers today and come back for Medical Detail
  next week, without the intervening steps' still-blank Zod validation blocking a save. This means
  core02 must expose something like `PATCH /api/participants/{id}` accepting a **partial**
  `UpdateParticipantDto` (only the keys present in the JSON body are applied; omitted keys are left
  untouched server-side — explicit `null` still means "clear this field", distinguishing "absent" from
  "null" the way `System.Text.Json`'s `JsonElement`-based partial-patch idiom already supports, not a
  plain POCO deserialize which cannot tell "not sent" from "sent as default").
- The six nested collections (`consents`, `healthConditions`, `adlAssessments`, `checklistItems`, plus
  PF-10.2's new `communityAccessRiskItems`) are all "materialize-all-N-rows" grids — a per-step PATCH
  from the Profile wizard should be able to send **just the grid that step owns** without the
  request accidentally reverting the other grids to defaults. Core02 must define whether an absent
  collection key means "leave unchanged" (required for this) vs. "clear to empty" (would be a data
  loss bug for this consumer) — this spec requires **absent = unchanged**.
- `riskEntries`/`contactRoles` stay on their existing nested-CRUD endpoints — unaffected by core02,
  no change needed there.

### Implementation
1. **New** `frontend/src/pages/ParticipantProfilePage.tsx`, `core01` shell, field set
   `fieldsForEntry('profile')`. Step/sub-section visibility computed once from `participant.serviceStreams`
   via the `isVisible: (participant) => boolean` list shape (see core01 requirements above): the
   Community Access step gated on `CommunityAccessDailyLiving`, the Consents & Terms step's
   Holiday/STA sub-block gated on `STA` — both driven by the same mechanism, not two separate
   code paths.
2. Port verbatim from `ParticipantCreatePage.tsx`: the Key Identifiers step JSX (:2391-2449), the
   Diagnoses/HIDPA/Health Conditions cards (:2903-3144), the ADL/Meals/About Me/CA-gated cards
   (:3268-3413), the fixed-grid consent UI (:2615-2645) — the latter split into an always-rendered
   PhotoVideo/Privacy/EmergencyMedical block plus a `serviceStreams.includes('STA')`-gated
   Alcohol/OtcMedication/TravelInsurance/TermsAndConditions block. These are large, already-correct
   blocks — move (and, for consents, split), don't rewrite from scratch.
2a. `backend/Odip.Infrastructure/Services/ParticipantDocumentComposer.cs`'s `BuildConsentsTable` —
   add a `bool includeHolidayConsents` parameter (mirroring `BuildAdlAssessmentsTable`'s existing
   `includeCommunityAccess` parameter shape exactly), sourced from `Compose`'s existing
   `participant.ServiceStreams.HasFlag(ServiceStreams.STA)` check, and skip the four gated
   `ConsentType` rows (Alcohol, OtcMedication, TravelInsurance, TermsAndConditions) when false — same
   "omit the row, don't blank it" contract PF-10.4's design section commits to. No `ParticipantDocumentFieldMap`
   change is needed (the `consents` field-map entry stays one `Tag.Profile` table row; the new gate
   is internal to the table builder, same level of granularity `includeCommunityAccess` already
   operates at inside `BuildAdlAssessmentsTable`).
3. Per-step save: each step's "Next" triggers `PATCH /api/participants/{id}` with only that step's
   fields (via core02's partial-update hook, once available) rather than accumulating in RHF state
   until a final Review submit. This is the one genuine UX behaviour change from today's wizard
   pattern (today: validate-and-advance client-side only, nothing hits the API until Review) — it
   is required here because a Profile can legitimately be completed over multiple sessions and a
   crash/navigation-away between steps must not lose earlier steps' work.
4. `PATCH` response failures re-render the step's existing errors (reuse `handleInvalidSubmit`'s
   field-to-step-index jump logic for the case where a later step's stale data now fails validation).
5. Final step (a lightweight Review, listing filled sections) sets a `profileCompletedAt` timestamp
   server-side and flips `IsDraft` false (see PF-10.5).
6. `ParticipantDetailPage.tsx` — the existing "Resume intake" link/banner (:105-120) is repointed per
   PF-10.5's routing rule; Details tab's per-card "Edit" affordance now routes into
   `ParticipantProfilePage` at the owning step (mirrors today's Review-step `Edit ${step.label}` links,
   :3528-3533) rather than into the old monolithic wizard.
7. Tests: **new** `ParticipantProfilePage.test.tsx` porting the profile-tagged subset of today's 19
   `describe` blocks (DIAG-01/02, INTAKE-09's risk-entries edit-mode-inert link, CONTACT — no,
   Contacts moved to Intake — Cultural & Consent's Personal-Interests/Consents half, clinical
   enrichment, Daily Living). Existing `ParticipantConsentsSection.test.tsx`/
   `ParticipantHealthConditionsSection.test.tsx`/`ParticipantAdlAssessmentsSection.test.tsx` (the
   detail-page per-row upsert tests) are **unaffected** — this branch does not touch that dual-write
   path (see PF-10.1's note that it is a pre-existing structural fact, not something this spec
   resolves).

### Acceptance
- A participant with `intakeCompletedAt` set and no profile data can open the Profile wizard, save
  one step, navigate away, and return to find that step's data persisted and the rest still blank.
- Completing every Profile step sets `IsDraft = false` and the participant becomes bookable (see
  PF-10.5) in the same request cycle a normal PUT would today.
- CA-gated step/section is present only when `serviceStreams` includes `CommunityAccessDailyLiving`.
- Holiday/STA-gated consent sub-block is present only when `serviceStreams` includes `STA`; the
  PhotoVideo/Privacy/EmergencyMedical consents remain visible/collectible regardless.
- Moving a participant off `STA` after Alcohol/OtcMedication/TravelInsurance/TermsAndConditions
  consents were recorded hides the sub-block but does not delete the underlying `ParticipantConsent`
  rows — a new test writes those four consents, flips `serviceStreams` to remove `STA`, and asserts
  (a) the wizard sub-block no longer renders, (b) the four rows are still present and unchanged via
  the API, (c) re-adding `STA` makes the sub-block reappear pre-filled with the retained values, and
  (d) that participant's Participant Profile PDF omits the four rows while `STA` is absent.
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` all green.

---

## PF-10.5 — Intake → Profile progression & participant lifecycle

**Branch:** `feat/pf1005-participant-lifecycle`

### Current state
`Participant.IsDraft` (bool) is the only lifecycle flag. It gates a long, already-tested list of
operational surfaces (roster board, shift assignment, compatibility matrix, medication/witness
pickers, incident participant pickers, trip/booking pickers, claims/billing, the alerts aggregate,
the portal) via `!p.IsDraft` checks scattered across the backend, while still showing (badged) on the
plain participants list. It flips to `false` only from a full Review submission.

### Design
**Does Intake create a Participant record immediately, or a separate draft/lead entity?**
Immediately — via the existing `POST /api/participants`. A separate lead/pre-participant entity was
considered and rejected: it would require a second set of contact/duplicate-detection logic, and
every one of the "excluded surfaces" `IsDraft` already implements would need to also exclude the new
entity type, doubling the surface area of an already-broad gate for no behavioural gain over "the
same Participant row, just flagged not-ready".

**Lifecycle fields (additive, on `Participant`):**
- `IntakeCompletedAt: DateTime?` — **new**. Null until the Intake wizard's final step succeeds; set
  once, never cleared.
- `IsDraft: bool` — **unchanged in storage and in every existing gate**. Its meaning widens slightly
  in prose (it now also covers "intake done, profile not started") but every one of the ~20 existing
  `!p.IsDraft` call sites keeps working with zero code change, because the thing they actually care
  about — "is this participant ready to be scheduled/billed/rostered" — is still exactly what
  `IsDraft = false` means. This is deliberate: it avoids a 20-call-site migration to a new tri/quad
  state enum for a distinction (intake-in-progress vs. profile-in-progress) that no existing
  consumer needs to make.

**Is a partially-profiled participant usable elsewhere in the app — can they be booked on a trip?**
No — identical to today's draft semantics. `IsDraft = true` for the entire span between "Intake not
started" and "Profile complete"; every surface that excludes drafts today continues to exclude a
participant who has finished Intake but not Profile. This is a direct, low-risk reuse of
already-tested exclusion logic, not new gating to write.

**Resuming:** `ParticipantDetailPage.tsx`'s existing "Resume intake" banner/link becomes
state-driven:
- `intakeCompletedAt == null` → label "Resume intake", routes to `/participants/{id}/intake` (the
  Intake wizard, in edit-of-a-draft mode) at the first unvalidated step.
- `intakeCompletedAt != null && isDraft == true` → label "Continue profile", routes to
  `/participants/{id}/profile` (PF-10.4) at the first incomplete step.
- `isDraft == false` → banner absent (fully onboarded), exactly as today.

### Implementation
1. `backend/Odip.Domain/Entities/Participant.cs` — add `public DateTime? IntakeCompletedAt { get; set; }`,
   doc comment cross-referencing this spec and `IsDraft`'s existing doc comment (update that comment
   to mention the two-wizard span explicitly).
2. **New migration** adding the column, nullable, no default (backfill is PF-10.7's job, not this
   branch's schema change).
3. `ParticipantsController.cs` — the Intake wizard's create call sets `IntakeCompletedAt = UtcNow`
   server-side (not client-supplied) on the request that represents "Intake finished" (a new query
   param or DTO bool `completeIntake: true`, distinct from `isDraft`, so a mid-intake "save as draft"
   POST — which still creates the row today, just in a rougher state — does **not** also stamp
   `IntakeCompletedAt`).
4. `backend/Odip.Application/DTOs/DTOs.cs` — `ParticipantDetailDto`/`ParticipantListDto` expose
   `IntakeCompletedAt` (read) so the frontend can drive the banner state without a second endpoint.
5. `ParticipantDetailPage.tsx:105-120` — replace the single "Resume intake" branch with the
   three-way state above.
6. `frontend/src/lib/permissions.ts` — no change; the existing `canWrite` gate on the Edit
   entry-point continues to gate both new routes identically to how it gates today's one route.

### Acceptance
- A brand-new participant created via the Intake wizard has `IntakeCompletedAt` set and `IsDraft`
  true; is absent from booking/roster/compatibility pickers; is visible (badged) on the plain list.
- Completing the Profile wizard flips `IsDraft` false; the participant now appears in booking/roster
  pickers — a new integration test asserts a participant becomes selectable in `BookingsTab`'s
  participant `SearchableSelect` immediately after Profile completion, without requiring a second
  unrelated write.
- The detail-page banner shows the correct one of the three states across all three lifecycle points
  (mid-intake draft, intake-done/profile-pending, fully onboarded).
- `dotnet test`, `npm test` green; the ~20 existing `!p.IsDraft`-gated tests are unmodified and still
  pass (proves the reuse claim above).

---

## PF-10.6 — Client Overview as a derived view

**Branch:** `feat/pf1006-client-overview-view`

### Current state
Doc 2 ("CLIENT OVERVIEW FORM") is a condensed, per-trip staff cheat-sheet — every field on it already
exists elsewhere on the Participant (Personal Care, Night Support, Modified Diet, Thickened Fluids,
Medication approach, Behaviours of Concern + rating, Health Conditions Alerts, Restrictive Practice
routine/PRN grid). Its header carries fields that are **not** participant fields at all — "TRIP",
"DATE", "GROUP" — confirming it is generated per-outing, not a form anyone fills in. DOC-01 already
proved the exact mechanism needed here: `ParticipantDocumentService`/`Composer`/`Renderer` (QuestPDF,
`backend/Odip.Infrastructure/Services/`) compose a `ParticipantDocumentModel` from a hydrated
`Participant` with zero new rendering infrastructure.

### Design
A **third** composed document, not a form: `ComposeClientOverview(Participant, Trip)`. Unlike
Intake/Profile's tag-filtered union over `ParticipantDocumentFieldMap.Entries`, this is a **fixed,
hand-picked field list** (the cheat-sheet's ~14 fields), because it is a condensed subset rather than
a document-tag partition — reuses `FormatParticipantProperty`/table-builder helpers already in
`ParticipantDocumentComposer`, but is its own `Compose*` method with its own field list, not driven
by `ParticipantDocumentTag`. It needs a `Trip` (for TRIP/DATE/GROUP header fields), so its signature
is `(Participant participant, Trip trip)`, unlike the other two composers' `(Participant, riskEntries)`.

**Surfacing:** primarily the **Trip detail page**, since the header fields (Trip/Date/Group) are only
meaningful in a trip's context — a "Client Overview PDF" action per participant row on the trip's
roster/participants tab. Secondarily, the **Participant detail page** gets a third download button
alongside the existing two, generating the same document with the header's Trip/Date/Group fields
blank (a genuric "current snapshot", for the case for someone wanting the cheat-sheet without a
specific trip in hand).

> **OPEN QUESTION:** should the Participant-detail-page variant (no trip context) exist at all, or
> is Client Overview meaningless outside a trip and that button should be omitted entirely? Included
> above as the safer default (more availability, not less) but this is a product call, not an
> engineering one.

### Implementation
1. `backend/Odip.Infrastructure/Services/ParticipantDocumentComposer.cs` — add
   `ComposeClientOverview(Participant participant, Trip trip, IReadOnlyList<ParticipantRiskEntry> riskEntries)`
   with its own fixed field list per `discovery/05-oassist-forms.md`'s Client Overview inventory
   (Personal Care, Night Support, Modified Diet, Thickened, Medication approach, BOC + rating,
   Health Conditions Alerts, Restrictive Practice routine/PRN grid via `RestrictivePractice`
   entities filtered `IsActive`), title `"Client Support Needs Summary"`, header fields Trip Name /
   Date / Group sourced from `trip`.
2. `ParticipantDocumentService.cs` — `GenerateClientOverviewAsync(Guid participantId, Guid tripId, ...)`,
   loading both the participant (existing `LoadParticipantAsync`, extended to also
   `.Include(x => x.RestrictivePractices)`) and the `Trip` (existing trip query, reused from
   `TripsController`'s load pattern).
3. `ParticipantsController.cs` — `GET /api/participants/{id}/documents/client-overview?tripId={tripId}`,
   same null-check/404 shape as the two existing document endpoints.
4. Frontend: `frontend/src/api/hooks/participants.ts` — `useDownloadClientOverviewPdf(tripId)`
   mirroring `useDownloadIntakeFormPdf`/`useDownloadParticipantProfilePdf` exactly (:82-120).
5. `frontend/src/pages/trip-detail/` (whichever tab lists trip participants — confirm exact file via
   the trip-detail discovery, not yet read in depth by this spec) — add a per-row "Client Overview
   PDF" action.
6. `ParticipantDetailPage.tsx` — third button, `tripId` omitted (composer/service handle `trip: null`
   by rendering blank header fields — confirm this doesn't crash `ComposeClientOverview`; make `trip`
   nullable in the signature rather than requiring a sentinel Trip).

### Acceptance
- Client Overview PDF generates correctly from a trip's participant row, with Trip/Date/Group
  populated.
- Generating it from the participant detail page (no trip) produces the same document with blank
  header fields, no exception.
- No new form/data-entry surface is created for any Client Overview field — a new test asserts every
  field it renders is sourced from an existing Participant/RestrictivePractice property, not a new
  writable field.
- `dotnet build`, `dotnet test`, `npm run build`, `npm test` green.

---

## PF-10.7 — Existing-participant migration & old-wizard retirement

**Branch:** `feat/pf1007-migration-and-retirement`

### Current state
Every existing participant was created via the single 11-step wizard, which asked for (a superset
of) both Intake- and Profile-tagged fields in one pass. `IsDraft` already distinguishes "went all the
way through Review" (`false`) from "saved mid-wizard and never finished" (`true`).

### Design — migration
- **Where `IsDraft = false` today:** these participants completed the old wizard's Review step, i.e.
  by definition they supplied (at minimum) whatever the old wizard required, which is a superset of
  both new wizards' required fields. Backfill `IntakeCompletedAt = CreatedAt` (their creation time —
  the old wizard had no per-step timestamp, so "when the row was created" is the closest available
  proxy for "when intake-equivalent data was captured") for every such row. They remain `IsDraft =
  false`, i.e. immediately treated as **both** intake-complete and profile-complete — correct, since
  they already have all the data both new wizards would have collected.
- **Where `IsDraft = true` today:** these are old-wizard drafts of unknown depth — "save as draft"
  could have been clicked from any of the 11 steps. Leave `IntakeCompletedAt = NULL`. On next visit,
  the detail-page banner (PF-10.5) routes them to **Resume intake** (the safer, more conservative
  read) — the new Intake wizard reads from the same underlying Participant fields via the same
  `reset()`-from-`existing` pattern the old wizard used, so **no data is lost or re-asked
  needlessly**: any intake-tagged field they already filled in shows pre-filled; only genuinely
  unanswered intake-tagged fields need answering. If they had, unusually, already filled in
  Profile-only fields under the old draft wizard before saving, that data is preserved on the row and
  will simply appear pre-filled once they reach the Profile wizard later — not lost, not blocking.
- This is a data backfill (a script/migration run once, not an EF schema migration) —
  `UPDATE "Participants" SET "IntakeCompletedAt" = "CreatedAt" WHERE "IsDraft" = false AND "IntakeCompletedAt" IS NULL;`
  wrapped in a small one-off console command (mirrors the `Odip.ProtoTests`/seeding conventions for
  one-off data scripts already in this codebase) or an EF `Up()` data migration — either is
  acceptable; prefer the EF data migration for auditability (`dotnet ef migrations add
  PF10_07_BackfillIntakeCompletedAt` with a SQL `migrationBuilder.Sql(...)` body).

### Design — retirement
`ParticipantCreatePage.tsx` (3,608 lines) is superseded by `ParticipantIntakePage.tsx` (PF-10.3) +
`ParticipantProfilePage.tsx` (PF-10.4). It is **deleted**, not kept as dead code, once both replacements
are verified (this branch lands last — see Dependency order). Its 2,779-line test file is likewise
deleted, having already been superseded field-by-field across PF-10.3/PF-10.4's own new test files.

### Implementation
1. **New EF data migration** `PF10_07_BackfillIntakeCompletedAt` — SQL body per Design above.
2. **Delete** `frontend/src/pages/ParticipantCreatePage.tsx`,
   `frontend/src/pages/ParticipantCreatePage.test.tsx`.
3. Confirm no remaining import references (`grep -rn "ParticipantCreatePage"`) — update any route
   table, nav link, or `Link to={.../edit}` reference (`ParticipantDetailPage.tsx:164-167`) to point
   at the new Profile-wizard edit entry point instead.
4. `frontend/src/lib/conditionalFields.test.tsx` — this file's 3 native-`<select>` test fixtures were
   explicitly excluded from GEN-1 as out of scope; confirm they don't reference
   `ParticipantCreatePage` fields that no longer exist post-split (audit only, likely no change).
5. Update `docs/specs/odip-updates-2026-09/discovery/02-participant-form.md`'s own header note (it
   currently describes the single monolith as current-state) with a one-line "superseded by
   SPEC-05, see PF-10.3/PF-10.4" pointer — discovery docs are historical evidence, not living specs,
   so this is a pointer, not a rewrite.

### Acceptance
- Every existing `IsDraft = false` participant has `IntakeCompletedAt` set after migration; every
  existing `IsDraft = true` participant does not.
- No file in the repo imports `ParticipantCreatePage`.
- Full regression pass: `dotnet build`, `dotnet test`, `npm run build`, `npm test`, `npm run lint`
  (no new errors vs. main) — this is the branch most likely to reveal a missed cross-reference, so
  its acceptance bar is the full four-command sweep, not a partial one.

---

## Requirements on the foundation branches (consolidated)

**`feat/core01-wizard-shell` needs:**
- Data-driven step definitions (array of `{key, label, fields}`), not hard-coded per-step JSX
  branching, so two independent wizards (PF-10.3, PF-10.4) can each configure their own step list
  from `fieldsForEntry(...)` without forking the shell.
- Steps with zero contributed fields can be omitted from the step-pill header (supports both a
  content shuffle later and PF-10.4's CA-conditional step).
- Reusable per-step Zod validation gating identical in contract to today's
  `handleNext`/`STEP_SCHEMAS` (safeParse → set errors at exact RHF path → focus first invalid field).
- A pluggable "save as draft" affordance on every step (PF-10.3 needs this in its existing
  whole-payload form; PF-10.4 needs it to become a genuine per-step partial save, once core02 exists).

**`feat/core02-participant-partial-save` needs:**
- `PATCH /api/participants/{id}` accepting a **partial** `UpdateParticipantDto` where an **absent**
  key means "leave unchanged" — required by PF-10.4's per-step save, not required by PF-10.3 (Intake
  completion is a single `POST`).
- Explicit "absent vs. null" semantics for each of the six nested-collection fields
  (`consents`/`healthConditions`/`adlAssessments`/`checklistItems`/`communityAccessRiskItems`/
  `riskEntries` — the last two out of scope for PATCH per PF-10.1/PF-10.4, staying on their existing
  nested-CRUD endpoints) — an absent collection key must mean "this step didn't touch that grid",
  not "clear it to defaults", or PF-10.4's per-step save silently destroys other steps' grid data.

---

## Dependency order

```
feat/core01-wizard-shell  ─┐
feat/core02-participant-   ├─→ feat/pf1001-field-allocation-contract
  partial-save            ─┘         │
                                      ├─→ feat/pf1002-content-gaps
                                      │         │
                                      ├─→ feat/pf1003-intake-wizard ──┐
                                      │         (needs core01 only)   │
                                      │                               ├─→ feat/pf1005-participant-lifecycle
                                      └─→ feat/pf1004-profile-wizard ─┘         │
                                                (needs core01 + core02,         │
                                                 needs pf1002's new fields      │
                                                 for the CA risk grid)          │
                                                                                ├─→ feat/pf1006-client-overview-view
                                                                                │      (independent of the wizard UIs —
                                                                                │       only needs Participant+Trip data,
                                                                                │       can land any time after main)
                                                                                │
                                                                                └─→ feat/pf1007-migration-and-retirement
                                                                                       (last — deletes the old wizard only
                                                                                        once pf1003+pf1004 are verified
                                                                                        in production use)
```

PF-10.6 has no hard dependency on PF-10.3/PF-10.4/PF-10.5 beyond "the codebase it branches from
should already have PF-10.2's `RestrictivePractice`-inclusion pattern available" — it can land in
parallel with PF-10.5 rather than strictly after it; shown sequentially above only for reading order.

---

## Open questions (consolidated)

**Resolved (product decision):** the four holiday/booking-specific consent types (Alcohol,
OtcMedication, TravelInsurance, TermsAndConditions) are gated on `serviceStreams` including `STA`,
using the same conditional-section mechanism as the Community Access section — see §PF-10.4's
"Holiday/STA consents" subsection for the predicate, storage, and stream-change edge case
(retained-and-hidden, never cleared). No longer open.

> **OPEN QUESTION (§PF-10.6):** should the Participant-detail-page "Client Overview PDF" button (no
> trip context) exist at all, given the source document's header fields (Trip/Date/Group) are
> meaningless without a trip? Included as the safer default; a product call either way.

> **OPEN QUESTION (§PF-10.1, Risks & Hazards):** only one general `notes` field exists today,
> allocated to Intake. Is a second, profile-stage running-notes field wanted, now that the wizard is
> split across two sessions that could be weeks apart? Not built here — flagging because the split
> makes the gap more visible than it was in a single-sitting wizard.

> **OPEN QUESTION (§PF-10.1, Identity):** `preferredStaffId` is allocated to Profile on the reasoning
> that it optimises rostering rather than gating safe initial support. If referral sources typically
> already know the preferred staff match at intake time (a plausible operational reality this spec
> can't verify from the codebase alone), it may belong in Intake instead — a one-line reallocation if
> so, not a structural change.
