import type { ContactRoleType, ContactRoleStatus, NomineeScope, PlanType, PreferredContactMethod } from './enums'

// ══════════════════════════════════════════════════════════════
// Legacy Contact (untouched — see Person/ParticipantContactRole below for CONTACT-01/02/03)
// ══════════════════════════════════════════════════════════════

export interface ContactDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  roleRelationship: string | null
  organisation: string | null
  email: string | null
  mobile: string | null
  phone: string | null
  preferredContactMethod: PreferredContactMethod
}

// ══════════════════════════════════════════════════════════════
// Person (CONTACT-01)
// ══════════════════════════════════════════════════════════════

export interface PersonDto {
  id: string
  firstName: string
  lastName: string
  fullName: string
  phone: string | null
  mobile: string | null
  email: string | null
  addressLine: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  organisation: string | null
  dateOfBirth: string | null
  notes: string | null
  activeRoleCount: number
}

export interface CreatePersonDto {
  firstName: string
  lastName: string
  phone?: string | null
  mobile?: string | null
  email?: string | null
  addressLine?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  organisation?: string | null
  dateOfBirth?: string | null
  notes?: string | null
}

export type UpdatePersonDto = CreatePersonDto

// ══════════════════════════════════════════════════════════════
// ParticipantContactRole (CONTACT-01/02/03)
// ══════════════════════════════════════════════════════════════

/** Every role-specific field, shared by the create/update payload shapes and the read DTO. */
export interface ContactRoleFields {
  roleType: ContactRoleType
  relationshipToParticipant?: string | null
  isPrimary: boolean
  priorityOrder?: number | null
  authorisedForMedicalInfo?: boolean | null
  appointingTribunal?: string | null
  orderScopeDomains: string[]
  orderStartDate?: string | null
  orderReviewDate?: string | null
  orderEndDate?: string | null
  nomineeScope?: NomineeScope | null
  appointmentDate?: string | null
  reasonForAppointment?: string | null
  alternateRepresentativeName?: string | null
  fundingLineItemType?: string | null
  organisationName?: string | null
  registrationNumber?: string | null
  lastVisitDate?: string | null
  consentToShare?: boolean | null
  discipline?: string | null
  frequencyOfContact?: string | null
  websterPackFlag?: boolean | null
  roleTitle?: string | null
  registeredProviderFlag?: boolean | null
  scopeNotes?: string | null
  authorisationDocumentReference?: string | null
  preferredLanguage?: string | null
  startDate?: string | null
  endDate?: string | null
  status: ContactRoleStatus
  notes?: string | null
}

export interface ParticipantContactRoleDto extends ContactRoleFields {
  id: string
  participantId: string
  personId: string
  personFullName: string
  personPhone: string | null
  personMobile: string | null
  personEmail: string | null
  personOrganisation: string | null
  createdAt: string
  updatedAt: string
}

/** Exactly one of personId or newPerson* is expected to be populated — CONTACT-03's "existing
 * person vs new person" add-contact choice. */
export interface CreateParticipantContactRoleDto extends ContactRoleFields {
  personId?: string | null
  newPersonFirstName?: string | null
  newPersonLastName?: string | null
  newPersonPhone?: string | null
  newPersonMobile?: string | null
  newPersonEmail?: string | null
  newPersonOrganisation?: string | null
  // PF-6 (SPEC-02): the rest of CreatePersonDto's optional fields, so AddContactRoleForm's
  // search-first "create new" fallback can capture more than just a name on first add.
  newPersonAddressLine?: string | null
  newPersonSuburb?: string | null
  newPersonState?: string | null
  newPersonPostcode?: string | null
  newPersonDateOfBirth?: string | null
}

/** A role's Person is fixed after creation — no person fields here (see the backend DTO's doc). */
export type UpdateParticipantContactRoleDto = ContactRoleFields

// ── Labels ───────────────────────────────────────────────

export const CONTACT_ROLE_TYPE_LABELS: Record<ContactRoleType, string> = {
  NextOfKin: 'Next of Kin',
  EmergencyContact: 'Emergency Contact',
  Guardian: 'Guardian',
  PlanNominee: 'Plan Nominee',
  ChildRepresentative: 'Child Representative',
  SupportCoordinator: 'Support Coordinator',
  PlanManager: 'Plan Manager',
  Gp: 'GP',
  Specialist: 'Specialist / Allied Health',
  Pharmacy: 'Pharmacy',
  ProviderContact: 'Support Worker / Provider Contact',
  Advocate: 'Advocate',
  Interpreter: 'Interpreter / Language Support',
  // PF-10.2 (SPEC-05): reverted from the mislabelled 'Solicitor / Financial Administrator' —
  // FinancialAdministrator is now its own distinct role type below.
  Solicitor: 'Solicitor',
  FinancialAdministrator: 'Financial Administrator',
}

export const NOMINEE_SCOPE_LABELS: Record<NomineeScope, string> = {
  Plan: 'Plan nominee (full authority)',
  Correspondence: 'Correspondence nominee (receive/act on correspondence only)',
}

export const CONTACT_ROLE_STATUS_LABELS: Record<ContactRoleStatus, string> = {
  Active: 'Active',
  Expired: 'Expired',
  Superseded: 'Superseded',
}

// ── CONTACT-02 gating (form-local convenience) ──────────

/** Mirrors Odip.Domain.Enums.ContactRoleRules.CalculateAge — whole years as of today, or null
 * when dateOfBirth is unset. */
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const beforeBirthdayThisYear = today.getMonth() < dob.getMonth()
    || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())
  if (beforeBirthdayThisYear) age--
  return age
}

/**
 * Mirrors Odip.Domain.Enums.ContactRoleRules.Validate — form-local convenience only, the server
 * re-validates identically regardless (see ParticipantContactRolesController/ParticipantsController).
 * Returns an explanatory string when `roleType` isn't available for this participant, or null when
 * it's fine to offer. `registeredProviderFlag` only matters for ProviderContact under
 * Agency-managed — pass the current form value for that field (or undefined before it's set).
 */
export function contactRoleGateError(
  roleType: ContactRoleType,
  planType: PlanType | null | undefined,
  dateOfBirth: string | null | undefined,
  registeredProviderFlag?: boolean | null,
): string | null {
  if (roleType === 'PlanManager' && planType !== 'PlanManaged')
    return 'Plan Manager contacts are only available for plan-managed participants.'

  if (roleType === 'ProviderContact' && planType === 'AgencyManaged' && registeredProviderFlag !== true)
    return 'Agency-managed participants can only record registered-provider contacts.'

  const age = calculateAge(dateOfBirth)
  if (roleType === 'PlanNominee' && age !== null && age < 18)
    return 'Plan Nominee is not available for a participant under 18 — use Child Representative instead.'

  return null
}

/** Every role type available for this participant right now (gate error === null) — drives the
 * single-select Role type Dropdown (edit mode's one-role-at-a-time picker): a role already gated
 * cannot be freshly picked there at all (see contactRoleGateError's ProviderContact/Agency-managed
 * branch — there is no way to supply `registeredProviderFlag` before the role is selected in a
 * single-select control, so the Dropdown simply never offers it). */
export function availableContactRoleTypes(
  roleTypes: readonly ContactRoleType[],
  planType: PlanType | null | undefined,
  dateOfBirth: string | null | undefined,
): ContactRoleType[] {
  return roleTypes.filter(rt => contactRoleGateError(rt, planType, dateOfBirth) === null)
}

/** PF-5 (SPEC-02): role types a multi-select CHECKBOX group should always offer, even when
 * `contactRoleGateError` currently reports a violation for them. Unlike the single-select Dropdown
 * above, a multi-select checkbox group renders every selected role's own fields inline (including
 * `registeredProviderFlag` once ProviderContact is checked) — so ProviderContact can be selected
 * fresh even while its gate is unmet, its live warning shown via contactRoleGateError, and
 * corrected in place by ticking that field, rather than being unreachable until some other step
 * pre-satisfies it. PlanManager/PlanNominee have no such row-level field that can fix their gate
 * (plan type and date of birth are fixed at this point), so they stay disabled here exactly as
 * they are for the Dropdown. */
const SELF_CORRECTABLE_GATE_ROLE_TYPES: ReadonlySet<ContactRoleType> = new Set<ContactRoleType>(['ProviderContact'])

export function selectableContactRoleTypes(
  roleTypes: readonly ContactRoleType[],
  planType: PlanType | null | undefined,
  dateOfBirth: string | null | undefined,
): ContactRoleType[] {
  return roleTypes.filter(rt => SELF_CORRECTABLE_GATE_ROLE_TYPES.has(rt) || contactRoleGateError(rt, planType, dateOfBirth) === null)
}

// ── PF-2 (SPEC-02): plan-type↔contact-role completeness warning ──────────────────────────
//
// Advisory only — never blocks a save. Mirrors
// Odip.Domain.Enums.ContactRoleRules.PlanTypeComplianceWarning EXACTLY (same messages, same
// conditions) so create-mode's live client-side computation and edit-mode's backend-computed
// `existing.planTypeComplianceWarning` never disagree. Used ONLY for create mode's in-progress
// (pre-save) contactRoles field array via useWatch — edit mode always reads the server-computed
// value straight off the participant DTO, never re-derives it client-side.

/** Minimal shape this helper needs from a contact-role row — matches both the create-mode
 * `useFieldArray` row shape and `ParticipantContactRoleDto`, so either can be passed directly.
 * `roleType`/`roleTypes` are plain `string`/`string[]` (not `ContactRoleType`) because the
 * create-mode wizard's Zod schema types its field-array rows as `z.array(z.string())` (form
 * values aren't the same as the wire DTO) — this helper only ever compares them against known
 * role-type literals, so a widened string type costs nothing and avoids an extra cast at every
 * call site.
 * PF-5 (SPEC-02): a row now carries `roleTypes` (multi-select, one row fans out to N persisted
 * roles) rather than a single `roleType` — `roleType` is kept here too since
 * `ParticipantContactRoleDto` (the already-persisted, single-role-per-row server shape edit mode
 * would use if it ever called this helper) still has it; a row satisfies a condition if EITHER
 * shape names the matching role. */
export interface PlanTypeComplianceRoleInput {
  roleType?: string
  roleTypes?: readonly string[]
  registeredProviderFlag?: boolean | null
  status?: ContactRoleStatus | string
}

function roleInputHasRole(r: PlanTypeComplianceRoleInput, roleType: string): boolean {
  return r.roleType === roleType || (r.roleTypes?.includes(roleType) ?? false)
}

/**
 * Mirrors Odip.Domain.Enums.ContactRoleRules.PlanTypeComplianceWarning. `contactRoles` is
 * expected to be the participant's (or in-progress create form's) full role list — rows without
 * an explicit `status` are treated as Active, matching create-mode's field array (which has no
 * status concept of its own before submit; every row it holds is, by definition, about to be
 * created as Active).
 */
export function planTypeComplianceWarning(
  planType: PlanType | null | undefined,
  contactRoles: readonly PlanTypeComplianceRoleInput[] | null | undefined,
): string | null {
  const roles = contactRoles ?? []
  const active = roles.filter(r => (r.status ?? 'Active') === 'Active')

  if (planType === 'PlanManaged' && !active.some(r => roleInputHasRole(r, 'PlanManager')))
    return 'This plan-managed participant has no active Plan Manager contact recorded.'

  if (planType === 'AgencyManaged'
    && !active.some(r => roleInputHasRole(r, 'ProviderContact') && r.registeredProviderFlag === true))
    return 'This agency-managed participant has no active registered-provider contact with agency details recorded.'

  return null
}

// ── Per-role-type field visibility (drives which inputs the add/edit modal shows) ──

export type ContactRoleFieldKey = Exclude<keyof ContactRoleFields, 'roleType' | 'isPrimary' | 'status'>

/** Which extra fields are relevant for each role type (research §3.1-3.14) — a curated subset of
 * ContactRoleFields' full column set surfaced per role, rather than showing all 25+ optional
 * inputs regardless of role. `relationshipToParticipant`/`notes` are offered for every role and
 * aren't listed per-entry below. */
export const CONTACT_ROLE_FIELD_MAP: Record<ContactRoleType, ContactRoleFieldKey[]> = {
  NextOfKin: [],
  EmergencyContact: ['priorityOrder', 'authorisedForMedicalInfo'],
  Guardian: ['appointingTribunal', 'orderScopeDomains', 'orderStartDate', 'orderReviewDate', 'orderEndDate'],
  PlanNominee: ['nomineeScope', 'appointmentDate', 'reasonForAppointment'],
  ChildRepresentative: ['alternateRepresentativeName'],
  SupportCoordinator: ['organisationName', 'fundingLineItemType', 'registrationNumber', 'startDate', 'endDate'],
  PlanManager: ['organisationName', 'startDate', 'endDate'],
  Gp: ['organisationName', 'registrationNumber', 'lastVisitDate', 'consentToShare'],
  Specialist: ['discipline', 'organisationName', 'frequencyOfContact'],
  Pharmacy: ['organisationName', 'websterPackFlag'],
  ProviderContact: ['organisationName', 'roleTitle', 'registeredProviderFlag', 'registrationNumber'],
  Advocate: ['organisationName', 'scopeNotes', 'authorisationDocumentReference'],
  Interpreter: ['preferredLanguage', 'organisationName'],
  Solicitor: ['organisationName', 'scopeNotes', 'authorisationDocumentReference'],
  // PF-10.2: same field shape as Solicitor — both are professional/authority contacts.
  FinancialAdministrator: ['organisationName', 'scopeNotes', 'authorisationDocumentReference'],
}

export const GUARDIAN_ORDER_SCOPE_DOMAINS = ['Health', 'Accommodation', 'Lifestyle', 'Legal', 'Financial', 'Plenary'] as const

// ── PF-5 (SPEC-02): multi-role field union ──────────────────────────────

/**
 * The deduplicated set of relevant field keys across every selected role, in first-seen order
 * (walking `roleTypes` in the order given, then each role's own `CONTACT_ROLE_FIELD_MAP` entry).
 * A pure, easily-unit-testable building block for "does this selection need any role-specific
 * fields at all" — AddContactRoleForm still renders each selected role's own fields in its own
 * grouped block (SPEC-02's "independent per-role values" default for shared-slot fields like
 * OrganisationName, since each role is a separate ParticipantContactRole row with its own
 * column value), so this union is NOT used to collapse same-named fields into one shared input.
 */
export function unionRelevantFields(roleTypes: readonly ContactRoleType[]): ContactRoleFieldKey[] {
  const seen = new Set<ContactRoleFieldKey>()
  const result: ContactRoleFieldKey[] = []
  for (const roleType of roleTypes) {
    for (const key of CONTACT_ROLE_FIELD_MAP[roleType] ?? []) {
      if (!seen.has(key)) {
        seen.add(key)
        result.push(key)
      }
    }
  }
  return result
}
