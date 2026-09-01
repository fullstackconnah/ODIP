import { useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { useParticipant, usePersons, useCreateContactRole, useUpdateContactRole } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ToggleGroup } from '@/components/ToggleGroup'
import { CONTACT_ROLE_TYPES } from '@/api/types/enums'
import type { ContactRoleType, NomineeScope, ContactRoleStatus } from '@/api/types/enums'
import {
  CONTACT_ROLE_TYPE_LABELS, CONTACT_ROLE_STATUS_LABELS, NOMINEE_SCOPE_LABELS, CONTACT_ROLE_FIELD_MAP,
  GUARDIAN_ORDER_SCOPE_DOMAINS, availableContactRoleTypes, contactRoleGateError,
  type ContactRoleFieldKey,
} from '@/api/types/contacts'
import type { ParticipantContactRoleDto, CreateParticipantContactRoleDto, UpdateParticipantContactRoleDto } from '@/api/types/contacts'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

type ContactFormState = {
  personMode: 'existing' | 'new'
  personId: string
  newFirstName: string
  newLastName: string
  newPhone: string
  newMobile: string
  newEmail: string
  newOrganisation: string
  roleType: ContactRoleType
  relationshipToParticipant: string
  isPrimary: boolean
  status: ContactRoleStatus
  notes: string
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

const EMPTY_FORM: ContactFormState = {
  personMode: 'existing', personId: '', newFirstName: '', newLastName: '', newPhone: '', newMobile: '', newEmail: '', newOrganisation: '',
  roleType: 'NextOfKin', relationshipToParticipant: '', isPrimary: false, status: 'Active', notes: '',
  priorityOrder: '', authorisedForMedicalInfo: false, appointingTribunal: '', orderScopeDomains: [],
  orderStartDate: '', orderReviewDate: '', orderEndDate: '', nomineeScope: '', appointmentDate: '', reasonForAppointment: '',
  alternateRepresentativeName: '', fundingLineItemType: '', organisationName: '', registrationNumber: '',
  lastVisitDate: '', consentToShare: false, discipline: '', frequencyOfContact: '', websterPackFlag: false,
  roleTitle: '', registeredProviderFlag: false, scopeNotes: '', authorisationDocumentReference: '', preferredLanguage: '',
  startDate: '', endDate: '',
}

function formToPayload(form: ContactFormState): CreateParticipantContactRoleDto {
  return {
    personId: form.personMode === 'existing' ? (form.personId || null) : null,
    newPersonFirstName: form.personMode === 'new' ? form.newFirstName.trim() : null,
    newPersonLastName: form.personMode === 'new' ? form.newLastName.trim() : null,
    newPersonPhone: form.personMode === 'new' ? (form.newPhone.trim() || null) : null,
    newPersonMobile: form.personMode === 'new' ? (form.newMobile.trim() || null) : null,
    newPersonEmail: form.personMode === 'new' ? (form.newEmail.trim() || null) : null,
    newPersonOrganisation: form.personMode === 'new' ? (form.newOrganisation.trim() || null) : null,
    roleType: form.roleType,
    relationshipToParticipant: form.relationshipToParticipant.trim() || null,
    isPrimary: form.isPrimary,
    status: form.status,
    notes: form.notes.trim() || null,
    priorityOrder: form.priorityOrder ? Number(form.priorityOrder) : null,
    authorisedForMedicalInfo: form.authorisedForMedicalInfo,
    appointingTribunal: form.appointingTribunal.trim() || null,
    orderScopeDomains: form.orderScopeDomains,
    orderStartDate: form.orderStartDate || null,
    orderReviewDate: form.orderReviewDate || null,
    orderEndDate: form.orderEndDate || null,
    nomineeScope: form.nomineeScope || null,
    appointmentDate: form.appointmentDate || null,
    reasonForAppointment: form.reasonForAppointment.trim() || null,
    alternateRepresentativeName: form.alternateRepresentativeName.trim() || null,
    fundingLineItemType: form.fundingLineItemType.trim() || null,
    organisationName: form.organisationName.trim() || null,
    registrationNumber: form.registrationNumber.trim() || null,
    lastVisitDate: form.lastVisitDate || null,
    consentToShare: form.consentToShare,
    discipline: form.discipline.trim() || null,
    frequencyOfContact: form.frequencyOfContact.trim() || null,
    websterPackFlag: form.websterPackFlag,
    roleTitle: form.roleTitle.trim() || null,
    registeredProviderFlag: form.registeredProviderFlag,
    scopeNotes: form.scopeNotes.trim() || null,
    authorisationDocumentReference: form.authorisationDocumentReference.trim() || null,
    preferredLanguage: form.preferredLanguage.trim() || null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
  }
}

/** A role's Person is fixed after creation (see UpdateParticipantContactRoleDto's doc) — strips
 * the person-identifying fields formToPayload adds for Create, rather than sending them (and
 * having the server silently ignore them) on Update. */
function formToUpdatePayload(form: ContactFormState): UpdateParticipantContactRoleDto {
  const payload = formToPayload(form)
  return {
    roleType: payload.roleType, relationshipToParticipant: payload.relationshipToParticipant,
    isPrimary: payload.isPrimary, status: payload.status, notes: payload.notes,
    priorityOrder: payload.priorityOrder, authorisedForMedicalInfo: payload.authorisedForMedicalInfo,
    appointingTribunal: payload.appointingTribunal, orderScopeDomains: payload.orderScopeDomains,
    orderStartDate: payload.orderStartDate, orderReviewDate: payload.orderReviewDate, orderEndDate: payload.orderEndDate,
    nomineeScope: payload.nomineeScope, appointmentDate: payload.appointmentDate, reasonForAppointment: payload.reasonForAppointment,
    alternateRepresentativeName: payload.alternateRepresentativeName, fundingLineItemType: payload.fundingLineItemType,
    organisationName: payload.organisationName, registrationNumber: payload.registrationNumber,
    lastVisitDate: payload.lastVisitDate, consentToShare: payload.consentToShare, discipline: payload.discipline,
    frequencyOfContact: payload.frequencyOfContact, websterPackFlag: payload.websterPackFlag, roleTitle: payload.roleTitle,
    registeredProviderFlag: payload.registeredProviderFlag, scopeNotes: payload.scopeNotes,
    authorisationDocumentReference: payload.authorisationDocumentReference, preferredLanguage: payload.preferredLanguage,
    startDate: payload.startDate, endDate: payload.endDate,
  }
}

function roleToForm(role: ParticipantContactRoleDto): ContactFormState {
  return {
    personMode: 'existing', personId: role.personId, newFirstName: '', newLastName: '', newPhone: '', newMobile: '', newEmail: '', newOrganisation: '',
    roleType: role.roleType, relationshipToParticipant: role.relationshipToParticipant ?? '', isPrimary: role.isPrimary,
    status: role.status, notes: role.notes ?? '',
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
  }
}

export interface AddContactRoleFormProps {
  /** Nested-CRUD write path (ParticipantContactRolesController) — same endpoint the Contacts tab
   * already uses, on create AND edit. Never routed through the wizard's whole-payload submit. */
  participantId: string | undefined
  mode: 'create' | 'edit'
  /** Required when mode === 'edit'; the role being edited (a role's Person is fixed after
   * creation, so edit mode never shows person-picking fields). */
  role?: ParticipantContactRoleDto
  /** Called after a successful create/update (mutation cache already invalidated). */
  onSaved: () => void
  onCancel: () => void
}

/**
 * Add/edit form for a single ParticipantContactRole, extracted from ContactsTab.tsx (PF-4,
 * SPEC-02) so it can be reused inline from the participant wizard's edit-mode Contacts step,
 * not just the Contacts tab's modal. Self-contained: fetches its own participant (for
 * plan-type/DOB gating) and persons list, and owns the create/update mutation + its own
 * Save/Cancel actions — callers just decide where to render it (inside a Modal, or inline).
 */
export default function AddContactRoleForm({ participantId, mode, role, onSaved, onCancel }: AddContactRoleFormProps) {
  const { data: participant } = useParticipant(participantId)
  const { data: people = [] } = usePersons()
  const createRole = useCreateContactRole()
  const updateRole = useUpdateContactRole()

  const availableRoleTypes = useMemo(
    () => availableContactRoleTypes(CONTACT_ROLE_TYPES, participant?.planType, participant?.dateOfBirth),
    [participant?.planType, participant?.dateOfBirth],
  )

  const [form, setForm] = useState<ContactFormState>(() =>
    mode === 'edit' && role ? roleToForm(role) : { ...EMPTY_FORM, roleType: availableRoleTypes[0] ?? 'NextOfKin' },
  )
  const [errors, setErrors] = useState<{ person?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)

  const gateError = contactRoleGateError(form.roleType, participant?.planType, participant?.dateOfBirth, form.registeredProviderFlag)
  const visibleFields: ContactRoleFieldKey[] = CONTACT_ROLE_FIELD_MAP[form.roleType] ?? []
  const showField = (key: ContactRoleFieldKey) => visibleFields.includes(key)

  function validate(): boolean {
    const next: { person?: string } = {}
    if (form.personMode === 'existing' && !form.personId) next.person = 'Select a person'
    if (form.personMode === 'new' && !form.newFirstName.trim() && !form.newLastName.trim()) next.person = "Provide the new person's name"
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    if (gateError) {
      setFormError(gateError)
      return
    }
    if (!participantId) return
    setFormError(null)
    try {
      if (mode === 'edit' && role) {
        await updateRole.mutateAsync({ id: role.id, data: formToUpdatePayload(form) })
      } else {
        await createRole.mutateAsync({ participantId, data: formToPayload(form) })
      }
      onSaved()
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Failed to save contact.'))
    }
  }

  const isSaving = createRole.isPending || updateRole.isPending

  return (
    <div className="space-y-4">
      {formError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          {formError}
        </div>
      )}

      {mode === 'create' && (
        <FormField label="Person">
          <ToggleGroup
            options={[
              { key: 'existing', label: 'Existing person' },
              { key: 'new', label: 'New person' },
            ]}
            value={form.personMode}
            onChange={personMode => setForm(f => ({ ...f, personMode: personMode as 'existing' | 'new' }))}
          />
        </FormField>
      )}

      {mode === 'create' && form.personMode === 'existing' && (
        <FormField label="Select person" required error={errors.person}>
          <SearchableSelect
            value={form.personId}
            onChange={v => setForm(f => ({ ...f, personId: v }))}
            items={people.map(p => ({ value: p.id, label: p.fullName, description: [p.organisation, p.activeRoleCount ? `${p.activeRoleCount} active role${p.activeRoleCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || undefined }))}
            placeholder="Search people…"
            emptyMessage="No people yet — add a new person instead"
          />
        </FormField>
      )}

      {mode === 'create' && form.personMode === 'new' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First name" required error={form.personMode === 'new' ? errors.person : undefined}>
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
        </div>
      )}

      {mode === 'edit' && role && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Contact: <span className="font-medium text-[var(--color-foreground)]">{role.personFullName}</span> — edit their details on the contact book instead.
        </p>
      )}

      <FormField label="Role type" hint={gateError ?? undefined}>
        <Dropdown
          variant="form"
          value={form.roleType}
          onChange={v => setForm(f => ({ ...f, roleType: v as ContactRoleType }))}
          items={CONTACT_ROLE_TYPES.map(rt => ({
            value: rt, label: CONTACT_ROLE_TYPE_LABELS[rt],
            disabled: !availableRoleTypes.includes(rt) && rt !== form.roleType,
          }))}
        />
      </FormField>

      {gateError && (
        <div role="alert" className="p-3 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm">
          {gateError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Relationship to participant">
          <input value={form.relationshipToParticipant} onChange={e => setForm(f => ({ ...f, relationshipToParticipant: e.target.value }))} placeholder="e.g. Mother, Father / Guardian" />
        </FormField>
        <FormField label="Primary" layout="checkbox" hint="Only one active primary allowed per role type where relevant">
          <input type="checkbox" checked={form.isPrimary} onChange={e => setForm(f => ({ ...f, isPrimary: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      </div>

      {showField('priorityOrder') && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Priority order" hint="1st, 2nd, 3rd call">
            <input type="number" min={1} value={form.priorityOrder} onChange={e => setForm(f => ({ ...f, priorityOrder: e.target.value }))} />
          </FormField>
          <FormField label="Authorised to receive medical info" layout="checkbox">
            <input type="checkbox" checked={form.authorisedForMedicalInfo} onChange={e => setForm(f => ({ ...f, authorisedForMedicalInfo: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>
        </div>
      )}

      {showField('appointingTribunal') && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Appointing tribunal">
              <input value={form.appointingTribunal} onChange={e => setForm(f => ({ ...f, appointingTribunal: e.target.value }))} placeholder="e.g. QCAT, VCAT" />
            </FormField>
            <FormField label="Order scope">
              <div className="flex flex-wrap gap-2 pt-1">
                {GUARDIAN_ORDER_SCOPE_DOMAINS.map(domain => {
                  const checked = form.orderScopeDomains.includes(domain)
                  return (
                    <label key={domain} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-[var(--color-border)] cursor-pointer min-h-[28px]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => setForm(f => ({
                          ...f,
                          orderScopeDomains: e.target.checked ? [...f.orderScopeDomains, domain] : f.orderScopeDomains.filter(d => d !== domain),
                        }))}
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
              <input type="date" value={form.orderStartDate} onChange={e => setForm(f => ({ ...f, orderStartDate: e.target.value }))} />
            </FormField>
            <FormField label="Order review date">
              <input type="date" value={form.orderReviewDate} onChange={e => setForm(f => ({ ...f, orderReviewDate: e.target.value }))} />
            </FormField>
            <FormField label="Order end date">
              <input type="date" value={form.orderEndDate} onChange={e => setForm(f => ({ ...f, orderEndDate: e.target.value }))} />
            </FormField>
          </div>
        </>
      )}

      {showField('nomineeScope') && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nominee scope">
            <Dropdown
              variant="form"
              value={form.nomineeScope}
              onChange={v => setForm(f => ({ ...f, nomineeScope: v as NomineeScope }))}
              items={[{ value: '', label: 'Not specified' }, ...(['Plan', 'Correspondence'] as const).map(s => ({ value: s, label: NOMINEE_SCOPE_LABELS[s] }))]}
            />
          </FormField>
          <FormField label="Appointment date">
            <input type="date" value={form.appointmentDate} onChange={e => setForm(f => ({ ...f, appointmentDate: e.target.value }))} />
          </FormField>
        </div>
      )}
      {showField('reasonForAppointment') && (
        <FormField label="Reason for appointment">
          <textarea rows={2} value={form.reasonForAppointment} onChange={e => setForm(f => ({ ...f, reasonForAppointment: e.target.value }))} />
        </FormField>
      )}

      {showField('alternateRepresentativeName') && (
        <FormField label="Alternate representative" hint="e.g. the second parent">
          <input value={form.alternateRepresentativeName} onChange={e => setForm(f => ({ ...f, alternateRepresentativeName: e.target.value }))} />
        </FormField>
      )}

      {showField('organisationName') && (
        <FormField label="Organisation">
          <input value={form.organisationName} onChange={e => setForm(f => ({ ...f, organisationName: e.target.value }))} />
        </FormField>
      )}

      {showField('fundingLineItemType') && (
        <FormField label="Funding line item">
          <input value={form.fundingLineItemType} onChange={e => setForm(f => ({ ...f, fundingLineItemType: e.target.value }))} placeholder="e.g. Coordination of Supports" />
        </FormField>
      )}

      {showField('registrationNumber') && (
        <FormField label="Registration number">
          <input value={form.registrationNumber} onChange={e => setForm(f => ({ ...f, registrationNumber: e.target.value }))} />
        </FormField>
      )}

      {(showField('startDate') || showField('endDate')) && (
        <div className="grid grid-cols-2 gap-3">
          {showField('startDate') && (
            <FormField label="Start date">
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </FormField>
          )}
          {showField('endDate') && (
            <FormField label="End date">
              <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </FormField>
          )}
        </div>
      )}

      {showField('lastVisitDate') && (
        <FormField label="Last visit date">
          <input type="date" value={form.lastVisitDate} onChange={e => setForm(f => ({ ...f, lastVisitDate: e.target.value }))} />
        </FormField>
      )}
      {showField('consentToShare') && (
        <FormField label="Consent to share health info" layout="checkbox">
          <input type="checkbox" checked={form.consentToShare} onChange={e => setForm(f => ({ ...f, consentToShare: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      )}

      {showField('discipline') && (
        <FormField label="Discipline">
          <input value={form.discipline} onChange={e => setForm(f => ({ ...f, discipline: e.target.value }))} placeholder="e.g. Psychiatry, Occupational Therapy" />
        </FormField>
      )}
      {showField('frequencyOfContact') && (
        <FormField label="Frequency of contact">
          <input value={form.frequencyOfContact} onChange={e => setForm(f => ({ ...f, frequencyOfContact: e.target.value }))} placeholder="e.g. Monthly" />
        </FormField>
      )}

      {showField('websterPackFlag') && (
        <FormField label="Uses webster pack" layout="checkbox">
          <input type="checkbox" checked={form.websterPackFlag} onChange={e => setForm(f => ({ ...f, websterPackFlag: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      )}

      {showField('roleTitle') && (
        <FormField label="Role / title">
          <input value={form.roleTitle} onChange={e => setForm(f => ({ ...f, roleTitle: e.target.value }))} />
        </FormField>
      )}
      {showField('registeredProviderFlag') && (
        <FormField
          label="Registered NDIS provider"
          layout="checkbox"
          hint={participant?.planType === 'AgencyManaged' ? 'Required for agency-managed participants' : undefined}
        >
          <input type="checkbox" checked={form.registeredProviderFlag} onChange={e => setForm(f => ({ ...f, registeredProviderFlag: e.target.checked }))} className="w-4 h-4 rounded border-[var(--color-border)]" />
        </FormField>
      )}

      {showField('scopeNotes') && (
        <FormField label="Scope">
          <input value={form.scopeNotes} onChange={e => setForm(f => ({ ...f, scopeNotes: e.target.value }))} placeholder="e.g. Formal advocacy, financial administration order" />
        </FormField>
      )}
      {showField('authorisationDocumentReference') && (
        <FormField label="Authorisation document reference">
          <input value={form.authorisationDocumentReference} onChange={e => setForm(f => ({ ...f, authorisationDocumentReference: e.target.value }))} />
        </FormField>
      )}

      {showField('preferredLanguage') && (
        <FormField label="Preferred language">
          <input value={form.preferredLanguage} onChange={e => setForm(f => ({ ...f, preferredLanguage: e.target.value }))} />
        </FormField>
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
