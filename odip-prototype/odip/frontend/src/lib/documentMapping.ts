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
 * (`Odip.Domain/SeedData/DataDictionarySeed.json` is the source of truth for the id
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
 */

export type SourceDocument = 'intake' | 'profile' | 'shared'

export interface DocumentMappingEntry {
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
}

export const DOCUMENT_MAPPING: DocumentMappingEntry[] = [
  // ── Participant Details (Identity step) — §4.1 ──────────────────────────
  { field: 'firstName', label: 'First Name', sources: ['shared'], dictionaryId: 'PID-002' },
  { field: 'lastName', label: 'Last Name', sources: ['shared'], dictionaryId: 'PID-003' },
  { field: 'preferredName', label: 'Preferred Name', sources: ['shared'], dictionaryId: 'PID-005' },
  {
    field: 'middleName', label: 'Middle Name', sources: ['profile'], dictionaryId: 'PID-004',
    notes: 'NEW (sub-wave A). Profile\'s Participant Details table only — the Intake coversheet\'s contacts table has no Middle Name column.',
  },
  { field: 'dateOfBirth', label: 'Date of Birth', sources: ['shared'], dictionaryId: 'PID-007' },
  {
    field: 'gender', label: 'Gender', sources: ['profile'], dictionaryId: 'PID-009',
    notes: 'Profile\'s Participant Details table only — not present on the Intake coversheet.',
  },
  {
    field: 'genderSelfDescription', label: 'Gender Self-Description', sources: [],
    notes: 'INTAKE-05, ODIP-only elaboration of Gender=Other. No direct field in either source form.',
  },
  {
    field: 'placeOfBirth', label: 'Place of Birth', sources: ['profile'], dictionaryId: 'PID-010',
    notes: 'NEW (sub-wave A). Profile only.',
  },
  {
    field: 'country', label: 'Country', sources: ['profile'], dictionaryId: 'CON-006',
    notes: 'NEW (sub-wave A). Neither source form visibly splits Country out of a flat "Address" field, but the dictionary carries it as a discrete id under the Profile\'s Participant Details table — tagged profile pending confirmation.',
  },
  {
    field: 'phone', label: 'Phone', sources: ['shared'], dictionaryId: 'CON-007',
    notes: 'NEW (sub-wave A). The participant\'s OWN phone — flagged as a foundational gap in §5 (previously only Contact/Person rows had a phone). Both source forms show it under "Participant Details".',
  },
  {
    field: 'email', label: 'Email', sources: ['shared'], dictionaryId: 'CON-008',
    notes: 'NEW (sub-wave A). Same gap as phone — the participant\'s OWN email, both source forms.',
  },
  { field: 'addressStreet', label: 'Address — Street', sources: ['shared'], dictionaryId: 'CON-001' },
  { field: 'addressSuburb', label: 'Address — Suburb', sources: ['shared'], dictionaryId: 'CON-003' },
  { field: 'addressState', label: 'Address — State', sources: ['shared'], dictionaryId: 'CON-004' },
  { field: 'addressPostcode', label: 'Address — Postcode', sources: ['shared'], dictionaryId: 'CON-005' },
  { field: 'preferredStaffId', label: 'Preferred Staff Member', sources: [], notes: 'ODIP rostering/compatibility field — not part of either source form.' },

  // ── Living Arrangements (Identity step) — LIVING-01..04, predates this research ──
  { field: 'livingArrangement', label: 'Living Arrangement', sources: [], notes: 'LIVING-01. Not covered by the 4 Oassist documents this research spec analysed — a separate design decision. Closest source-form concept is Profile\'s "Living Situation" (CON-011), but the 3-way Family/Independent/SupportedAccommodation model and its per-type fields below are ODIP\'s own.' },
  { field: 'mainSupportPersonName', label: 'Main Support Person', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { field: 'mainSupportPersonRelationship', label: 'Main Support Person — Relationship', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { field: 'othersLivingInAccommodation', label: 'Others Living in the Accommodation', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { field: 'residentialInfo', label: 'Residential Information', sources: [], notes: 'LIVING-02. See livingArrangement.' },
  { field: 'livesWithOthers', label: 'Lives With Others', sources: [], notes: 'LIVING-03. See livingArrangement.' },
  { field: 'whoLivesWith', label: 'Who They Live With', sources: [], notes: 'LIVING-03. See livingArrangement.' },
  { field: 'silProviderName', label: 'SIL Provider Name', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { field: 'silProviderContactPhone', label: 'SIL Provider Contact Phone', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { field: 'accommodationType', label: 'Accommodation Type', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { field: 'onSiteSupportHours', label: 'On-Site Support Hours', sources: [], notes: 'LIVING-04. See livingArrangement.' },
  { field: 'livingArrangementNotes', label: 'Living Arrangement Notes', sources: [], notes: 'LIVING-01 shared field across the 3 arrangement types. See livingArrangement.' },

  // ── NDIS & Funding step — §4.3 ───────────────────────────────────────────
  {
    field: 'ndisNumber', label: 'NDIS Number', sources: ['shared'], dictionaryId: 'PID-012',
    notes: 'Spec §6.3 flags a possible ambiguity against dictionary id NDIS-001 "Plan Number" — the two source forms never show both as distinct fields side by side. NOT modelled as a second field here; see the PR description.',
  },
  { field: 'planStartDate', label: 'Plan Start Date', sources: ['shared'], dictionaryId: 'NDIS-002' },
  { field: 'planEndDate', label: 'Plan End Date', sources: ['shared'], dictionaryId: 'NDIS-003' },
  { field: 'planType', label: 'Plan Type', sources: ['shared'], dictionaryId: 'NDIS-005' },
  { field: 'fundingSource', label: 'Funding Source (NDIS/Other)', sources: ['shared'], notes: 'FUND-02. Both forms show an NDIS Funding Y/N + Plan Type gate.' },
  { field: 'fundingOrganisation', label: 'Funding Organisation (Other — specify)', sources: [], notes: 'ODIP free-text elaboration of FundingSource=Other; no direct source-form field.' },
  {
    field: 'isDsoa', label: 'Disability Support for Older Australians (DSOA)', sources: ['profile'], dictionaryId: 'NDIS-006',
    notes: 'NEW (sub-wave A). Profile-only per §2 — the Intake coversheet has no DSOA toggle.',
  },
  { field: 'region', label: 'Region', sources: [], notes: 'ODIP operational field (service region assignment) — not part of either source form.' },
  { field: 'isRepeatClient', label: 'Repeat Client', sources: [], notes: 'ODIP operational field — not part of either source form.' },
  { field: 'serviceStreams', label: 'Service Streams', sources: [], notes: 'ODIP business-stream tags — not part of either source form (see the Community Access variant, §3, for the one stream with a real source-document delta).' },

  // ── Key Identifiers step (NEW, sub-wave A) — §4.4/§5 ────────────────────
  { field: 'pensionCardNumber', label: 'Pension Card Number', sources: ['profile'], dictionaryId: 'CARD-*', notes: 'NEW. Profile-only — §2 lists the whole Key Identifiers section as Profile-only.' },
  { field: 'pensionCardExpiry', label: 'Pension Card Expiry', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'medicareNumber', label: 'Medicare Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'medicareExpiry', label: 'Medicare Expiry', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'companionCardNumber', label: 'Companion Card Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'companionCardExpiry', label: 'Companion Card Expiry', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'privateHealthFund', label: 'Private Health Fund', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'privateHealthMembershipNumber', label: 'Private Health Membership Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'taxiCardNumber', label: 'Taxi Card Number', sources: ['profile'], dictionaryId: 'CARD-*' },
  { field: 'hairColour', label: 'Hair Colour', sources: ['profile'], dictionaryId: 'PHY-*' },
  { field: 'eyeColour', label: 'Eye Colour', sources: ['profile'], dictionaryId: 'PHY-*' },
  { field: 'weightKg', label: 'Weight (kg)', sources: ['profile'], dictionaryId: 'PHY-*' },
  { field: 'heightCm', label: 'Height (cm)', sources: ['profile'], dictionaryId: 'PHY-*' },

  // ── Contacts step — CONTACT-01/02/03 ─────────────────────────────────────
  {
    field: 'contactRoles', label: 'Contacts (Next of Kin, Support Coordinator, Plan Manager, ...)', sources: ['shared'],
    notes: 'Maps loosely to both forms\' contact blocks (Intake\'s Residence/Support Coordinator/NDIS Funds Manager/Family/Administrator/Authorised Signatory rows; Profile\'s NOK/Financial Administrator/Nominated Decision Maker/Support Coordinator/Plan Manager/Plan Nominee blocks) — the merged CONTACT-01/02/03 typed-contact model already satisfies §5\'s "Plan Nominee contact type" call-out; see this PR\'s report. Field-set deltas between the two forms are NOT re-litigated here — see the research spec §2 for that detail.',
  },

  // ── Support Needs & Equipment step — §4.7 ────────────────────────────────
  { field: 'mobilityAidWheelchair', label: 'Wheelchair', sources: ['shared'], dictionaryId: 'MOB-004' },
  { field: 'mobilityAidWalker', label: 'Walker', sources: ['intake'], notes: 'Intake\'s equipment checklist includes Walker; the base Profile only lists it as a Non-Ambulant aid, not an equipment checkbox — a flagged delta, not a straight dupe (§2).' },
  { field: 'mobilitySupportOptions', label: 'Mobility Support Options', sources: ['profile'], dictionaryId: 'MOB-004', notes: 'Profile\'s Non-Ambulant Equipment/Transfers picklist; Intake\'s wheelchair sub-checks (Travel in Vehicle/Transfers/etc.) cover similar ground under a different shape.' },
  { field: 'isHighSupport', label: 'High Support', sources: [], notes: 'ODIP-derived support-level flag — not a direct source-form field.' },
  { field: 'isIntensiveSupport', label: 'Intensive Support (NDIS billing)', sources: [], notes: 'ODIP billing flag — not part of either source form.' },
  { field: 'overnightSupport', label: 'Overnight Support', sources: ['shared'], dictionaryId: 'MOB-011' },
  { field: 'overnightRatio', label: 'Overnight Ratio', sources: ['shared'], dictionaryId: 'GOAL-014' },
  { field: 'requiresHiLoBed', label: 'Hi-Lo Bed', sources: ['shared'], dictionaryId: 'MOB-013' },
  { field: 'requiresHoist', label: 'Hoist', sources: ['shared'], dictionaryId: 'MOB-014' },
  { field: 'requiresShowerChair', label: 'Shower Chair', sources: ['shared'], dictionaryId: 'MOB-015' },
  { field: 'requiresCommode', label: 'Commode', sources: ['shared'], dictionaryId: 'MOB-016' },
  { field: 'requiresStandingMachine', label: 'Standing Machine', sources: ['shared'], dictionaryId: 'MOB-017' },
  { field: 'supportRatio', label: 'Support Ratio', sources: ['shared'], dictionaryId: 'GOAL-013', notes: 'Intake\'s informal Day/Evening free-text cells vs. Profile\'s structured 1:1..1:5 × Morning/Day/Evening checkbox grid — same concept, different shape (§2 flags this as a delta, not a straight dupe).' },
  { field: 'mobilityNotes', label: 'Mobility Notes', sources: ['profile'], notes: 'Free-text elaboration; loosely maps to Profile\'s Functional Information notes.' },
  { field: 'equipmentRequirements', label: 'Equipment Requirements', sources: ['profile'], notes: 'Free-text elaboration alongside the equipment checkboxes above.' },
  { field: 'transportRequirements', label: 'Transport Requirements', sources: ['profile'], notes: 'Free-text elaboration; loosely maps to Profile\'s Transportation/wheelchair-in-vehicle notes.' },

  // ── Medical step — §4.6, DIAG-01/02 ──────────────────────────────────────
  { field: 'primaryDiagnosis', label: 'Primary Diagnosis', sources: ['profile'], dictionaryId: 'MED-016', notes: 'DIAG-01. Profile\'s structured Diagnoses & Medical Conditions table; the Intake coversheet only has free-text "Health Conditions/Diagnoses" (see medicalSummary below).' },
  { field: 'otherDiagnoses', label: 'Other Diagnoses', sources: ['profile'], dictionaryId: 'MED-016' },
  { field: 'hidpaSupportCategories', label: 'HIDPA Support Categories', sources: ['profile'], notes: 'DIAG-02. The base Profile scatters HIDPA-training-required flags per-condition rather than a single field; the Community Access variant (§3, INTAKE-03 territory) centralises a proper HIDPA checklist instead. Tagged profile pending that later reconciliation.' },
  { field: 'medicalSummary', label: 'Medical Summary', sources: ['shared'], notes: 'Both forms carry a free-text "Health Conditions/Diagnoses" field — one of §2\'s explicit shared-set entries.' },

  // ── Cultural & Consent step (NEW, sub-wave B) — §4.5/§5 ──────────────────
  {
    field: 'isCald', label: 'Culturally and Linguistically Diverse (CALD)', sources: ['shared'], dictionaryId: 'CUL-*',
    notes: 'NEW (sub-wave B). §4.5: ALL of CALD/LGBTIQA+/Family-Community/ATSI + info-received are NEW — "the clearest one-to-one duplicate in the whole set" per §2, since the Cultural table is IDENTICAL wording/layout on both the Intake coversheet and the Participant Profile.',
  },
  {
    field: 'isLgbtqi', label: 'LGBTQI', sources: ['shared'], dictionaryId: 'CUL-*',
    notes: 'NEW (sub-wave B). Source forms label this checkbox "LGBTIQA+" — named isLgbtqi here per this PR\'s brief; flagged, not silently reconciled (see this PR\'s report).',
  },
  { field: 'isFamilyCommunity', label: 'Family / Community', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  {
    field: 'isAboriginalOrTorresStraitIslander', label: 'Aboriginal and/or Torres Strait Islander', sources: ['shared'], dictionaryId: 'CUL-*',
    notes: 'NEW (sub-wave B). Source forms label this checkbox "ATSI" — rendered with the respectful full label per the design guardrails.',
  },
  { field: 'receivedRightsAndResponsibilitiesInfo', label: 'Received: Rights and Responsibilities', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B). One of the 5 "information received" flags, §4.5.' },
  { field: 'receivedPrivacyAndConfidentialityInfo', label: 'Received: Privacy and Confidentiality', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  { field: 'receivedFeedbackInfo', label: 'Received: Feedback Information and Form', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  { field: 'receivedBeingSafeInfo', label: 'Received: Being Safe Information', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  { field: 'receivedAdvocacyInfo', label: 'Received: Advocacy Information', sources: ['shared'], dictionaryId: 'CUL-*', notes: 'NEW (sub-wave B).' },
  {
    field: 'personalInterests', label: 'Personal Interests', sources: ['profile'],
    notes: 'NEW (sub-wave B). §5 groups this with the Cultural & Consent step; loosely maps to the Profile\'s Personal and Cultural Preferences "Hobbies/interests" free text (§1c-16) — Intake has no equivalent.',
  },
  {
    field: 'choiceControlNotes', label: 'Choice & Control Notes', sources: ['profile'],
    notes: 'NEW (sub-wave B). Maps to the Profile\'s "Participant Choice and Control" section (§1c-6, Support areas/Goals/Strengths-Fears free text) — Intake has no equivalent. Modelled as one free-text field here, not the Profile\'s 3-way split; a finer split is a later-wave design decision if needed.',
  },
  {
    field: 'consents', label: 'Consent & Terms (photo/video, alcohol, OTC medication, emergency medical, privacy, travel insurance, T&Cs)', sources: ['profile'], dictionaryId: 'CNST-001..013',
    notes: 'NEW (sub-wave B). §4.5: "the entire Consent & Terms block... NEW, and notably there is no consent-tracking entity/field anywhere in the domain model. This is the single largest structural gap for a compliance-sensitive area" — now backed by the ParticipantConsent entity (one row per ConsentType). Profile-only per §2 (§1c-19/§1c-20) — the Intake coversheet has no consent block at all, only the shared Cultural table\'s own Client/Rep signature line (not modelled here — see this PR\'s report). No drawn-signature capture (SignedByName is typed, not a canvas image) — deferred.',
  },

  // ── Risks & Hazards step — §4.10, INTAKE-09 (renamed from "Risks & Consents" in sub-wave B —
  // this step never carried any consent content; the Consent & Terms block above now has its own
  // step, so the two names no longer overlap) ─────────────────────────────
  { field: 'behaviourRiskSummary', label: 'Behaviour Risk Summary', sources: ['shared'], notes: 'Loosely maps to both forms\' BOC current/5yrs severity fields (§2 shared set) — value-set delta flagged there (Low/Med/High/NA on Intake vs. /Critical on Profile), not re-modelled as separate fields here.' },
  { field: 'notes', label: 'General Notes', sources: [], notes: 'ODIP catch-all notes field — not a direct source-form field.' },
  {
    field: 'riskEntries', label: 'Risk Entries (who is at risk)', sources: [],
    notes: 'INTAKE-09. NOT the same structured tool as the source spec\'s §4.10 Risk Assessment (FRAT-style scored register) — that is flagged there as a separate, much larger design effort, not yet built. This lighter at-risk-party/description/mitigation register has no direct backing in either of the 4 Oassist documents analysed.',
  },
]

/** Every entry tagged to the given document (an entry tagged 'shared' matches both 'intake' and 'profile' queries). */
export function fieldsForDocument(doc: 'intake' | 'profile'): DocumentMappingEntry[] {
  return DOCUMENT_MAPPING.filter((entry) => entry.sources.includes(doc) || entry.sources.includes('shared'))
}

/** Look up a single field's mapping entry by its wizard/DTO field name. */
export function getFieldMapping(field: string): DocumentMappingEntry | undefined {
  return DOCUMENT_MAPPING.find((entry) => entry.field === field)
}
