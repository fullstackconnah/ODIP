import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus } from 'lucide-react'
import { useParticipant, usePersons, useCreateContactRole, useUpdateContactRole } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { CONTACT_ROLE_TYPES } from '@/api/types/enums'
import type { ContactRoleType, NomineeScope, ContactRoleStatus, PlanType } from '@/api/types/enums'
import {
  CONTACT_ROLE_TYPE_LABELS, CONTACT_ROLE_STATUS_LABELS, NOMINEE_SCOPE_LABELS, CONTACT_ROLE_FIELD_MAP,
  GUARDIAN_ORDER_SCOPE_DOMAINS, availableContactRoleTypes, selectableContactRoleTypes, contactRoleGateError,
  unionRelevantFields, type ContactRoleFieldKey,
} from '@/api/types/contacts'
import type { ParticipantContactRoleDto, CreateParticipantContactRoleDto, UpdateParticipantContactRoleDto, PersonDto } from '@/api/types/contacts'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

/** Splits a typed "First Last" (or "First Middle Last") query into first/last name parts for the
 * "create new" fallback's pre-fill — PF-6's "pre-filled from whatever was typed". */
function splitTypedName(query: string): { first: string; last: string } {
  const parts = query.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

/** Every role-specific field this form can render, keyed by role in a per-role slice of state —
 * PF-5's OPEN QUESTION default of "independent per-role values": a person with 2 roles is 2
 * separate ParticipantContactRole rows with 2 separate values for any same-named column (e.g.
 * OrganisationName), so this form never feeds one shared input into two roles' payloads. */
type RoleFieldValues = {
  priorityOrder: string
  authorisedForMedicalInfo: boolean
  appointingTribunal: string
  orderScopeDomains: string[]
  orderStartDate: string
  orderReviewDate: string
  orderEndDate: string
  nomineeScope: NomineeScope | ''
  appointmentDate: string
  reasonForAppointment: string
  alternateRepresentativeName: string
  fundingLineItemType: string
  organisationName: string
  registrationNumber: string
  lastVisitDate: string
  consentToShare: boolean
  discipline: string
  frequencyOfContact: string
  websterPackFlag: boolean
  roleTitle: string
  registeredProviderFlag: boolean
  scopeNotes: string
  authorisationDocumentReference: string
  preferredLanguage: string
  startDate: string
  endDate: string
}

const EMPTY_ROLE_FIELDS: RoleFieldValues = {
  priorityOrder: '', authorisedForMedicalInfo: false, appointingTribunal: '', orderScopeDomains: [],
  orderStartDate: '', orderReviewDate: '', orderEndDate: '', nomineeScope: '', appointmentDate: '',
  reasonForAppointment: '', alternateRepresentativeName: '', fundingLineItemType: '', organisationName: '',
  registrationNumber: '', lastVisitDate: '', consentToShare: false, discipline: '', frequencyOfContact: '',
  websterPackFlag: false, roleTitle: '', registeredProviderFlag: false, scopeNotes: '',
  authorisationDocumentReference: '', preferredLanguage: '', startDate: '', endDate: '',
}

type ContactFormState = {
  // PF-6: 'search' while typing/browsing results, 'selected' once an existing person is chosen,
  // 'new' when "None of these — create new" was clicked. Edit mode never leaves 'selected' (a
  // role's Person is fixed after creation).
  personMode: 'search' | 'selected' | 'new'
  nameQuery: string
  personId: string
  selectedPersonLabel: string
  newFirstName: string
  newLastName: string
  newPhone: string
  newMobile: string
  newEmail: string
  newOrganisation: string
  newAddressLine: string
  newSuburb: string
  newState: string
  newPostcode: string
  newDateOfBirth: string
  roleTypes: ContactRoleType[]
  roleFields: Partial<Record<ContactRoleType, RoleFieldValues>>
  relationshipToParticipant: string
  isPrimary: boolean
  status: ContactRoleStatus
  notes: string
}

function emptyForm(initialRoleType: ContactRoleType): ContactFormState {
  return {
    personMode: 'search', nameQuery: '', personId: '', selectedPersonLabel: '',
    newFirstName: '', newLastName: '', newPhone: '', newMobile: '', newEmail: '', newOrganisation: '',
    newAddressLine: '', newSuburb: '', newState: '', newPostcode: '', newDateOfBirth: '',
    roleTypes: [initialRoleType], roleFields: { [initialRoleType]: EMPTY_ROLE_FIELDS },
    relationshipToParticipant: '', isPrimary: false, status: 'Active', notes: '',
  }
}

function roleToForm(role: ParticipantContactRoleDto): ContactFormState {
  return {
    personMode: 'selected', nameQuery: role.personFullName, personId: role.personId, selectedPersonLabel: role.personFullName,
    newFirstName: '', newLastName: '', newPhone: '', newMobile: '', newEmail: '', newOrganisation: '',
    newAddressLine: '', newSuburb: '', newState: '', newPostcode: '', newDateOfBirth: '',
    roleTypes: [role.roleType],
    roleFields: {
      [role.roleType]: {
        priorityOrder: role.priorityOrder != null ? String(role.priorityOrder) : '',
        authorisedForMedicalInfo: role.authorisedForMedicalInfo ?? false,
        appointingTribunal: role.appointingTribunal ?? '', orderScopeDomains: role.orderScopeDomains ?? [],
        orderStartDate: role.orderStartDate?.split('T')[0] ?? '', orderReviewDate: role.orderReviewDate?.split('T')[0] ?? '', orderEndDate: role.orderEndDate?.split('T')[0] ?? '',
        nomineeScope: role.nomineeScope ?? '', appointmentDate: role.appointmentDate?.split('T')[0] ?? '', reasonForAppointment: role.reasonForAppointment ?? '',
        alternateRepresentativeName: role.alternateRepresentativeName ?? '', fundingLineItemType: role.fundingLineItemType ?? '',
        organisationName: role.organisationName ?? '', registrationNumber: role.registrationNumber ?? '',
        lastVisitDate: role.lastVisitDate?.split('T')[0] ?? '', consentToShare: role.consentToShare ?? false,
        discipline: role.discipline ?? '', frequencyOfContact: role.frequencyOfContact ?? '', websterPackFlag: role.websterPackFlag ?? false,
        roleTitle: role.roleTitle ?? '', registeredProviderFlag: role.registeredProviderFlag ?? false,
        scopeNotes: role.scopeNotes ?? '', authorisationDocumentReference: role.authorisationDocumentReference ?? '', preferredLanguage: role.preferredLanguage ?? '',
        startDate: role.startDate?.split('T')[0] ?? '', endDate: role.endDate?.split('T')[0] ?? '',
      },
    },
    relationshipToParticipant: role.relationshipToParticipant ?? '', isPrimary: role.isPrimary,
    status: role.status, notes: role.notes ?? '',
  }
}

function formToUpdatePayload(form: ContactFormState, roleType: ContactRoleType): UpdateParticipantContactRoleDto {
  const rf = form.roleFields[roleType] ?? EMPTY_ROLE_FIELDS
  return {
    roleType,
    relationshipToParticipant: form.relationshipToParticipant.trim() || null,
    isPrimary: form.isPrimary,
    status: form.status,
    notes: form.notes.trim() || null,
    priorityOrder: rf.priorityOrder ? Number(rf.priorityOrder) : null,
    authorisedForMedicalInfo: rf.authorisedForMedicalInfo,
    appointingTribunal: rf.appointingTribunal.trim() || null,
    orderScopeDomains: rf.orderScopeDomains,
    orderStartDate: rf.orderStartDate || null,
    orderReviewDate: rf.orderReviewDate || null,
    orderEndDate: rf.orderEndDate || null,
    nomineeScope: rf.nomineeScope || null,
    appointmentDate: rf.appointmentDate || null,
    reasonForAppointment: rf.reasonForAppointment.trim() || null,
    alternateRepresentativeName: rf.alternateRepresentativeName.trim() || null,
    fundingLineItemType: rf.fundingLineItemType.trim() || null,
    organisationName: rf.organisationName.trim() || null,
    registrationNumber: rf.registrationNumber.trim() || null,
    lastVisitDate: rf.lastVisitDate || null,
    consentToShare: rf.consentToShare,
    discipline: rf.discipline.trim() || null,
    frequencyOfContact: rf.frequencyOfContact.trim() || null,
    websterPackFlag: rf.websterPackFlag,
    roleTitle: rf.roleTitle.trim() || null,
    registeredProviderFlag: rf.registeredProviderFlag,
    scopeNotes: rf.scopeNotes.trim() || null,
    authorisationDocumentReference: rf.authorisationDocumentReference.trim() || null,
    preferredLanguage: rf.preferredLanguage.trim() || null,
    startDate: rf.startDate || null,
    endDate: rf.endDate || null,
  }
}

/** Builds one role's create payload. `overridePersonId` carries the Person just created by an
 * earlier role in the same fan-out (PF-5: "the same newly-created Person, created once then
 * reused for the remaining role POSTs") — when set, person fields are never re-sent, since the
 * Person already exists by the time this call goes out. */
function buildCreatePayloadForRole(form: ContactFormState, roleType: ContactRoleType, overridePersonId: string | undefined): CreateParticipantContactRoleDto {
  const base = formToUpdatePayload(form, roleType)
  const usingExistingPerson = overridePersonId !== undefined || form.personMode === 'selected'
  return {
    ...base,
    personId: usingExistingPerson ? (overridePersonId ?? form.personId ?? null) : null,
    newPersonFirstName: usingExistingPerson ? null : form.newFirstName.trim(),
    newPersonLastName: usingExistingPerson ? null : form.newLastName.trim(),
    newPersonPhone: usingExistingPerson ? null : (form.newPhone.trim() || null),
    newPersonMobile: usingExistingPerson ? null : (form.newMobile.trim() || null),
    newPersonEmail: usingExistingPerson ? null : (form.newEmail.trim() || null),
    newPersonOrganisation: usingExistingPerson ? null : (form.newOrganisation.trim() || null),
    newPersonAddressLine: usingExistingPerson ? null : (form.newAddressLine.trim() || null),
    newPersonSuburb: usingExistingPerson ? null : (form.newSuburb.trim() || null),
    newPersonState: usingExistingPerson ? null : (form.newState.trim() || null),
    newPersonPostcode: usingExistingPerson ? null : (form.newPostcode.trim() || null),
    newPersonDateOfBirth: usingExistingPerson ? null : (form.newDateOfBirth || null),
  }
}

export interface AddContactRoleFormProps {
  /** Nested-CRUD write path (ParticipantContactRolesController) — same endpoint the Contacts tab
   * already uses, on create AND edit. Never routed through the wizard's whole-payload submit. */
  participantId: string | undefined
  mode: 'create' | 'edit'
  /** Required when mode === 'edit'; the role being edited (a role's Person is fixed after
   * creation, so edit mode never shows person-picking fields, and always edits exactly one role —
   * PF-5's multi-select only applies to adding NEW roles). */
  role?: ParticipantContactRoleDto
  /** Called after a successful create/update (mutation cache already invalidated). */
  onSaved: () => void
  onCancel: () => void
}

/** One selected role's field-specific inputs, parameterized so the same JSX renders once per
 * selected role in create mode (PF-5's field-union rule) and once for the single role in edit
 * mode — `values`/`onChange` are that one role's own independent slice of state. */
function RoleFieldsBlock({ role, values, planType, onChange }: {
  role: ContactRoleType
  values: RoleFieldValues
  planType: PlanType | null | undefined
  onChange: (patch: Partial<RoleFieldValues>) => void
}) {
  const relevant = CONTACT_ROLE_FIELD_MAP[role] ?? []
  const showField = (key: ContactRoleFieldKey) => relevant.includes(key)

  return (
    <>
      {showField('priorityOrder') && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Priority order" hint="1st, 2nd, 3rd call">
            <input type="number" min={1} value={values.priorityOrder} onChange={e => onChange({ priorityOrder: e.target.value })} />
          </FormField>
          <FormField label="Authorised to receive medical info" layout="checkbox">
            <input type="checkbox" checked={values.authorisedForMedicalInfo} onChange={e => onChange({ authorisedForMedicalInfo: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </div>
      )}

      {showField('appointingTribunal') && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Appointing tribunal">
              <input value={values.appointingTribunal} onChange={e => onChange({ appointingTribunal: e.target.value })} placeholder="e.g. QCAT, VCAT" />
            </FormField>
            <FormField label="Order scope">
              <div className="flex flex-wrap gap-2 pt-1">
                {GUARDIAN_ORDER_SCOPE_DOMAINS.map(domain => {
                  const checked = values.orderScopeDomains.includes(domain)
                  return (
                    <label key={domain} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-[var(--color-border)] cursor-pointer min-h-[28px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => onChange({
                          orderScopeDomains: e.target.checked ? [...values.orderScopeDomains, domain] : values.orderScopeDomains.filter(d => d !== domain),
                        })}
                        className="w-3.5 h-3.5 rounded border-[var(--color-border)]"
                      />
                      {domain}
                    </label>
                  )
                })}
              </div>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Order start date">
              <input type="date" value={values.orderStartDate} onChange={e => onChange({ orderStartDate: e.target.value })} />
            </FormField>
            <FormField label="Order review date">
              <input type="date" value={values.orderReviewDate} onChange={e => onChange({ orderReviewDate: e.target.value })} />
            </FormField>
            <FormField label="Order end date">
              <input type="date" value={values.orderEndDate} onChange={e => onChange({ orderEndDate: e.target.value })} />
            </FormField>
          </div>
        </>
      )}

      {showField('nomineeScope') && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nominee scope">
            <Dropdown
              variant="form"
              value={values.nomineeScope}
              onChange={v => onChange({ nomineeScope: v as NomineeScope })}
              items={[{ value: '', label: 'Not specified' }, ...(['Plan', 'Correspondence'] as const).map(s => ({ value: s, label: NOMINEE_SCOPE_LABELS[s] }))]}
            />
          </FormField>
          <FormField label="Appointment date">
            <input type="date" value={values.appointmentDate} onChange={e => onChange({ appointmentDate: e.target.value })} />
          </FormField>
        </div>
      )}
      {showField('reasonForAppointment') && (
        <FormField label="Reason for appointment">
          <textarea rows={2} value={values.reasonForAppointment} onChange={e => onChange({ reasonForAppointment: e.target.value })} />
        </FormField>
      )}

      {showField('alternateRepresentativeName') && (
        <FormField label="Alternate representative" hint="e.g. the second parent">
          <input value={values.alternateRepresentativeName} onChange={e => onChange({ alternateRepresentativeName: e.target.value })} />
        </FormField>
      )}

      {showField('organisationName') && (
        <FormField label="Organisation">
          <input value={values.organisationName} onChange={e => onChange({ organisationName: e.target.value })} />
        </FormField>
      )}

      {showField('fundingLineItemType') && (
        <FormField label="Funding line item">
          <input value={values.fundingLineItemType} onChange={e => onChange({ fundingLineItemType: e.target.value })} placeholder="e.g. Coordination of Supports" />
        </FormField>
      )}

      {showField('registrationNumber') && (
        <FormField label="Registration number">
          <input value={values.registrationNumber} onChange={e => onChange({ registrationNumber: e.target.value })} />
        </FormField>
      )}

      {(showField('startDate') || showField('endDate')) && (
        <div className="grid grid-cols-2 gap-3">
          {showField('startDate') && (
            <FormField label="Start date">
              <input type="date" value={values.startDate} onChange={e => onChange({ startDate: e.target.value })} />
            </FormField>
          )}
          {showField('endDate') && (
            <FormField label="End date">
              <input type="date" value={values.endDate} onChange={e => onChange({ endDate: e.target.value })} />
            </FormField>
          )}
        </div>
      )}

      {showField('lastVisitDate') && (
        <FormField label="Last visit date">
          <input type="date" value={values.lastVisitDate} onChange={e => onChange({ lastVisitDate: e.target.value })} />
        </FormField>
      )}
      {showField('consentToShare') && (
        <FormField label="Consent to share health info" layout="checkbox">
          <input type="checkbox" checked={values.consentToShare} onChange={e => onChange({ consentToShare: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      )}

      {showField('discipline') && (
        <FormField label="Discipline">
          <input value={values.discipline} onChange={e => onChange({ discipline: e.target.value })} placeholder="e.g. Psychiatry, Occupational Therapy" />
        </FormField>
      )}
      {showField('frequencyOfContact') && (
        <FormField label="Frequency of contact">
          <input value={values.frequencyOfContact} onChange={e => onChange({ frequencyOfContact: e.target.value })} placeholder="e.g. Monthly" />
        </FormField>
      )}

      {showField('websterPackFlag') && (
        <FormField label="Uses webster pack" layout="checkbox">
          <input type="checkbox" checked={values.websterPackFlag} onChange={e => onChange({ websterPackFlag: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      )}

      {showField('roleTitle') && (
        <FormField label="Role / title">
          <input value={values.roleTitle} onChange={e => onChange({ roleTitle: e.target.value })} />
        </FormField>
      )}
      {showField('registeredProviderFlag') && (
        <FormField
          label="Registered NDIS provider"
          layout="checkbox"
          hint={planType === 'AgencyManaged' ? 'Required for agency-managed participants' : undefined}
        >
          <input type="checkbox" checked={values.registeredProviderFlag} onChange={e => onChange({ registeredProviderFlag: e.target.checked })} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      )}

      {showField('scopeNotes') && (
        <FormField label="Scope">
          <input value={values.scopeNotes} onChange={e => onChange({ scopeNotes: e.target.value })} placeholder="e.g. Formal advocacy, financial administration order" />
        </FormField>
      )}
      {showField('authorisationDocumentReference') && (
        <FormField label="Authorisation document reference">
          <input value={values.authorisationDocumentReference} onChange={e => onChange({ authorisationDocumentReference: e.target.value })} />
        </FormField>
      )}

      {showField('preferredLanguage') && (
        <FormField label="Preferred language">
          <input value={values.preferredLanguage} onChange={e => onChange({ preferredLanguage: e.target.value })} />
        </FormField>
      )}
    </>
  )
}

/**
 * Add/edit form for a single ParticipantContactRole, extracted from ContactsTab.tsx (PF-4,
 * SPEC-02) so it can be reused inline from the participant wizard's edit-mode Contacts step,
 * not just the Contacts tab's modal. Self-contained: fetches its own participant (for
 * plan-type/DOB gating) and owns the create/update mutation + its own Save/Cancel actions —
 * callers just decide where to render it (inside a Modal, or inline).
 *
 * PF-5/PF-6 (SPEC-02): create mode also owns multi-role selection (fans out to N nested-CRUD
 * create calls sharing one PersonId) and a search-first person field (types a name, sees matching
 * existing people via the existing GET /api/persons?search= endpoint, or falls through to
 * "create new"). Edit mode is unchanged in shape — it always edits exactly one already-persisted
 * role, whose Person is fixed.
 */
export default function AddContactRoleForm({ participantId, mode, role, onSaved, onCancel }: AddContactRoleFormProps) {
  const { data: participant } = useParticipant(participantId)
  const createRole = useCreateContactRole()
  const updateRole = useUpdateContactRole()

  const availableRoleTypes = useMemo(
    () => availableContactRoleTypes(CONTACT_ROLE_TYPES, participant?.planType, participant?.dateOfBirth),
    [participant?.planType, participant?.dateOfBirth],
  )
  // PF-5: the create-mode multi-select checkbox group offers a self-correctable role (currently
  // just ProviderContact) even while its gate is unmet — see selectableContactRoleTypes' doc.
  const selectableRoleTypes = useMemo(
    () => selectableContactRoleTypes(CONTACT_ROLE_TYPES, participant?.planType, participant?.dateOfBirth),
    [participant?.planType, participant?.dateOfBirth],
  )

  const [form, setForm] = useState<ContactFormState>(() =>
    mode === 'edit' && role ? roleToForm(role) : emptyForm(availableRoleTypes[0] ?? 'NextOfKin'),
  )
  const [errors, setErrors] = useState<{ person?: string; roleTypes?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)

  // PF-6: debounce the typed name before it reaches the shared usePersons(search) hook — no new
  // backend endpoint, the existing GET /api/persons?search= substring match is reused verbatim.
  const [debouncedQuery, setDebouncedQuery] = useState(form.nameQuery.trim())
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(form.nameQuery.trim()), 300)
    return () => clearTimeout(handle)
  }, [form.nameQuery])
  const { data: searchResults = [] } = usePersons(mode === 'create' ? debouncedQuery : undefined)

  function selectPerson(person: PersonDto) {
    setForm(f => ({ ...f, personMode: 'selected', personId: person.id, selectedPersonLabel: person.fullName, nameQuery: person.fullName }))
    setErrors(e => ({ ...e, person: undefined }))
  }

  function switchToNewPerson() {
    const { first, last } = splitTypedName(form.nameQuery)
    setForm(f => ({ ...f, personMode: 'new', newFirstName: first, newLastName: last }))
    setErrors(e => ({ ...e, person: undefined }))
  }

  function toggleRole(roleType: ContactRoleType, checked: boolean) {
    setForm(f => ({
      ...f,
      roleTypes: checked ? [...f.roleTypes, roleType] : f.roleTypes.filter(rt => rt !== roleType),
      roleFields: checked && !f.roleFields[roleType] ? { ...f.roleFields, [roleType]: EMPTY_ROLE_FIELDS } : f.roleFields,
    }))
    setErrors(e => ({ ...e, roleTypes: undefined }))
  }

  function setEditRoleType(roleType: ContactRoleType) {
    setForm(f => ({ ...f, roleTypes: [roleType], roleFields: { ...f.roleFields, [roleType]: f.roleFields[roleType] ?? EMPTY_ROLE_FIELDS } }))
  }

  function updateRoleFields(roleType: ContactRoleType, patch: Partial<RoleFieldValues>) {
    setForm(f => ({ ...f, roleFields: { ...f.roleFields, [roleType]: { ...(f.roleFields[roleType] ?? EMPTY_ROLE_FIELDS), ...patch } } }))
  }

  const gateErrors = form.roleTypes
    .map(rt => ({ rt, msg: contactRoleGateError(rt, participant?.planType, participant?.dateOfBirth, form.roleFields[rt]?.registeredProviderFlag) }))
    .filter((e): e is { rt: ContactRoleType; msg: string } => !!e.msg)

  function validate(): boolean {
    const next: { person?: string; roleTypes?: string } = {}
    if (mode === 'create') {
      if (form.personMode === 'new') {
        if (!form.newFirstName.trim() && !form.newLastName.trim()) next.person = "Provide the new person's name"
      } else if (!form.personId) {
        next.person = 'Select a person'
      }
      if (form.roleTypes.length === 0) next.roleTypes = 'Select at least one role'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    // Gate errors are already shown live, reactively, via the per-role gateErrors block below —
    // no separate formError banner for them here, since that state wouldn't clear itself the
    // instant the underlying field (e.g. registeredProviderFlag) is corrected (it would only
    // clear on the NEXT Save click), leaving a stale duplicate banner visible in the meantime.
    if (gateErrors.length > 0) return
    if (!participantId) return
    setFormError(null)
    try {
      if (mode === 'edit' && role) {
        const roleType = form.roleTypes[0] ?? role.roleType
        await updateRole.mutateAsync({ id: role.id, data: formToUpdatePayload(form, roleType) })
      } else {
        // PF-5: one POST per selected role, sharing one PersonId — the person created (or
        // selected) once, reused for every subsequent role in this fan-out.
        let personId: string | undefined = form.personMode === 'selected' ? form.personId : undefined
        for (const roleType of form.roleTypes) {
          const payload = buildCreatePayloadForRole(form, roleType, personId)
          const res = await createRole.mutateAsync({ participantId, data: payload })
          personId = personId ?? res?.data?.personId
        }
      }
      onSaved()
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to save contact.'))
    }
  }

  const isSaving = createRole.isPending || updateRole.isPending
  const showResults = mode === 'create' && form.personMode === 'search'
  const editRoleType = form.roleTypes[0] ?? 'NextOfKin'

  return (
    <div className="space-y-4">
      {formError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {formError}
        </div>
      )}

      {mode === 'create' && (
        <FormField label="Person" required error={errors.person}>
          <input
            value={form.personMode === 'selected' ? form.selectedPersonLabel : form.nameQuery}
            onChange={e => setForm(f => ({ ...f, personMode: 'search', nameQuery: e.target.value, personId: '', selectedPersonLabel: '' }))}
            onFocus={() => { if (form.personMode === 'selected') setForm(f => ({ ...f, personMode: 'search' })) }}
            placeholder="Search people…"
            autoFocus
          />
        </FormField>
      )}

      {showResults && (
        <div className="space-y-2">
          {searchResults.length > 0 ? (
            <ul className="space-y-1.5">
              {searchResults.map(person => (
                <li key={person.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={person.id === form.personId}
                    onClick={() => selectPerson(person)}
                    className="w-full text-left p-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
                  >
                    <p className="text-sm font-medium text-[var(--color-foreground)]">{person.fullName}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {[person.phone || person.mobile, person.dateOfBirth, person.organisation].filter(Boolean).join(' · ') || '—'}
                      {person.activeRoleCount > 0 && ` · already a contact for ${person.activeRoleCount} other participant${person.activeRoleCount === 1 ? '' : 's'}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            // Only claim "no matches" once the user has actually typed something to search for —
            // an empty field showing zero results (e.g. a brand-new tenant with no people yet)
            // isn't a failed search.
            debouncedQuery.length > 0 && (
              <p className="text-sm text-[var(--color-muted-foreground)]">No matching people found.</p>
            )
          )}
          <button
            type="button"
            onClick={switchToNewPerson}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-2 text-sm font-medium text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> None of these — create new
          </button>
        </div>
      )}

      {mode === 'create' && form.personMode === 'new' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First name" required error={errors.person}>
              <input value={form.newFirstName} onChange={e => setForm(f => ({ ...f, newFirstName: e.target.value }))} autoFocus />
            </FormField>
            <FormField label="Last name">
              <input value={form.newLastName} onChange={e => setForm(f => ({ ...f, newLastName: e.target.value }))} />
            </FormField>
            <FormField label="Mobile">
              <input value={form.newMobile} onChange={e => setForm(f => ({ ...f, newMobile: e.target.value }))} />
            </FormField>
            <FormField label="Phone">
              <input value={form.newPhone} onChange={e => setForm(f => ({ ...f, newPhone: e.target.value }))} />
            </FormField>
            <FormField label="Email">
              <input type="email" value={form.newEmail} onChange={e => setForm(f => ({ ...f, newEmail: e.target.value }))} />
            </FormField>
            <FormField label="Organisation">
              <input value={form.newOrganisation} onChange={e => setForm(f => ({ ...f, newOrganisation: e.target.value }))} />
            </FormField>
            <FormField label="Address">
              <input value={form.newAddressLine} onChange={e => setForm(f => ({ ...f, newAddressLine: e.target.value }))} />
            </FormField>
            <FormField label="Suburb">
              <input value={form.newSuburb} onChange={e => setForm(f => ({ ...f, newSuburb: e.target.value }))} />
            </FormField>
            <FormField label="State">
              <input value={form.newState} onChange={e => setForm(f => ({ ...f, newState: e.target.value }))} />
            </FormField>
            <FormField label="Postcode">
              <input value={form.newPostcode} onChange={e => setForm(f => ({ ...f, newPostcode: e.target.value }))} />
            </FormField>
            <FormField label="Date of birth">
              <input type="date" value={form.newDateOfBirth} onChange={e => setForm(f => ({ ...f, newDateOfBirth: e.target.value }))} />
            </FormField>
          </div>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, personMode: 'search' }))}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Back to search
          </button>
        </div>
      )}

      {mode === 'edit' && role && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Contact: <span className="font-medium text-[var(--color-foreground)]">{role.personFullName}</span> — edit their details on the contact book instead.
        </p>
      )}

      {mode === 'create' ? (
        <FormField label="Role types" required error={errors.roleTypes}>
          <div className="flex flex-wrap gap-2">
            {CONTACT_ROLE_TYPES.map(rt => {
              const checked = form.roleTypes.includes(rt)
              const disabled = !selectableRoleTypes.includes(rt) && !checked
              return (
                <label
                  key={rt}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border cursor-pointer min-h-[36px] transition-colors ${
                    checked ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)]'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={e => toggleRole(rt, e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-[var(--color-border)]"
                  />
                  {CONTACT_ROLE_TYPE_LABELS[rt]}
                </label>
              )
            })}
          </div>
        </FormField>
      ) : (
        <FormField label="Role type">
          <Dropdown
            variant="form"
            value={editRoleType}
            onChange={v => setEditRoleType(v as ContactRoleType)}
            items={CONTACT_ROLE_TYPES.map(rt => ({
              value: rt, label: CONTACT_ROLE_TYPE_LABELS[rt],
              disabled: !availableRoleTypes.includes(rt) && rt !== editRoleType,
            }))}
          />
        </FormField>
      )}

      {gateErrors.map(({ rt, msg }) => (
        <div key={rt} role="alert" className="p-3 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm">
          {form.roleTypes.length > 1 ? `${CONTACT_ROLE_TYPE_LABELS[rt]}: ${msg}` : msg}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Relationship to participant">
          <input value={form.relationshipToParticipant} onChange={e => setForm(f => ({ ...f, relationshipToParticipant: e.target.value }))} placeholder="e.g. Mother, Father / Guardian" />
        </FormField>
        <FormField label="Primary" layout="checkbox" hint="Only one active primary allowed per role type where relevant">
          <input type="checkbox" checked={form.isPrimary} onChange={e => setForm(f => ({ ...f, isPrimary: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      </div>

      {/* PF-5: field union across every selected role, rendered as one grouped block per role
          (independent values — see the OPEN QUESTION note on RoleFieldsBlock/unionRelevantFields
          above) rather than a single deduplicated set of inputs. */}
      {unionRelevantFields(form.roleTypes).length > 0 && (
        <div className="space-y-3">
          {form.roleTypes
            .filter(rt => (CONTACT_ROLE_FIELD_MAP[rt] ?? []).length > 0)
            .map(rt => (
              <div key={rt} className="p-3 rounded-lg border border-[var(--color-border)] space-y-3">
                {form.roleTypes.length > 1 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{CONTACT_ROLE_TYPE_LABELS[rt]} details</p>
                )}
                <RoleFieldsBlock
                  role={rt}
                  values={form.roleFields[rt] ?? EMPTY_ROLE_FIELDS}
                  planType={participant?.planType}
                  onChange={patch => updateRoleFields(rt, patch)}
                />
              </div>
            ))}
        </div>
      )}

      <FormField label="Notes">
        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </FormField>

      {mode === 'edit' && (
        <FormField label="Status">
          <Dropdown
            variant="form"
            value={form.status}
            onChange={v => setForm(f => ({ ...f, status: v as ContactRoleStatus }))}
            items={(['Active', 'Expired', 'Superseded'] as const).map(s => ({ value: s, label: CONTACT_ROLE_STATUS_LABELS[s] }))}
          />
        </FormField>
      )}

      <div className="flex justify-end gap-3 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
        >
          {isSaving ? 'Saving...' : 'Save contact'}
        </button>
      </div>
    </div>
  )
}
