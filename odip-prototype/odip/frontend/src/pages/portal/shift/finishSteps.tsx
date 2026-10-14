import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flag } from 'lucide-react'
import { useDeleteBreak, useEditBreak, useEndBreak, useShiftNotes } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FactList, type FactListItem } from '@/components/FactList'
import { formatWithTimeZone } from '@/lib/utils'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import type { ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'
import { formatMinutesSpan } from '@/pages/rostering/lib/roster'
import { rosteredInstants } from '../lib/portal'
import { dosesSummary, type FinishStepKey } from './checklist'
import { PrnRow, RoutineRow } from './DuringSection'
import { minutesBetween, providerLocalToUtcInstant, utcInstantToProviderLocal } from './shiftTime'
import { Fold } from './ui'
import type { DoseTarget } from './DoseSheet'
import type { EndDraft } from './endDraft'
import type { PortalFinishBlockerDto, PortalShiftDetailDto, ShiftBreakDto, ShiftNoteDto } from '@/api/types'

const HANDOVER_MAX = 2000
const fieldClass = 'w-full px-3 py-2 min-h-[44px] rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]'
const clock = (iso: string, tz: string) => formatWithTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit' })

/** A submit the server refused, with the step that can fix it (stepForCode). */
export type Refusal = { message: string; step: FinishStepKey | null }

export function BreakRow({ shift, brk, online }: { shift: PortalShiftDetailDto; brk: ShiftBreakDto; online: boolean }) {
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
            {brk.isRunning && <Button id={`brk-end-now-${brk.id}`} size="lg" onClick={endNow} disabled={end.isPending || !online}>End break</Button>}
            <Button id={`brk-edit-${brk.id}`} size="lg" variant="secondary" onClick={open} disabled={!online}>Edit</Button>
            <Button size="lg" variant="ghost-danger" onClick={remove} disabled={del.isPending || !online}>Remove</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{error}</p>}
    </li>
  )
}

export function FlaggedNotePrompt({ shift, note, onLeave }: { shift: PortalShiftDetailDto; note: ShiftNoteDto; onLeave: () => void }) {
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
      returnTo: `/portal/shifts/${shift.id}`,
    }
    onLeave()
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

/** Step 1, Your times (SHAPE §4): the recorded start, the finish (when you submit), the breaks, editable here, and the time worked. */
export function TimesStep({ shift, online, now }: { shift: PortalShiftDetailDto; online: boolean; now: Date }) {
  const tz = shift.timeZoneId
  const c = shift.completion
  const rostered = rosteredInstants(shift)
  const breakMinutes = shift.breaks.reduce((sum, b) => sum + b.minutes, 0)
  const worked = c ? Math.max(0, minutesBetween(c.actualStart, now.toISOString()) - breakMinutes) : 0
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-sm text-[var(--color-muted-foreground)]">Started</p>
          <p className="text-xl font-bold tabular-nums">{c ? clock(c.actualStart, tz) : 'Not recorded'}</p>
          {rostered.start && <p className="text-xs text-[var(--color-muted-foreground)]">Rostered {clock(rostered.start, tz)}</p>}
        </div>
        <div className="space-y-1">
          <p className="text-sm text-[var(--color-muted-foreground)]">Finished</p>
          <p className="text-xl font-bold">When you submit</p>
          <p className="text-sm">now {clock(now.toISOString(), tz)}</p>
          {rostered.end && <p className="text-xs text-[var(--color-muted-foreground)]">Rostered {clock(rostered.end, tz)}</p>}
        </div>
      </div>
      <section aria-labelledby="finish-breaks" className="space-y-2">
        <h3 id="finish-breaks" className="text-sm font-semibold">Breaks</h3>
        {shift.breaks.length === 0
          ? <p className="text-sm text-[var(--color-muted-foreground)]">No breaks taken.</p>
          : <ul className="space-y-2">{shift.breaks.map(b => <BreakRow key={b.id} shift={shift} brk={b} online={online} />)}</ul>}
      </section>
      <p className="text-sm">Time worked <span className="font-semibold tabular-nums">{formatMinutesSpan(worked)}</span></p>
    </div>
  )
}

/** Step 2, Doses & routines (SHAPE §4): what needs an outcome (the server's blockers), routines not ticked (shown, never blocking), as-needed medicines. */
export function DosesStep({ shift, online, canAct, onRecord }: {
  shift: PortalShiftDetailDto; online: boolean; canAct: boolean; onRecord: (t: DoseTarget, notGiven: boolean) => void
}) {
  const missing = shift.finishBlockers.filter(b => b.code === 'DOSE_OUTCOME_MISSING')
  const unticked = shift.shiftRoutines.filter(r => !r.isChecked)   // the server lists critical routines first
  const summary = dosesSummary(shift.medicationsDue, shift.shiftRoutines)
  const canRecord = canAct && online && shift.canRecordDoses
  function open(b: PortalFinishBlockerDto, notGiven: boolean) {
    const slot = shift.medicationsDue.find(d => d.medicationId === b.medicationId && d.scheduledAt === b.scheduledAt)
    if (slot) onRecord({ kind: 'slot', slot }, notGiven)
  }
  return (
    <div className="space-y-4">
      {missing.length === 0 && unticked.length === 0 && shift.prn.length === 0 && <p className="text-sm">Nothing due this shift.</p>}
      {missing.length > 0 && (
        <section aria-labelledby="finish-missing" className="space-y-2">
          <h3 id="finish-missing" className="text-sm font-semibold">Needs an outcome</h3>
          <ul className="space-y-2">
            {missing.map((b, i) => (
              <li key={`${b.medicationId}-${b.scheduledAt}`} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                <p>{b.message}</p>
                {canAct && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button id={`dose-blocker-${i}`} size="lg" onClick={() => open(b, false)} disabled={!online || !shift.canRecordDoses}>Record it</Button>
                    <Button size="lg" variant="secondary" onClick={() => open(b, true)} disabled={!online || !shift.canRecordDoses}>Not given this shift</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {unticked.length > 0 && (
        <section aria-labelledby="finish-routines" className="space-y-2">
          <h3 id="finish-routines" className="text-sm font-semibold">Routines not ticked</h3>
          <p className="text-sm text-[var(--color-muted-foreground)]">These don't stop you finishing. Tick any you did.</p>
          <ul className="space-y-2">{unticked.map(r => <RoutineRow key={r.id} routine={r} shiftId={shift.id} canAct={canAct} online={online} />)}</ul>
        </section>
      )}
      {shift.prn.length > 0 && (
        <section aria-labelledby="finish-prn" className="space-y-2">
          <h3 id="finish-prn" className="text-sm font-semibold">Did you give an as-needed medicine?</h3>
          <Fold summary={`As needed · ${shift.prn.length} medicine${shift.prn.length === 1 ? '' : 's'}`}>
            <ul className="space-y-2">
              {shift.prn.map(prn => <PrnRow key={prn.medicationId} prn={prn} tz={shift.timeZoneId} canAct={canRecord} onRecord={t => onRecord(t, false)} />)}
            </ul>
          </Fold>
        </section>
      )}
      {summary && <p className="text-sm text-[var(--color-muted-foreground)]">{summary}</p>}
    </div>
  )
}

/** Step 3, Anything to report? (SHAPE §4): optional. Yes leaves for the incident form; a flagged note keeps its own Report incident. */
export function ReportStep({ shift, answer, onYes, onNo, onLeave }: {
  shift: PortalShiftDetailDto; answer: EndDraft['anythingToReport']; onYes: () => void; onNo: () => void; onLeave: () => void
}) {
  const { data: notes } = useShiftNotes(shift.id)
  const flagged = (notes ?? []).filter(n => n.flaggedCategories.length > 0 && !n.flagsAcknowledgedAt && !n.incidentId)
  return (
    <div className="space-y-3">
      <p className="text-sm">An injury, a fall, a near miss, a complaint, or anything that worried you.</p>
      {flagged.map(n => <FlaggedNotePrompt key={n.id} shift={shift} note={n} onLeave={onLeave} />)}
      {answer === 'yes' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p>You said yes and opened the incident form.</p>
          <Button variant="ghost" size="md" onClick={onYes}>Open the form again</Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <Button size="lg" variant="secondary" className="w-full" onClick={onYes}>Yes, report it</Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={onNo}>No, nothing to report</Button>
        </div>
      )}
    </div>
  )
}

/**
 * Step 4, Note & handover (SHAPE §4): the notes count with a way to the Notes tab, "Nothing to note" while there are none, and the handover.
 * The notes themselves stay in the Notes panel, mounted behind the flow, so a note half-typed there is never lost and never doubled (plan check S1).
 */
export function HandoverStep({ noteCount, draft, set, onEditNotes }: {
  noteCount: number; draft: EndDraft; set: (patch: Partial<EndDraft>) => void; onEditNotes: () => void
}) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="finish-notes" className="space-y-2">
        <h3 id="finish-notes" className="text-sm font-semibold">Your notes</h3>
        <p className="text-sm">{noteCount > 0 ? `${noteCount} note${noteCount === 1 ? '' : 's'} on this shift.` : 'No notes yet.'}</p>
        <Button variant="secondary" size="md" onClick={onEditNotes}>Add or edit notes</Button>
        {noteCount === 0 && (
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input type="checkbox" checked={draft.nothingToNote} onChange={e => set({ nothingToNote: e.target.checked })} />
            Nothing to note
          </label>
        )}
      </section>
      <section aria-labelledby="finish-handover" className="space-y-2">
        <h3 id="finish-handover" className="text-sm font-semibold">Handover for the next worker</h3>
        <label htmlFor="handover-text" className="sr-only">Your handover note</label>
        <textarea
          id="handover-text" rows={4} maxLength={HANDOVER_MAX} className={fieldClass}
          value={draft.handoverText} disabled={draft.nothingToHandOver} onChange={e => set({ handoverText: e.target.value })}
        />
        <p className="text-xs text-[var(--color-muted-foreground)]">{draft.handoverText.length} of {HANDOVER_MAX}</p>
        <label className="flex items-center gap-2 text-sm min-h-[44px]">
          <input type="checkbox" checked={draft.nothingToHandOver} onChange={e => set(e.target.checked ? { nothingToHandOver: true, handoverText: '' } : { nothingToHandOver: false })} />
          Nothing to hand over
        </label>
      </section>
    </div>
  )
}

/** Step 5, Check and submit (SHAPE §4): what will be sent, grouped by step with a way back to each, then the server's answer if it refused. */
export function SubmitStep({ shift, draft, noteCount, now, refusals, go }: {
  shift: PortalShiftDetailDto; draft: EndDraft; noteCount: number; now: Date; refusals: Refusal[]; go: (step: FinishStepKey) => void
}) {
  const tz = shift.timeZoneId
  const c = shift.completion
  const breakMinutes = shift.breaks.reduce((sum, b) => sum + b.minutes, 0)
  const worked = c ? Math.max(0, minutesBetween(c.actualStart, now.toISOString()) - breakMinutes) : 0
  const handover = draft.handoverText.trim()
  const groups: { step: FinishStepKey; title: string; items: FactListItem[] }[] = [
    { step: 'times', title: 'Times', items: [
      { label: 'Started', value: c ? clock(c.actualStart, tz) : null },
      { label: 'Finishing', value: 'When you submit' },
      { label: 'Breaks', value: `${shift.breaks.length}, ${breakMinutes} min` },
      { label: 'Time worked', value: formatMinutesSpan(worked) },
    ] },
    { step: 'doses', title: 'Doses and routines', items: [{ label: 'Recorded', value: dosesSummary(shift.medicationsDue, shift.shiftRoutines) || 'Nothing due' }] },
    { step: 'report', title: 'Report', items: [{ label: 'Anything to report', value: draft.anythingToReport === 'yes' ? 'Yes' : draft.anythingToReport === 'no' ? 'No' : 'Not answered' }] },
    { step: 'handover', title: 'Notes and handover', items: [
      { label: 'Notes', value: noteCount > 0 ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : 'Nothing to note' },
      { label: 'Handover', value: draft.nothingToHandOver || !handover ? 'Nothing to hand over' : handover.split('\n')[0] },
    ] },
  ]
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <section key={g.step} aria-labelledby={`finish-check-${g.step}`} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`finish-check-${g.step}`} className="text-sm font-semibold">{g.title}</h3>
            <Button variant="ghost" size="md" onClick={() => go(g.step)} aria-label={`Change: ${g.title}`}>Change</Button>
          </div>
          <FactList items={g.items} />
        </section>
      ))}
      <p className="text-sm">A coordinator reviews your shift next. You can still add notes after you submit.</p>
      {refusals.length > 0 && (
        <Callout tone="info" title="You can't submit yet">
          <ul className="space-y-1">
            {refusals.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                {r.message}
                {r.step && <Button variant="ghost" size="md" onClick={() => go(r.step!)}>Go to step</Button>}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  )
}
