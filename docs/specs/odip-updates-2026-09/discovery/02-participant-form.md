# Participant Create/Edit Wizard — Discovery

Scope: `ParticipantCreatePage.tsx` (create + edit), `ParticipantDetailPage.tsx` + `participant-detail/*`, backend `Participant*` domain/API. All line numbers as of 2026-09-01.

## 1. Wizard shell

**File:** `frontend/src/pages/ParticipantCreatePage.tsx` — a single 3,608-line monolithic component. There are **no separate step/tab components** — every step's schema, JSX, and helpers live inline in this one file. (The teammate-message assumption that steps live under `components/participant*` is wrong; there is no such directory. `frontend/src/components/ParticipantAlertsBanner.tsx` is unrelated — a banner, not a wizard piece.)

### Steps (`WIZARD_STEPS`, `ParticipantCreatePage.tsx:771-793`), in order:

| # | `key` | Label | Fields const | JSX block |
|---|-------|-------|--------------|-----------|
| 0 | `identity` | Identity | `STEP_IDENTITY_FIELDS` (:669) | `stepIndex===0` :2086-2267 |
| 1 | `ndis` | NDIS & Funding | `STEP_NDIS_FIELDS` (:679) | :2267-2391 |
| 2 | `keyIdentifiers` | Key Identifiers | `STEP_KEY_IDENTIFIERS_FIELDS` (:683) | :2391-2449 |
| 3 | `contacts` | Contacts | `STEP_CONTACTS_FIELDS` (:692, just `['contactRoles']`) | :2449-2587 |
| 4 | `culturalConsent` | Cultural & Consent | `STEP_CULTURAL_CONSENT_FIELDS` (:696) | :2587-2656 |
| 5 | `support` | Support Needs & Mobility | `STEP_SUPPORT_FIELDS` (:712) | :2656-2901 |
| 6 | `medical` | Medical | `STEP_MEDICAL_FIELDS` (:730) | :2901-3145 |
| 7 | `behaviourCommunication` | Behaviour & Communication | `STEP_BEHAVIOUR_COMMUNICATION_FIELDS` (:740) | :3145-3266 |
| 8 | `dailyLiving` | Daily Living | `STEP_DAILY_LIVING_FIELDS` (:753) | :3266-3426 |
| 9 | `risks` | Risks & Hazards | `STEP_RISK_FIELDS` (:762) | :3426-3523 |
| 10 | `review` | Review | `STEP_REVIEW_FIELDS` (:763, empty) | `stepIndex===REVIEW_STEP_INDEX` :3523-3550 |

`REVIEW_STEP_INDEX = WIZARD_STEPS.length - 1` (:795).

### Navigation / validation gating

- `stepIndex` state (:1039); `goToStep(index)` (:1085-1089) jumps directly (used by the step-pill header and Review's per-card "Edit" links).
- `handleNext` (:1092-1112): looks up `STEP_SCHEMAS[stepIndex]` (a per-step Zod `.pick()` of the base schema, :802-817), `safeParse(getValues())`; on failure sets RHF errors at the exact dot/index path (so per-row array errors land correctly) and focuses the first invalid field; on success advances `stepIndex` and marks it visited. **No schema for Review** (`STEP_SCHEMAS[10] === null`) so `handleNext` no-ops there.
- `handleBack` (:1090): simple decrement, no validation.
- `handleInvalidSubmit` (:1118-1128): safety net — if final submit's full-schema resolver fails from something edited via a Review "Edit" link, jumps back to whichever step owns the first invalid field (`fieldToStepIndex` lookup) and focuses it.
- In **edit mode**, `visitedSteps` starts as *every* step index (:1041 — `isEdit ? WIZARD_STEPS.map((_, i) => i) : [0]`), so an editor can jump to any step immediately rather than walking Next→Next like a blank intake.

### Save model: final-submit only, plus a separate parallel "save draft" action — no per-step save.

- **Final submit**: `<form onSubmit={handleSubmit(onSubmit, handleInvalidSubmit)}>` (:2085). `onSubmit` (:1607-1638):
  ```ts
  const onSubmit = async (data: ParticipantFormData) => {
    const payload = buildPayload(data, false)
    try {
      if (isEdit) {
        delete payload.riskEntries
        delete payload.contactRoles
        const res = await updateParticipant.mutateAsync({ id, data: { ...payload, isActive: existing?.isActive ?? true } })
        if (res.success) { flushSync(() => reset(data as unknown as Parameters<typeof reset>[0])); navigate(`/participants/${id}`) }
      } else {
        const res = await createParticipant.mutateAsync(payload)
        if (res.success && res.data?.id) { flushSync(() => reset(...)); navigate(`/participants/${res.data.id}`) }
      }
    } catch { /* error handled by mutation state */ }
  }
  ```
  Only reachable from the Review step's submit button (:3590-3595). There is no per-step "save and continue" — Next only validates and advances client-side; nothing hits the API until Review.
- **Save as draft** (`handleSaveDraft`, :1652-1673) is a *second*, independent write path, available as a button on **every step** (rendered once at :3571, inside the shared nav footer, gated by `canSaveDraft`) — not per-step saves of just that step's fields, but a whole-form draft save from wherever the user currently is. It deliberately bypasses `handleSubmit`/`participantResolver` (reads `getValues()` raw) so an incomplete form can still be persisted; the server applies a much looser floor (see §4). `canSaveDraft = !isEdit || existing?.isDraft === true` (:1688) — never offered once a participant is finalized.
- Both paths funnel through **the same** `buildPayload(data, draft)` (:1490-1596).

### Edit mode — same component, `isEdit = !!useParams().id` (:974-975)

Differences when `isEdit`:
- `useParticipant(id)` loads `existing`; a `useEffect` (:1266+) calls RHF `reset({...})` field-by-field from `existing` once loaded (loading guard at :1682).
- All steps start "visited" (jump-anywhere) instead of the linear `[0]` gate.
- **Contacts step (3) renders no editor at all in edit mode** — just a card linking to the detail page's Contacts tab (:2452-2460). The `contactRoles`/`useFieldArray` add-row UI (:2461-2578) is create-mode only.
- **Risk Entries card in step 9 is edit-mode-inert** too — links to the detail page's Risks section instead of rendering rows (:3452-3460).
- `onSubmit`/`handleSaveDraft` both `delete payload.riskEntries` and `delete payload.contactRoles` before calling `updateParticipant` in edit mode (:1616-1617, :1660-1661) — these two collections are **create-time-only, transactional with the participant**; once a participant exists they're managed via separate nested-CRUD endpoints/tabs (see §4/§5).
- Header title, submit-button label, and the restrictive-practice-flag banner (:3429-3435) toggle on `isEdit`.
- `canSaveDraft` as above.

## 2. Form state

- **No separate Zod schema file** — `baseParticipantSchema` (`ParticipantCreatePage.tsx:33`, a ~440-line `z.object({...})`) and every `superRefine` validator (`genderRefine`, `fundingSourceRefine`, `livingArrangementRefine`, `addressPostcodeRefine`, `contactMethodRefine`, `weightHeightRefine`, `diagnosisOtherRefine`, `equipmentRefine`, `contactRolesRefine`) are defined inline in this same file, roughly lines 33-449. `participantSchema` (:451-460) chains all refines onto the base shape for full-submit validation; `STEP_SCHEMAS` (:802-817) chain the relevant subset per step via `.pick()`.
- **Type:** `type ParticipantFormData = z.infer<typeof baseParticipantSchema>` (:294) — one flat type covering every step's fields plus the six fixed/dynamic arrays (`riskEntries`, `contactRoles`, `consents`, `healthConditions`, `adlAssessments`, `checklistItems`).
- **Resolver:** custom `participantResolver` (:483-491) — hand-rolled against `participantSchema.safeParse` rather than `@hookform/resolvers`'s `zodResolver`, because that resolver reads `ZodError.errors`, a getter zod v4 removed (comment at :478-482).
- **`useForm`** setup at :983-1027 with an explicit `defaultValues` object (create-mode defaults — tri-state fields default to `''`, the four fixed-row arrays are pre-populated one row per enum member via `.map()`, e.g. `consents: CONSENT_TYPES.map(...)`, `healthConditions: HEALTH_CONDITION_TYPES.map(...)`, `adlAssessments: ADL_TYPES.map(...)`, `checklistItems: CHECKLIST_ITEM_TYPES.map(...)`).
- **Edit-mode defaultValues**: a `useEffect` (:1266-~1490, keyed on `existing`) calls `reset({...})` mapping every `existing.<field>` onto the form shape field-by-field (not a generic spread) — includes format round-trips, e.g. `dateOfBirth: existing.dateOfBirth ? existing.dateOfBirth.split('T')[0] : ''`, and the DIAG-01 curated-vs-"Other" diagnosis split (:1300-1309), and `parseServiceStreams`/`parseHidpaCategories` for the comma-separated wire formats.
- **Payload mapping** — `buildPayload(data, draft)` (:1490-1596): starts from `stripHiddenFieldKeys({...data}, hiddenFields)` (defence-in-depth drop of conditionally-hidden fields), then per-field transforms: `serviceStreams`/`hidpaSupportCategories` formatted to wire strings; `primaryDiagnosis`/`primaryDiagnosisOther` collapsed to one field; `contactRoles` expanded from the wizard's lean per-row shape into the full `CreateParticipantContactRoleDto` shape (every role-specific field nulled — the wizard step deliberately doesn't surface all 25+ per-role fields, :1508-1522); `weightKg`/`heightCm` coerced to number-or-null; tri-state (`'true'|'false'|''`) fields collapsed to `boolean|null` for cultural/clinical flags, `consents`, `healthConditions`; `adlAssessments`/`checklistItems` rows drop notes/detail once unset; finally every remaining `''`/`undefined` value is nulled and `payload.isDraft = draft` is set.

## 3. Per-step field detail

### Plan / funding step — `stepIndex===1`, `ParticipantCreatePage.tsx:2267-2391`
No separate component — inline JSX. Fields:
- Funding Source — `<select>` register (`fundingSourceRegistration`, custom `onChange`) :2271
- NDIS Number — text input, conditional (`isVisible('ndisNumber')`) :2281
- Plan Start/End Date — `type=date` inputs, conditional :2287, :2292
- Plan Type — `Controller` + `Dropdown` (SelfManaged/PlanManaged/AgencyManaged), conditional :2298-2317
- Region — text input, always visible :2320
- Funding Organisation — text input, conditional on `fundingSource==='Other'` :2324
- Repeat Client — checkbox :2329
- DSOA (Disability Support for Older Australians) — checkbox :2334
- Service Streams — `Controller`-driven checkbox group over `SERVICE_STREAMS`, with the `CommunityAccessDailyLiving` checkbox specially intercepted (`handleCommunityAccessStreamChange`) to confirm-dialog before removal if CA-gated data was entered :2341-2384

### Contacts / people step — `stepIndex===3`, `:2449-2587`
- **Create mode only** (edit mode shows a link to the Contacts tab instead, :2452-2460).
- Existing-vs-new-person split is a `ToggleGroup` per row (`Person` / `Existing person` / `New person`, :2478-2492) driving `contactRoles.{i}.personMode`. When `existing`: `Controller` + `SearchableSelect` sourced from `usePersons()` (:2494-2513). When `new`: two plain text inputs, First/Last name (:2515-2529).
- **Role field is single-select per row** — a `Dropdown` bound to `contactRoles.{i}.roleType` (:2540-2551), one `ContactRoleType` value per row; multiple roles for the same person are modelled as multiple rows (see §4 — backend `ParticipantContactRole` is a many-to-many join, not a multi-select column).
- Also per row: Relationship to participant (text, :2552), a role-gating hint/error (`contactRoleGateError`, :2554-2556), Primary checkbox (:2557-2559).
- `appendContactRole`/`removeContactRole` via `useFieldArray('contactRoles')` (:1027-1029).

### Cultural & consent tab — `stepIndex===4`, `:2587-2656`
Cards: "Cultural Background" (4 `YesNoToggleField` tri-state toggles: CALD, LGBTIQA+, Family/Community, Aboriginal/Torres Strait Islander), "Information Received" (5 tri-state toggles: Rights & Responsibilities, Privacy & Confidentiality, Feedback Info, Being Safe, Advocacy), "Personal Interests & Choice and Control" (2 textareas), "Consent & Terms" — a **fixed 7-row grid, one per `ConsentType`**, each row: `YesNoToggleField` for `granted`, and (only once granted='true') Signed-by name + Date signed inputs (:2615-2645). All laid out as `Card`s in a 2-column grid; the consent grid itself is a vertical list of bordered per-row blocks.

### Health — diagnoses AND health conditions — both in `stepIndex===6` ("Medical" step), `:2901-3145` — **not separate components**, but two separate `Card`s within the same step:
- **Diagnoses card** (:2903-2999): Primary Diagnosis `<select>` (curated list + `DIAGNOSIS_OTHER_SENTINEL`), conditional "Specify Primary Diagnosis" text input, "Other Diagnoses" — a `Controller`-driven checkbox group over curated options plus a free-text add-your-own chip input (custom entries rendered as removable pills).
- **HIDPA Support Categories card** (:3001-3038): checkbox group + HIDPA Notes textarea.
- **Health Conditions card** (:3113-3144): a **fixed 10-row grid, one per `HealthConditionType`** — `YesNoToggleField` for `has`, then (only if `has==='true'`) Severity text, Plan Provided / Training Required tri-state toggles, Notes textarea. Explicitly documented (:3096-3103) as distinct support-planning detail from the Diagnoses card, not a duplicate.

### Daily living / ADLs tab — `stepIndex===8` ("Daily Living" step), `:3266-3426`
- **Personal ADLs card** (:3268-3300) and **Community & Domestic ADLs card** (:3302-3334) — both render from the **same fixed 20-row `adlAssessments` array** (`ADL_TYPES`), split into two groups via `PERSONAL_ADL_TYPES`/`COMMUNITY_DOMESTIC_ADL_TYPES` index lookups; each row: `AdlLevelToggleField` (I/S/A/F), conditional Notes textarea, conditional (CA-gated) "How To Help Me" textarea.
- **Meals & Diet card** (:3336-3368): Meal Assistance, Choking Risk (meal-management, explicitly distinct from the Dysphagia health-condition row), Modified Diet, PEG Regime, Special Utensils, Special Dietary Needs (all textareas), Favourite Breakfast/Lunch/Dinner (text), Medication Tricks, Foods Always Eaten (textareas).
- **About Me card** (:3369-3392): Goals, Support Areas, Strengths/Fears, Things to Know, Who/What Is Important, Likes & Dislikes (all textareas). Explicitly does NOT repeat Hobbies (lives on Cultural & Consent's Personal Interests).
- **CA-gated "What My Supports Look Like" card** (:3394-3413): Morning/Day/Afternoon-Evening/Overnight textareas, only rendered when `CommunityAccessDailyLiving` is a selected service stream.

### Support profile fields — two unrelated concepts share the word "support":
1. **Wizard "Support Needs & Mobility" step** (`stepIndex===5`, `:2656-2901`) — plain `Participant` columns: High Support / Intensive Support checkboxes, Support Ratio dropdown, Mobility Aids (Wheelchair/Walker checkboxes) + Mobility Support Options (checkbox group), Overnight Support type + conditional Overnight Ratio, Equipment checkboxes (Hi-Lo Bed/Hoist/Shower Chair/Commode/Standing Machine), Mobility/Equipment/Transport notes textareas, and a "Mobility & Functional" card (Ambulant Status, Falls Risk Rating, Level of Personal Care selects, Uneven Ground toggle, Orthotics/Continence/Bowel Care/Menstruation/Skin Integrity textareas), plus a CA-gated "Community Mobility & Transport Risk" checklist card.
2. **`SupportProfileDto`** (`backend/Odip.Application/DTOs/DTOs.cs:565-590`) is a **genuinely separate backend entity**, reachable only via `GET/PUT /api/participants/{id}/support-profile` (`ParticipantsController.cs:973-1010`), never touched by the wizard at all: `CommunicationNotes`, `BehaviourSupportNotes`, `RestrictivePracticeDetails` (read-only now — write path moved to the Restrictive Practices register), `ManualHandlingNotes`, `MedicationHealthSummary`, `EmergencyConsiderations`, `TravelSpecificNotes`, `ReviewDate`. Rendered in `ParticipantDetailPage.tsx`'s `'support'` tab (:686-712), not in the wizard. **A "support profile" spec item must disambiguate which of these two is meant.**

### Preferred staff member field
- Frontend field: `preferredStaffId` (form field, `ParticipantCreatePage.tsx:123` schema decl; rendered `stepIndex===0` Identity step, "Staff Preferences" card, :2141-2163, as a `Controller` + `SearchableSelect` over `useStaff()`'s active staff).
- DTO field: `PreferredStaffId` (`DTOs.cs:101` create, `:359` update).
- **Backend domain column is named differently**: `Participant.PreferredUserId` (`Participant.cs:188`) — `ParticipantsController` maps `dto.PreferredStaffId` → `p.PreferredUserId` on both Create (:656) and Update (:888), and reads it back out as `PreferredStaffId = p.PreferredUserId` for the response DTO (:513).
- On every create/update, `ParticipantsController` calls `_compatLink.SyncFromParticipantPreferredStaffAsync(...)` (:766 create, :941 update) — see §5, this is the rostering-compatibility link.

## 4. Backend contract

- **Domain entities** (`backend/Odip.Domain/Entities/`): `Participant.cs` (487 lines — the flat wide table backing nearly every wizard field), `ParticipantContactRole.cs` (130 lines), `Person.cs` (59 lines), plus one-entity-per-collection: `ParticipantRiskEntry.cs`, `ParticipantConsent.cs`, `ParticipantHealthCondition.cs`, `ParticipantAdlAssessment.cs`, `ParticipantChecklistItem.cs`. Also present but **unrelated to the new CONTACT-01 model**: `Contact.cs` / `ParticipantContact.cs` — a legacy pair still wired to `Participant.PlanManagerContact`/`InvoiceService` billing, explicitly left alone (`ContactRoles.cs:11-13` doc comment).
- **`ParticipantsController.cs`** (`backend/Odip.Api/Controllers/ParticipantsController.cs`) endpoints:
  - `GET /api/participants` (:412-413, paged list)
  - `GET /api/participants/{id}` (:455-456, `ParticipantDetailDto`)
  - `POST /api/participants` (:569-571, `CreateParticipantDto` → `ParticipantDetailDto`)
  - `PUT /api/participants/{id}` (:785-787, `UpdateParticipantDto` → `ParticipantDetailDto`)
  - `GET/PUT /api/participants/{id}/support-profile` (:973-1010, `SupportProfileDto`/`UpdateSupportProfileDto`)
  - `GET /api/participants/{id}/bookings`, `GET .../documents/intake`, `GET .../documents/profile`, `DELETE /api/participants/{id}`
  - **No PATCH** anywhere on this controller — **partial update is not supported**; `PUT` always takes the full `UpdateParticipantDto` shape (an `IsActive` bool added on top of everything `CreateParticipantDto` has, `DTOs.cs:560-563`).
- **DTOs** (`backend/Odip.Application/DTOs/DTOs.cs`): `CreateParticipantDto` (:211-559, ~350 lines) contains every flat participant field plus six nested collections: `RiskEntries: List<CreateParticipantRiskEntryDto>`, `ContactRoles: List<CreateParticipantContactRoleDto>`, `Consents: List<CreateParticipantConsentDto>`, `HealthConditions: List<CreateParticipantHealthConditionDto>`, `AdlAssessments: List<CreateParticipantAdlAssessmentDto>`, `ChecklistItems: List<CreateParticipantChecklistItemDto>`. `UpdateParticipantDto : CreateParticipantDto` (:560-563) adds only `IsActive`. `ParticipantDetailDto : ParticipantListDto` (:38).
- **Contact/person entity + role field type**: `Person` (one row per human/org, tenant-scoped, `Person.cs`) is many-to-many with `Participant` via `ParticipantContactRole` (`ParticipantContactRole.cs`) — **`RoleType` is a single `ContactRoleType` enum column per join row** (`backend/Odip.Domain/Enums/ContactRoles.cs:24-38`, 14 values: NextOfKin, EmergencyContact, Guardian, PlanNominee, ChildRepresentative, SupportCoordinator, PlanManager, Gp, Specialist, Pharmacy, ProviderContact, Advocate, Interpreter, Solicitor) — **not** a multi-select/collection field; multiple roles for one person-participant pair are multiple `ParticipantContactRole` rows. Gating/uniqueness rules live in `ContactRoleRules`/`ContactRoleFieldRules` (same file), shared between `ParticipantsController` (rows submitted transactionally with a new participant) and `ParticipantContactRolesController` (nested CRUD after creation).
- **`ParticipantContactRolesController.cs`** (separate nested-CRUD controller, used post-creation / by the detail page's Contacts tab, not the wizard's edit mode):
  - `GET /api/participants/{participantId}/contact-roles` (:32-33)
  - `POST /api/participants/{participantId}/contact-roles` (:45-47)
  - `PUT /api/participants/contact-roles/{id}` (:94-96)
  - `DELETE /api/participants/contact-roles/{id}` (:124-126)
- **`PersonsController.cs`**: `GET /api/persons?search=`, `GET /api/persons/{id}`, `POST`, `PUT /api/persons/{id}` (standard CRUD, no delete found in this list).
- Similarly, `ParticipantConsentsSection`/`ParticipantHealthConditionsSection`/`ParticipantAdlAssessmentsSection`/`RiskEntriesSection` on the detail page each call their own **per-item upsert hooks** (`useUpsertConsent`, `useUpsertHealthCondition`, `useUpsertAdlAssessment`, plus Risk Entries' own CRUD) rather than going through the whole-participant `PUT` — i.e. **two independent write paths exist for the same consents/health-conditions/ADL data**: the wizard's edit-mode full-form submit (which DOES still include and submit these three arrays, unlike `riskEntries`/`contactRoles` which are stripped) and the detail page's per-row upsert endpoints. This dual-path is a notable structural fact for any spec touching those grids.

## 5. Rostering compatibility

- Frontend: `frontend/src/pages/rostering/CompatibilityPage.tsx` (339 lines) + `frontend/src/pages/rostering/lib/useCompatibilityMatrix.ts` (36 lines) render/feed the Preferred/Allowed/Excluded staff×participant matrix; writes go through `RosteringController.UpsertCompatibility`.
- Backend: `backend/Odip.Domain/Rostering/RosteringEntities.cs` defines `StaffParticipantCompatibility` (Level: Preferred/Allowed/Excluded, `AutoLinked` bool, `Reason`). `backend/Odip.Infrastructure/Services/StaffCompatibilityLinkService.cs` (135 lines) is the two-way sync:
  - `SyncFromParticipantPreferredStaffAsync(participantId, oldUserId, newUserId, ct, isDraft)` — called by `ParticipantsController` on both Create (:766) and Update (:941) with the participant's `PreferredUserId` before/after values. Auto-creates/refreshes a `Preferred`-level compatibility row for the newly-picked staff member, and removes the row for the previously-picked one **only if that row is still `AutoLinked`** (never overwrites a human-set Allowed/Excluded judgement). Skips creating a row entirely when `isDraft` is true.
  - `SyncFromCompatibilityUpsertAsync(row, previousLevel, ct)` — the reverse direction, called from `RosteringController.UpsertCompatibility`: marking a pair `Preferred` in the matrix fills an empty `Participant.PreferredUserId`; moving a pair *off* `Preferred` (e.g. to Excluded) clears `PreferredUserId` if it pointed at that same staff member.
- **So yes — preferred staff member already feeds rostering compatibility today**, bidirectionally, with `AutoLinked` as the origin marker preventing either side from clobbering a human's explicit matrix decision. Any spec change to the preferred-staff field or its cardinality (e.g. multi-staff) must account for this sync service on both write paths.

## 6. Existing tests

| Test file | Lines | Covers |
|---|---|---|
| `frontend/src/pages/ParticipantCreatePage.test.tsx` | 2,779 | The whole wizard. 19 top-level `describe` blocks: wizard navigation/back-preserves-values, per-step validation scoping (an error on one step doesn't block another), Review step (summary + Edit links + exact final-submit payload shape + preferred-staff selection incl. keyboard-only selection), INTAKE-05 gender self-description reveal, FUND-01 NDIS plan dates, FUND-02 funding-source gating incl. a confirm-before-data-loss dialog, INTAKE-07 conditional-payload exact-key-set assertions per scenario (Gender=Other, FundingSource=Other, each LivingArrangement branch, address), DIAG-01/02 diagnoses + HIDPA + epilepsy auto-derivation, INTAKE-09 risk entries (create-mode add/remove/validate, **and edit-mode renders no add-rows UI**), CONTACT-02/03 contacts (create-mode new/existing person), INTAKE-08 save-as-draft (incl. button-visibility rules), INTAKE sub-wave A field draft/edit round-trip, Cultural & Consent, clinical enrichment (Health/Medical/Mobility/Behaviour), Daily Living (ADL grid/Meals/About Me), and INTAKE-03 Community Access conditional field injection. **Any of the 10 planned changes touching step order, field visibility rules, the payload shape, or the create/edit divergence will very likely break several of these assertions** — the "exact payload key set" tests in particular are brittle to intentional restructuring.
| `frontend/src/pages/ParticipantDetailPage.test.tsx` | — | 3 `describe` blocks: INTAKE-03 Community Access card, Details tab groups (PDETAIL-01), DOC-01 document header buttons. |
| `frontend/src/pages/participant-detail/ContactsTab.test.tsx` | 193 | Contacts tab CRUD, role-type gating. |
| `frontend/src/pages/participant-detail/ParticipantConsentsSection.test.tsx` | 160 | Per-row consent upsert. |
| `frontend/src/pages/participant-detail/ParticipantHealthConditionsSection.test.tsx` | 184 | Per-row health-condition upsert. |
| `frontend/src/pages/participant-detail/ParticipantAdlAssessmentsSection.test.tsx` | 194 | Per-row ADL upsert. |
| `frontend/src/pages/participant-detail/RiskEntriesSection.test.tsx` | 162 | Detail-page risk-entry CRUD. |
| `backend/Odip.Tests/Controllers/ParticipantsControllerTests.cs`, `ParticipantsControllerCommunityAccessTests.cs` | — | Controller-level create/update validation, community-access field gating. |
| `backend/Odip.Tests/Contacts/ParticipantContactRolesControllerTests.cs`, `PersonsControllerTests.cs` | — | Contact-role/person CRUD + `ContactRoleRules` gating. |
| `backend/Odip.Tests/Rostering/StaffCompatibilityLinkServiceTests.cs` | — | The preferred-staff ↔ compatibility-matrix sync described in §5. |

---

## Top structural obstacles to splitting into an "intake form" + "participant profile"

1. **One monolithic component, one monolithic schema, one monolithic payload.** All 11 steps, all Zod validation, and the entire `CreateParticipantDto`/`UpdateParticipantDto` payload live as a single 3,608-line file / single flat DTO with 6 nested collections. There is no existing seam between "intake-only" data and "ongoing profile" data at the code level — every field is just another key in the same `ParticipantFormData` type and the same wire payload. Splitting requires either (a) two DTOs/forms with a merge point, or (b) keeping one payload shape but two entry-point UIs — a real design decision, not a mechanical extraction.
2. **Create-mode-only vs. edit-mode-managed data already diverges inconsistently within the one component.** `riskEntries` and `contactRoles` are wizard-editable only at creation and become detail-page-tab-only afterward (with the wizard's edit-mode step reduced to a "go there instead" link) — but `consents`/`healthConditions`/`adlAssessments` are edited in **both** places simultaneously (the wizard's edit mode still submits them via the whole-participant `PUT`, while the detail page's sections independently upsert the same rows per-item). Any intake/profile split must decide, per data area, which of these two precedents to follow, or resolve the existing dual-write-path inconsistency for consents/health/ADLs first.
3. **No incremental/partial save exists server-side to build on.** There's no PATCH endpoint and no per-step submit — only one whole-object `POST`/`PUT` (for the main record) plus a bolted-on `IsDraft` flag/"save as draft" action that reuses the exact same whole-payload endpoint with looser validation. An "intake form" that saves progressively, or a "profile" that's edited in independent chunks, has no existing partial-update primitive to reuse beyond the per-item upsert endpoints already used by the four detail-page sections (§4) — extending that pattern (or adding real PATCH support) is likely required rather than optional plumbing.

Additional naming/scope trap worth flagging up front: "support profile" is ambiguous in this codebase — it can mean the wizard's Support Needs & Mobility step (plain Participant columns) or the entirely separate `SupportProfileDto`/`support-profile` sub-resource (Communication/Behaviour-Support/Manual-Handling/etc. notes, edited only from the detail page). Confirm which one any "support profile" change item targets before scoping it.
