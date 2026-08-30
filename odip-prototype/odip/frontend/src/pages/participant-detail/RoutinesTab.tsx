import { useMemo, useState } from 'react'
import { ListChecks, AlertTriangle, ChevronDown, Plus, Clock } from 'lucide-react'
import type { AxiosError } from 'axios'
import { useParticipantRoutines, useCreateRoutine, useUpdateRoutine, useDeleteRoutine } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FormField } from '@/components/FormField'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { ROUTINE_CATEGORIES } from '@/api/types/enums'
import { ROUTINE_CATEGORY_LABELS } from '@/api/types/routines'
import type { ParticipantRoutineDto } from '@/api/types/routines'
import type { RoutineCategory } from '@/api/types/enums'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

/** Monday-first for display, independent of the .NET DayOfWeek (Sunday=0) wire ordering. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** Normalises a "HH:mm:ss"/"HH:mm" time from the API to what an <input type="time"> needs. */
function toTimeInputValue(time: string | null | undefined): string {
  return (time ?? '').slice(0, 5)
}

/** Normalises an <input type="time"> value ("HH:mm") to the "HH:mm:ss" the API expects. */
function toApiTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time
}

function formatRoutineTime(startTime: string | null, endTime: string | null): string {
  if (!startTime || !endTime) return 'Untimed'
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const period = h >= 12 ? 'pm' : 'am'
    const hour12 = h % 12 === 0 ? 12 : h % 12
    return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`
  }
  return `${fmt(startTime)}–${fmt(endTime)}`
}

/** Groups active routines into "Every day" plus one bucket per weekday that has entries, each sorted critical-first then by time (untimed last). */
function groupRoutines(routines: ParticipantRoutineDto[]): { label: string; items: ParticipantRoutineDto[] }[] {
  const sortWithin = (items: ParticipantRoutineDto[]) =>
    [...items].sort((a, b) => {
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
      if (!a.startTime && !b.startTime) return 0
      if (!a.startTime) return 1
      if (!b.startTime) return -1
      return a.startTime.localeCompare(b.startTime)
    })

  const groups: { label: string; items: ParticipantRoutineDto[] }[] = []

  const everyDay = routines.filter(r => !r.dayOfWeek)
  if (everyDay.length > 0) groups.push({ label: 'Every day', items: sortWithin(everyDay) })

  for (const day of WEEKDAYS) {
    const items = routines.filter(r => r.dayOfWeek === day)
    if (items.length > 0) groups.push({ label: day, items: sortWithin(items) })
  }

  return groups
}

type RoutineFormState = {
  title: string
  description: string
  category: RoutineCategory
  dayOfWeek: string
  timed: boolean
  startTime: string
  endTime: string
  isCritical: boolean
  isActive: boolean
}

const EMPTY_FORM: RoutineFormState = {
  title: '', description: '', category: 'PersonalCare', dayOfWeek: '', timed: false,
  startTime: '', endTime: '', isCritical: false, isActive: true,
}

function RoutineSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse space-y-2.5">
      <div className="h-4 w-1/3 bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-full bg-[var(--color-muted)] rounded" />
      <div className="h-3 w-2/3 bg-[var(--color-muted)] rounded" />
    </div>
  )
}

function RoutineCard({ routine, canWrite, onEdit, onDelete }: {
  routine: ParticipantRoutineDto
  canWrite: boolean
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
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] whitespace-nowrap">
            {ROUTINE_CATEGORY_LABELS[routine.category]}
          </span>
          {routine.isCritical && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] whitespace-nowrap">
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
      <p className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] mt-1.5">
        <Clock className="w-3 h-3" /> {formatRoutineTime(routine.startTime, routine.endTime)}
      </p>
      <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap mt-1.5">{routine.description}</p>
    </div>
  )
}

export default function RoutinesTab({ participantId }: { participantId: string | undefined }) {
  const { canWriteRoutines } = usePermissions()
  // includeInactive=true: the edit form lets staff flip a routine to inactive (see the "Active"
  // field below), so the list has to fetch inactive ones too and surface them in their own
  // disclosure — otherwise toggling a routine off would make it vanish with no way back,
  // unlike every sibling tab's soft-hide pattern (Notes' Archived, Medications' Ceased).
  const { data: routines = [], isLoading } = useParticipantRoutines(participantId, true)
  const createRoutine = useCreateRoutine()
  const updateRoutine = useUpdateRoutine()
  const deleteRoutine = useDeleteRoutine()

  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit'; routine?: ParticipantRoutineDto } | null>(null)
  const [form, setForm] = useState<RoutineFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ title?: string; description?: string; time?: string }>({})
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
      dayOfWeek: routine.dayOfWeek ?? '',
      timed: !!(routine.startTime && routine.endTime),
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
    const next: { title?: string; description?: string; time?: string } = {}
    if (!form.title.trim()) next.title = 'Title is required'
    if (!form.description.trim()) next.description = 'Description is required'
    if (form.timed && (!form.startTime || !form.endTime)) next.time = 'Start and end time are required for a timed routine'
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
      dayOfWeek: form.dayOfWeek || null,
      startTime: form.timed ? toApiTime(form.startTime) : null,
      endTime: form.timed ? toApiTime(form.endTime) : null,
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

      {isLoading ? (
        <div className="space-y-3">
          <RoutineSkeleton />
          <RoutineSkeleton />
        </div>
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
                  <RoutineCard key={r.id} routine={r} canWrite={canWriteRoutines} onEdit={() => openEdit(r)} onDelete={() => setDeletingRoutine(r)} />
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
                <RoutineCard key={r.id} routine={r} canWrite={canWriteRoutines} onEdit={() => openEdit(r)} onDelete={() => setDeletingRoutine(r)} />
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
          <FormField label="Day" hint="Leave as Every day if this applies every day of the week">
            <Dropdown
              variant="form"
              value={form.dayOfWeek}
              onChange={v => setForm(f => ({ ...f, dayOfWeek: v }))}
              items={[{ value: '', label: 'Every day' }, ...WEEKDAYS.map(d => ({ value: d, label: d }))]}
            />
          </FormField>
          <FormField label="Has a specific time window" layout="checkbox">
            <input
              type="checkbox"
              checked={form.timed}
              onChange={e => setForm(f => ({ ...f, timed: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--color-border)]"
            />
          </FormField>
          {form.timed && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start time" required error={errors.time}>
                <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
              </FormField>
              <FormField label="End time" required>
                <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
              </FormField>
            </div>
          )}
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
        message="This permanently removes the routine. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteRoutine.isPending}
      />
    </div>
  )
}
