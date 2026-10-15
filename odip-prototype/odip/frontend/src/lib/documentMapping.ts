/**
 * INTAKE-01/02 — wizard field → source document mapping
 * ======================================================================
 *
 * Implements INTAKE-02's Intake/Profile document split and INTAKE-04's model-once
 * principle: every participant-wizard field (existing and new, sub-wave A) is tagged
 * here with which Oassist source document(s) it belongs to —
 *
 *   - `'intake'`  — the Intake Client Needs Assessment Form only.
 *   - `'profile'` — the Participant Profile only.
 *   - `'shared'`  — appears on BOTH source forms. Per INTAKE-04, a shared field is
 *                   modelled ONCE here (and once in the entity/DTO/wizard) and simply
 *                   tagged to both documents — never duplicated as two separate fields.
 *
 * This is data + types only — no rendering change. It exists so DOC-01 (a later PR) can
 * query "which fields does the Intake coversheet PDF need?" / "which does the full
 * Participant Profile PDF need?" without re-deriving the split from scratch.
 *
 * Source: `research-source-forms.md` (the binding gap-analysis spec for this restructure),
 * particularly §2 (INTAKE vs PROFILE split / shared set), §4 (the full ODIP mapping
 * table), and §6 (ambiguous/illegible items — deliberately NOT guessed at here either).
 * `dictionaryId` cites the Master Data Dictionary field id where the spec names one
 * (`ODIP Master Data Dictionary.xlsx` at the repo root is the source of truth for the id
 * catalogue itself — this module only cites ids, it doesn't re-validate them).
 *
 * Coverage: every field the wizard captures as of sub-wave A, including fields from
 * earlier waves (LIVING-01..04, DIAG-01/02, CONTACT-01/02/03, INTAKE-09) that predate
 * this research spec — those are tagged `sources: []` with a note, since the 4 Oassist
 * documents this spec analysed don't cover them (LIVING-01..04's arrangement fields
 * come from a separate design decision, not from the Intake/Profile forms; the same is
 * true of a handful of ODIP-operational-only fields like `region`/`serviceStreams`).
 * `sources: []` means "no source-document backing", not "not yet mapped" — an
 * INTAKE-02-relevant field always has at least one source tagged.
 *
 * Wizard fields added in LATER sub-waves (B, C, ...) MUST extend `DOCUMENT_MAPPING`
 * below rather than starting a parallel mapping structure — this is meant to be the
 * one place DOC-01 (and anything else that needs "what document is this field on")
 * looks.
 *
 * PF-10.1 (SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`) adds a
 * second, orthogonal tag to every entry: `entryPhase` — which WIZARD captures the field, as
 * opposed to `sources` (which PDF renders it). See the `EntryPhase`/`DocumentMappingEntry`
 * doc comments and `fieldsForEntry` below. This promotes the existing document-tagging into an
 * entry-tagging without a parallel file — the backend mirror lives in a THIRD file,
 * `backend/Odip.Infrastructure/Services/ParticipantFieldEntryMap.cs`, kept deliberately
 * separate from `ParticipantDocumentFieldMap.cs` (that file stays scoped to PDF rendering).
 */

import type { ServiceStream } from '@/api/types/enums'

export type SourceDocument = 'intake' | 'profile' | 'shared'

/**
 * PF-10.1 (SPEC-05 `docs/specs/odip-updates-2026-09/SPEC-05-intake-profile-split.md`) — which
 * WIZARD captures this field, as opposed to `sources` above (which PDF *renders* it). Every
 * field has exactly one `entryPhase`; there is no `'shared'` entry-phase value — a field present
 * on both Oassist source forms (`sources: ['shared']`) is always `entryPhase: 'intake'` (captured
 * once, at Intake, per the "any common fields should be removed for the time being" backlog
 * ask) and is merely displayed read-only on the Profile wizard/detail page afterwards. See
 * `fieldsForEntry` below for the query surface PF-10.3/PF-10.4 build on.
 */
export type EntryPhase = 'intake' | 'profile'

/**
 * INTAKE-04 — field-level de-duplication / service identity. `serviceStreams` records which
 * service stream(s) a field belongs to: 'all' (or omitted) for fields relevant regardless of
 * service, or an explicit ServiceStream[] for fields that only exist because of one particular
 * service (e.g. CommunityAccessDailyLiving). A field shared by more than one service still
 * appears as exactly ONE DOCUMENT_MAPPING entry (not one per service) — list every service that
 * uses it in this array rather than duplicating the entry. This is the field-identity rule
 * INTAKE-04 asks for: same field, same entry, however many services reference it.
 */
export interface DocumentMappingEntry {
  /**
   * PF-10.1 — which wizard captures this field (as opposed to `sources`, which document(s)
   * *render* it). Required on every entry; see the `EntryPhase` doc comment above.
   */
  entryPhase: EntryPhase
  /** The wizard/DTO field name (matches ParticipantFormData / CreateParticipantDto). */
  field: string
  /** Short human label, for a future DOC-01 UI or debug output — not the wizard's own label. */
  label: string
  /**
   * Which source document(s) this field belongs to. A 'shared' field is modelled once
   * (INTAKE-04) — it is NOT also listed separately under 'intake' and 'profile'.
   * An empty array means the field has no Oassist source-form backing (ODIP-operational,
   * or sourced from a separate design decision — see `notes`).
   */
  sources: SourceDocument[]
  /** Master Data Dictionary field id, where the research spec names one (e.g. "PID-004"). */
  dictionaryId?: string
  /** Gap/delta/ambiguity notes — mirrors the research spec's EXISTS-DIFFERENTLY / flagged items. */
  notes?: string
  /** See this interface's own doc comment above (INTAKE-04 field-identity rule). */
  serviceStreams?: ServiceStream[] | 'all'
}

export const DOCUMENT_MAPPING: DocumentMappingEntry[] = [
  // ── Participant Details (Identity step) — §4.1 ──────────────────────────
  { entryPhase: 'intake', field: 'firstName', label: 'First Name', sources: ['shared'], dictionaryId: 'PID-002' },
  { entryPhase: 'intake', field: 'lastName', label: 'Last Name', sources: ['shared'], dictionaryId: 'PID-003' },
  { entryPhase: 'intake', field: 'preferredName', label: 'Preferred Name', sources: ['shared'], dictionaryId: 'PID-005' },
  {
    entryPhase: 'profile',
    field: 'middleName', label: 'Middle Name', sources: ['profile'], dictionaryId: 'PID-004',
    notes: 'NEW (sub-wave A). Profile\'s Participant Details table only — the Intake coversheet\'s contacts table has no Middle Name column.',
  },
  { entryPhase: 'intake', field: 'dateOfBirth', label: 'Date of Birth', sources: ['shared'], dictionaryId: 'PID-007' },
  {
    entryPhase: 'profile',
    field: 'gender', label: 'Gender', sources: ['profile'], dictionaryId: 'PID-009',
    notes: 'Profile\'s Participant Details table only — not present on the Intake coversheet.',
  },
  {
    entryPhase: 'profile',
    field: 'genderSelfDescription', label: 'Gender Self-Description', sources: [],
    notes: 'INTAKE-05, ODIP-only elaboration of Gender=Other. No direct field in either source form.',
  },
  {
    entryPhase: 'profile',
    field: 'placeOfBirth', label: 'Place of Birth', sources: ['profile'], dictionaryId: 'PID-010',
    notes: 'NEW (sub-wave A). Profile only.',
  },
  {
    entryPhase: 'profile',
    field: 'country', label: 'Country', sources: ['profile'], dictionaryId: 'CON-006',
    notes: 'NEW (sub-wave A). Neither source form visibly splits Country out of a flat "Address" field, but the dictionary carries it as a discrete id under the Profile\'s Participant Details table — tagged profile pending confirmation.',
  },
  {
    entryPhase: 'intake',
    field: 'phone', label: 'Phone', sources: ['shared'], dictionaryId: 'CON-007',
    notes: 'NEW (sub-wave A). The participant\'s OWN phone — flagged as a foundational gap in §5 (previously only Contact/Person rows had a phone). Both source forms show it under "Participant Details".',
  },
  {
    entryPhase: 'intake',
    field: 'email', label: 'Email', sources: ['shared'], dictionaryId: 'CON-008',
    notes: 'NEW (sub-wave A). Same gap as phone — the participant\'s OWN email, both source forms.',
  },
  { entryPhase: 'intake', field: 'addressStreet', label: 'Address — Street', sources: ['shared'], dictionaryId: 'CON-001' },
  { entryPhase: 'intake', field: 'addressSuburb', label: 'Address — Suburb', sources: ['shared'], dictionaryId: 'CON-003' },
  { entryPhase: 'intake', field: 'addressState', label: 'Address — State', sources: ['shared'], dictionaryId: 'CON-004' },
  { entryPhase: 'intake', field: 'addressPostcode', label: 'Address — Postcode', sources: ['shared'], dictionaryId: 'CON-005' },
  { entryPhase: 'profile', field: 'preferredStaffId', label: 'Preferred Staff Member', sources: [], notes: 'ODIP rostering/compatibility field — not part of either source form.' },

  // ── Living Arrangements (Identity step) — LIVING-01..04, predates this research ──
  { entryPhase: 'intake', field: 'livingArrangement', label: 'Living Arrangement', sources: [], notes: 'LIVING-01. Not covered by the 4 Oassist documents this research spec analysed — a separate design decision. Closest source-form concept is Profile\'s "Living Situation" (CON-011), but the 3-way Family/Independent/SupportedAccommodation model and its per-type fields below are ODIP\'s own.' },
  { entryPhase: 'intake', field: 'mainSupportPersonName', label: 'Main Support Person', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { entryPhase: 'intake', field: 'mainSupportPersonRelationship', label: 'Main Support Person — Relationship', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { entryPhase: 'intake', field: 'othersLivingInAccommodation', label: 'Others Living in the Accommodation', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { entryPhase: 'intake', field: 'residentialInfo', label: 'Residential Information', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { entryPhase: 'intake', field: 'livesWithOthers', label: 'Lives With Others', sources: [], notes: 'LIVING-03. See livingArrangement.' },
  { entryPhase: 'intake', field: 'whoLivesWith', label: 'Who They Live With', sources: [], notes: 'LIVING-03. See livingArrangement.' },
  { entryPhase: 'intake', field: 'silProviderName', label: 'SIL Provider Name', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { entryPhase: 'intake', field: 'silProviderContactPhone', label: 'SIL Provider Contact Phone', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { entryPhase: 'intake', field: 'accommodationType', label: 'Accommodation Type', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { entryPhase: 'intake', field: 'onSiteSupportHours', label: 'On-Site Support Hours', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { entryPhase: 'intake', field: 'livingArrangementNotes', label: 'Living Arrangement Notes', sources: [], notes: 'LIVING-01 shared field across the 3 arrangement types. See livingArrangement.' },

  // ── NDIS & Funding step — §4.3 ───────────────────────────────────────────
  {
    entryPhase: 'intake',
    field: 'ndisNumber', label: 'NDIS Number', sources: ['shared'], dictionaryId: 'PID-012',
    notes: 'Spec §6.3 flags a possible ambiguity against dictionary id NDIS-001 "Plan Number" — the two source forms never show both as distinct fields side by side. NOT modelled as a second field here; see the PR description.',
  },
  { entryPhase: 'intake', field: 'planStartDate', label: 'Plan Start Date', sources: ['shared'], dictionaryId: 'NDIS-002' },
  { entryPhase: 'intake', field: 'planEndDate', label: 'Plan End Date', sources: ['shared'], dictionaryId: 'NDIS-003' },
  { entryPhase: 'intake', field: 'planType', label: 'Plan Type', sources: ['shared'], dictionaryId: 'NDIS-005' },
  { entryPhase: 'intake', field: 'fundingSource', label: 'Funding Source (NDIS/Other)', sources: ['shared'], notes: 'FUND-02. Both forms show an NDIS Funding Y/N + Plan Type gate.' },
  { entryPhase: 'intake', field: 'fundingOrganisation', label: 'Funding Organisation (Other — specify)', sources: [], notes: 'ODIP free-text elaboration of FundingSource=Other; no direct source-form field.' },
  {
    entryPhase: 'profile',
    field: 'isDsoa', label: 'Disability Support for Older Australians (DSOA)', sources: ['profile'], dictionaryId: 'NDIS-006',
    notes: 'NEW (sub-wave A). Profile-only per §2 — the Intake coversheet has no DSOA toggle.',
  },
  { entryPhase: 'intake', field: 'region', label: 'Region', sources: [], notes: 'ODIP operational field (service region assignment) — not part of either source form.' },
  { entryPhase: 'intake', field: 'isRepeatClient', label: 'Repeat Client', sources: [], notes: 'ODIP operational field — not part of either source form.' },
  { entryPhase: 'intake', field: 'serviceStreams', label: 'Service Streams', sources: [], notes: 'ODIP business-stream tags — not part of either source form (see the Community Access variant, §3, for the one stream with a real source-document delta).' },

  // ── Key Identifiers step (NEW, sub-wave A) — §4.4/§5 ────────────────────
  { entryPhase: 'profile', field: 'pensionCardNumber', label: 'Pension Card Number', sources: ['profile'], dictionaryId: 'CARD-*', notes: 'NEW. Profile-only — §2 lists the whole Key Identifiers section as Profile-only.' },
  { entryPhase: 'profile', field: 'pensionCardExpiry', label: 'Pension Card Expiry', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'medicareNumber', label: 'Medicare Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'medicareExpiry', label: 'Medicare Expiry', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'companionCardNumber', label: 'Companion Card Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'companionCardExpiry', label: 'Companion Card Expiry', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'privateHealthFund', label: 'Private Health Fund', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'privateHealthMembershipNumber', label: 'Private Health Membership Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'taxiCardNumber', label: 'Taxi Card Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { entryPhase: 'profile', field: 'hairColour', label: 'Hair Colour', sources: ['profile'], dictionaryId: 'PHY-*' },
  { entryPhase: 'profile', field: 'eyeColour', label: 'Eye Colour', sources: ['profile'], dictionaryId: 'PHY-*' },
  { entryPhase: 'profile', field: 'weightKg', label: 'Weight (kg)', sources: ['profile'], dictionaryId: 'PHY-*' },
  { entryPhase: 'profile', field: 'heightCm', label: 'Height (cm)', sources: ['profile'], dictionaryId: 'PHY-*' },

  // ── Contacts step — CONTACT-01/02/03 ─────────────────────────────────────
  {
    entryPhase: 'intake',
    field: 'contactRoles', label: 'Contacts (Next of Kin, Support Coordinator, Plan Manager, ...)', sources: ['shared'],
    notes: 'Maps loosely to both forms\' contact blocks (Intake\'s Residence/Support Coordinator/NDIS Funds Manager/Family/Administrator/Authorised Signatory rows; Profile\'s NOK/Financial Administrator/Nominated Decision Maker/Support Coordinator/Plan Manager/Plan Nominee blocks) — the merged CONTACT-01/02/03 typed-contact model already satisfies §5\'s "Plan Nominee contact type" call-out; see this PR\'s report. Field-set deltas between the two forms are NOT re-litigated here — see the research spec §2 for that detail.',
  },

  // ── Support Needs & Mobility step — §4.7 (renamed from "Support Needs & Equipment" in
  // sub-wave C1 — see the retired single-step wizard's STEP_SUPPORT_FIELDS doc for the rename
  // rationale) ───────────────────────────────────────────────────────────
  { entryPhase: 'intake', field: 'mobilityAidWheelchair', label: 'Wheelchair', sources: ['shared'], dictionaryId: 'MOB-004' },
  { entryPhase: 'intake', field: 'mobilityAidWalker', label: 'Walker', sources: ['intake'], notes: 'Intake\'s equipment checklist includes Walker; the base Profile only lists it as a Non-Ambulant aid, not an equipment checkbox — a flagged delta, not a straight dupe (§2).' },
  { entryPhase: 'profile', field: 'mobilitySupportOptions', label: 'Mobility Support Options', sources: ['profile'], dictionaryId: 'MOB-004', notes: 'Profile\'s Non-Ambulant Equipment/Transfers picklist; Intake\'s wheelchair sub-checks (Travel in Vehicle/Transfers/etc.) cover similar ground under a different shape.' },
  { entryPhase: 'intake', field: 'isHighSupport', label: 'High Support', sources: [], notes: 'ODIP-derived support-level flag — not a direct source-form field.' },
  { entryPhase: 'intake', field: 'isIntensiveSupport', label: 'Intensive Support (NDIS billing)', sources: [], notes: 'ODIP billing flag — not part of either source form.' },
  { entryPhase: 'intake', field: 'overnightSupport', label: 'Overnight Support', sources: ['shared'], dictionaryId: 'MOB-011' },
  { entryPhase: 'intake', field: 'overnightRatio', label: 'Overnight Ratio', sources: ['shared'], dictionaryId: 'GOAL-014' },
  { entryPhase: 'intake', field: 'requiresHiLoBed', label: 'Hi-Lo Bed', sources: ['shared'], dictionaryId: 'MOB-013' },
  { entryPhase: 'intake', field: 'requiresHoist', label: 'Hoist', sources: ['shared'], dictionaryId: 'MOB-014' },
  { entryPhase: 'intake', field: 'requiresShowerChair', label: 'Shower Chair', sources: ['shared'], dictionaryId: 'MOB-015' },
  { entryPhase: 'intake', field: 'requiresCommode', label: 'Commode', sources: ['shared'], dictionaryId: 'MOB-016' },
  { entryPhase: 'intake', field: 'requiresStandingMachine', label: 'Standing Machine', sources: ['shared'], dictionaryId: 'MOB-017' },
  { entryPhase: 'intake', field: 'supportRatio', label: 'Support Ratio', sources: ['shared'], dictionaryId: 'GOAL-013', notes: 'Intake\'s informal Day/Evening free-text cells vs. Profile\'s structured 1:1..1:5 × Morning/Day/Evening checkbox grid — same concept, different shape (§2 flags this as a delta, not a straight dupe).' },
  { entryPhase: 'profile', field: 'mobilityNotes', label: 'Mobility Notes', sources: ['profile'], notes: 'Free-text elaboration; loosely maps to Profile\'s Functional Information notes.' },
  { entryPhase: 'profile', field: 'equipmentRequirements', label: 'Equipment Requirements', sources: ['profile'], notes: 'Free-text elaboration alongside the equipment checkboxes above.' },
  { entryPhase: 'profile', field: 'transportRequirements', label: 'Transport Requirements', sources: ['profile'], notes: 'Free-text elaboration; loosely maps to Profile\'s Transportation/wheelchair-in-vehicle notes.' },

  // ── Mobility & Functional (NEW, sub-wave C1) — §4.7/§5. Step renamed "Support Needs &
  // Mobility" to honestly cover this content (see the retired single-step wizard's STEP_SUPPORT_FIELDS
  // doc for the rename rationale). All NEW per §4.7's gap table — no backing field existed. ──
  { entryPhase: 'profile', field: 'ambulantStatus', label: 'Ambulant Status', sources: ['profile'], dictionaryId: 'MOB-002', notes: 'NEW (sub-wave C1). Profile\'s Ambulant sub-grid (§1c-9): No Assist/Unsteady/Frame/Short Distance.' },
  { entryPhase: 'profile', field: 'fallsRiskRating', label: 'Falls Risk Rating', sources: ['profile'], dictionaryId: 'MOB-003', notes: 'NEW (sub-wave C1). Source-supported Low/Med/High/Critical values only — Profile\'s richer 4-value vocabulary, not Intake\'s 3-value Low/Med/High/NA variant (§2\'s flagged value-set delta).' },
  { entryPhase: 'profile', field: 'unevenGroundFlag', label: 'Uneven Ground', sources: ['profile'], dictionaryId: 'MOB-002', notes: 'NEW (sub-wave C1). Profile\'s Ambulant sub-grid "Uneven ground Y/N" sub-field.' },
  { entryPhase: 'profile', field: 'levelOfPersonalCare', label: 'Level of Personal Care', sources: ['profile'], dictionaryId: 'MOB-006', notes: 'NEW (sub-wave C1). Independent/Supervision/One-person/Two-person.' },
  { entryPhase: 'profile', field: 'orthotics', label: 'Orthotics', sources: ['profile'], dictionaryId: 'MOB-007', notes: 'NEW (sub-wave C1). Source shows Y/N/Plan + list; collapsed to one free-text column here — see Participant.cs\'s field-group doc for why.' },
  { entryPhase: 'profile', field: 'continenceSupportDetail', label: 'Continence Support', sources: ['profile'], dictionaryId: 'MOB-008', notes: 'NEW (sub-wave C1). Source shows Y/NA/Plan + Prompt/Assist + aids + Pull-up/Pads + night support; collapsed to one free-text column.' },
  { entryPhase: 'profile', field: 'bowelCareDetail', label: 'Colostomy / Catheter / Enema / Suppository', sources: ['profile'], dictionaryId: 'MOB-009', notes: 'NEW (sub-wave C1). Source shows Y/No/Plan + equipment note + support-required note + training; collapsed to one free-text column.' },
  { entryPhase: 'profile', field: 'menstruationSupport', label: 'Menstruation Support', sources: ['profile'], dictionaryId: 'MOB-012', notes: 'NEW (sub-wave C1). Source shows Y/No/Plan + Independent/Verbal/Physical; collapsed to one free-text column.' },
  { entryPhase: 'profile', field: 'skinIntegrity', label: 'Skin Integrity', sources: [], notes: 'NEW (sub-wave C1). Not further enumerated in the source form — free text.' },

  // ── Medical step — §4.6, DIAG-01/02 ──────────────────────────────────────
  { entryPhase: 'profile', field: 'primaryDiagnosis', label: 'Primary Diagnosis', sources: ['profile'], dictionaryId: 'MED-016', notes: 'DIAG-01. Profile\'s structured Diagnoses & Medical Conditions table; the Intake coversheet only has free-text "Health Conditions/Diagnoses" (see medicalSummary below).' },
  { entryPhase: 'profile', field: 'otherDiagnoses', label: 'Other Diagnoses', sources: ['profile'], dictionaryId: 'MED-016' },
  {
    entryPhase: 'profile',
    field: 'hidpaSupportCategories', label: 'HIDPA Support Categories', sources: ['profile'],
    notes: 'DIAG-02. The base Profile scatters HIDPA-training-required flags per-condition rather than a single field; the Community Access variant (§3, INTAKE-03 territory) centralises a proper HIDPA checklist instead. Tagged profile pending that later reconciliation. UPDATE (INTAKE-03): that reconciliation is now closed — the Community Access variant\'s 14-item HIDPA checklist (research spec §3, Section 3) was checked against this field\'s original 9 values, 9 of which already existed (matched near-verbatim) and were left as-is; the 5 genuine-gap values (StomaColostomyCare, DiabetesManagementInsulin, PressureCare, HighIntensityBehaviourSupport, ComplexMedicationAdministration) were appended to the same HIDPA_SUPPORT_CATEGORIES enum rather than opening a second/duplicate field. Ungated — ALL 14 values are visible regardless of service stream (same as the original 9), not CommunityAccessDailyLiving-conditional.',
  },
  { entryPhase: 'intake', field: 'medicalSummary', label: 'Medical Summary', sources: ['shared'], notes: 'Both forms carry a free-text "Health Conditions/Diagnoses" field — one of §2\'s explicit shared-set entries.' },
  {
    entryPhase: 'profile',
    field: 'allergiesDetail', label: 'Allergies', sources: ['profile'], dictionaryId: 'MED-012',
    notes: 'NEW (sub-wave C1). §4.6: "Allergies/Anaphylaxis — NEW". Profile\'s Dietary Requirements table\'s "Other Allergies/Alerts" field (§1c-13).',
  },
  { entryPhase: 'profile', field: 'isAnaphylaxisRisk', label: 'Anaphylaxis Risk', sources: ['profile'], dictionaryId: 'MED-012', notes: 'NEW (sub-wave C1).' },
  { entryPhase: 'profile', field: 'allergyManagementNotes', label: 'Allergy Management Notes', sources: [], notes: 'NEW (sub-wave C1). ODIP elaboration (EpiPen location, action plan) — no direct source-form field, judged alongside the allergy detail/risk flag.' },
  {
    entryPhase: 'profile',
    field: 'healthConditions', label: 'Health Conditions (structured grid)', sources: ['profile'], dictionaryId: 'MED-002..011',
    notes: 'NEW (sub-wave C1). §4.6: structured per-condition fields for Intellectual Disability/Visual/Hearing Impairment/Mental Health/High BP/Wound Care/Epilepsy/Diabetes/Asthma/Dysphagia (Yes-No + severity + plan-provided + training-required shape) — "ALL NEW... none of the structured shape is modelled" per the gap analysis, now backed by the ParticipantHealthCondition entity (one row per HealthConditionType). This grid is support-planning DETAIL — the pre-existing primaryDiagnosis/otherDiagnoses fields (DIAG-01) remain the participant\'s clinical diagnosis labels; the two are deliberately not merged (see ParticipantHealthCondition\'s backend type doc for the full reconciliation, including the one-way, transition-only Epilepsy-diagnosis-to-grid derivation).',
  },

  // ── Cultural & Consent step (NEW, sub-wave B) — §4.5/§5 ──────────────────
  {
    entryPhase: 'intake',
    field: 'isCald', label: 'Culturally and Linguistically Diverse (CALD)', sources: ['shared'], dictionaryId: 'CUL-*',
    notes: 'NEW (sub-wave B). §4.5: ALL of CALD/LGBTIQA+/Family-Community/ATSI + info-received are NEW — "the clearest one-to-one duplicate in the whole set" per §2, since the Cultural table is IDENTICAL wording/layout on both the Intake coversheet and the Participant Profile.',
  },
  {
    entryPhase: 'intake',
    field: 'isLgbtqi', label: 'LGBTIQA+', sources: ['shared'], dictionaryId: 'CUL-*',
    notes: 'NEW (sub-wave B). Displayed label matches the source forms\' own wording ("LGBTIQA+") per review-round polish; the underlying field/column name stays isLgbtqi (this PR\'s original brief) rather than being renamed to match — a display-only reconciliation, not a schema one.',
  },
  { entryPhase: 'intake', field: 'isFamilyCommunity', label: 'Family / Community', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  {
    entryPhase: 'intake',
    field: 'isAboriginalOrTorresStraitIslander', label: 'Aboriginal and/or Torres Strait Islander', sources: ['shared'], dictionaryId: 'CUL-*',
    notes: 'NEW (sub-wave B). Source forms label this checkbox "ATSI" — rendered with the respectful full label per the design guardrails.',
  },
  { entryPhase: 'intake', field: 'receivedRightsAndResponsibilitiesInfo', label: 'Received: Rights and Responsibilities', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B). One of the 5 "information received" flags, §4.5.' },
  { entryPhase: 'intake', field: 'receivedPrivacyAndConfidentialityInfo', label: 'Received: Privacy and Confidentiality', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  { entryPhase: 'intake', field: 'receivedFeedbackInfo', label: 'Received: Feedback Information and Form', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  { entryPhase: 'intake', field: 'receivedBeingSafeInfo', label: 'Received: Being Safe Information', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  { entryPhase: 'intake', field: 'receivedAdvocacyInfo', label: 'Received: Advocacy Information', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  {
    entryPhase: 'profile',
    field: 'personalInterests', label: 'Personal Interests', sources: ['profile'],
    notes: 'NEW (sub-wave B). §5 groups this with the Cultural & Consent step; loosely maps to the Profile\'s Personal and Cultural Preferences "Hobbies/interests" free text (§1c-16) — Intake has no equivalent.',
  },
  {
    entryPhase: 'profile',
    field: 'choiceControlNotes', label: 'Choice & Control Notes', sources: ['profile'],
    notes: 'NEW (sub-wave B). Maps to the Profile\'s "Participant Choice and Control" section (§1c-6, Support areas/Goals/Strengths-Fears free text) — Intake has no equivalent. Modelled as one free-text field here, not the Profile\'s 3-way split; a finer split is a later-wave design decision if needed. UPDATE (sub-wave C2): that finer split now exists as the dedicated goals/supportAreas/strengthsFears fields (Daily Living step) — see the goals entry\'s DEDUP note for the full reconciliation. This field is kept (existing data, general elaboration not otherwise captured) rather than removed or backfilled from it.',
  },
  {
    entryPhase: 'profile',
    field: 'consents', label: 'Consent & Terms (photo/video, alcohol, OTC medication, emergency medical, privacy, travel insurance, T&Cs)', sources: ['profile'], dictionaryId: 'CNST-001..013',
    notes: 'NEW (sub-wave B). §4.5: "the entire Consent & Terms block... NEW, and notably there is no consent-tracking entity/field anywhere in the domain model. This is the single largest structural gap for a compliance-sensitive area" — now backed by the ParticipantConsent entity (one row per ConsentType). Profile-only per §2 (§1c-19/§1c-20) — the Intake coversheet has no consent block at all, only the shared Cultural table\'s own Client/Rep signature line (not modelled here — see this PR\'s report). No drawn-signature capture (SignedByName is typed, not a canvas image) — deferred.',
  },

  // ── Behaviour & Communication step (NEW, sub-wave C1) — §4.8/§5. New step placed between
  // Medical and Risks & Hazards (see the retired single-step wizard's STEP_BEHAVIOUR_COMMUNICATION_FIELDS
  // doc for the placement rationale). All NEW per §4.8's gap table except the two EXISTS-DIFFERENTLY
  // entries called out below. ──────────────────────────────────────────────
  { entryPhase: 'profile', field: 'memory', label: 'Memory', sources: ['profile'], dictionaryId: 'COG-001', notes: 'NEW (sub-wave C1). Excellent/Fair/Poor.' },
  { entryPhase: 'profile', field: 'memoryAids', label: 'Memory Aids', sources: ['profile'], dictionaryId: 'COG-002', notes: 'NEW (sub-wave C1).' },
  { entryPhase: 'profile', field: 'impairedUnderstanding', label: 'Impaired Understanding', sources: ['profile'], dictionaryId: 'COG-003', notes: 'NEW (sub-wave C1). Split from Impaired Judgement/Reasoning below — the source form has these as two separate Y/N fields, not one combined item.' },
  { entryPhase: 'profile', field: 'impairedJudgementReasoning', label: 'Impaired Judgement / Reasoning', sources: ['profile'], dictionaryId: 'COG-004', notes: 'NEW (sub-wave C1).' },
  {
    entryPhase: 'intake',
    field: 'behavioursOfConcernCurrent', label: 'Behaviours of Concern (Current)', sources: ['shared'], dictionaryId: 'COG-005',
    notes: 'EXISTS-DIFFERENTLY, now closed (sub-wave C1). §4.8: previously only Participant.BehaviourRiskSummary free text, no discrete Y/N flag — now a dedicated bool? column. behaviourRiskSummary (Risks & Hazards step) remains the free-text elaboration.',
  },
  { entryPhase: 'intake', field: 'behavioursOfConcernFiveYearHistory', label: 'Behaviours of Concern (5-Year History)', sources: ['shared'], notes: 'NEW (sub-wave C1). Both source forms\' "BOC 5yrs+" rating row (§2 shared set) — this is the discrete Y/N companion to that rating, see behaviourRiskRating below.' },
  {
    entryPhase: 'profile',
    field: 'behaviourRiskRating', label: 'Behaviour Risk Rating', sources: ['profile'], dictionaryId: 'COG-011',
    notes: 'EXISTS-DIFFERENTLY, now closed (sub-wave C1). §4.8: previously only free-text BehaviourRiskSummary, no Low/Med/High/Critical enum field — now a dedicated RiskRatingLevel? column, sharing the enum with fallsRiskRating (§4.7).',
  },
  { entryPhase: 'profile', field: 'ridsLogged', label: 'RIDS Logged', sources: ['profile'], dictionaryId: 'COG-008', notes: 'NEW (sub-wave C1).' },
  { entryPhase: 'profile', field: 'bspPlanProvided', label: 'BSP Plan Provided', sources: ['profile'], dictionaryId: 'COG-009', notes: 'NEW (sub-wave C1).' },
  { entryPhase: 'profile', field: 'bocChartProvided', label: 'BOC Chart Provided', sources: ['profile'], dictionaryId: 'COG-010', notes: 'NEW (sub-wave C1).' },
  { entryPhase: 'intake', field: 'expressiveSkills', label: 'Expressive Skills', sources: ['shared'], dictionaryId: 'COM-001', notes: 'NEW (sub-wave C1). Free text — source form combines High/Med/Low + Verbal/Non-verbal/Restrictions/Sign, too varied for one enum. Intake\'s free-text "Expressive and Receptive Skills" is the shared-set companion (§2).' },
  { entryPhase: 'profile', field: 'receptiveSkills', label: 'Receptive Skills', sources: ['profile'], dictionaryId: 'COM-002', notes: 'NEW (sub-wave C1). Free text — source form combines High/Med/Low.' },
  { entryPhase: 'profile', field: 'readingAbility', label: 'Reading Ability', sources: ['profile'], dictionaryId: 'COM-003', notes: 'NEW (sub-wave C1). Free text — source form combines Y/N + Good/Med/Low.' },
  { entryPhase: 'profile', field: 'communicationAids', label: 'Communication Aids', sources: ['profile'], dictionaryId: 'COM-004', notes: 'NEW (sub-wave C1). Free text — source form combines Y/N + specify.' },

  // ── Daily Living step (NEW, sub-wave C2) — §4.9/§5. New step placed between "Behaviour &
  // Communication" and "Risks & Hazards" (see the retired single-step wizard's
  // STEP_DAILY_LIVING_FIELDS doc for the placement rationale). All NEW per §4.9's gap table
  // except the two dedup calls documented below. ──────────────────────────────────────────
  {
    entryPhase: 'profile',
    field: 'adlAssessments', label: 'ADL Ratings (Personal + Community/Domestic, structured grid)', sources: ['profile'], dictionaryId: 'PADL-002..007, CADL-001..015',
    notes: 'NEW (sub-wave C2). §4.9: "Personal-ADL I/S/A/F levels... NEW — no I/S/A/F level field anywhere"; "the entire Community/Domestic ADL domain — ALL NEW, complete gap, no ADL-level fields exist". Now backed by the ParticipantAdlAssessment entity (one row per AdlType, 20 values: 6 Personal §1c-15 + 14 Community/Domestic §1c-17). Level scale "I/S/A/F" is unexpanded in the source form — see the backend AdlLevel enum doc for the flagged plain-English-reading caveat, not a confirmed source expansion. UPDATE (INTAKE-03): each row also gained an optional howToHelpNotes column (research spec §3) — a per-ADL-row "how to help me" instruction, CommunityAccessDailyLiving-gated in the wizard, distinct from this same row\'s always-visible `notes`. Not split into a separate DOCUMENT_MAPPING entry (sub-field granularity isn\'t this table\'s shape) — the whole adlAssessments field stays tagged \'all\' since the base grid itself is relevant regardless of stream; only its howToHelpNotes column is CA-specific.',
  },
  {
    entryPhase: 'profile',
    field: 'mealAssistanceDetail', label: 'Meal Assistance', sources: ['profile'], dictionaryId: 'MEAL-001',
    notes: 'NEW (sub-wave C2). §4.9/§1c-13: "Meal assistance [Y/N]" — collapsed to one free-text descriptive column, same deliberate simplification as the Mobility & Functional group\'s Orthotics/ContinenceSupportDetail (sub-wave C1).',
  },
  {
    entryPhase: 'profile',
    field: 'chokingRiskMealDetail', label: 'Choking Risk — Meal Management', sources: ['profile'], dictionaryId: 'MEAL-002',
    notes: 'NEW (sub-wave C2). §1c-13: "Fluid intake/Choking risk [Y/N + Low/Med/High/Crit]". DEDUP/RECONCILIATION vs the health-condition grid\'s Dysphagia row (sub-wave C1, Medical step): this field is the day-to-day MEAL-MANAGEMENT detail; the grid row records WHETHER Dysphagia is a diagnosed support need. Deliberately not merged — see Participant.cs\'s field group doc and this PR\'s report.',
  },
  { entryPhase: 'profile', field: 'modifiedDietDetail', label: 'Modified Diet', sources: ['profile'], dictionaryId: 'MEAL-003', notes: 'NEW (sub-wave C2). §1c-13: Y/N + A(Soft)/B(minced)/C(pureed)/Cut small — collapsed to one free-text column.' },
  {
    entryPhase: 'profile',
    field: 'pegRegimeMealDetail', label: 'PEG Regime', sources: ['profile'], dictionaryId: 'MEAL-004',
    notes: 'NEW (sub-wave C2). §1c-13: "PEG regime [plan Y/N + training]" — collapsed to one free-text column. Loosely related to HidpaSupportCategory.EnteralFeeding (DIAG-02) but not merged with it.',
  },
  { entryPhase: 'profile', field: 'specialUtensilsDetail', label: 'Special Utensils', sources: ['profile'], dictionaryId: 'MEAL-005', notes: 'NEW (sub-wave C2). §1c-13: "Special utensils [Y/N]" — collapsed to one free-text column so which utensils can be described.' },
  {
    entryPhase: 'profile',
    field: 'specialDietaryNeedsDetail', label: 'Special Dietary Needs', sources: ['profile'], dictionaryId: 'MEAL-006',
    notes: 'NEW (sub-wave C2). §1c-13: "Special Dietary Needs [Y/N + allergy risk grid]" — the dietary-preference detail (e.g. vegetarian, halal, low-sodium), distinct from allergies (see the DEDUP note below).',
  },
  {
    entryPhase: 'profile',
    field: 'favouriteBreakfast', label: 'Favourite Breakfast', sources: ['profile'], dictionaryId: 'MEAL-008..010',
    notes: 'NEW (sub-wave C2). §1c-14 Favourite Meals snapshot table follows the source\'s Breakfast/Lunch/Dinner shape — modelled as three named fields, not a generic "favourite meal 1/2/3" list.',
  },
  { entryPhase: 'profile', field: 'favouriteLunch', label: 'Favourite Lunch', sources: ['profile'], dictionaryId: 'MEAL-008..010', notes: 'NEW (sub-wave C2). See favouriteBreakfast.' },
  { entryPhase: 'profile', field: 'favouriteDinner', label: 'Favourite Dinner', sources: ['profile'], dictionaryId: 'MEAL-008..010', notes: 'NEW (sub-wave C2). See favouriteBreakfast.' },
  { entryPhase: 'profile', field: 'medicationTricks', label: 'Medication Tricks', sources: ['profile'], dictionaryId: 'MEAL-011', notes: 'NEW (sub-wave C2). §1c-14: "Tricks for medication" — how medication is best given alongside food.' },
  { entryPhase: 'profile', field: 'foodsAlwaysEaten', label: 'Foods Always Eaten', sources: ['profile'], dictionaryId: 'MEAL-012', notes: 'NEW (sub-wave C2). §1c-14: "Foods always eaten".' },
  {
    entryPhase: 'profile',
    field: 'goals', label: 'Goals', sources: ['profile'], dictionaryId: 'GOAL-002',
    notes: 'NEW (sub-wave C2). DEDUP: sub-wave B\'s choiceControlNotes entry explicitly flagged this exact finer Support Areas/Goals/Strengths-Fears split as "a later-wave design decision if needed" — this IS that later wave. choiceControlNotes is kept (existing data, general elaboration) rather than removed or backfilled — see this PR\'s report.',
  },
  { entryPhase: 'profile', field: 'supportAreas', label: 'Support Areas', sources: ['profile'], dictionaryId: 'GOAL-001', notes: 'NEW (sub-wave C2). See goals\' DEDUP note.' },
  { entryPhase: 'profile', field: 'strengthsFears', label: 'Strengths / Fears', sources: ['profile'], dictionaryId: 'GOAL-003', notes: 'NEW (sub-wave C2). See goals\' DEDUP note.' },
  { entryPhase: 'profile', field: 'thingsToKnow', label: 'Things to Know', sources: ['profile'], dictionaryId: 'GOAL-004', notes: 'NEW (sub-wave C2). §1c-16 "Things you need to know" — no prior field.' },
  { entryPhase: 'profile', field: 'whoIsImportant', label: 'Who/What Is Important', sources: ['profile'], dictionaryId: 'GOAL-005', notes: 'NEW (sub-wave C2). §1c-16 "Who/what is important" — no prior field.' },
  {
    entryPhase: 'profile',
    field: 'likesDislikes', label: 'Likes & Dislikes', sources: ['profile'], dictionaryId: 'GOAL-007',
    notes: 'NEW (sub-wave C2). §1c-16 "Likes and dislikes" — no prior field. GOAL-006 "Hobbies/interests" is DELIBERATELY NOT a new field: personalInterests (sub-wave B) already sources from this exact same source-form line (see that entry\'s notes) — adding a second Hobbies field would be a straight duplicate, not a finer split. See this PR\'s report for the dedup call.',
  },

  // ── Community Access variant (NEW, INTAKE-03/04) — research spec §3. Fields that exist only
  // because CommunityAccessDailyLiving is one of the participant's serviceStreams — tagged
  // serviceStreams: ['CommunityAccessDailyLiving'] per the field-identity rule documented on
  // DocumentMappingEntry above. sources: [] throughout — these are ODIP-operational fields
  // sourced from the Community Access variant document (research spec §3), not traced to a
  // Master Data Dictionary id like the base Intake/Profile forms above. hidpaNotes is the one
  // exception: it's introduced by this same PR but is ungated (see its own entry below), so it is
  // NOT tagged CommunityAccessDailyLiving-specific — tagging it that way would contradict its own
  // always-visible wizard placement (Medical step, alongside hidpaSupportCategories).
  {
    entryPhase: 'profile',
    field: 'signsHappyAndSettled', label: 'Signs I Am Happy and Settled', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 7 — free text.',
  },
  {
    entryPhase: 'profile',
    field: 'whatHelpsMeCalmDown', label: 'What Helps Me Calm Down', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 7 — free text.',
  },
  {
    entryPhase: 'profile',
    field: 'bocTriggers', label: 'Behaviours of Concern — Triggers', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 8 — free text. Distinct from the checklistItems Community Behaviours of Concern checkbox list below (structured Yes/No/N-A per named item vs. this narrative detail).',
  },
  {
    entryPhase: 'profile',
    field: 'bocEarlyWarningSigns', label: 'Behaviours of Concern — Early Warning Signs', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 8 — free text.',
  },
  {
    entryPhase: 'profile',
    field: 'bocDeEscalationStrategies', label: 'Behaviours of Concern — De-Escalation Strategies', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 8 — free text.',
  },
  {
    entryPhase: 'profile',
    field: 'bocWhatNotToDo', label: 'Behaviours of Concern — What Not To Do', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 8 — free text.',
  },
  {
    entryPhase: 'profile',
    field: 'checklistItems', label: 'Community Access Checklists (Mobility & Transport Risk, Behaviours of Concern)', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03/04). research spec §3, Section 7 (9-item Community Mobility & Transport Risk checklist) and Section 8 (12-item Community Behaviours of Concern checkbox list) — one ChecklistItemType row per item, 21 total, same fixed-enumerated-set "materialize all N rows" shape as adlAssessments/healthConditions above (backed by the ParticipantChecklistItem entity). One DOCUMENT_MAPPING entry for the whole grid-shaped field, matching how adlAssessments/healthConditions are represented here.',
  },
  {
    entryPhase: 'profile',
    field: 'communityAccessRiskItems', label: 'Community Access Risk Assessment (itemised matrix)', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'PF-10.2 (SPEC-05). research spec §10 — 22 named risk items across three categories (Road & Traffic Safety, Behaviours of Concern, Health & Personal Safety), each rated Low/Med/High/Critical with a free-text Support/Strategy note per item. Genuinely a different shape from checklistItems\' Yes/No/N-A checkbox list (structured rating + strategy note vs. tri-state answer) and from riskEntries (INTAKE-09\'s lighter at-risk-party register) — this resolves the "not yet built" FRAT-style scored register flagged on riskEntries\' own entry below. One DOCUMENT_MAPPING entry for the whole 22-row grid, same convention as checklistItems/adlAssessments/healthConditions (backed by the ParticipantCommunityAccessRiskItem entity).',
  },
  {
    entryPhase: 'profile',
    field: 'overallCommunityAccessRiskRating', label: 'Overall Community Access Risk Rating', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'PF-10.2 (SPEC-05). research spec §10\'s 23rd, non-itemised rated value — a single overall rating alongside the 22-row communityAccessRiskItems matrix, not part of that collection (lives directly on Participant).',
  },
  {
    entryPhase: 'intake',
    field: 'hidpaNotes', label: 'HIDPA Notes', sources: [],
    notes: 'NEW (INTAKE-03). research spec §3, Section 3 — free-text elaboration alongside hidpaSupportCategories\' "None of the above" item. DELIBERATELY tagged \'all\' (not CommunityAccessDailyLiving), unlike this section\'s other new fields — ungated in the wizard, same visibility as hidpaSupportCategories itself, since this is the same general support-need concept regardless of service stream. See hidpaSupportCategories\' own entry above for the fuller reconciliation.',
  },
  {
    entryPhase: 'profile',
    field: 'supportsLookLikeMorning', label: 'What My Supports Look Like — Morning', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 9 — free text; "only complete where Oassist staff are providing support" per the source.',
  },
  {
    entryPhase: 'profile',
    field: 'supportsLookLikeDay', label: 'What My Supports Look Like — Day', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 9. See supportsLookLikeMorning.',
  },
  {
    entryPhase: 'profile',
    field: 'supportsLookLikeAfternoonEvening', label: 'What My Supports Look Like — Afternoon-Evening', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 9. See supportsLookLikeMorning.',
  },
  {
    entryPhase: 'profile',
    field: 'supportsLookLikeOvernight', label: 'What My Supports Look Like — Overnight', sources: [], serviceStreams: ['CommunityAccessDailyLiving'],
    notes: 'NEW (INTAKE-03). research spec §3, Section 9. See supportsLookLikeMorning.',
  },

  // ── Risks & Hazards step — §4.10, INTAKE-09 (renamed from "Risks & Consents" in sub-wave B —
  // this step never carried any consent content; the Consent & Terms block above now has its own
  // step, so the two names no longer overlap) ─────────────────────────────
  { entryPhase: 'intake', field: 'behaviourRiskSummary', label: 'Behaviour Risk Summary', sources: ['shared'], notes: 'Loosely maps to both forms\' BOC current/5yrs severity fields (§2 shared set) — value-set delta flagged there (Low/Med/High/NA on Intake vs. /Critical on Profile), not re-modelled as separate fields here.' },
  { entryPhase: 'intake', field: 'notes', label: 'General Notes', sources: [], notes: 'ODIP catch-all notes field — not a direct source-form field.' },
  {
    entryPhase: 'intake',
    field: 'riskEntries', label: 'Risk Entries (who is at risk)', sources: [],
    notes: 'INTAKE-09. NOT the same structured tool as the source spec\'s §4.10 Risk Assessment (FRAT-style scored register) — that effort is now resolved by communityAccessRiskItems above (PF-10.2). This lighter at-risk-party/description/mitigation register has no direct backing in either of the 4 Oassist documents analysed.',
  },
]

/** Every entry tagged to the given document (an entry tagged 'shared' matches both 'intake' and 'profile' queries). */
export function fieldsForDocument(doc: 'intake' | 'profile'): DocumentMappingEntry[] {
  return DOCUMENT_MAPPING.filter((entry) => entry.sources.includes(doc) || entry.sources.includes('shared'))
}

/**
 * PF-10.1 — every entry whose wizard capture phase (`entryPhase`, not `sources`) is `phase`.
 * This is the single source of truth PF-10.3 (Intake wizard)/PF-10.4 (Profile wizard) build
 * their field sets from — no hand-authored duplicate field list in either wizard component.
 * `fieldsForEntry('intake')` and `fieldsForEntry('profile')` partition `DOCUMENT_MAPPING`
 * exactly (every field in exactly one), unlike `fieldsForDocument`, whose two calls overlap on
 * every `sources: ['shared']` entry.
 */
export function fieldsForEntry(phase: EntryPhase): DocumentMappingEntry[] {
  return DOCUMENT_MAPPING.filter((entry) => entry.entryPhase === phase)
}

/** Look up a single field's mapping entry by its wizard/DTO field name. */
export function getFieldMapping(field: string): DocumentMappingEntry | undefined {
  return DOCUMENT_MAPPING.find((entry) => entry.field === field)
}

/**
 * PF-10.4 — every `entryPhase: 'intake'` field that also renders (read-only) on the Profile
 * wizard/detail page: exactly the fields tagged `sources: ['shared']`, per this module's own
 * `EntryPhase` doc comment ("A field present on both Oassist source forms ... is captured once, at
 * Intake, and merely displayed (read-only) on the Profile wizard/detail page afterwards"). Derived
 * as `fieldsForDocument('profile')`'s intake-entryPhase subset rather than a hand-authored list —
 * `fieldsForDocument('profile')` already matches every entry whose `sources` includes 'profile' OR
 * 'shared' (see that function's doc), and no `entryPhase: 'profile'` entry has `sources: ['shared']`
 * in this table, so filtering to `entryPhase === 'intake'` recovers exactly the shared set.
 */
export function sharedFieldsDisplayedOnProfile(): DocumentMappingEntry[] {
  return fieldsForDocument('profile').filter((entry) => entry.entryPhase === 'intake')
}
