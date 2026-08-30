import { useMemo, useState } from 'react'
import { ShieldAlert, AlertTriangle, ChevronDown, Plus, Pill, ListChecks, Trash2 } from 'lucide-react'
import type { AxiosError } from 'axios'
import {
  useRestrictivePractices, useCreateRestrictivePractice, useUpdateRestrictivePractice, useDeleteRestrictivePractice,
  useBulkCreateRestrictivePractices, useParticipantMedications,
} from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { DataTable, type Column } from '@/components/DataTable'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import {
  RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS, BULK_RESTRICTIVE_PRACTICE_TYPES,
} from '@/api/types/restrictive-practices'
import type { RestrictivePracticeDto, RestrictivePracticeType, BulkCreateRestrictivePracticeDto } from '@/api/types/restrictive-practices'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

/** One row of RP-01's bulk-add table — client-side draft state before it becomes its own register entry. */
type BulkRowState = {
  id: string
  description: string
  authorisedBy: string
  authorisationDate: string
  reviewDate: string
}

function makeBulkRow(): BulkRowState {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `row-${Date.now()}-${Math.random()}`
  return { id, description: '', authorisedBy: '', authorisationDate: '', reviewDate: '' }
}

/**
 * The bulk endpoint returns `errors: string[]` prefixed `"Row N: message"` for a row-level
 * failure, or an unprefixed string for a whole-request failure (participant missing, no rows).
 * Maps each row-prefixed error back to that row's client-side id (1-based index -> `rows[i-1]`)
 * so DataTable's `rowError` can show it under the right row; anything else becomes the banner.
 */
function parseBulkErrors(err: unknown, rows: BulkRowState[]): { general: string | null; rowErrors: Map<string, string> } {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  const errors = axiosErr?.response?.data?.errors
  const rowErrors = new Map<string, string>()
  let general: string | null = null

  if (errors && errors.length > 0) {
    for (const e of errors) {
      const match = /^Row (\d+):\s*(.*)$/.exec(e)
      const row = match ? rows[Number(match[1]) - 1] : undefined
      if (match && row) {
        rowErrors.set(row.id, match[2])
      } else if (!general) {
        general = e
      }
    }
  } else {
    general = axiosErr?.response?.data?.message ?? null
  }

  if (rowErrors.size === 0 && !general) {
    general = 'Failed to save restrictive practice entries.'
  }
  return { general, rowErrors }
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
  const bulkCreatePractices = useBulkCreateRestrictivePractices()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; practice?: RestrictivePracticeDto } | null>(null)
  const [form, setForm] = useState<PracticeFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ description?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [deletingPractice, setDeletingPractice] = useState<RestrictivePracticeDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  // RP-01 bulk-add: 'setup' picks a type + row count; 'rows' is the editable table.
  const [bulkStep, setBulkStep] = useState<'setup' | 'rows' | null>(null)
  const [bulkType, setBulkType] = useState<RestrictivePracticeType>(BULK_RESTRICTIVE_PRACTICE_TYPES[0])
  const [bulkCountInput, setBulkCountInput] = useState('3')
  const [bulkCountError, setBulkCountError] = useState<string | null>(null)
  const [bulkRows, setBulkRows] = useState<BulkRowState[]>([])
  const [bulkRowErrors, setBulkRowErrors] = useState<Map<string, string>>(new Map())
  const [bulkGeneralError, setBulkGeneralError] = useState<string | null>(null)

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

  // ── RP-01 bulk-add ────────────────────────────────────────────────────

  function openBulk() {
    setBulkType(BULK_RESTRICTIVE_PRACTICE_TYPES[0])
    setBulkCountInput('3')
    setBulkCountError(null)
    setBulkGeneralError(null)
    setBulkRowErrors(new Map())
    setBulkStep('setup')
  }

  function closeBulk() {
    setBulkStep(null)
    setBulkRows([])
    setBulkRowErrors(new Map())
    setBulkGeneralError(null)
  }

  function continueToBulkRows() {
    const count = Number(bulkCountInput)
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setBulkCountError('Enter a whole number between 1 and 50')
      return
    }
    setBulkCountError(null)
    setBulkRows(Array.from({ length: count }, makeBulkRow))
    setBulkRowErrors(new Map())
    setBulkGeneralError(null)
    setBulkStep('rows')
  }

  function backToBulkSetup() {
    setBulkStep('setup')
  }

  function addBulkRow() {
    setBulkRows(rows => [...rows, makeBulkRow()])
  }

  function removeBulkRow(id: string) {
    setBulkRows(rows => rows.filter(r => r.id !== id))
    setBulkRowErrors(errs => {
      if (!errs.has(id)) return errs
      const next = new Map(errs)
      next.delete(id)
      return next
    })
  }

  function updateBulkRow(id: string, key: keyof Omit<BulkRowState, 'id'>, value: string) {
    setBulkRows(rows => rows.map(r => (r.id === id ? { ...r, [key]: value } : r)))
  }

  async function saveBulk() {
    if (!participantId) return

    const nextErrors = new Map<string, string>()
    for (const row of bulkRows) {
      if (!row.description.trim()) nextErrors.set(row.id, 'Description is required')
    }
    if (nextErrors.size > 0) {
      setBulkRowErrors(nextErrors)
      setBulkGeneralError(null)
      return
    }

    setBulkRowErrors(new Map())
    setBulkGeneralError(null)

    const payload: BulkCreateRestrictivePracticeDto = {
      items: bulkRows.map(row => ({
        type: bulkType,
        description: row.description.trim(),
        authorisedBy: row.authorisedBy.trim() || null,
        authorisationDate: row.authorisationDate || null,
        reviewDate: row.reviewDate || null,
        isActive: true,
      })),
    }

    try {
      await bulkCreatePractices.mutateAsync({ participantId, data: payload })
      closeBulk()
    } catch (err) {
      const { general, rowErrors } = parseBulkErrors(err, bulkRows)
      setBulkGeneralError(general)
      setBulkRowErrors(rowErrors)
    }
  }

  const bulkColumns: Column<BulkRowState>[] = [
    {
      key: 'description',
      header: 'Description',
      editable: {
        render: (row, onChange) => {
          const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
          return (
            <input
              aria-label={`Description, row ${rowNumber}`}
              value={row.description}
              onChange={e => onChange(e.target.value)}
              placeholder="What the restrictive practice involves..."
              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          )
        },
      },
    },
    {
      key: 'authorisedBy',
      header: 'Authorised by',
      editable: {
        render: (row, onChange) => {
          const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
          return (
            <input
              aria-label={`Authorised by, row ${rowNumber}`}
              value={row.authorisedBy}
              onChange={e => onChange(e.target.value)}
              placeholder="e.g. Dr. Chen"
              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          )
        },
      },
    },
    {
      key: 'authorisationDate',
      header: 'Authorisation date',
      editable: {
        render: (row, onChange) => {
          const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
          return (
            <input
              type="date"
              aria-label={`Authorisation date, row ${rowNumber}`}
              value={row.authorisationDate}
              onChange={e => onChange(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          )
        },
      },
    },
    {
      key: 'reviewDate',
      header: 'Review date',
      editable: {
        render: (row, onChange) => {
          const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
          return (
            <input
              type="date"
              aria-label={`Review date, row ${rowNumber}`}
              value={row.reviewDate}
              onChange={e => onChange(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          )
        },
      },
    },
    {
      key: 'remove',
      header: <span className="sr-only">Remove row</span>,
      align: 'center',
      render: row => {
        const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
        return (
          <button
            type="button"
            onClick={() => removeBulkRow(row.id)}
            disabled={bulkRows.length <= 1}
            aria-label={`Remove row ${rowNumber}`}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )
      },
    },
  ]

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
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-[var(--color-foreground)]">Restrictive Practices Register</h2>
        {canWriteRestrictivePractices && participantId && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openBulk}
              className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-foreground)] text-sm font-medium hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-colors"
            >
              <ListChecks className="w-4 h-4" /> Bulk add
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all shadow-md shadow-[var(--color-primary)]/20"
            >
              <Plus className="w-4 h-4" /> New entry
            </button>
          </div>
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

      <Modal
        open={bulkStep === 'setup'}
        onClose={closeBulk}
        title="Bulk add restrictive practices"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={closeBulk}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={continueToBulkRows}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
            >
              Continue
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Pick the type shared by every entry you're adding and how many, then fill in each row's details.
          </p>
          <FormField
            label="Restrictive practice type"
            hint="Adding a chemical restraint? Use New entry instead — it links a medication record, which the bulk table doesn't support."
          >
            <Dropdown
              variant="form"
              value={bulkType}
              onChange={v => setBulkType(v as RestrictivePracticeType)}
              items={BULK_RESTRICTIVE_PRACTICE_TYPES.map(t => ({ value: t, label: RESTRICTIVE_PRACTICE_TYPE_LABELS[t], description: TYPE_DESCRIPTIONS[t] }))}
            />
          </FormField>
          <FormField label="Number of entries" error={bulkCountError ?? undefined}>
            <input
              type="number"
              min={1}
              max={50}
              value={bulkCountInput}
              onChange={e => setBulkCountInput(e.target.value)}
              autoFocus
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={bulkStep === 'rows'}
        onClose={closeBulk}
        title={`Bulk add — ${RESTRICTIVE_PRACTICE_TYPE_LABELS[bulkType]}`}
        size="xl"
        footer={
          <>
            <button
              type="button"
              onClick={backToBulkSetup}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={saveBulk}
              disabled={bulkCreatePractices.isPending}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
            >
              {bulkCreatePractices.isPending ? 'Saving...' : `Save ${bulkRows.length} ${bulkRows.length === 1 ? 'entry' : 'entries'}`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {bulkGeneralError && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {bulkGeneralError}
            </div>
          )}
          <DataTable
            data={bulkRows}
            columns={bulkColumns}
            keyField="id"
            editingRows={new Set(bulkRows.map(r => r.id))}
            onEditChange={(row, key, value) => updateBulkRow(row.id, key as keyof Omit<BulkRowState, 'id'>, value as string)}
            rowError={row => bulkRowErrors.get(row.id)}
            emptyMessage="No rows yet — add one below."
          />
          <button
            type="button"
            onClick={addBulkRow}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-dashed border-[var(--color-border)] text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            <Plus className="w-4 h-4" /> Add row
          </button>
        </div>
      </Modal>
    </div>
  )
}
