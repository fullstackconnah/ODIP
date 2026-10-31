import { useEffect, useMemo, useRef, useState } from 'react'
import { useShowAll } from '@/components/ShowAllButton'
import { ShieldAlert, AlertTriangle, Plus, Pill } from 'lucide-react'
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
import { ToggleGroup } from '@/components/ToggleGroup'
import { usePermissions } from '@/lib/permissions'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import {
  RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS, RESTRICTIVE_PRACTICE_TYPE_DESCRIPTIONS, USE_KIND_LABELS,
} from '@/api/types/restrictive-practices'
import type { BspPlanState, RestrictivePracticeDto, RestrictivePracticeType, RestrictivePracticeUseKind } from '@/api/types/restrictive-practices'
import { calendarDaysUntil } from '@/lib/dateOnly'
import { AddRestrictivePracticeDialog } from './AddRestrictivePracticeDialog'
import { isPastDue } from '@/lib/deadline'
import { Button } from '@/components/Button'
import { DisclosureToggle } from '@/components/DisclosureToggle'
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

const USE_KIND_OPTIONS = [{ key: 'Routine', label: USE_KIND_LABELS.Routine }, { key: 'Prn', label: USE_KIND_LABELS.Prn }]

const BSP_PILL_STYLES: Record<BspPlanState, string> = {
  NotStarted: '',
  Due: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
  DueSoon: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  Overdue: 'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]',
  InPlace: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
}

/** "Interim plan due 7 Nov 2026" / "... overdue ..." / "... in place ...", in the Review chip's style. */
function BspPill({ plan, state, date }: { plan: 'Interim' | 'Comprehensive'; state: BspPlanState; date: string | null }) {
  if (state === 'NotStarted' || !date) return null
  const overdue = state === 'Overdue'
  const word = overdue ? 'overdue' : state === 'InPlace' ? 'in place' : 'due'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${BSP_PILL_STYLES[state]}`}>
      {overdue && <AlertTriangle className="w-3 h-3" />}
      {plan} plan {word} {formatDateAu(date)}
    </span>
  )
}

type PracticeFormState = {
  type: RestrictivePracticeType
  description: string
  authorisedBy: string
  authorisationDate: string
  authorisationEndDate: string
  useKind: RestrictivePracticeUseKind
  firstUsedOn: string
  interimBspDate: string
  comprehensiveBspDate: string
  reviewDate: string
  relatedMedicationId: string
  isActive: boolean
  /** Only asked while unauthorised; null until answered. */
  requiresReporting: boolean | null
  /** Ticked: who authorised it and when are shown and required. Unticked: both are saved as null. */
  authorised: boolean
}

const EMPTY_FORM: PracticeFormState = {
  type: 'Unclassified', description: '', authorisedBy: '', authorisationDate: '', authorisationEndDate: '', useKind: 'Routine',
  firstUsedOn: '', interimBspDate: '', comprehensiveBspDate: '', reviewDate: '',
  relatedMedicationId: '', isActive: true, requiresReporting: null, authorised: false,
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
  // Both on file yet the server says not authorised: either the end date has passed or the start date is still ahead.
  const whyUnauthorised = practice.authorisationEndDate && isPastDue(practice.authorisationEndDate)
    ? `Authorisation ended ${formatDateAu(practice.authorisationEndDate)}`
    : practice.authorisedBy?.trim() && practice.authorisationDate
      ? 'Not yet in force'
      : !practice.authorisedBy?.trim()
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
          {unauthorised && practice.requiresReporting === true && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--color-error-container)] text-[var(--color-on-error-container)]">
              <AlertTriangle className="w-3 h-3" /> Report to NDIS Commission
            </span>
          )}
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
          <div className="flex items-center gap-1 pointer-coarse:gap-2 shrink-0">
            <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost-danger" size="sm" className="pointer-coarse:min-h-11" onClick={onDelete}>
              Delete
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-2">{practice.description}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--color-muted-foreground)]">
        <span>{USE_KIND_LABELS[practice.useKind]}</span>
        {practice.authorisedBy && <span>Authorised by {practice.authorisedBy}</span>}
        {practice.authorisationDate && (
          <span>
            Authorised {formatDateAu(practice.authorisationDate)}
            {practice.authorisationEndDate ? ` to ${formatDateAu(practice.authorisationEndDate)}` : ', no end date'}
          </span>
        )}
        {unauthorised && <span>{whyUnauthorised}</span>}
        {unauthorised && practice.requiresReporting === false && <span>No report needed</span>}
        {practice.type === 'ChemicalRestraint' && practice.relatedMedicationName && (
          <span className="inline-flex items-center gap-1">
            <Pill className="w-3 h-3" /> Linked to {practice.relatedMedicationName}{practice.relatedMedicationStatus === 'Ceased' ? ' (ceased)' : ''}
          </span>
        )}
      </div>
      {practice.isActive && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-[var(--color-muted-foreground)]">
          <span>Behaviour support plan</span>
          {!practice.firstUsedOn && !practice.interimBspDate && !practice.comprehensiveBspDate && (
            <span>{canWrite ? 'Add the first use date to see when plans are due' : 'First use date not recorded'}</span>
          )}
          {practice.comprehensiveBspDate ? null : (
            <BspPill plan="Interim" state={practice.interimBspState} date={practice.interimBspState === 'InPlace' ? practice.interimBspDate : practice.interimBspDueOn} />
          )}
          <BspPill plan="Comprehensive" state={practice.comprehensiveBspState} date={practice.comprehensiveBspState === 'InPlace' ? practice.comprehensiveBspDate : practice.comprehensiveBspDueOn} />
        </div>
      )}
    </div>
  )
}

/** First used on: the hint offers the earliest use on record with a one-tap fill, and says so when a use is on record before the date entered. */
function FirstUsedField({ value, suggestion, error, onChange }: { value: string; suggestion: string | null; error?: string; onChange: (v: string) => void }) {
  const offer = !value && !!suggestion
  const earlier = !!value && !!suggestion && suggestion < value
  const hint = offer ? undefined
    : earlier ? `A use is on record from ${formatDateAu(suggestion!)}, before this date.`
      : 'The date this practice was first used. It starts the plan due dates.'
  return (
    <div>
      <FormField label="First used on" error={error} hint={hint} descriptionId={offer ? 'first-used-suggestion' : undefined}>
        <input type="date" value={value} onChange={e => onChange(e.target.value)} />
      </FormField>
      {offer && (
        <div id="first-used-suggestion" className="flex flex-wrap items-center gap-x-2 mt-1 text-xs text-[var(--color-muted-foreground)]">
          <span>Earliest use on record: {formatDateAu(suggestion!)}.</span>
          <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={() => onChange(suggestion!.split('T')[0])}>
            Use {formatDateAu(suggestion!)}
          </Button>
        </div>
      )}
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
  const [errors, setErrors] = useState<{ description?: string; authorisedBy?: string; authorisationDate?: string; authorisationEndDate?: string; firstUsedOn?: string }>({})
  // A 409 means the entry changed under the editor, not that they did something wrong: it gets the warning tone.
  const [modalError, setModalError] = useState<{ message: string; stale: boolean } | null>(null)
  const [refusals, setRefusals] = useState(0)
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (refusals === 0) return
    errorRef.current?.focus({ preventScroll: true })
    errorRef.current?.scrollIntoView({ block: 'start' })
  }, [refusals])
  const [deletingPractice, setDeletingPractice] = useState<RestrictivePracticeDto | null>(null)
  const [listError, setListError] = useState<{ message: string; stale: boolean } | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const [adding, setAdding] = useState(false)
  const [deleteBlocked, setDeleteBlocked] = useState<RestrictivePracticeDto | null>(null)

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
      authorisationEndDate: practice.authorisationEndDate ? practice.authorisationEndDate.split('T')[0] : '',
      useKind: practice.useKind,
      firstUsedOn: practice.firstUsedOn ? practice.firstUsedOn.split('T')[0] : '',
      interimBspDate: practice.interimBspDate ? practice.interimBspDate.split('T')[0] : '',
      comprehensiveBspDate: practice.comprehensiveBspDate ? practice.comprehensiveBspDate.split('T')[0] : '',
      reviewDate: practice.reviewDate ? practice.reviewDate.split('T')[0] : '',
      relatedMedicationId: practice.relatedMedicationId ?? '',
      isActive: practice.isActive,
      requiresReporting: practice.requiresReporting ?? null,
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
    const next: { description?: string; authorisedBy?: string; authorisationDate?: string; authorisationEndDate?: string; firstUsedOn?: string } = {}
    if (!form.description.trim()) next.description = 'Add a description'
    if (form.authorised && !form.authorisedBy.trim()) next.authorisedBy = 'Add who authorised it'
    if (form.authorised && !form.authorisationDate) next.authorisationDate = 'Add the date it was authorised'
    if (form.authorised && form.authorisationEndDate && form.authorisationDate && form.authorisationEndDate < form.authorisationDate) {
      next.authorisationEndDate = "The end date can't be before the authorisation date"
    }
    // shortcut: the browser's calendar day, not the organisation's; the server repeats the check on the organisation's day.
    if (form.firstUsedOn && (calendarDaysUntil(form.firstUsedOn) ?? 0) > 0) next.firstUsedOn = "The first use date can't be in the future"
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
      datesIncluded: true,
      authorisationEndDate: form.authorised ? (form.authorisationEndDate || null) : null,
      useKind: form.useKind,
      firstUsedOn: form.firstUsedOn || null,
      interimBspDate: form.interimBspDate || null,
      comprehensiveBspDate: form.comprehensiveBspDate || null,
      reviewDate: form.reviewDate || null,
      relatedMedicationId: form.type === 'ChemicalRestraint' ? (form.relatedMedicationId || null) : null,
      isActive: form.isActive,
      requiresReporting: form.authorised ? null : form.requiresReporting,
      expectedUpdatedAt: editingPractice.updatedAt,
    }
    try {
      await updatePractice.mutateAsync({ id: editingPractice.id, data: payload })
      closeModal()
    } catch (err) {
      // So closing and reopening the entry carries the version someone else just saved.
      if (apiErrorStatus(err) === 409) void practicesQuery.refetch()
      setModalError({
        message: apiErrorStatus(err) === 409 && editingPractice.relatedMedicationId
          ? 'This entry was changed while you had it open, possibly by a change to its linked medicine. Close it and open it again to see the latest version.'
          : extractErrorMessage(err, 'Failed to save restrictive practice entry.'),
        stale: apiErrorStatus(err) === 409,
      })
      setRefusals((n) => n + 1)
    }
  }

  // A linked entry can't be deleted; send the user to deactivate it instead.
  function requestDelete(p: RestrictivePracticeDto) {
    if (p.relatedMedicationId) setDeleteBlocked(p)
    else setDeletingPractice(p)
  }

  async function confirmDelete() {
    if (!deletingPractice || !participantId) return
    setListError(null)
    try {
      await deletePractice.mutateAsync({ id: deletingPractice.id, participantId, expectedUpdatedAt: deletingPractice.updatedAt })
      setDeletingPractice(null)
    } catch (err) {
      setDeletingPractice(null)
      // So the list shows the change that stopped the delete.
      if (apiErrorStatus(err) === 409) void practicesQuery.refetch()
      setListError({ message: extractErrorMessage(err, 'Failed to delete restrictive practice entry.'), stale: apiErrorStatus(err) === 409 })
    }
  }

  const isSaving = updatePractice.isPending

  // A linked entry is owned by its medicine: its type and medicine are locked, and Active follows the medicine.
  const linkedMedLabel = editingPractice?.relatedMedicationName ?? 'the linked medicine'
  const isLinked = !!editingPractice?.relatedMedicationId
  const linkedCeased = isLinked && editingPractice?.relatedMedicationStatus === 'Ceased'
  const takenByOthers = new Set(practices.filter(p => p.id !== editingPractice?.id && p.relatedMedicationId).map(p => p.relatedMedicationId))
  const medicationItems = [
    { value: '', label: 'None' },
    ...medications
      .filter(m => !takenByOthers.has(m.id))
      .map(m => ({ value: m.id, label: m.strength ? `${m.name} ${m.strength}` : m.name })),
  ]
  const pickedMed = medications.find(m => m.id === form.relatedMedicationId)
  const newlyLinking = !isLinked && !!form.relatedMedicationId && form.isActive
  const deactivating = isLinked && !!editingPractice?.isActive && !form.isActive
  const reactivating = isLinked && !editingPractice?.isActive && form.isActive
  const consequenceRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (deactivating || reactivating) consequenceRef.current?.scrollIntoView({ block: 'nearest' })
  }, [deactivating, reactivating])

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
        <Callout tone={listError.stale ? 'warning' : 'error'}
          actions={<Button variant="ghost" size="sm" onClick={() => setListError(null)}>Dismiss</Button>}>
          {listError.message}
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
            <PracticeCard practice={p} canWrite={canWriteRestrictivePractices} onEdit={() => openEdit(p)} onDelete={() => requestDelete(p)} />
            </div>
          ))}
        </div>
        {showAll.button}
        </div>
      )}

      {inactivePractices.length > 0 && (
        <div>
          <DisclosureToggle label={`Inactive (${inactivePractices.length})`} open={showInactive} onToggle={() => setShowInactive(v => !v)} controls="practices-inactive-list" />
          {showInactive && (
            <div id="practices-inactive-list" className="space-y-3 mt-3">
              {inactivePractices.map(p => (
                <PracticeCard key={p.id} practice={p} canWrite={canWriteRestrictivePractices} onEdit={() => openEdit(p)} onDelete={() => requestDelete(p)} />
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
              {isSaving ? 'Saving...' : deactivating ? 'Save and untick medicine' : 'Save entry'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            // The key re-mounts it on each refusal, so a repeat Save is announced and scrolled to again.
            <div key={refusals} ref={errorRef} tabIndex={-1} className="scroll-mt-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
              <Callout tone={modalError.stale ? 'warning' : 'error'}>{modalError.message}</Callout>
            </div>
          )}
          <FormField label="Type" hint={isLinked ? 'Set by the linked medicine, so it stays a chemical restraint.' : undefined}>
            <Dropdown
              variant="form"
              disabled={isLinked}
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
                isLinked
                  ? 'To stop this restraint, untick Chemical restraint on the medicine or deactivate this entry.'
                  : medicationItems.length === 1
                    ? 'This participant has no active medications on record without an entry — add one on the Medications tab first, or leave this unlinked for now.'
                    : 'The prescribed medication this chemical restraint is based on'
              }
            >
              <Dropdown
                variant="form"
                disabled={isLinked}
                value={form.relatedMedicationId}
                onChange={v => setForm(f => ({ ...f, relatedMedicationId: v }))}
                items={isLinked
                  ? [{ value: form.relatedMedicationId, label: `${linkedMedLabel}${linkedCeased ? ' (ceased)' : ''}` }]
                  : medicationItems}
              />
            </FormField>
          )}
          {newlyLinking && (
            <Callout tone="info">Linking also ticks Chemical restraint on {pickedMed?.name ?? 'the medicine'}.</Callout>
          )}
          <FormField
            label="How is it used?"
            hint={isLinked
              ? `Set by the linked medicine, which is ${form.useKind === 'Prn' ? 'PRN' : 'Regular'}.`
              : 'Routine is part of the everyday plan. As needed (PRN) is used only when a set situation arises.'}
          >
            <ToggleGroup
              ariaLabel="How is it used?"
              options={USE_KIND_OPTIONS}
              value={form.useKind}
              disabled={isLinked}
              onChange={k => setForm(f => ({ ...f, useKind: k as RestrictivePracticeUseKind }))}
            />
          </FormField>
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
              <FormField
                label="Authorisation end date"
                error={errors.authorisationEndDate}
                hint={!form.authorisationEndDate
                  ? 'Leave blank if the authorisation has no end date.'
                  : isPastDue(form.authorisationEndDate) ? 'This date has passed, so the entry reads Not authorised.' : undefined}
              >
                <input type="date" value={form.authorisationEndDate} onChange={e => setForm(f => ({ ...f, authorisationEndDate: e.target.value }))} />
              </FormField>
            </>
          )}
          {!form.authorised && (
            <FormField label="Does this need to be reported to the NDIS Commission?">
              <ToggleGroup
                ariaLabel="Does this need to be reported to the NDIS Commission?"
                options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }]}
                value={form.requiresReporting == null ? '' : String(form.requiresReporting)}
                onChange={k => setForm(f => ({ ...f, requiresReporting: k === 'true' }))}
              />
            </FormField>
          )}
          <FormField label="Review date">
            <input type="date" value={form.reviewDate} onChange={e => setForm(f => ({ ...f, reviewDate: e.target.value }))} />
          </FormField>
          <fieldset className="space-y-4">
            <legend className="text-sm font-medium text-[var(--color-foreground)]">Behaviour support plan</legend>
            <p className="text-sm text-[var(--color-muted-foreground)]">The interim plan is due 1 month after first use, and the comprehensive plan 6 months after.</p>
            <FirstUsedField
              value={form.firstUsedOn}
              suggestion={editingPractice?.earliestRecordedUseDate ?? null}
              error={errors.firstUsedOn}
              onChange={v => setForm(f => ({ ...f, firstUsedOn: v }))}
            />
            <FormField label="Interim plan in place on">
              <input type="date" value={form.interimBspDate} onChange={e => setForm(f => ({ ...f, interimBspDate: e.target.value }))} />
            </FormField>
            <FormField label="Comprehensive plan in place on">
              <input type="date" value={form.comprehensiveBspDate} onChange={e => setForm(f => ({ ...f, comprehensiveBspDate: e.target.value }))} />
            </FormField>
          </fieldset>
          <FormField label="Active" layout="checkbox" hint={linkedCeased ? `${linkedMedLabel} is ceased. Restart the medicine to reactivate this entry.` : 'Inactive entries are hidden from the default list but not deleted'}>
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={linkedCeased}
              onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--color-border)]"
            />
          </FormField>
          {(deactivating || reactivating) && (
            <div ref={consequenceRef} className="pb-4 scroll-mb-24">
              {deactivating && (
                <Callout tone="warning">Deactivating this entry also unticks Chemical restraint on {linkedMedLabel}. Its history is kept.</Callout>
              )}
              {reactivating && (
                <Callout tone="info">Reactivating this entry also ticks Chemical restraint on {linkedMedLabel}.</Callout>
              )}
            </div>
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

      <ConfirmDialog
        open={!!deleteBlocked}
        onCancel={() => setDeleteBlocked(null)}
        onConfirm={() => { const p = deleteBlocked; setDeleteBlocked(null); if (p) openEdit(p) }}
        title="This entry can't be deleted"
        message={`This entry is linked to ${deleteBlocked?.relatedMedicationName ?? 'a medicine'}${deleteBlocked?.isActive === false ? ", so it's kept as the record of that restraint." : '. Deactivate it instead.'}`}
        confirmLabel="Open entry"
        cancelLabel="Close"
        // An inactive entry has nothing to open: it only needs the Close button.
        footer={deleteBlocked?.isActive === false ? <Button variant="secondary" onClick={() => setDeleteBlocked(null)}>Close</Button> : undefined}
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
