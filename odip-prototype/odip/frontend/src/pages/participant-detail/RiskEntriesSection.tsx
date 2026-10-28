import { useMemo, useRef, useState } from 'react'
import { useShowAll } from '@/components/ShowAllButton'
import { AlertTriangle, Plus } from 'lucide-react'
import { useParticipantRiskEntries, useCreateRiskEntry, useUpdateRiskEntry, useDeleteRiskEntry } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { AT_RISK_PARTIES } from '@/api/types/enums'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import type { ParticipantRiskEntryDto } from '@/api/types/risk-entries'
import type { AtRiskParty } from '@/api/types/enums'
import { extractErrorMessage } from '@/lib/utils'
import { Button } from '@/components/Button'
import { DisclosureToggle } from '@/components/DisclosureToggle'
import { Callout } from '@/components/Callout'

// One empty array for every render while there is no data, so the memos below do not see a new dependency each time.
const NO_ENTRIES: ParticipantRiskEntryDto[] = []

type RiskEntryFormState = {
  atRiskParty: AtRiskParty
  description: string
  mitigationNotes: string
  isActive: boolean
}

const EMPTY_FORM: RiskEntryFormState = {
  atRiskParty: 'Participant', description: '', mitigationNotes: '', isActive: true,
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
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] whitespace-nowrap">
          {AT_RISK_PARTY_LABELS[entry.atRiskParty]}
        </span>
        {canWrite && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost-danger" size="sm" onClick={onDelete}>
              Delete
            </Button>
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
 * RoutinesTab.tsx closely (Modal add/edit, ConfirmDialog delete, a compact empty strip, active/inactive
 * split) — new participants instead get their initial risk entries created transactionally with
 * the participant via the intake wizard (see the retired single-step wizard's riskEntries field);
 * this section is the only write path from here on.
 */
export default function RiskEntriesSection({ participantId }: { participantId: string | undefined }) {
  const { canWriteRisks } = usePermissions()
  const entriesQuery = useParticipantRiskEntries(participantId, true)
  const entries = entriesQuery.data ?? NO_ENTRIES
  // A failed or paused request is not an empty list: "No risks recorded" is only for one that succeeded and came back empty.
  const phase = queryPhase(entriesQuery)
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
  const activeRef = useRef<HTMLDivElement>(null)
  const showAll = useShowAll(activeEntries.length, activeRef, '[data-show-row]')

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
          <Button variant="secondary" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add risk
          </Button>
        )}
      </div>

      {listError && (
        <Callout tone="error"
          actions={<Button variant="ghost" size="sm" onClick={() => setListError(null)}>Dismiss</Button>}>
          {listError}
        </Callout>
      )}

      {phase === 'loading' ? (
        <PageState kind="loading" noun="risk list" />
      ) : phase === 'error' ? (
        <PageState kind="error" noun="risk list" onRetry={() => entriesQuery.refetch()} />
      ) : activeEntries.length === 0 ? (
        // The same compact strip Health Conditions and the ADL grids use for "nothing recorded" (a bordered,
        // centred, muted line about 60px tall), not an EmptyState: its 40px icon, 18px title, three lines of
        // guidance and a 44px button made this card a ~300px void in the middle of the page. The "Add risk"
        // action it repeated is the button in the card header (same label, same gate), and the guidance is kept
        // as the strip's tooltip.
        <p
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--cell-px)] py-5 text-center text-sm text-[var(--color-muted-foreground)]"
          title="Capture potential risks in supporting this participant, categorised by who is at risk — the participant, other participants, the public, or staff."
        >
          No risks recorded
        </p>
      ) : (
        <div>
        <div ref={activeRef} className="space-y-3">
          {activeEntries.slice(0, showAll.limit).map(entry => (
            <div key={entry.id} tabIndex={-1} data-show-row className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
            <RiskEntryRow entry={entry} canWrite={canWriteRisks} onEdit={() => openEdit(entry)} onDelete={() => setDeletingEntry(entry)} />
            </div>
          ))}
        </div>
        {showAll.button}
        </div>
      )}

      {inactiveEntries.length > 0 && (
        <div>
          <DisclosureToggle label={`Inactive (${inactiveEntries.length})`} open={showInactive} onToggle={() => setShowInactive(v => !v)} controls="risks-inactive-list" />
          {showInactive && (
            <div id="risks-inactive-list" className="space-y-3 mt-3">
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
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save risk entry'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <Callout tone="error">{modalError}</Callout>
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
