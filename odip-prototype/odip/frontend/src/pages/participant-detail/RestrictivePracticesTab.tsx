import { useMemo, useRef, useState } from 'react'
import { useShowAll } from '@/components/ShowAllButton'
import { ShieldAlert, AlertTriangle, ChevronDown, Plus, Pill } from 'lucide-react'
import {
  useRestrictivePractices, useUpdateRestrictivePractice, useDeleteRestrictivePractice,
  useParticipantMedications,
} from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { CheckboxField } from '@/components/CheckboxField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import {
  RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS, RESTRICTIVE_PRACTICE_TYPE_DESCRIPTIONS,
} from '@/api/types/restrictive-practices'
import type { RestrictivePracticeDto, RestrictivePracticeType } from '@/api/types/restrictive-practices'
import { AddRestrictivePracticeDialog } from './AddRestrictivePracticeDialog'
import { isPastDue } from '@/lib/deadline'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { RpAuthorisationBadge } from '@/pages/incidents/RpAuthorisationBadge'
import { isRpAuthorised } from '@/lib/incidentPrefill'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'

// Overdue from the day AFTER the review date (a DateOnly), the rule the server's own alert uses (ReviewDate < today), not from UTC midnight.
const isReviewOverdue = (dateStr: string | null) => isPastDue(dateStr)

const TYPE_BADGE_STYLES: Record<RestrictivePracticeType, string> = {
  Seclusion: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  ChemicalRestraint: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  MechanicalRestraint: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  PhysicalRestraint: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  EnvironmentalRestraint: 'bg-[var(--color-secondary-container)] text-[var(--color-foreground)]',
  Unclassified: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
}

type PracticeFormState = {
  type: RestrictivePracticeType
  description: string
  authorisedBy: string
  authorisationDate: string
  reviewDate: string
  relatedMedicationId: string
  isActive: boolean
  /** Ticked: who authorised it and when are shown and required. Unticked: both are saved as null. */
  authorised: boolean
}

const EMPTY_FORM: PracticeFormState = {
  type: 'Unclassified', description: '', authorisedBy: '', authorisationDate: '', reviewDate: '',
  relatedMedicationId: '', isActive: true, authorised: false,
}

function PracticeCard({ practice, canWrite, onEdit, onDelete }: {
  practice: RestrictivePracticeDto
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const overdue = practice.isActive && isReviewOverdue(practice.reviewDate)
  // Retired entries aren't badged (the wizard doesn't either); the Inactive pill carries their state.
  const unauthorised = practice.isActive && !isRpAuthorised(practice)
  const whyUnauthorised = !practice.authorisedBy?.trim()
    ? (practice.authorisationDate ? 'No authoriser on file' : 'No authorisation recorded')
    : 'No authorisation date on file'
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
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_BADGE_STYLES[practice.type]}`}>
            {RESTRICTIVE_PRACTICE_TYPE_LABELS[practice.type]}
          </span>
          {practice.isActive && <RpAuthorisationBadge authorised={!unauthorised} />}
          {practice.type === 'Unclassified' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]">
              <AlertTriangle className="w-3 h-3" /> Needs classification
            </span>
          )}
          {!practice.isActive && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] whitespace-nowrap">
              Inactive
            </span>
          )}
          {practice.reviewDate && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                overdue ? 'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]' : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
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
        {unauthorised && <span>{whyUnauthorised}</span>}
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
  const practicesQuery = useRestrictivePractices(participantId, true)
  const practices = useMemo(() => practicesQuery.data ?? [], [practicesQuery.data])
  // A failed or paused request is not an empty register: "No restrictive practices recorded" is only for one that succeeded and came back empty.
  const phase = queryPhase(practicesQuery)
  const { data: medications = [] } = useParticipantMedications(participantId, false)
  const updatePractice = useUpdateRestrictivePractice()
  const deletePractice = useDeleteRestrictivePractice()

  // PD-2: creation now only happens through the "Add entries" bulk modal below. This modal is
  // edit-only — `null` means closed, otherwise the entry currently being edited.
  const [editingPractice, setEditingPractice] = useState<RestrictivePracticeDto | null>(null)
  const [form, setForm] = useState<PracticeFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ description?: string; authorisedBy?: string; authorisationDate?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [deletingPractice, setDeletingPractice] = useState<RestrictivePracticeDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const [adding, setAdding] = useState(false)

  const activePractices = useMemo(() => practices.filter(p => p.isActive), [practices])
  const inactivePractices = useMemo(() => practices.filter(p => !p.isActive), [practices])
  const activeRef = useRef<HTMLDivElement>(null)
  const showAll = useShowAll(activePractices.length, activeRef, '[data-show-row]')

  function openEdit(practice: RestrictivePracticeDto) {
    setForm({
      type: practice.type,
      description: practice.description,
      authorisedBy: practice.authorisedBy ?? '',
      authorisationDate: practice.authorisationDate ? practice.authorisationDate.split('T')[0] : '',
      reviewDate: practice.reviewDate ? practice.reviewDate.split('T')[0] : '',
      relatedMedicationId: practice.relatedMedicationId ?? '',
      isActive: practice.isActive,
      authorised: !!practice.authorisedBy?.trim() || !!practice.authorisationDate,
    })
    setErrors({})
    setModalError(null)
    setEditingPractice(practice)
  }

  function closeModal() {
    setEditingPractice(null)
    setModalError(null)
  }

  function validate(): boolean {
    const next: { description?: string; authorisedBy?: string; authorisationDate?: string } = {}
    if (!form.description.trim()) next.description = 'Add a description'
    if (form.authorised && !form.authorisedBy.trim()) next.authorisedBy = 'Add who authorised it'
    if (form.authorised && !form.authorisationDate) next.authorisationDate = 'Add the date it was authorised'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    if (!editingPractice) return
    setModalError(null)
    const payload = {
      type: form.type,
      description: form.description.trim(),
      authorisedBy: form.authorised ? form.authorisedBy.trim() : null,
      authorisationDate: form.authorised ? form.authorisationDate : null,
      reviewDate: form.reviewDate || null,
      relatedMedicationId: form.type === 'ChemicalRestraint' ? (form.relatedMedicationId || null) : null,
      isActive: form.isActive,
      expectedUpdatedAt: editingPractice.updatedAt,
    }
    try {
      await updatePractice.mutateAsync({ id: editingPractice.id, data: payload })
      closeModal()
    } catch (err) {
      // So closing and reopening the entry carries the version someone else just saved.
      if (apiErrorStatus(err) === 409) void practicesQuery.refetch()
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

  const isSaving = updatePractice.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[var(--color-foreground)]">Restrictive Practices Register</h2>
        {canWriteRestrictivePractices && participantId && (
          <div className="flex items-center gap-2">
            <Button onClick={() => setAdding(true)}>
              <Plus className="w-4 h-4" /> Add entries
            </Button>
          </div>
        )}
      </div>

      {listError && (
        <Callout tone="error"
          actions={<Button variant="ghost" size="sm" onClick={() => setListError(null)}>Dismiss</Button>}>
          {listError}
        </Callout>
      )}

      {phase === 'loading' ? (
        <PageState kind="loading" noun="restrictive practices" />
      ) : phase === 'error' ? (
        <PageState kind="error" noun="restrictive practices" onRetry={() => practicesQuery.refetch()} />
      ) : activePractices.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No restrictive practices recorded"
          description="Record any restrictive practice in use for this participant — seclusion, chemical, mechanical, physical, or environmental restraint — with its authorisation and review date."
          action={canWriteRestrictivePractices && participantId ? { label: 'Add entries', onClick: () => setAdding(true) } : undefined}
        />
      ) : (
        <div>
        <div ref={activeRef} className="space-y-3">
          {activePractices.slice(0, showAll.limit).map(p => (
            <div key={p.id} tabIndex={-1} data-show-row className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
            <PracticeCard practice={p} canWrite={canWriteRestrictivePractices} onEdit={() => openEdit(p)} onDelete={() => setDeletingPractice(p)} />
            </div>
          ))}
        </div>
        {showAll.button}
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
            Inactive ({inactivePractices.length})
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
        open={!!editingPractice}
        onClose={closeModal}
        title="Edit restrictive practice entry"
        size="md"
        stickyFooter
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save entry'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <Callout tone="error">{modalError}</Callout>
          )}
          <FormField label="Type">
            <Dropdown
              variant="form"
              value={form.type}
              onChange={v => setForm(f => ({ ...f, type: v as RestrictivePracticeType, relatedMedicationId: v === 'ChemicalRestraint' ? f.relatedMedicationId : '' }))}
              items={RESTRICTIVE_PRACTICE_TYPES.map(t => ({ value: t, label: RESTRICTIVE_PRACTICE_TYPE_LABELS[t], description: RESTRICTIVE_PRACTICE_TYPE_DESCRIPTIONS[t] }))}
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
          <CheckboxField
            label="This restrictive practice is authorised"
            hint="If ticked, add who authorised it and the date."
            className="[&_input]:size-4 [&_input]:rounded"
            checked={form.authorised}
            onChange={e => setForm(f => ({ ...f, authorised: e.target.checked }))}
          />
          {form.authorised && (
            <>
              <FormField label="Authorised by" required error={errors.authorisedBy}>
                <input
                  value={form.authorisedBy}
                  onChange={e => setForm(f => ({ ...f, authorisedBy: e.target.value }))}
                  placeholder="e.g. Dr. Chen / NDIS Commission"
                />
              </FormField>
              <FormField label="Authorisation date" required error={errors.authorisationDate}>
                <input type="date" value={form.authorisationDate} onChange={e => setForm(f => ({ ...f, authorisationDate: e.target.value }))} />
              </FormField>
            </>
          )}
          <FormField label="Review date">
            <input type="date" value={form.reviewDate} onChange={e => setForm(f => ({ ...f, reviewDate: e.target.value }))} />
          </FormField>
          <FormField label="Active" layout="checkbox" hint="Inactive entries are hidden from the default list but not deleted">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--color-border)]"
            />
          </FormField>
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

      <AddRestrictivePracticeDialog
        open={adding && !!participantId}
        participantId={participantId ?? ''}
        onClose={() => setAdding(false)}
        onSaved={() => setAdding(false)}
      />
    </div>
  )
}
