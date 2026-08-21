import { useEffect, useId, useRef, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import type { ShiftDto, CreateShiftDto, RosterFindingDto, SupportRatio, SleepoverType } from '@/api/types'
import { SUPPORT_RATIOS, SLEEPOVER_TYPES } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { FormField } from '@/components/FormField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  useCheckShift, useCreateShift, useUpdateShift, useDeleteShift, getRosterFindings,
} from '@/api/hooks'
import { FindingsList } from './FindingsList'
import { useSlideOverA11y } from '../lib/useSlideOverA11y'
import { RATIO_LABELS, NIGHT_TYPE_LABELS } from '../lib/roster'

export type ShiftSlideOverTarget =
  | { mode: 'create'; participantId?: string; staffId?: string | null; serviceDate?: string }
  | { mode: 'edit'; shift: ShiftDto }

export type ShiftSlideOverProps = {
  target: ShiftSlideOverTarget | null
  onClose: () => void
  canWrite: boolean
  participantOptions: { value: string; label: string }[]
  staffOptions: { value: string; label: string }[]
}

/** Normalises a Shift/TimeOnly string ("HH:mm:ss" or "HH:mm") to the "HH:mm" a <input type="time"> needs. */
function toTimeInputValue(time: string | undefined): string {
  return (time ?? '09:00').slice(0, 5)
}

export function ShiftSlideOver({ target, onClose, canWrite, participantOptions, staffOptions }: ShiftSlideOverProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const open = target !== null
  useSlideOverA11y(open, onClose, panelRef)

  const isEdit = target?.mode === 'edit'
  const existing = target?.mode === 'edit' ? target.shift : undefined

  const [participantId, setParticipantId] = useState(existing?.participantId ?? (target?.mode === 'create' ? target.participantId ?? '' : ''))
  const [staffId, setStaffId] = useState<string | null>(existing?.staffId ?? (target?.mode === 'create' ? target.staffId ?? null : null))
  const [serviceDate, setServiceDate] = useState(existing?.serviceDate ?? (target?.mode === 'create' ? target.serviceDate ?? '' : ''))
  const [startTime, setStartTime] = useState(toTimeInputValue(existing?.startTime))
  const [endTime, setEndTime] = useState(toTimeInputValue(existing?.endTime))
  const [endsNextDay, setEndsNextDay] = useState(existing?.endsNextDay ?? false)
  const [ratio, setRatio] = useState<SupportRatio>(existing?.ratio ?? 'OneToOne')
  const [nightType, setNightType] = useState<SleepoverType>(existing?.nightType ?? 'None')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [overrideReason, setOverrideReason] = useState('')
  const [findings, setFindings] = useState<RosterFindingDto[]>(existing?.findings ?? [])
  const [reasonRequired, setReasonRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const checkShift = useCheckShift()
  const createShift = useCreateShift()
  const updateShift = useUpdateShift()
  const deleteShift = useDeleteShift()

  // Live dry-run: re-checks findings whenever the candidate shape changes, debounced so we
  // don't fire a request per keystroke. Never writes — POST /shifts/check is a pure preview.
  useEffect(() => {
    if (!canWrite || !participantId || !serviceDate || !startTime || !endTime) return
    const handle = setTimeout(() => {
      checkShift.mutate(
        { id: existing?.id, participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType },
        { onSuccess: setFindings },
      )
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, participantId, staffId, serviceDate, startTime, endTime, endsNextDay, ratio, nightType])

  if (!open) return null

  const blockingFindings = findings.filter(f => f.severity === 'Blocking')
  const warningFindings = findings.filter(f => f.severity === 'Warning')
  const isBusy = createShift.isPending || updateShift.isPending

  async function handleSave() {
    setError(null)
    if (blockingFindings.length > 0) return
    if (warningFindings.length > 0 && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)

    const payload: CreateShiftDto = {
      participantId,
      staffId,
      serviceDate,
      startTime,
      endTime,
      endsNextDay,
      ratio,
      nightType,
      notes: notes.trim() || null,
      overrideReason: warningFindings.length > 0 ? overrideReason.trim() : null,
      acknowledgedFindingCodes: warningFindings.map(f => f.code),
    }

    try {
      if (isEdit && existing) {
        await updateShift.mutateAsync({ id: existing.id, data: payload })
      } else {
        await createShift.mutateAsync(payload)
      }
      onClose()
    } catch (err: unknown) {
      const serverFindings = getRosterFindings(err)
      if (serverFindings) {
        setFindings(serverFindings)
        if (serverFindings.some(f => f.severity === 'Warning') && !overrideReason.trim()) setReasonRequired(true)
      } else {
        setError('Something went wrong saving this shift. Please try again.')
      }
    }
  }

  async function handleDelete() {
    if (!existing) return
    await deleteShift.mutateAsync(existing.id)
    setConfirmDelete(false)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-card shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="font-display font-semibold text-foreground">
            {isEdit ? 'Shift details' : 'New shift'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
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

          <FormField label="Staff" hint="Leave unassigned to add this shift to the Unfilled lane.">
            <Dropdown
              variant="form"
              value={staffId ?? ''}
              onChange={v => setStaffId(v || null)}
              disabled={!canWrite}
              searchable
              label="Unassigned"
              items={[{ value: '', label: 'Unassigned' }, ...staffOptions]}
            />
          </FormField>

          <FormField label="Service date" required>
            <input type="date" value={serviceDate} disabled={!canWrite} onChange={e => setServiceDate(e.target.value)} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
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

          <FormField label="Notes">
            <textarea rows={3} value={notes} disabled={!canWrite} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for this shift" />
          </FormField>

          {findings.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Findings</p>
              <FindingsList findings={findings} />
            </div>
          )}

          {canWrite && warningFindings.length > 0 && (
            <FormField
              label="Reason for override"
              required
              error={reasonRequired ? 'A reason is required to save with open warnings.' : undefined}
              hint="Stored on the shift and visible in audit."
            >
              <textarea rows={2} value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Why this shift should be rostered despite the warnings above" />
            </FormField>
          )}

          {blockingFindings.length > 0 && (
            <p role="alert" className="text-sm font-medium text-destructive">
              This shift can't be saved while a blocking finding is open.
            </p>
          )}

          {error && (
            <div role="alert" className="rounded-sm bg-error-container px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {canWrite && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-4">
            {isEdit ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-destructive transition-colors duration-150 hover:bg-error-container focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isBusy || blockingFindings.length > 0}
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {isBusy ? 'Saving…' : warningFindings.length > 0 ? 'Save with override' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        title="Delete shift"
        message="This permanently removes the shift from the roster. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteShift.isPending}
      />
    </>
  )
}
