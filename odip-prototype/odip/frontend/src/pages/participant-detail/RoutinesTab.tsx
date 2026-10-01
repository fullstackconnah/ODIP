import { useMemo, useState } from 'react'
import { ListChecks, AlertTriangle, ChevronDown, Plus, Clock, CalendarDays } from 'lucide-react'
import { useParticipantRoutines, useCreateRoutine, useUpdateRoutine, useDeleteRoutine } from '@/api/hooks'
import { formatShiftTime, extractErrorMessage } from '@/lib/utils'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField, labelClass } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { ROUTINE_CATEGORIES } from '@/api/types/enums'
import { ROUTINE_CATEGORY_LABELS } from '@/api/types/routines'
import type { ParticipantRoutineDto } from '@/api/types/routines'
import type { RoutineCategory } from '@/api/types/enums'

/** Monday-first for display, independent of the .NET DayOfWeek (Sunday=0) wire ordering. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

const WEEKDAY_ABBREVIATIONS: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
}

/**
 * Readable label for a routine's day set (PD-4) — "Every day" for all 7, "Weekdays"/"Weekends"
 * for those two common subsets, otherwise a Monday-first comma list of abbreviations (e.g.
 * "Mon, Wed, Fri"). Re-sorts to Monday-first order regardless of the input array's order, since
 * the days array is built by toggling individual checkboxes and isn't guaranteed to arrive sorted.
 */
function formatDaySet(days: string[]): string {
  const sorted = WEEKDAYS.filter(d => days.includes(d))
  if (sorted.length === 7) return 'Every day'
  if (sorted.length === 5 && WEEKDAYS.slice(0, 5).every(d => sorted.includes(d))) return 'Weekdays'
  if (sorted.length === 2 && WEEKDAYS.slice(5).every(d => sorted.includes(d))) return 'Weekends'
  return sorted.map(d => WEEKDAY_ABBREVIATIONS[d]).join(', ')
}

/** Normalises a "HH:mm:ss"/"HH:mm" time from the API to what an <input type="time"> needs. */
function toTimeInputValue(time: string | null | undefined): string {
  return (time ?? '').slice(0, 5)
}

/** Normalises an <input type="time"> value ("HH:mm") to the "HH:mm:ss" the API expects. */
function toApiTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time
}

/** Same "h:mma–h:mma" formatting as the rostering board's shift times, plus an "Untimed" fallback
 * for routines with no start/end — delegates to the shared formatShiftTime instead of duplicating it.
 * A routine may also have only a start ("the task needs to be done from this time") or only an end
 * ("the task needs to be done by this time") — both render as a single time with a directional word. */
function formatRoutineTime(startTime: string | null, endTime: string | null): string {
  if (startTime && endTime) return `${formatShiftTime(startTime)}–${formatShiftTime(endTime)}`
  if (startTime) return `From ${formatShiftTime(startTime)}`
  if (endTime) return `By ${formatShiftTime(endTime)}`
  return 'Untimed'
}

/**
 * Groups active routines into "Every day" plus one bucket per weekday that has entries, each
 * sorted critical-first then by time (untimed last). A routine spanning multiple days but not
 * all 7 (e.g. Mon/Wed/Fri) appears once in EACH of its applicable weekday buckets — never in
 * "Every day" — so a support worker checking any one of those days sees it (PD-4).
 */
function groupRoutines(routines: ParticipantRoutineDto[]): { label: string; items: ParticipantRoutineDto[] }[] {
  const sortWithin = (items: ParticipantRoutineDto[]) =>
    [...items].sort((a, b) => {
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
      // An end-only routine ("By 5pm") still carries a real time constraint, so it sorts among
      // timed routines by its deadline rather than being lumped in with true "Untimed" routines.
      const aTime = a.startTime ?? a.endTime
      const bTime = b.startTime ?? b.endTime
      if (!aTime && !bTime) return 0
      if (!aTime) return 1
      if (!bTime) return -1
      return aTime.localeCompare(bTime)
    })

  const groups: { label: string; items: ParticipantRoutineDto[] }[] = []

  const everyDay = routines.filter(r => r.days.length === 7)
  if (everyDay.length > 0) groups.push({ label: 'Every day', items: sortWithin(everyDay) })

  for (const day of WEEKDAYS) {
    const items = routines.filter(r => r.days.includes(day) && r.days.length < 7)
    if (items.length > 0) groups.push({ label: day, items: sortWithin(items) })
  }

  return groups
}

type RoutineFormState = {
  title: string
  description: string
  category: RoutineCategory
  days: string[]
  startTime: string
  endTime: string
  isCritical: boolean
  isActive: boolean
}

// Defaults to every day, same as the old dayOfWeek === null default.
const EMPTY_FORM: RoutineFormState = {
  title: '', description: '', category: 'PersonalCare', days: [...WEEKDAYS],
  startTime: '', endTime: '', isCritical: false, isActive: true,
}

function RoutineCard({ routine, canWrite, canDelete, onEdit, onDelete }: {
  routine: ParticipantRoutineDto
  canWrite: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`p-4 rounded-xl border transition-colors ${
        routine.isCritical
          ? 'border-[var(--color-destructive)]/30 bg-[var(--color-error-container)]/20'
          : 'border-[var(--color-border)] bg-[var(--color-card)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
          {routine.isCritical && (
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-destructive)] shrink-0" aria-label="Critical" />
          )}
          <p className="font-medium text-[var(--color-foreground)]">{routine.title}</p>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] whitespace-nowrap">
            {ROUTINE_CATEGORY_LABELS[routine.category]}
          </span>
          {routine.isCritical && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] whitespace-nowrap">
              Critical
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
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] px-2 py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)] mt-1.5">
        <p className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> {formatRoutineTime(routine.startTime, routine.endTime)}
        </p>
        {/* Shown even inside a single weekday's group — a Mon/Wed/Fri routine appears in three
            groups (see groupRoutines), so its own day set is the only place staff can see the
            full picture rather than assuming it's specific to just the group they're looking at. */}
        <p className="flex items-center gap-1">
          <CalendarDays className="w-3 h-3" /> {formatDaySet(routine.days)}
        </p>
      </div>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-1.5">{routine.description}</p>
    </div>
  )
}

export default function RoutinesTab({ participantId }: { participantId: string | undefined }) {
  const { canWriteRoutines, canDeleteRoutines } = usePermissions()
  // includeInactive=true: the edit form lets staff flip a routine to inactive (see the "Active"
  // field below), so the list has to fetch inactive ones too and surface them in their own
  // disclosure — otherwise toggling a routine off would make it vanish with no way back,
  // unlike every sibling tab's soft-hide pattern (Notes' Archived, Medications' Ceased).
  const routinesQuery = useParticipantRoutines(participantId, true)
  const routines = useMemo(() => routinesQuery.data ?? [], [routinesQuery.data])
  // A failed or paused request is not an empty list: "No routines yet" is only for one that succeeded and came back empty.
  const phase = queryPhase(routinesQuery)
  const createRoutine = useCreateRoutine()
  const updateRoutine = useUpdateRoutine()
  const deleteRoutine = useDeleteRoutine()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; routine?: ParticipantRoutineDto } | null>(null)
  const [form, setForm] = useState<RoutineFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ title?: string; description?: string; time?: string; days?: string }>({})
  const [modalError, setModalError] = useState<string | null>(null)
  const [deletingRoutine, setDeletingRoutine] = useState<ParticipantRoutineDto | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const activeRoutines = useMemo(() => routines.filter(r => r.isActive), [routines])
  const inactiveRoutines = useMemo(() => routines.filter(r => !r.isActive), [routines])
  const groups = useMemo(() => groupRoutines(activeRoutines), [activeRoutines])

  function openCreate() {
    setForm(EMPTY_FORM)
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'create' })
  }

  function openEdit(routine: ParticipantRoutineDto) {
    setForm({
      title: routine.title,
      description: routine.description,
      category: routine.category,
      days: routine.days,
      startTime: toTimeInputValue(routine.startTime),
      endTime: toTimeInputValue(routine.endTime),
      isCritical: routine.isCritical,
      isActive: routine.isActive,
    })
    setErrors({})
    setModalError(null)
    setModalState({ mode: 'edit', routine })
  }

  function closeModal() {
    setModalState(null)
    setModalError(null)
  }

  function validate(): boolean {
    const next: { title?: string; description?: string; time?: string; days?: string } = {}
    if (!form.title.trim()) next.title = 'Title is required'
    if (!form.description.trim()) next.description = 'Description is required'
    if (form.startTime && form.endTime && form.endTime <= form.startTime) next.time = 'End time must be after start time'
    if (form.days.length === 0) next.days = 'Select at least one day'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setModalError(null)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      days: form.days,
      startTime: form.startTime ? toApiTime(form.startTime) : null,
      endTime: form.endTime ? toApiTime(form.endTime) : null,
      isCritical: form.isCritical,
      isActive: form.isActive,
    }
    try {
      if (modalState?.mode === 'edit' && modalState.routine) {
        await updateRoutine.mutateAsync({ id: modalState.routine.id, data: payload })
      } else if (participantId) {
        await createRoutine.mutateAsync({ participantId, data: payload })
      }
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save routine.'))
    }
  }

  async function confirmDelete() {
    if (!deletingRoutine || !participantId) return
    setListError(null)
    try {
      await deleteRoutine.mutateAsync({ id: deletingRoutine.id, participantId })
      setDeletingRoutine(null)
    } catch (err) {
      setDeletingRoutine(null)
      setListError(extractErrorMessage(err, 'Failed to delete routine.'))
    }
  }

  const isSaving = createRoutine.isPending || updateRoutine.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--color-foreground)]">Routines &amp; Specifics</h2>
        {canWriteRoutines && participantId && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> New routine
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

      {phase === 'loading' ? (
        <PageState kind="loading" noun="routines" />
      ) : phase === 'error' ? (
        <PageState kind="error" noun="routines" onRetry={() => routinesQuery.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No routines yet"
          description="Capture the routines and shift-critical specifics support workers need to know — morning routines, mealtime requirements, behaviour supports, and more."
          action={canWriteRoutines && participantId ? { label: 'New routine', onClick: openCreate } : undefined}
        />
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <div key={group.label}>
              <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">
                {group.label}
              </h3>
              <div className="space-y-3">
                {group.items.map(r => (
                  <RoutineCard key={r.id} routine={r} canWrite={canWriteRoutines} canDelete={canDeleteRoutines} onEdit={() => openEdit(r)} onDelete={() => setDeletingRoutine(r)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        ChevronDown is reserved for interactive disclosures like this one — it's kept off the
        day-group headings above so a static icon never implies a toggle that isn't there,
        matching how Notes' Archived section and Medications' Ceased section use it.
      */}
      {inactiveRoutines.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded transition-colors"
            aria-expanded={showInactive}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showInactive ? 'rotate-180' : ''}`} />
            Inactive routines ({inactiveRoutines.length})
          </button>
          {showInactive && (
            <div className="space-y-3 mt-3">
              {inactiveRoutines.map(r => (
                <RoutineCard key={r.id} routine={r} canWrite={canWriteRoutines} canDelete={canDeleteRoutines} onEdit={() => openEdit(r)} onDelete={() => setDeletingRoutine(r)} />
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!modalState}
        onClose={closeModal}
        title={modalState?.mode === 'edit' ? 'Edit routine' : 'New routine'}
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
              {isSaving ? 'Saving...' : 'Save routine'}
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
          <FormField label="Title" required error={errors.title}>
            <input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Morning routine"
              autoFocus
            />
          </FormField>
          <FormField label="Description" required error={errors.description}>
            <textarea
              rows={4}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Details staff should know or do on shift..."
            />
          </FormField>
          <FormField label="Category">
            <Dropdown
              variant="form"
              value={form.category}
              onChange={v => setForm(f => ({ ...f, category: v as RoutineCategory }))}
              items={ROUTINE_CATEGORIES.map(c => ({ value: c, label: ROUTINE_CATEGORY_LABELS[c] }))}
            />
          </FormField>
          <fieldset className="m-0 p-0 border-0">
            <legend className={labelClass}>Days *</legend>
            {/* "Every day" is derived, not independently stored: checked iff all 7 days are
                selected. Checking it selects all 7; unchecking it (only reachable when all 7 are
                already checked) clears the selection to force an explicit re-pick rather than
                falling back to some arbitrary default day. Toggling an individual day just
                adds/removes it from `days` — "Every day" naturally ticks itself once all 7 end up
                selected that way too, with no separate code path. */}
            <label className="flex items-center gap-3 py-1 min-h-[44px]">
              <input
                type="checkbox"
                checked={form.days.length === 7}
                onChange={e => setForm(f => ({ ...f, days: e.target.checked ? [...WEEKDAYS] : [] }))}
                className="w-4 h-4 rounded border-[var(--color-border)]"
              />
              <span className="text-sm font-medium text-[var(--color-foreground)]">Every day</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4">
              {WEEKDAYS.map(day => {
                const checked = form.days.includes(day)
                return (
                  <label key={day} className="flex items-center gap-3 py-1 min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => setForm(f => ({
                        ...f,
                        days: e.target.checked ? [...f.days, day] : f.days.filter(d => d !== day),
                      }))}
                      className="w-4 h-4 rounded border-[var(--color-border)]"
                    />
                    <span className="text-sm text-[var(--color-foreground)]">{day}</span>
                  </label>
                )
              })}
            </div>
            {errors.days && <p className="text-xs text-[var(--color-destructive)] mt-1">{errors.days}</p>}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start time" error={errors.time} hint="Leave blank if this task has no fixed start">
              <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
            </FormField>
            <FormField label="End time" hint="Leave blank if this task has no fixed end">
              <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
            </FormField>
          </div>
          <FormField label="Critical — must-know for shifts" layout="checkbox" hint="Critical routines are visually flagged and always surfaced on the shift slide-over, even if untimed">
            <input
              type="checkbox"
              checked={form.isCritical}
              onChange={e => setForm(f => ({ ...f, isCritical: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--color-border)]"
            />
          </FormField>
          {modalState?.mode === 'edit' && (
            <FormField label="Active" layout="checkbox" hint="Inactive routines are hidden from staff but not deleted">
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
        open={!!deletingRoutine}
        onCancel={() => setDeletingRoutine(null)}
        onConfirm={confirmDelete}
        title={`Delete "${deletingRoutine?.title ?? ''}"?`}
        message="The routine is taken out of the participant's shifts and moved to Inactive routines. Shifts already worked keep what was ticked."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteRoutine.isPending}
      />
    </div>
  )
}
