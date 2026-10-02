import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Circle, Flag } from 'lucide-react'
import { useDeleteBreak, useEditBreak, useEndBreak, useFinishShift, useShiftNotes } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { formatWithTimeZone } from '@/lib/utils'
import { SHIFT_PACKAGE_ERROR_CODES } from '@/api/types'
import { apiErrorMessages, apiErrorStatus, finishBlockersFromError, hasApiErrorCode, shiftDetailFromError } from '@/lib/shiftPackageErrors'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import type { ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'
import { breaksSignature, endChecklist } from './checklist'
import { clearEndDraft, loadEndDraft, saveEndDraft } from './endDraft'
import { requestGeolocation } from './geolocation'
import { minutesBetween, providerLocalToUtcInstant, utcInstantToProviderLocal } from './shiftTime'
import { Section } from './ui'
import type { DoseTarget } from './DoseSheet'
import type { PortalFinishBlockerDto, PortalShiftDetailDto, ShiftBreakDto, ShiftNoteDto } from '@/api/types'

const HANDOVER_MAX = 2000
const fieldClass = 'w-full px-3 py-2 min-h-[44px] rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]'

function BreakRow({ shift, brk, online }: { shift: PortalShiftDetailDto; brk: ShiftBreakDto; online: boolean }) {
  const tz = shift.timeZoneId
  const edit = useEditBreak()
  const del = useDeleteBreak()
  const end = useEndBreak()
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState('')
  const [stop, setStop] = useState('')
  const [error, setError] = useState<string | null>(null)

  function open() {
    setStart(utcInstantToProviderLocal(brk.startedAt, tz))
    setStop(brk.endedAt ? utcInstantToProviderLocal(brk.endedAt, tz) : '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    // The two controls hold provider-zone digits; the API wants instants, so convert with the provider zone and send with Z.
    const startedAt = providerLocalToUtcInstant(start, tz)
    const endedAt = stop ? providerLocalToUtcInstant(stop, tz) : null
    if (!startedAt || (stop && !endedAt)) { setError('Enter the break times.'); return }
    if (brk.endedAt && !endedAt) { setError('A finished break needs an end time.'); return }
    setError(null)
    try {
      await edit.mutateAsync({ id: shift.id, breakId: brk.id, data: { startedAt, endedAt } })
      setEditing(false)
    } catch (err) {
      setError(apiErrorMessages(err)[0] ?? "Couldn't save the break. Your times are kept. Try again.")
    }
  }

  async function remove() {
    setError(null)
    try { await del.mutateAsync({ id: shift.id, breakId: brk.id }) }
    catch (err) { setError(apiErrorMessages(err)[0] ?? "Couldn't remove the break. Try again.") }
  }

  async function endNow() {
    setError(null)
    try { await end.mutateAsync({ id: shift.id, breakId: brk.id }) }
    catch (err) { setError(apiErrorMessages(err)[0] ?? "Couldn't end the break. Try again.") }
  }

  const range = `${formatWithTimeZone(brk.startedAt, tz, { hour: 'numeric', minute: '2-digit' })} to ${brk.endedAt ? formatWithTimeZone(brk.endedAt, tz, { hour: 'numeric', minute: '2-digit' }) : 'now'}`
  return (
    <li className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="text-sm font-medium" htmlFor={`brk-start-${brk.id}`}>Break started</label>
            <input id={`brk-start-${brk.id}`} type="datetime-local" className={fieldClass} value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor={`brk-end-${brk.id}`}>Break ended</label>
            <input id={`brk-end-${brk.id}`} type="datetime-local" className={fieldClass} value={stop} onChange={e => setStop(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="lg" onClick={save} disabled={edit.isPending || !online}>{edit.isPending ? 'Saving…' : 'Save break'}</Button>
            <Button size="lg" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p>{range}, {brk.minutes} min{brk.isRunning ? ' so far' : ''}{brk.editedAt ? ' (edited)' : ''}</p>
          <div className="flex gap-2">
            {brk.isRunning && <Button size="lg" onClick={endNow} disabled={end.isPending || !online}>End break</Button>}
            <Button size="lg" variant="secondary" onClick={open} disabled={!online}>Edit</Button>
            <Button size="lg" variant="ghost-danger" onClick={remove} disabled={del.isPending || !online}>Remove</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{error}</p>}
    </li>
  )
}

function FlaggedNotePrompt({ shift, note }: { shift: PortalShiftDetailDto; note: ShiftNoteDto }) {
  const navigate = useNavigate()
  const { id: currentUserId } = usePermissions()
  function report() {
    const prefill: ShiftNoteIncidentPrefillState = {
      source: 'shift-note',
      shiftNoteId: note.id,
      categories: note.flaggedCategories as ShiftNoteFlagCategory[],
      participantId: shift.participant.id,
      participantName: shift.participant.fullName,
      noteBody: note.body,
      serviceDate: shift.serviceDate,
      startTime: shift.startTime,
      endTime: shift.endTime,
      endsNextDay: shift.endsNextDay,
      reportedByUserId: currentUserId,
      shiftId: shift.id,
    }
    navigate('/incidents/new', { state: prefill })
  }
  return (
    <Callout
      tone="info"
      icon={Flag}
      actions={<Button size="lg" variant="secondary" onClick={report}>Report incident</Button>}
    >
      A note mentions {formatFlaggedCategoryList(note.flaggedCategories as ShiftNoteFlagCategory[])}. You can report an incident now, with the note filled in.
    </Callout>
  )
}

/**
 * End: a checklist that must clear before Finish (doses, breaks, a note, the handover), then a read-only summary and Finish. The doses and
 * the running-break rule come from the server's `finishBlockers`; a 422 lists the server's blocker messages as given.
 */
export function EndSection({ shift, online, canAct, onRecord }: {
  shift: PortalShiftDetailDto
  online: boolean
  canAct: boolean
  onRecord: (t: DoseTarget, notGiven: boolean) => void
}) {
  const qc = useQueryClient()
  const finish = useFinishShift()
  const { data: notes } = useShiftNotes(shift.id)
  const [draft] = useState(() => loadEndDraft(shift.id))
  const [confirmedSig, setConfirmedSig] = useState<string | null>(draft?.confirmedSig ?? null)
  const sig = breaksSignature(shift.breaks)
  // The tick belongs to the breaks as they were when it was made; any edit, removal or new break drops it.
  const breaksConfirmed = confirmedSig === sig
  const [nothingToNote, setNothingToNote] = useState(draft?.nothingToNote ?? false)
  const [handoverText, setHandoverText] = useState(draft?.handoverText ?? '')
  const [nothingToHandOver, setNothingToHandOver] = useState(draft?.nothingToHandOver ?? false)
  const [blockers, setBlockers] = useState<PortalFinishBlockerDto[]>([])
  const [finishError, setFinishError] = useState<string | null>(null)

  // Keep the inputs so leaving for Report incident and coming back loses nothing.
  useEffect(() => {
    saveEndDraft(shift.id, { handoverText, nothingToNote, nothingToHandOver, confirmedSig })
  }, [shift.id, handoverText, nothingToNote, nothingToHandOver, confirmedSig])

  const noteCount = notes?.length ?? 0
  const items = endChecklist({ blockers: shift.finishBlockers, breaksConfirmed, noteCount, nothingToNote, handoverText, nothingToHandOver })
  const allDone = items.every(i => i.done)
  const doseBlockers = shift.finishBlockers.filter(b => b.code === 'DOSE_OUTCOME_MISSING')
  const flagged = (notes ?? []).filter(n => n.flaggedCategories.length > 0 && !n.flagsAcknowledgedAt && !n.incidentId)

  const completion = shift.completion
  const now = new Date().toISOString()
  const elapsed = completion ? minutesBetween(completion.actualStart, now) : 0
  const breakMinutes = shift.breaks.reduce((sum, b) => sum + b.minutes, 0)
  const doseOutcomes = shift.medicationsDue.reduce<Record<string, number>>((acc, d) => {
    const key = d.outcome ? d.outcome.status : 'None'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  function openDose(blocker: PortalFinishBlockerDto, notGiven: boolean) {
    const slot = shift.medicationsDue.find(d => d.medicationId === blocker.medicationId && d.scheduledAt === blocker.scheduledAt)
    if (slot) onRecord({ kind: 'slot', slot }, notGiven)
  }

  async function submit() {
    setFinishError(null)
    setBlockers([])
    try {
      const geo = await requestGeolocation()
      await finish.mutateAsync({
        id: shift.id,
        data: {
          ...geo,
          handoverText: nothingToHandOver ? null : handoverText.trim() || null,
          nothingToHandOver,
          nothingToNote: noteCount === 0 && nothingToNote,
        },
      })
      clearEndDraft(shift.id)
    } catch (err) {
      const listed = finishBlockersFromError(err)
      if (listed.length) {
        setBlockers(listed)
        const fresh = shiftDetailFromError(err)
        if (fresh) qc.setQueryData(['portal-shift-detail', shift.id], fresh)
      } else if (hasApiErrorCode(err, SHIFT_PACKAGE_ERROR_CODES.noteRequired) || apiErrorStatus(err) !== undefined) {
        setFinishError(apiErrorMessages(err)[0] ?? "Couldn't finish this shift. Your entries are kept. Try again.")
      } else {
        setFinishError("Couldn't finish this shift. Check your connection. Your handover is kept: try again.")
      }
    }
  }

  return (
    <Section id="end" title="End of shift" icon={<Check className="w-4 h-4" aria-hidden="true" />}>
      <ul className="space-y-1" aria-label="Before you finish">
        {items.map(i => (
          <li key={i.id} className="flex items-center gap-2 text-sm">
            {i.done ? <Check className="w-4 h-4" aria-hidden="true" /> : <Circle className="w-4 h-4 text-[var(--color-muted-foreground)]" aria-hidden="true" />}
            <span>{i.label}</span>
            <span className="sr-only">{i.done ? ', done' : ', to do'}</span>
          </li>
        ))}
      </ul>

      {doseBlockers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Doses that need an outcome</h3>
          <ul className="space-y-2">
            {doseBlockers.map(b => (
              <li key={`${b.medicationId}-${b.scheduledAt}`} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                <p>{b.message}</p>
                {canAct && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button size="lg" onClick={() => openDose(b, false)} disabled={!online || !shift.canRecordDoses}>Record it</Button>
                    <Button size="lg" variant="secondary" onClick={() => openDose(b, true)} disabled={!online || !shift.canRecordDoses}>Not given this shift</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Breaks</h3>
        {shift.breaks.length === 0
          ? <p className="text-sm text-[var(--color-muted-foreground)]">No breaks taken.</p>
          : <ul className="space-y-2">{shift.breaks.map(b => <BreakRow key={b.id} shift={shift} brk={b} online={online} />)}</ul>}
        <label className="flex items-center gap-2 text-sm min-h-[44px]">
          <input type="checkbox" checked={breaksConfirmed} onChange={e => setConfirmedSig(e.target.checked ? sig : null)} />
          {shift.breaks.length === 0 ? 'I took no breaks' : 'My breaks are correct'}
        </label>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Notes</h3>
        <p className="text-sm text-[var(--color-muted-foreground)]">{noteCount > 0 ? `${noteCount} note${noteCount === 1 ? '' : 's'} added.` : 'No notes added yet. Use Add note above.'}</p>
        {noteCount === 0 && (
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input type="checkbox" checked={nothingToNote} onChange={e => setNothingToNote(e.target.checked)} />
            Nothing to note
          </label>
        )}
        {flagged.map(n => <FlaggedNotePrompt key={n.id} shift={shift} note={n} />)}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Handover for the next worker</h3>
        <label htmlFor="handover-text" className="sr-only">Your handover note</label>
        <textarea
          id="handover-text"
          rows={4}
          maxLength={HANDOVER_MAX}
          className={fieldClass}
          value={handoverText}
          disabled={nothingToHandOver}
          onChange={e => setHandoverText(e.target.value)}
        />
        <p className="text-xs text-[var(--color-muted-foreground)]">{handoverText.length} of {HANDOVER_MAX}</p>
        <label className="flex items-center gap-2 text-sm min-h-[44px]">
          <input
            type="checkbox"
            checked={nothingToHandOver}
            onChange={e => { setNothingToHandOver(e.target.checked); if (e.target.checked) setHandoverText('') }}
          />
          Nothing to hand over
        </label>
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Summary</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--color-muted-foreground)]">Started</dt>
          <dd>{completion ? formatWithTimeZone(completion.actualStart, shift.timeZoneId, { hour: 'numeric', minute: '2-digit' }) : 'Not recorded'}</dd>
          <dt className="text-[var(--color-muted-foreground)]">Ending</dt>
          <dd>{formatWithTimeZone(now, shift.timeZoneId, { hour: 'numeric', minute: '2-digit' })}</dd>
          <dt className="text-[var(--color-muted-foreground)]">Breaks</dt>
          <dd>{shift.breaks.length}, {breakMinutes} min</dd>
          <dt className="text-[var(--color-muted-foreground)]">Time worked</dt>
          <dd>{Math.max(0, elapsed - breakMinutes)} min</dd>
          <dt className="text-[var(--color-muted-foreground)]">Doses</dt>
          <dd>
            {shift.medicationsDue.length === 0
              ? 'None due'
              : `${doseOutcomes.Administered ?? 0} given, ${doseOutcomes.Refused ?? 0} refused, ${doseOutcomes.Withheld ?? 0} withheld, ${doseOutcomes.Missed ?? 0} not given`}
          </dd>
          <dt className="text-[var(--color-muted-foreground)]">Notes</dt>
          <dd>{noteCount}</dd>
        </dl>
      </div>

      {blockers.length > 0 && (
        <Callout tone="info" title="You can't finish yet">
          <ul className="list-disc pl-5">{blockers.map((b, i) => <li key={`${b.code}-${i}`}>{b.message}</li>)}</ul>
        </Callout>
      )}
      {finishError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{finishError}</p>}
      {canAct && (
        <Button size="lg" onClick={submit} disabled={!allDone || finish.isPending || !online} className="w-full sm:w-auto">
          {finish.isPending ? 'Finishing…' : finishError ? 'Try again' : 'Finish shift'}
        </Button>
      )}
      {!allDone && <p className="text-xs text-[var(--color-muted-foreground)]">Clear the list above to finish.</p>}
    </Section>
  )
}
