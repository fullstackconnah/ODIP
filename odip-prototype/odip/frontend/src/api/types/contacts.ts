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
  Solicitor: 'Solicitor / Financial Administrator',
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

// ── CONTACT-02 gating (form-local convenience — INTAKE-07 style) ──────────

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
 * Contacts step/tab's role-type picker. */
export function availableContactRoleTypes(
  roleTypes: readonly ContactRoleType[],
  planType: PlanType | null | undefined,
  dateOfBirth: string | null | undefined,
): ContactRoleType[] {
  return roleTypes.filter(rt => contactRoleGateError(rt, planType, dateOfBirth) === null)
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
}

export const GUARDIAN_ORDER_SCOPE_DOMAINS = ['Health', 'Accommodation', 'Lifestyle', 'Legal', 'Financial', 'Plenary'] as const
