import { useMemo, useState } from 'react'
import { Contact2, Plus } from 'lucide-react'
import type { AxiosError } from 'axios'
import {
  useParticipant, usePersons, useParticipantContactRoles,
  useCreateContactRole, useUpdateContactRole, useDeleteContactRole,
} from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { ToggleGroup } from '@/components/ToggleGroup'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable, type Column } from '@/components/DataTable'
import { usePermissions } from '@/lib/permissions'
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

/** The most relevant secondary line for a role row — different role types surface a different
 * "what matters most" field (research §3.1-3.14) rather than one fixed column always showing the
 * same (often-blank) field. */
function roleSummaryLine(role: ParticipantContactRoleDto): string {
  switch (role.roleType) {
    case 'Guardian':
      return role.appointingTribunal ? `Order via ${role.appointingTribunal}` : '—'
    case 'PlanNominee':
      return role.nomineeScope ? NOMINEE_SCOPE_LABELS[role.nomineeScope] : '—'
    case 'SupportCoordinator':
    case 'PlanManager':
    case 'Advocate':
    case 'Solicitor':
    case 'Gp':
    case 'Specialist':
    case 'Pharmacy':
    case 'ProviderContact':
    case 'Interpreter':
      return role.organisationName || role.discipline || '—'
    default:
      return role.relationshipToParticipant || '—'
  }
}

export default function ContactsTab({ participantId }: { participantId: string | undefined }) {
  const { canWriteContacts: canWrite } = usePermissions()
  const { data: participant } = useParticipant(participantId)
  const { data: roles = [], isLoading } = useParticipantContactRoles(participantId)
  const { data: people = [] } = usePersons()
  const createRole = useCreateContactRole()
  const updateRole = useUpdateContactRole()
  const deleteRole = useDeleteContactRole()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; role?: ParticipantContactRoleDto } | null>(null)
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ person?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [deletingRole, setDeletingRole] = useState<ParticipantContactRoleDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const availableRoleTypes = useMemo(
    () => availableContactRoleTypes(CONTACT_ROLE_TYPES, participant?.planType, participant?.dateOfBirth),
    [participant?.planType, participant?.dateOfBirth],
  )
  const gateError = contactRoleGateError(form.roleType, participant?.planType, participant?.dateOfBirth, form.registeredProviderFlag)
  const visibleFields: ContactRoleFieldKey[] = CONTACT_ROLE_FIELD_MAP[form.roleType] ?? []
  const showField = (key: ContactRoleFieldKey) => visibleFields.includes(key)

  function openCreate() {
    setForm({ ...EMPTY_FORM, roleType: availableRoleTypes[0] ?? 'NextOfKin' })
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'create' })
  }

  function openEdit(role: ParticipantContactRoleDto) {
    setForm(roleToForm(role))
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'edit', role })
  }

  function closeModal() {
    setModalState(null)
    setModalError(null)
  }

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
      setModalError(gateError)
      return
    }
    setModalError(null)
    const payload = formToPayload(form)
    try {
      if (modalState?.mode === 'edit' && modalState.role) {
        await updateRole.mutateAsync({ id: modalState.role.id, data: formToUpdatePayload(form) })
      } else if (participantId) {
        await createRole.mutateAsync({ participantId, data: payload })
      }
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save contact.'))
    }
  }

  async function confirmDelete() {
    if (!deletingRole || !participantId) return
    setListError(null)
    try {
      await deleteRole.mutateAsync({ id: deletingRole.id, participantId })
      setDeletingRole(null)
    } catch (err) {
      setDeletingRole(null)
      setListError(extractErrorMessage(err, 'Failed to remove contact.'))
    }
  }

  const isSaving = createRole.isPending || updateRole.isPending

  const columns: Column<ParticipantContactRoleDto>[] = [
    {
      key: 'personFullName',
      header: 'Person',
      sortable: true,
      render: role => (
        <div>
          <p className="font-medium text-[var(--color-foreground)]">{role.personFullName}</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {[role.personMobile || role.personPhone, role.personEmail].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'roleType',
      header: 'Role',
      sortable: true,
      render: role => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={role.roleType} label={CONTACT_ROLE_TYPE_LABELS[role.roleType]} colorMap={{ [role.roleType.toLowerCase()]: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' }} />
          {role.isPrimary && <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Primary</span>}
        </span>
      ),
    },
    { key: 'summary', header: 'Detail', render: role => <span className="text-sm">{roleSummaryLine(role)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: role => (
        <StatusBadge
          status={role.status}
          label={CONTACT_ROLE_STATUS_LABELS[role.status]}
          colorMap={{ superseded: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]' }}
        />
      ),
    },
    ...(canWrite ? [{
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right' as const,
      render: (role: ParticipantContactRoleDto) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => openEdit(role)}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline min-h-[44px] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setDeletingRole(role)}
            className="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] min-h-[44px] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            Remove
          </button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Contact2 className="w-4 h-4" /> Contacts
        </h2>
        {canWrite && participantId && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> Add contact
          </button>
        )}
      </div>

      {listError && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          <span>{listError}</span>
          <button
            type="button"
            onClick={() => setListError(null)}
            className="shrink-0 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {!isLoading && roles.length === 0 ? (
        <EmptyState
          icon={Contact2}
          title="No contacts recorded"
          description="Add next of kin, guardians, support coordinators, plan managers, and other key contacts for this participant."
          action={canWrite && participantId ? { label: 'Add contact', onClick: openCreate } : undefined}
        />
      ) : (
        <DataTable
          data={roles}
          columns={columns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No contacts recorded"
        />
      )}

      <Modal
        open={!!modalState}
        onClose={closeModal}
        title={modalState?.mode === 'edit' ? 'Edit contact' : 'Add contact'}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={closeModal}
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
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {modalError}
            </div>
          )}

          {modalState?.mode === 'create' && (
            <FormField label="Person">
              <ToggleGroup
                options={[
                  { key: 'existing', label: 'Existing person' },
                  { key: 'new', label: 'New person' },
                ]}
                value={form.personMode}
                onChange={mode => setForm(f => ({ ...f, personMode: mode as 'existing' | 'new' }))}
              />
            </FormField>
          )}

          {modalState?.mode === 'create' && form.personMode === 'existing' && (
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

          {modalState?.mode === 'create' && form.personMode === 'new' && (
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

          {modalState?.mode === 'edit' && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Contact: <span className="font-medium text-[var(--color-foreground)]">{modalState.role?.personFullName}</span> — edit their details on the contact book instead.
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

          {modalState?.mode === 'edit' && (
            <FormField label="Status">
              <Dropdown
                variant="form"
                value={form.status}
                onChange={v => setForm(f => ({ ...f, status: v as ContactRoleStatus }))}
                items={(['Active', 'Expired', 'Superseded'] as const).map(s => ({ value: s, label: CONTACT_ROLE_STATUS_LABELS[s] }))}
              />
            </FormField>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingRole}
        onCancel={() => setDeletingRole(null)}
        onConfirm={confirmDelete}
        title="Remove this contact role?"
        message="This removes the role from this participant. The person record itself is kept, and any other roles they hold are unaffected."
        confirmLabel="Remove"
        variant="danger"
        loading={deleteRole.isPending}
      />
    </div>
  )
}
