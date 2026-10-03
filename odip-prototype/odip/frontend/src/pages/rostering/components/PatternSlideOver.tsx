import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ShiftPatternDto, CreateShiftPatternDto, SupportRatio, SleepoverType } from '@/api/types'
import { SUPPORT_RATIOS, SLEEPOVER_TYPES } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { FormField } from '@/components/FormField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useCreatePattern, useUpdatePattern, useDeletePattern } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { RequirementChips } from '@/components/RequirementChips'
import { SlideOver } from '@/components/SlideOver'
import { requirementLabels } from '@/lib/workerRequirements'
import { extractErrorMessage } from '@/lib/utils'
import { modalGrid } from '@/lib/formGrid'
import { RATIO_LABELS, NIGHT_TYPE_LABELS } from '../lib/roster'

export type PatternSlideOverTarget =
  | { mode: 'create' }
  | { mode: 'edit'; pattern: ShiftPatternDto }

export type PatternSlideOverProps = {
  target: PatternSlideOverTarget | null
  onClose: () => void
  canWrite: boolean
  participantOptions: { value: string; label: string }[]
  staffOptions: { value: string; label: string }[]
}

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  .map(d => ({ value: d, label: d }))

/** Normalises a TimeOnly string ("HH:mm:ss" or "HH:mm") to the "HH:mm" a <input type="time"> needs. */
function toTimeInputValue(time: string | undefined): string {
  return (time ?? '09:00').slice(0, 5)
}

/**
 * Create/edit slide-over for a weekly shift pattern. Mirrors ShiftSlideOver's shape exactly
 * (a SlideOver, delete-inside-the-panel-on-edit). Deliberately has no "Active"
 * toggle — deactivation is its own guarded action from the patterns table (ConfirmDialog,
 * explaining that it stops future generation without touching shifts already generated), not a
 * field buried in this form.
 */
export function PatternSlideOver({ target, onClose, canWrite, participantOptions, staffOptions }: PatternSlideOverProps) {
  const open = target !== null

  const isEdit = target?.mode === 'edit'
  const existing = target?.mode === 'edit' ? target.pattern : undefined

  const [participantId, setParticipantId] = useState(existing?.participantId ?? '')
  const [defaultStaffId, setDefaultStaffId] = useState<string | null>(existing?.defaultStaffId ?? null)
  const [dayOfWeek, setDayOfWeek] = useState(existing?.dayOfWeek ?? 'Monday')
  const [startTime, setStartTime] = useState(toTimeInputValue(existing?.startTime))
  const [endTime, setEndTime] = useState(toTimeInputValue(existing?.endTime))
  const [endsNextDay, setEndsNextDay] = useState(existing?.endsNextDay ?? false)
  const [ratio, setRatio] = useState<SupportRatio>(existing?.ratio ?? 'OneToOne')
  const [nightType, setNightType] = useState<SleepoverType>(existing?.nightType ?? 'None')
  const [effectiveFrom, setEffectiveFrom] = useState(existing?.effectiveFrom ?? '')
  const [effectiveTo, setEffectiveTo] = useState(existing?.effectiveTo ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Unsaved edits: the form as it is now against the form as it first rendered. The page keys this component on the target,
  // so "first render" is the moment the panel opened.
  const current = JSON.stringify([participantId, defaultStaffId, dayOfWeek, startTime, endTime, endsNextDay, ratio, nightType, effectiveFrom, effectiveTo, notes])
  const [opened] = useState(current)
  const dirty = current !== opened

  const createPattern = useCreatePattern()
  const updatePattern = useUpdatePattern()
  const deletePattern = useDeletePattern()

  if (!open) return null

  const isBusy = createPattern.isPending || updatePattern.isPending
  const canSave = !!participantId && !!effectiveFrom && !!startTime && !!endTime

  async function handleSave() {
    setError(null)
    if (!canSave) return

    const payload: CreateShiftPatternDto = {
      participantId,
      defaultStaffId,
      dayOfWeek,
      startTime,
      endTime,
      endsNextDay,
      ratio,
      nightType,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
      isActive: existing?.isActive ?? true,
      notes: notes.trim() || null,
    }

    try {
      if (isEdit && existing) {
        await updatePattern.mutateAsync({ id: existing.id, data: payload })
      } else {
        await createPattern.mutateAsync(payload)
      }
      onClose()
    } catch (err: unknown) {
      // The server's own words when it sent any (e.g. Enforce mode's "Participant is not ready for booking or rostering."),
      // the generic line only when it did not. The form stays as the user left it.
      setError(extractErrorMessage(err, 'Something went wrong saving this pattern. Please try again.'))
    }
  }

  async function handleDelete() {
    if (!existing) return
    await deletePattern.mutateAsync(existing.id)
    setConfirmDelete(false)
    onClose()
  }

  return (
    <>
      <SlideOver
        open
        onClose={onClose}
        title={isEdit ? 'Edit pattern' : 'New pattern'}
        dirty={dirty}
        bodyClassName="flex flex-col gap-[var(--field-gap-y)]"
        footerClassName="flex items-center justify-between gap-3"
        footer={canWrite ? (
          <>
            {isEdit ? (
              <Button variant="ghost-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isBusy || !canSave}>
                {isBusy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        ) : undefined}
      >
        {existing?.sourceDraftId && (
          <Callout tone="warning">
            {`This pattern came from agreement v${existing.sourceDraftVersion ?? '?'}; changing it here makes the roster differ from the agreement.`}
          </Callout>
        )}
        {existing?.requirements && requirementLabels(existing.requirements).length > 0 && (
          <FormField label="Asks for" hint="From the agreement. Shown, not checked against the worker yet.">
            <RequirementChips requirements={existing.requirements} />
          </FormField>
        )}

        <FormField label="Participant" required>
          <Dropdown
            variant="form"
            value={participantId}
            onChange={setParticipantId}
            disabled={!canWrite || isEdit}
            searchable
            label="Select a participant"
            items={participantOptions}
          />
        </FormField>

        <FormField label="Default staff" hint="Pre-fills every shift this pattern generates. Leave unassigned to generate unfilled shifts.">
          <SearchableSelect
            value={defaultStaffId ?? ''}
            onChange={v => setDefaultStaffId(v || null)}
            disabled={!canWrite}
            placeholder="Unassigned"
            items={[{ value: '', label: 'Unassigned' }, ...staffOptions]}
          />
        </FormField>

        <FormField label="Day of week" required>
          <Dropdown variant="form" value={dayOfWeek} onChange={setDayOfWeek} disabled={!canWrite} items={DAY_OPTIONS} />
        </FormField>

        <div className={modalGrid}>
          <FormField label="Start time" required>
            <input type="time" value={startTime} disabled={!canWrite} onChange={e => setStartTime(e.target.value)} />
          </FormField>
          <FormField label="End time" required>
            <input type="time" value={endTime} disabled={!canWrite} onChange={e => setEndTime(e.target.value)} />
          </FormField>
        </div>

        <FormField label="Ends the next day" layout="checkbox">
          <input type="checkbox" checked={endsNextDay} disabled={!canWrite} onChange={e => setEndsNextDay(e.target.checked)} />
        </FormField>

        <div className={modalGrid}>
          <FormField label="Ratio">
            <Dropdown
              variant="form"
              value={ratio}
              onChange={v => setRatio(v as SupportRatio)}
              disabled={!canWrite}
              items={SUPPORT_RATIOS.map(r => ({ value: r, label: RATIO_LABELS[r] ?? r }))}
            />
          </FormField>
          <FormField label="Night type">
            <Dropdown
              variant="form"
              value={nightType}
              onChange={v => setNightType(v as SleepoverType)}
              disabled={!canWrite}
              items={SLEEPOVER_TYPES.map(n => ({ value: n, label: NIGHT_TYPE_LABELS[n] ?? n }))}
            />
          </FormField>
        </div>

        <div className={modalGrid}>
          <FormField label="Effective from" required>
            <input type="date" value={effectiveFrom} disabled={!canWrite} onChange={e => setEffectiveFrom(e.target.value)} />
          </FormField>
          <FormField label="Effective to" hint="Leave blank for no end date.">
            <input type="date" value={effectiveTo} disabled={!canWrite} onChange={e => setEffectiveTo(e.target.value)} />
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea rows={3} value={notes} disabled={!canWrite} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for this pattern" />
        </FormField>

        {error && (
          <div role="alert" className="rounded-[var(--radius-sm)] bg-error-container px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </SlideOver>

      <ConfirmDialog
        open={confirmDelete}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        title="Delete pattern"
        message="This permanently removes the pattern. Shifts already generated from it stay on the roster exactly as they are — this doesn't touch them."
        confirmLabel="Delete"
        variant="danger"
        loading={deletePattern.isPending}
      />
    </>
  )
}
