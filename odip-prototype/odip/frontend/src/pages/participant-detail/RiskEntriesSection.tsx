import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Plus } from 'lucide-react'
import type { AxiosError } from 'axios'
import { useParticipantRiskEntries, useCreateRiskEntry, useUpdateRiskEntry, useDeleteRiskEntry } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { AT_RISK_PARTIES } from '@/api/types/enums'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import type { ParticipantRiskEntryDto } from '@/api/types/risk-entries'
import type { AtRiskParty } from '@/api/types/enums'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

type RiskEntryFormState = {
  atRiskParty: AtRiskParty
  description: string
  mitigationNotes: string
  isActive: boolean
}

const EMPTY_FORM: RiskEntryFormState = {
  atRiskParty: 'Participant', description: '', mitigationNotes: '', isActive: true,
}

function RiskEntrySkeleton() {
  return (
    <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse space-y-2">
      <div className="h-4 w-1/4 bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-full bg-[var(--color-muted)] rounded" />
    </div>
  )
}

function RiskEntryRow({ entry, canWrite, onEdit, onDelete }: {
  entry: ParticipantRiskEntryDto
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] whitespace-nowrap">
          {AT_RISK_PARTY_LABELS[entry.atRiskParty]}
        </span>
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
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-1.5">{entry.description}</p>
      {entry.mitigationNotes && (
        <p className="text-xs text-[var(--color-muted-foreground)] whitespace-pre-wrap mt-1">
          <span className="font-medium">Mitigation:</span> {entry.mitigationNotes}
        </p>
      )}
    </div>
  )
}

/**
 * INTAKE-09 — a compact section (not a full tab) on the participant detail page's Details tab,
 * managing risk entries via the nested CRUD (ParticipantRiskEntriesController). Judged against a
 * new tab (see ParticipantDetailPage's existing 7-8 tabs — Details/Bookings/Support/Medications/
 * Notes/Routines/Restrictive Practices/[History]) and decided against one: risk entries are a
 * short, infrequently-touched list per participant (unlike Routines' per-day/time structure or
 * Restrictive Practices' compliance-authorisation detail, both of which justify their own tab),
 * so a section here avoids further tab-bar crowding. UI/CRUD wiring otherwise mirrors
 * RoutinesTab.tsx closely (Modal add/edit, ConfirmDialog delete, EmptyState, active/inactive
 * split) — new participants instead get their initial risk entries created transactionally with
 * the participant via the intake wizard (see the retired single-step wizard's riskEntries field);
 * this section is the only write path from here on.
 */
export default function RiskEntriesSection({ participantId }: { participantId: string | undefined }) {
  const { canWriteRisks } = usePermissions()
  const { data: entries = [], isLoading } = useParticipantRiskEntries(participantId, true)
  const createEntry = useCreateRiskEntry()
  const updateEntry = useUpdateRiskEntry()
  const deleteEntry = useDeleteRiskEntry()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; entry?: ParticipantRiskEntryDto } | null>(null)
  const [form, setForm] = useState<RiskEntryFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ description?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<ParticipantRiskEntryDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const activeEntries = useMemo(() => entries.filter(e => e.isActive), [entries])
  const inactiveEntries = useMemo(() => entries.filter(e => !e.isActive), [entries])

  function openCreate() {
    setForm(EMPTY_FORM)
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'create' })
  }

  function openEdit(entry: ParticipantRiskEntryDto) {
    setForm({
      atRiskParty: entry.atRiskParty,
      description: entry.description,
      mitigationNotes: entry.mitigationNotes ?? '',
      isActive: entry.isActive,
    })
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'edit', entry })
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
      atRiskParty: form.atRiskParty,
      description: form.description.trim(),
      mitigationNotes: form.mitigationNotes.trim() || null,
      isActive: form.isActive,
    }
    try {
      if (modalState?.mode === 'edit' && modalState.entry) {
        await updateEntry.mutateAsync({ id: modalState.entry.id, data: payload })
      } else if (participantId) {
        await createEntry.mutateAsync({ participantId, data: payload })
      }
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save risk entry.'))
    }
  }

  async function confirmDelete() {
    if (!deletingEntry || !participantId) return
    setListError(null)
    try {
      await deleteEntry.mutateAsync({ id: deletingEntry.id, participantId })
      setDeletingEntry(null)
    } catch (err) {
      setDeletingEntry(null)
      setListError(extractErrorMessage(err, 'Failed to delete risk entry.'))
    }
  }

  const isSaving = createEntry.isPending || updateEntry.isPending

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Risks
        </h3>
        {canWriteRisks && participantId && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
          >
            <Plus className="w-4 h-4" /> Add risk
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
          <RiskEntrySkeleton />
        </div>
      ) : activeEntries.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No risks recorded"
          description="Capture potential risks in supporting this participant, categorised by who is at risk — the participant, other participants, the public, or staff."
          action={canWriteRisks && participantId ? { label: 'Add risk', onClick: openCreate } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {activeEntries.map(entry => (
            <RiskEntryRow key={entry.id} entry={entry} canWrite={canWriteRisks} onEdit={() => openEdit(entry)} onDelete={() => setDeletingEntry(entry)} />
          ))}
        </div>
      )}

      {inactiveEntries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded transition-colors"
            aria-expanded={showInactive}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showInactive ? 'rotate-180' : ''}`} />
            Inactive risks ({inactiveEntries.length})
          </button>
          {showInactive && (
            <div className="space-y-3 mt-3">
              {inactiveEntries.map(entry => (
                <RiskEntryRow key={entry.id} entry={entry} canWrite={canWriteRisks} onEdit={() => openEdit(entry)} onDelete={() => setDeletingEntry(entry)} />
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!modalState}
        onClose={closeModal}
        title={modalState?.mode === 'edit' ? 'Edit risk entry' : 'Add risk entry'}
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
              {isSaving ? 'Saving...' : 'Save risk entry'}
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
          <FormField label="At Risk">
            <Dropdown
              variant="form"
              value={form.atRiskParty}
              onChange={v => setForm(f => ({ ...f, atRiskParty: v as AtRiskParty }))}
              items={AT_RISK_PARTIES.map(p => ({ value: p, label: AT_RISK_PARTY_LABELS[p] }))}
            />
          </FormField>
          <FormField label="Description" required error={errors.description}>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe the risk..."
              autoFocus
            />
          </FormField>
          <FormField label="Mitigation Notes">
            <textarea
              rows={3}
              value={form.mitigationNotes}
              onChange={e => setForm(f => ({ ...f, mitigationNotes: e.target.value }))}
              placeholder="How this risk is mitigated (optional)..."
            />
          </FormField>
          {modalState?.mode === 'edit' && (
            <FormField label="Active" layout="checkbox" hint="Inactive risk entries are hidden from staff and the portal, but not deleted">
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
        open={!!deletingEntry}
        onCancel={() => setDeletingEntry(null)}
        onConfirm={confirmDelete}
        title="Delete this risk entry?"
        message="This permanently removes the risk entry. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteEntry.isPending}
      />
    </div>
  )
}
