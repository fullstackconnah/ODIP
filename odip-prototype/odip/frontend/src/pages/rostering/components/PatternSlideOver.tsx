import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ShiftPatternDto, CreateShiftPatternDto, SupportRatio, SleepoverType, PatternChangeResultDto } from '@/api/types'
import { SUPPORT_RATIOS, SLEEPOVER_TYPES } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { FormField } from '@/components/FormField'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useCreatePattern, useUpdatePattern, useDeletePattern, usePatternChange } from '@/api/hooks'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { buttonClasses } from '@/components/buttonClasses'
import { Callout } from '@/components/Callout'
import { RequirementChips } from '@/components/RequirementChips'
import { SlideOver } from '@/components/SlideOver'
import { requirementLabels } from '@/lib/workerRequirements'
import { modalGrid } from '@/lib/formGrid'
import { localIsoDate } from '@/lib/dateOnly'
import { addDays } from '@/lib/planQuote'
import { formatServiceDate } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { RATIO_LABELS, NIGHT_TYPE_LABELS } from '../lib/roster'
import { NO_LENGTH_MESSAGE, hasNoLength, oneHourAfter, refusalOf, type PanelRefusal } from '../lib/shiftTimes'

export type PatternSlideOverTarget =
  | { mode: 'create' }
  | { mode: 'edit'; pattern: ShiftPatternDto }

export type PatternSlideOverProps = {
  target: PatternSlideOverTarget | null
  onClose: () => void
  canWrite: boolean
  participantOptions: { value: string; label: string }[]
  staffOptions: { value: string; label: string }[]
  /** For a pattern an agreement made: the days of its block (the page reads them from its list), so a change can be made to every day of it at once. */
  blockDays?: string[]
}

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  .map(d => ({ value: d, label: d }))

/** Normalises a TimeOnly string ("HH:mm:ss" or "HH:mm") to the "HH:mm" a <input type="time"> needs. */
function toTimeInputValue(time: string | undefined): string {
  return (time ?? '09:00').slice(0, 5)
}

/** The pattern as it is stored, in the shape the PUT takes: what its own fields (default staff, notes) are saved with while a change to the agreement waits for approval. */
function storedDefinition(pattern: ShiftPatternDto): CreateShiftPatternDto {
  return {
    participantId: pattern.participantId, defaultStaffId: pattern.defaultStaffId, dayOfWeek: pattern.dayOfWeek, startTime: toTimeInputValue(pattern.startTime), endTime: toTimeInputValue(pattern.endTime),
    endsNextDay: pattern.endsNextDay, ratio: pattern.ratio, nightType: pattern.nightType, effectiveFrom: pattern.effectiveFrom, effectiveTo: pattern.effectiveTo ?? null, isActive: pattern.isActive, notes: pattern.notes,
  }
}

/** "Price from Mon 19 Oct 2026 to Sun 20 Dec 2026: $7,358.00 as it is at today's prices, $7,725.90 with the change (+$367.90)." The server's figures, over the change's own dates: the old one is the revision's blocks priced now, not what it bills. */
function priceLine(change: PatternChangeResultDto): string {
  return `Price from ${formatServiceDate(change.agreementStartDate)} to ${formatServiceDate(change.agreementEndDate)}: ${formatCurrency(change.oldTotal)} as it is at today's prices, ${formatCurrency(change.newTotal)} with the change (${change.difference > 0 ? '+' : ''}${formatCurrency(change.difference)}).`
}

/**
 * Create/edit slide-over for a weekly shift pattern. Mirrors ShiftSlideOver's shape exactly
 * (a SlideOver, delete-inside-the-panel-on-edit). Deliberately has no "Active"
 * toggle — deactivation is its own guarded action from the patterns table (ConfirmDialog,
 * explaining that it stops future generation without touching shifts already generated), not a
 * field buried in this form.
 */
export function PatternSlideOver({ target, onClose, canWrite, participantOptions, staffOptions, blockDays }: PatternSlideOverProps) {
  const open = target !== null

  const isEdit = target?.mode === 'edit'
  const existing = target?.mode === 'edit' ? target.pattern : undefined

  const [participantId, setParticipantId] = useState(existing?.participantId ?? '')
  const [defaultStaffId, setDefaultStaffId] = useState<string | null>(existing?.defaultStaffId ?? null)
  const [dayOfWeek, setDayOfWeek] = useState(existing?.dayOfWeek ?? 'Monday')
  const [startTime, setStartTime] = useState(toTimeInputValue(existing?.startTime))
  // A new pattern opens with an end an hour after the start, so it opens with a length (09:00 gives 10:00); an existing one keeps its own.
  const [endTime, setEndTime] = useState(existing?.endTime ? toTimeInputValue(existing.endTime) : oneHourAfter(toTimeInputValue(existing?.startTime)))
  const [endsNextDay, setEndsNextDay] = useState(existing?.endsNextDay ?? false)
  const [ratio, setRatio] = useState<SupportRatio>(existing?.ratio ?? 'OneToOne')
  const [nightType, setNightType] = useState<SleepoverType>(existing?.nightType ?? 'None')
  const [effectiveFrom, setEffectiveFrom] = useState(existing?.effectiveFrom ?? '')
  const [effectiveTo, setEffectiveTo] = useState(existing?.effectiveTo ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<PanelRefusal | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isAgreement = !!existing?.sourceDraftId
  // A change to an agreement pattern starts tomorrow, or on the agreement's own first day when that is later (the server holds both to the provider's today).
  const [fromDate, setFromDate] = useState(() => {
    const tomorrow = addDays(localIsoDate(), 1)
    return existing?.effectiveFrom && existing.effectiveFrom > tomorrow ? existing.effectiveFrom : tomorrow
  })
  const [allDays, setAllDays] = useState(false)
  // The server's check of a change, kept with the change it was for: any edit after it asks for a new check.
  const [checked, setChecked] = useState<{ key: string; result: PatternChangeResultDto } | null>(null)
  const [saved, setSaved] = useState<PatternChangeResultDto | null>(null)

  // Unsaved edits: the form as it is now against the form as it first rendered. The page keys this component on the target,
  // so "first render" is the moment the panel opened.
  const current = JSON.stringify([participantId, defaultStaffId, dayOfWeek, startTime, endTime, endsNextDay, ratio, nightType, effectiveFrom, effectiveTo, notes])
  const [opened] = useState(current)
  const dirty = current !== opened
  // What the agreement sets is the day, the times, the ratio and the kind of night (its dates are read-only here): a change to one of those is a change to the agreement. Who does the shifts, and the
  // notes, are the coordinator's own.
  const definition = JSON.stringify([dayOfWeek, startTime, endTime, endsNextDay, ratio, nightType])
  const [openedDefinition] = useState(definition)
  const changing = isAgreement && definition !== openedDefinition
  const changeKey = JSON.stringify([definition, allDays, fromDate])
  const preview = checked?.key === changeKey ? checked.result : null

  // The message sits under the last field of a form that scrolls, so a refused save (the "already has a pattern for that day" one included) would otherwise look like nothing happened.
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])
  // The notice sits at the top of a panel that scrolls, and the field that caused it can be far below (on a phone a changed Ratio): when it appears it is brought into view, and only if it is not already.
  const noticeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (changing) noticeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [changing])

  const createPattern = useCreatePattern()
  const updatePattern = useUpdatePattern()
  const deletePattern = useDeletePattern()
  const changePattern = usePatternChange()

  if (!open) return null

  // The version when the server knows it, never a placeholder.
  const source = existing?.sourceDraftVersion !== undefined ? `agreement v${existing.sourceDraftVersion}` : 'an agreement'
  const isBusy = createPattern.isPending || updatePattern.isPending || changePattern.isPending
  const nextRevision = preview ? `revision v${preview.version}` : existing?.sourceDraftVersion !== undefined ? `revision v${existing.sourceDraftVersion + 1}` : 'a new revision'
  const canSave = !!participantId && !!effectiveFrom && !!startTime && !!endTime
  // The length is said under End time, where the person is looking: by the form's own rule, and by the server's 400 for it (the backstop), recognised by its code (with the sentence as the fallback) and said
  // in the server's own words. Never as the alert at the foot.
  const lengthError = hasNoLength(startTime, endTime, endsNextDay) ? NO_LENGTH_MESSAGE : error?.noLength ? error.message : undefined
  // A save's refusal for the length is about the times it was for: changing one ends it.
  const clearLengthRefusal = () => setError(previous => (previous?.noLength ? null : previous))

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
      setError(refusalOf(err, 'Something went wrong saving this pattern. Please try again.'))
    }
  }


  // The change as the server takes it (POST .../pattern-change): the pattern, its new day, times, ratio and night type, every day of its block or this one, and from when.
  const change = (asPreview: boolean) => ({
    participantId, draftId: existing!.sourceDraftId!,
    data: { patternId: existing!.id, dayOfWeek, startTime, endTime, endsNextDay, ratio, nightType, allDays, fromDate, preview: asPreview },
  })

  async function handleCheck() {
    setError(null)
    try {
      setChecked({ key: changeKey, result: await changePattern.mutateAsync(change(true)) })
    } catch (err: unknown) {
      setError(refusalOf(err, 'Something went wrong checking this change. Please try again.'))
    }
  }

  async function handleCreate() {
    if (!existing) return
    setError(null)
    try {
      // The regular and notes are the pattern's own and save on it now, with the times the agreement set; the new times wait for the revision's approval.
      if (defaultStaffId !== existing.defaultStaffId || notes !== (existing.notes ?? '')) {
        await updatePattern.mutateAsync({ id: existing.id, data: { ...storedDefinition(existing), defaultStaffId, notes: notes.trim() || null } })
      }
      setSaved(await changePattern.mutateAsync(change(false)))
    } catch (err: unknown) {
      setError(refusalOf(err, 'Something went wrong saving this change. Please try again.'))
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
        dirty={dirty && !saved}
        bodyClassName="flex flex-col gap-[var(--field-gap-y)]"
        footerClassName="flex items-center justify-between gap-3"
        footer={canWrite ? (saved ? (
          <>
            <span />
            <Button onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            {/* An agreement's pattern ends through the agreement (the server refuses its delete): only a hand-made one offers Delete. */}
            {isEdit && !isAgreement ? (
              <Button variant="ghost-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {changing ? (
                <Button onClick={preview ? handleCreate : handleCheck} disabled={isBusy || !canSave || !fromDate}>
                  {isBusy ? (preview ? 'Saving…' : 'Checking…') : preview ? `Create ${nextRevision}` : 'Check the change'}
                </Button>
              ) : (
                <Button onClick={handleSave} disabled={isBusy || !canSave}>
                  {isBusy ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          </>
        )) : undefined}
      >
        {saved ? (
          <Callout tone="success" title={`Revision v${saved.version} saved`} actions={<Button variant="secondary" size="sm" to={`/participants/${participantId}/agreement-draft`}>Open the revision</Button>}>
            {`It starts on ${formatServiceDate(saved.agreementStartDate)}. ${priceLine(saved)} The pattern and the roster change when it is approved.`}
          </Callout>
        ) : isAgreement && (changing ? (
          <div ref={noticeRef} className="flex flex-col gap-[var(--field-gap-y)]">
            <Callout tone="info" actions={
              // A new tab: the change being typed here is not lost (the panel has no route guard), as the approval dialog's roster link does it.
              <Link to={`/participants/${participantId}/agreement-draft`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
                Open the agreement<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            }>
              <p>{`This changes the service agreement. Saving creates ${nextRevision} from ${formatServiceDate(preview?.agreementStartDate ?? fromDate)}, re-priced, for approval.`}</p>
              {preview && <p>{priceLine(preview)}</p>}
              {preview?.needsReview && <p>The revision needs a look in the agreement before it can be approved.</p>}
              {/* The regular saves on this pattern now (handleCreate); the changed pattern the approval makes starts with none (D10). */}
              {defaultStaffId !== (existing?.defaultStaffId ?? null) && <p>The regular is saved on the current pattern now. After approval, set it on the changed pattern.</p>}
            </Callout>
            <div className={modalGrid}>
              <FormField label="Change starts" required hint="The new revision runs from this day to the end of the agreement.">
                <input type="date" value={fromDate} disabled={!canWrite} onChange={e => setFromDate(e.target.value)} />
              </FormField>
            </div>
            {blockDays && blockDays.length > 1 && (
              <FormField label={`Change every day of this support (${blockDays.map(day => day.slice(0, 3)).join(', ')})`} layout="checkbox">
                <input type="checkbox" checked={allDays} disabled={!canWrite} onChange={e => setAllDays(e.target.checked)} />
              </FormField>
            )}
          </div>
        ) : <p role="status" className="text-sm text-[var(--color-muted-foreground)]">{`From ${source}.`}</p>)}
        {!saved && (<>
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

        <FormField label="Regular" hint="Goes on every shift this pattern makes. Leave unassigned to make open shifts.">
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
            <input type="time" value={startTime} disabled={!canWrite} onChange={e => { setStartTime(e.target.value); clearLengthRefusal() }} />
          </FormField>
          <FormField label="End time" required error={lengthError}>
            <input type="time" value={endTime} disabled={!canWrite} onChange={e => { setEndTime(e.target.value); clearLengthRefusal() }} />
          </FormField>
        </div>

        <FormField label="Ends the next day" layout="checkbox">
          <input type="checkbox" checked={endsNextDay} disabled={!canWrite} onChange={e => { setEndsNextDay(e.target.checked); clearLengthRefusal() }} />
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
          <FormField label="Effective from" required hint={isAgreement ? 'Set by the agreement.' : undefined}>
            <input type="date" value={effectiveFrom} disabled={!canWrite || isAgreement} onChange={e => setEffectiveFrom(e.target.value)} />
          </FormField>
          <FormField label="Effective to" hint={isAgreement ? 'Set by the agreement.' : 'Leave blank for no end date.'}>
            <input type="date" value={effectiveTo} disabled={!canWrite || isAgreement} onChange={e => setEffectiveTo(e.target.value)} />
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea rows={3} value={notes} disabled={!canWrite} onChange={e => setNotes(e.target.value)} placeholder="Optional notes for this pattern" />
        </FormField>

        {error && !error.noLength && (
          <Callout ref={errorRef} tone="error" className="scroll-mb-[var(--card-pad)]">{error.message}</Callout>
        )}
        </>)}
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
