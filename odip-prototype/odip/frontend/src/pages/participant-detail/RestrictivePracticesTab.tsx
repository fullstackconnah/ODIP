import { useMemo, useState } from 'react'
import { ShieldAlert, AlertTriangle, ChevronDown, Plus, Pill } from 'lucide-react'
import type { AxiosError } from 'axios'
import {
  useRestrictivePractices, useCreateRestrictivePractice, useUpdateRestrictivePractice, useDeleteRestrictivePractice,
  useParticipantMedications,
} from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import type { RestrictivePracticeDto, RestrictivePracticeType } from '@/api/types/restrictive-practices'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

const isReviewOverdue = (dateStr: string | null) => !!dateStr && new Date(dateStr).getTime() < Date.now()

const TYPE_BADGE_STYLES: Record<RestrictivePracticeType, string> = {
  Seclusion: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  ChemicalRestraint: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  MechanicalRestraint: 'bg-amber-100 text-amber-800',
  PhysicalRestraint: 'bg-amber-100 text-amber-800',
  EnvironmentalRestraint: 'bg-[var(--color-secondary-container)] text-[#0d1c2e]',
  Unclassified: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
}

/** Plain-language explanations shown under each option in the Type picker so a coordinator
 * unfamiliar with NDIS restrictive-practice terminology can tell the five categories apart. */
const TYPE_DESCRIPTIONS: Record<RestrictivePracticeType, string> = {
  Seclusion: 'Confining the person alone in a room or area they can’t freely leave',
  ChemicalRestraint: 'Medication used to control behaviour, not to treat a diagnosed condition',
  MechanicalRestraint: 'A device or equipment that restricts the person’s movement',
  PhysicalRestraint: 'Holding or physically restraining part of the person’s body',
  EnvironmentalRestraint: 'Restricting access to parts of the environment, e.g. locked doors or gates',
  Unclassified: 'Type not yet recorded — reclassify this entry when you next review it',
}

type PracticeFormState = {
  type: RestrictivePracticeType
  description: string
  authorisedBy: string
  authorisationDate: string
  reviewDate: string
  relatedMedicationId: string
  isActive: boolean
}

const EMPTY_FORM: PracticeFormState = {
  type: 'Unclassified', description: '', authorisedBy: '', authorisationDate: '', reviewDate: '',
  relatedMedicationId: '', isActive: true,
}

function PracticeSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse space-y-2.5">
      <div className="h-4 w-1/3 bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-full bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-2/3 bg-[var(--color-muted)] rounded" />
    </div>
  )
}

function PracticeCard({ practice, canWrite, onEdit, onDelete }: {
  practice: RestrictivePracticeDto
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const overdue = practice.isActive && isReviewOverdue(practice.reviewDate)
  return (
    <div
      className={`p-4 rounded-xl border transition-colors ${
        overdue
          ? 'border-[var(--color-destructive)]/30 bg-[var(--color-error-container)]/20'
          : 'border-[var(--color-border)] bg-[var(--color-card)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_BADGE_STYLES[practice.type]}`}>
            {RESTRICTIVE_PRACTICE_TYPE_LABELS[practice.type]}
          </span>
          {practice.type === 'Unclassified' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-800">
              <AlertTriangle className="w-3 h-3" /> Needs classification
            </span>
          )}
          {!practice.isActive && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] whitespace-nowrap">
              Inactive
            </span>
          )}
          {practice.reviewDate && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                overdue ? 'bg-[var(--color-destructive)] text-white' : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
              }`}
            >
              {overdue && <AlertTriangle className="w-3 h-3" />}
              Review {overdue ? 'overdue' : 'due'} {formatDateAu(practice.reviewDate)}
            </span>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-2">{practice.description}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--color-muted-foreground)]">
        {practice.authorisedBy && <span>Authorised by {practice.authorisedBy}</span>}
        {practice.authorisationDate && <span>Authorised {formatDateAu(practice.authorisationDate)}</span>}
        {practice.type === 'ChemicalRestraint' && practice.relatedMedicationName && (
          <span className="inline-flex items-center gap-1">
            <Pill className="w-3 h-3" /> Linked to {practice.relatedMedicationName}
          </span>
        )}
      </div>
    </div>
  )
}

export default function RestrictivePracticesTab({ participantId }: { participantId: string | undefined }) {
  const { canWriteRestrictivePractices } = usePermissions()
  const { data: practices = [], isLoading } = useRestrictivePractices(participantId, true)
  const { data: medications = [] } = useParticipantMedications(participantId, false)
  const createPractice = useCreateRestrictivePractice()
  const updatePractice = useUpdateRestrictivePractice()
  const deletePractice = useDeleteRestrictivePractice()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; practice?: RestrictivePracticeDto } | null>(null)
  const [form, setForm] = useState<PracticeFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ description?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [deletingPractice, setDeletingPractice] = useState<RestrictivePracticeDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const activePractices = useMemo(() => practices.filter(p => p.isActive), [practices])
  const inactivePractices = useMemo(() => practices.filter(p => !p.isActive), [practices])

  function openCreate() {
    setForm(EMPTY_FORM)
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'create' })
  }

  function openEdit(practice: RestrictivePracticeDto) {
    setForm({
      type: practice.type,
      description: practice.description,
      authorisedBy: practice.authorisedBy ?? '',
      authorisationDate: practice.authorisationDate ? practice.authorisationDate.split('T')[0] : '',
      reviewDate: practice.reviewDate ? practice.reviewDate.split('T')[0] : '',
      relatedMedicationId: practice.relatedMedicationId ?? '',
      isActive: practice.isActive,
    })
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'edit', practice })
  }

  function closeModal() {
    setModalState(null)
    setModalError(null)
  }

  function validate(): boolean {
    const next: { description?: string } = {}
    if (!form.description.trim()) next.description = 'Description is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setModalError(null)
    const payload = {
      type: form.type,
      description: form.description.trim(),
      authorisedBy: form.authorisedBy.trim() || null,
      authorisationDate: form.authorisationDate || null,
      reviewDate: form.reviewDate || null,
      relatedMedicationId: form.type === 'ChemicalRestraint' ? (form.relatedMedicationId || null) : null,
      isActive: form.isActive,
    }
    try {
      if (modalState?.mode === 'edit' && modalState.practice) {
        await updatePractice.mutateAsync({ id: modalState.practice.id, data: payload })
      } else if (participantId) {
        await createPractice.mutateAsync({ participantId, data: payload })
      }
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save restrictive practice entry.'))
    }
  }

  async function confirmDelete() {
    if (!deletingPractice || !participantId) return
    setListError(null)
    try {
      await deletePractice.mutateAsync({ id: deletingPractice.id, participantId })
      setDeletingPractice(null)
    } catch (err) {
      setDeletingPractice(null)
      setListError(extractErrorMessage(err, 'Failed to delete restrictive practice entry.'))
    }
  }

  const isSaving = createPractice.isPending || updatePractice.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--color-foreground)]">Restrictive Practices Register</h2>
        {canWriteRestrictivePractices && participantId && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> New entry
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

      {isLoading ? (
        <div className="space-y-3">
          <PracticeSkeleton />
          <PracticeSkeleton />
        </div>
      ) : activePractices.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No restrictive practices recorded"
          description="Record any restrictive practice in use for this participant — seclusion, chemical, mechanical, physical, or environmental restraint — with its authorisation and review date."
          action={canWriteRestrictivePractices && participantId ? { label: 'New entry', onClick: openCreate } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {activePractices.map(p => (
            <PracticeCard key={p.id} practice={p} canWrite={canWriteRestrictivePractices} onEdit={() => openEdit(p)} onDelete={() => setDeletingPractice(p)} />
          ))}
        </div>
      )}

      {inactivePractices.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded transition-colors"
            aria-expanded={showInactive}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showInactive ? 'rotate-180' : ''}`} />
            Inactive entries ({inactivePractices.length})
          </button>
          {showInactive && (
            <div className="space-y-3 mt-3">
              {inactivePractices.map(p => (
                <PracticeCard key={p.id} practice={p} canWrite={canWriteRestrictivePractices} onEdit={() => openEdit(p)} onDelete={() => setDeletingPractice(p)} />
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!modalState}
        onClose={closeModal}
        title={modalState?.mode === 'edit' ? 'Edit restrictive practice entry' : 'New restrictive practice entry'}
        size="md"
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
              {isSaving ? 'Saving...' : 'Save entry'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {modalError}
            </div>
          )}
          <FormField label="Type">
            <Dropdown
              variant="form"
              value={form.type}
              onChange={v => setForm(f => ({ ...f, type: v as RestrictivePracticeType, relatedMedicationId: v === 'ChemicalRestraint' ? f.relatedMedicationId : '' }))}
              items={RESTRICTIVE_PRACTICE_TYPES.map(t => ({ value: t, label: RESTRICTIVE_PRACTICE_TYPE_LABELS[t], description: TYPE_DESCRIPTIONS[t] }))}
            />
          </FormField>
          <FormField label="Description" required error={errors.description}>
            <textarea
              rows={4}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What the restrictive practice involves..."
              autoFocus
            />
          </FormField>
          {form.type === 'ChemicalRestraint' && (
            <FormField
              label="Linked medication"
              hint={
                medications.length === 0
                  ? 'This participant has no active medications on record — add one on the Medications tab first, or leave this unlinked for now.'
                  : 'The prescribed medication this chemical restraint is based on'
              }
            >
              <Dropdown
                variant="form"
                value={form.relatedMedicationId}
                onChange={v => setForm(f => ({ ...f, relatedMedicationId: v }))}
                items={[
                  { value: '', label: 'None' },
                  ...medications.map(m => ({ value: m.id, label: m.strength ? `${m.name} ${m.strength}` : m.name })),
                ]}
              />
            </FormField>
          )}
          <FormField label="Authorised by">
            <input
              value={form.authorisedBy}
              onChange={e => setForm(f => ({ ...f, authorisedBy: e.target.value }))}
              placeholder="e.g. Dr. Chen / NDIS Commission"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Authorisation date">
              <input type="date" value={form.authorisationDate} onChange={e => setForm(f => ({ ...f, authorisationDate: e.target.value }))} />
            </FormField>
            <FormField label="Review date">
              <input type="date" value={form.reviewDate} onChange={e => setForm(f => ({ ...f, reviewDate: e.target.value }))} />
            </FormField>
          </div>
          {modalState?.mode === 'edit' && (
            <FormField label="Active" layout="checkbox" hint="Inactive entries are hidden from the default list but not deleted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 rounded border-[var(--color-border)]"
              />
            </FormField>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingPractice}
        onCancel={() => setDeletingPractice(null)}
        onConfirm={confirmDelete}
        title="Delete this restrictive practice entry?"
        message="This permanently removes the register entry. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deletePractice.isPending}
      />
    </div>
  )
}
