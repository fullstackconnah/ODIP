# Medication Management — Backend Spec

**Status:** Implemented (backend). **Date:** 2026-08-23.

## Purpose

ODIP already tracks a free-text `MedicationHealthSummary` field on `SupportProfile`. That's
enough for a support worker to *read* a participant's medication situation but not enough to
run day-to-day medication administration safely, or to answer an auditor's questions about PRN
dosing, chemical restraint, or consent. This feature adds a structured medication chart per
participant, a Medication Administration Record (MAR) view for support staff, and the
compliance metadata NDIS practice standards expect to exist and be reviewable.

## NDIS / legal drivers

- **NDIS Practice Standards — Medication Management module.** Registered providers delivering
  medication support must be able to demonstrate safe administration practice: what was
  prescribed, what was actually given, who gave it, and what happened when it wasn't given as
  prescribed. `ParticipantMedication` + `MedicationAdministration` are the structured record of
  that.
- **PRN (as-needed) dosing discipline.** A PRN medication needs a documented indication (why it's
  given), a ceiling (max doses per 24h and/or a minimum interval between doses), and an outcome
  once given (did it work?). All three are modelled: `PrnIndication`/`PrnMaxDosesPer24h`/
  `PrnMinIntervalMinutes` on the medication, `PrnReason`/`PrnOutcome`/`PrnOutcomeAt` on the
  administration record.
- **Chemical restraint.** Under the NDIS Quality and Safeguards framework, a medication used
  *primarily to influence a participant's behaviour* (rather than to treat a diagnosed condition)
  is a restrictive practice. It requires a behaviour support plan (BSP) to be in place and a
  state-based restrictive practice authorisation, and its use must be regularly reviewed.
  Unauthorised chemical restraint is a reportable incident. This is why `IsChemicalRestraint`,
  `BspInPlace`, and `RestrictivePracticeAuthorisationRef` exist as first-class fields, and why
  the `ChemicalRestraintUnauthorised` compliance flag exists to surface the gap automatically
  rather than relying on someone noticing during a file audit. `IsPsychotropic` is tracked
  separately and does *not* imply restraint — most psychotropic medication (e.g. an SSRI for an
  anxiety diagnosis) is ordinary clinical treatment, not a restrictive practice. The distinction
  matters: conflating the two would either over-flag routine mental health treatment or
  under-flag genuine restraint.
- **High-risk administration / witness sign-off.** Requiring a second person to witness
  administration of high-risk medications (e.g. injectables, medications with a narrow safety
  margin) is sector best practice for reducing administration error, even though it isn't a
  single hard NDIS rule. `IsHighRisk` drives the witness requirement on administration.
- **High Intensity Support.** Certain medication-related supports (e.g. subcutaneous injections,
  enteral/PEG feeding) fall under the NDIS High Intensity Support Skills Descriptor, which has
  its own worker competency expectations. `IsHighIntensitySupport` flags these so the data exists
  to support that workflow later (see Exclusions — no competency gating in v1).
- **No hard deletes.** NDIS-funded providers are expected to retain support records for
  approximately 7 years. There is deliberately no DELETE endpoint anywhere in this feature — a
  medication is retired via `Status = Ceased`, never removed, matching the existing pattern for
  `Participant`/`IncidentReport` (soft-delete via a status/active flag).
- **Polypharmacy** (for future UI/reporting use, not enforced in v1): commonly defined as 5 or
  more concurrent regular medications, or 2 or more concurrent psychotropic medications — a
  known risk signal for adverse interactions and over-medication, particularly relevant to the
  chemical-restraint review process.

## Data model

### `ParticipantMedication` (the chart entry — one row per prescribed medication)

Tenant-scoped (`ITenantEntity`), FK to `Participant` (Restrict — a participant's medication
history must survive even if the participant record itself is later archived/removed from
another flow). Key fields beyond the obvious (name/strength/form/route/dose/directions):

- `Type` (Regular | Prn) drives which of the two dosing-schedule shapes applies —
  `TimesOfDay` (CSV of 24h times, e.g. `"08:00,20:00"`) for Regular, or
  `PrnIndication`/`PrnMaxDosesPer24h`/`PrnMinIntervalMinutes` for PRN.
- `Purpose`, `IsPsychotropic`, `IsChemicalRestraint`, `BspInPlace`,
  `RestrictivePracticeAuthorisationRef` — the chemical-restraint documentation trail described
  above.
- `IsHighRisk` (witness required on administration), `IsHighIntensitySupport` (flag only, see
  Exclusions), `DrugSchedule` (Unscheduled/S2/S3/S4/S8), `SupportLevel`
  (SelfAdministered/PromptOnly/Assist/Administer — how much the participant does themselves).
- `ConsentObtained`/`ConsentGivenBy`/`ConsentDate`, `NextReviewDue` — consent and review tracking
  that feed the `ConsentMissing`/`ReviewOverdue` compliance flags.
- `Status` (Active | OnHold | Ceased, default Active) — lifecycle instead of deletion.

### `MedicationAdministration` (the MAR — one row per dose event, given or not)

Tenant-scoped, FK to `ParticipantMedication` (Restrict) and denormalized FK to `Participant`
(Restrict, for fast MAR queries without a join through the medication), optional FK to
`TripInstance` (SetNull — an administration recorded during a trip shouldn't vanish if the trip
record does).

- `ScheduledAt` (null for PRN — there's no fixed schedule to miss), `AdministeredAt`,
  `Status` (Administered | Refused | Withheld | Missed).
- `RecordedByName` — **always set server-side** from the authenticated user's JWT claims (the
  same `fullName`/`ClaimTypes.Name` claim precedence `AuditInterceptor` already uses), never
  accepted from the request body. This is a "who actually recorded this" integrity guarantee,
  not just a UX convenience.
- `Reason` (required when `Status != Administered`), `WitnessName` (required when the medication
  is high-risk and the dose was administered), `PrnReason`/`PrnOutcome`/`PrnOutcomeAt` (the PRN
  indication-given / outcome-observed pair), `LimitBreachAcknowledged` (set when a PRN dose was
  recorded despite breaching the max-doses/min-interval ceiling, with an explicit override).

Both entities are added to `AuditedEntities.Types` (full change history via the existing
`AuditInterceptor`/`AuditController`) and are subject to the standard tenant query filter.

## Endpoints (`Odip.Api/Controllers/MedicationsController.cs`, base route `api/v1`)

All routes use `{id:guid}`/`{participantId:guid}` constraints so literal path segments
(`register`, `mar`) never collide with a medication ID segment.

| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `participants/{participantId}/medications?includeInactive=` | any authenticated | excludes `Ceased` by default |
| POST | `participants/{participantId}/medications` | Admin, Coordinator, SuperAdmin | 404 if participant missing; see validation below |
| GET | `medications/{id}` | any authenticated | includes `PrnDosesInLast24h` |
| PUT | `medications/{id}` | Admin, Coordinator, SuperAdmin | same validation as create; no DELETE anywhere |
| GET | `medications/register?search=&status=` | any authenticated | cross-participant search |
| GET | `medications/mar?date=&participantId=` | any authenticated | MAR for a day, see below |
| POST | `medications/{id}/administrations` | Admin, Coordinator, SupportWorker, SuperAdmin | records a dose event |
| PUT | `medications/administrations/{id}` | Admin, Coordinator, SuperAdmin | amendment only |
| POST | `medications/administrations/{id}/outcome` | Admin, Coordinator, SupportWorker, SuperAdmin | records `PrnOutcome` |
| GET | `participants/{participantId}/administrations?from=&to=` | any authenticated | history, newest first |

### Validation rules

- **Create/Update medication:** `Type == Prn` requires `PrnIndication` + `PrnMaxDosesPer24h`;
  `Type == Regular` requires `TimesOfDay` as a valid CSV of `HH:mm` values;
  `IsChemicalRestraint == true` requires a non-empty `Purpose`.
- **Record administration:** `Status != Administered` requires `Reason` ("A reason is required
  when a dose is refused, withheld or missed."); a PRN medication being administered requires
  `PrnReason`; a high-risk medication being administered requires `WitnessName`.
- **PRN ceiling:** when recording an Administered dose against a PRN medication, the last 24h of
  Administered records for that medication are checked against `PrnMaxDosesPer24h` and
  `PrnMinIntervalMinutes`. A breach returns 400 with a message naming the specific limit
  ("Maximum N doses in 24 hours reached" / "Minimum interval of N minutes not yet elapsed")
  *unless* the caller sets `AcknowledgeLimitBreach = true`, in which case the record is saved
  with `LimitBreachAcknowledged = true` — the override is visible on the record, not silent.
- **MAR (`GET medications/mar`):** every Active Regular medication whose `StartDate`/`EndDate`
  cover the requested date is expanded into one `MarEntryDto` per `TimesOfDay` slot, left-joined
  to any recorded administration for that exact `(ParticipantMedicationId, ScheduledAt)` pair.
  `IsOverdue` is true when no administration is recorded and the scheduled time is more than 60
  minutes in the past. PRN medications for the filtered participant set are listed separately
  with a rolling 24h dose count and the most recent Administered record still missing a
  `PrnOutcome` (`OutcomePendingAdministrationId`), so the UI can prompt for the outcome.
- **Compliance flags** (computed server-side, never stored, attached to every
  `MedicationListDto`/`MedicationDetailDto`):
  - `ChemicalRestraintUnauthorised` — `IsChemicalRestraint && (!BspInPlace || no authorisation ref)`.
  - `ReviewOverdue` — `NextReviewDue` is in the past and the medication is still `Active`.
  - `ConsentMissing` — `ConsentObtained == false` and the medication is still `Active`.

## v1 exclusions (explicitly out of scope)

- **No jurisdiction-specific poisons/drugs rule engine.** Australian state/territory poisons
  legislation differs (e.g. what counts as S8 handling, who may administer what). Rather than
  encode a rules engine per state, v1 ships conservative defaults (`DrugSchedule` is captured but
  not enforced) plus an on-screen disclaimer that state law governs actual practice — this is a
  data-capture and workflow tool, not a compliance engine.
- **No NDIS Commission portal integration.** Nothing in this feature files a report with the
  Commission automatically.
- **No monthly restrictive-practice report export.** The data needed to build one (chemical
  restraint flags, BSP status, authorisation references, administration history) is captured now
  so that report can be built later without a schema change, but no export exists yet.
- **No staff competency gating.** `IsHighIntensitySupport` and `SupportLevel` are flags for the
  UI to surface, not an enforcement mechanism — the API does not check whether the recording
  staff member is actually competency-verified for high-intensity supports.
- **Medication-error → incident linkage is a UI prompt, not an automated workflow.** Recording a
  `Refused`/`Withheld`/`Missed` dose, or a PRN ceiling breach, does not automatically create an
  `IncidentReport`. The expectation is the frontend prompts the user to raise one manually via
  the existing Incidents feature.

## Migration

`AddMedications` (`Odip.Infrastructure/Migrations/20260823033203_AddMedications.cs`) — purely
additive: creates `ParticipantMedications` and `MedicationAdministrations` with their indexes and
FKs. No existing migration was touched.
