import { useState } from 'react'
import { Flag } from 'lucide-react'
import { useDeleteBreak, useEditBreak, useEndBreak, useShiftNotes } from '@/api/hooks'
import { useQueueRecords } from '@/api/hooks/portal'
import { isStillTrying } from '@/lib/offline/queue'
import { waitingBreak } from '@/lib/offline/overlay'
import { fieldSurface } from '@/components/FormField'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FactList, type FactListItem } from '@/components/FactList'
import { formatWithTimeZone } from '@/lib/utils'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { formatMinutesSpan } from '@/pages/rostering/lib/roster'
import { rosteredInstants } from '../lib/portal'
import { breaksLabel, clockLabel, FINISH_STEPS, dosesSummary, REASON_MAX, timeBounds, type FinishStepKey, type TimesField } from './checklist'
import { PrnRow, RoutineRow } from './DuringSection'
import { minutesBetween, providerLocalToUtcInstant, utcInstantToProviderLocal } from './shiftTime'
import { Fold, WaitingToSend } from './ui'
import { plural } from '@/lib/format'
import type { DoseTarget } from './DoseSheet'
import type { EndDraft } from './endDraft'
import type { PortalFinishBlockerDto, PortalShiftDetailDto, ShiftBreakDto, ShiftNoteDto } from '@/api/types'

const HANDOVER_MAX = 2000
const fieldClass = `w-full py-2 min-h-[44px] text-sm ${fieldSurface}`
const clock = (iso: string, tz: string) => formatWithTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit' })

/** A submit the server refused, with the step that can fix it (stepForCode). */
export type Refusal = { message: string; step: FinishStepKey | null }

export function BreakRow({ shift, brk, online }: { shift: PortalShiftDetailDto; brk: ShiftBreakDto; online: boolean }) {
  const tz = shift.timeZoneId
  const edit = useEditBreak()
  const del = useDeleteBreak()
  const end = useEndBreak()
  const waiting = waitingBreak(useQueueRecords(), shift.id, brk.id)
  // A break still waiting to send is not on the server yet, so it cannot be edited or removed until it is.
  const locked = !online || !!waiting
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
          <p>{range}, {brk.minutes} min{brk.isRunning ? ' so far' : ''}{brk.editedAt ? ' (edited)' : ''}{waiting && <>&nbsp;<WaitingToSend stuck={isStillTrying(waiting)} /></>}</p>
          <div className="flex gap-2">
            {brk.isRunning && <Button id={`brk-end-now-${brk.id}`} size="lg" onClick={endNow} disabled={end.isPending}>End break</Button>}
            <Button id={`brk-edit-${brk.id}`} size="lg" variant="secondary" onClick={open} disabled={locked}>Edit</Button>
            <Button size="lg" variant="ghost-danger" onClick={remove} disabled={del.isPending || locked}>Remove</Button>
          </div>
        </div>
      )}
      {locked && !editing && <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Editing a break needs a connection.</p>}
      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{error}</p>}
    </li>
  )
}

/** A flagged note, as one line of context on step 3: "Yes, report it" files the incident from it, so there is one way to report (finish review fix 4). */
export function FlaggedNoteLine({ note }: { note: ShiftNoteDto }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      <Flag className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>A note mentions {formatFlaggedCategoryList(note.flaggedCategories as ShiftNoteFlagCategory[])}. Yes fills the report in from that note.</span>
    </p>
  )
}

/** One recorded time and its Change control (SHAPE §4, step 1): a datetime-local held to the server's window, the stamp to the minute ±15 or the end's 15 minutes. */
function TimeField({ label, figure, sub, rostered, tz, id, name, value, bounds, helper, invalid, onOpen, onChange, onReset }: {
  label: string; figure: string; sub?: string; rostered: string | null; tz: string
  id: string; name: 'start' | 'finish'; value: string | null; bounds: { min: string; max: string } | null; helper: string; invalid: boolean
  onOpen: () => void; onChange: (value: string) => void; onReset: () => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-[var(--color-muted-foreground)]">{label}</p>
      <p className="text-xl font-bold tabular-nums">{figure}</p>
      {sub && <p className="text-sm">{sub}</p>}
      {rostered && <p className="text-xs text-[var(--color-muted-foreground)]">Rostered {clock(rostered, tz)}</p>}
      {value === null ? (
        <Button variant="secondary" size="md" onClick={onOpen} disabled={!bounds} aria-label={`Change your ${name} time`}>Change</Button>
      ) : (
        <div className="space-y-1">
          <label htmlFor={id} className="sr-only">{`Your ${name} time`}</label>
          <input
            id={id} type="datetime-local" className={fieldClass} value={value} min={bounds?.min} max={bounds?.max}
            aria-describedby={`${id}-help`} aria-invalid={invalid || undefined} onChange={e => onChange(e.target.value)}
          />
          <p id={`${id}-help`} className="text-xs text-[var(--color-muted-foreground)]">{helper}</p>
          <Button variant="secondary" size="md" onClick={onReset} aria-label={`Use the recorded time for your ${name}`}>Use the recorded time</Button>
        </div>
      )}
    </div>
  )
}

/** Step 1, Your times (SHAPE §4): change either time by up to 15 minutes with a reason, correct the breaks, add kilometres. */
export function TimesStep({ shift, online, now, draft, set, invalid }: {
  shift: PortalShiftDetailDto; online: boolean; now: Date; draft: EndDraft; set: (patch: Partial<EndDraft>) => void; invalid?: TimesField
}) {
  const tz = shift.timeZoneId
  const c = shift.completion
  const rostered = rosteredInstants(shift)
  const b = c ? timeBounds(c.actualStart, tz, now) : null
  const first = shift.participant.fullName.split(' ')[0]
  const instant = (local: string | null) => (local ? providerLocalToUtcInstant(local, tz) : null)
  const startIso = instant(draft.startOverride) ?? c?.actualStart ?? null
  const endIso = instant(draft.endOverride) ?? now.toISOString()
  const breakMinutes = shift.breaks.reduce((sum, x) => sum + x.minutes, 0)
  const worked = startIso ? Math.max(0, minutesBetween(startIso, endIso) - breakMinutes) : 0
  const say = (local: string) => clockLabel(`${local}:00`)
  const muted = 'text-xs text-[var(--color-muted-foreground)]'

  return (
    <div className="space-y-4">
      <p className="text-sm">Check when you started and finished. You can change either by up to 15 minutes.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TimeField
          label="Started" figure={c ? clock(c.actualStart, tz) : 'Not recorded'} rostered={rostered.start} tz={tz}
          id="finish-start" name="start" value={draft.startOverride} bounds={b && b.start} invalid={invalid === 'start'}
          helper={b ? `Between ${say(b.start.min)} and ${say(b.start.max)}` : ''}
          onOpen={() => b && set({ startOverride: b.start.stamp })} onChange={v => set({ startOverride: v })} onReset={() => set({ startOverride: null })}
        />
        <TimeField
          label="Finished" figure="When you submit" sub={`now ${clock(now.toISOString(), tz)}`} rostered={rostered.end} tz={tz}
          id="finish-end" name="finish" value={draft.endOverride} bounds={b && b.end} invalid={invalid === 'end'}
          helper="Up to 15 minutes before you submit."
          onOpen={() => b && set({ endOverride: b.end.max })} onChange={v => set({ endOverride: v })} onReset={() => set({ endOverride: null })}
        />
      </div>
      {(draft.startOverride !== null || draft.endOverride !== null) && (
        <div className="space-y-1">
          <label htmlFor="finish-reason" className="text-sm font-medium">Why did your times change?</label>
          <p id="finish-reason-help" className={muted}>Your coordinator sees this.</p>
          <textarea
            id="finish-reason" rows={3} maxLength={REASON_MAX} className={fieldClass} aria-describedby="finish-reason-help"
            aria-invalid={invalid === 'reason' || undefined} value={draft.adjustmentReason} onChange={e => set({ adjustmentReason: e.target.value })}
          />
          <p className={muted}>{draft.adjustmentReason.length} of {REASON_MAX}</p>
        </div>
      )}
      <section aria-labelledby="finish-breaks" className="space-y-2">
        <h3 id="finish-breaks" className="text-sm font-semibold">Breaks</h3>
        {shift.breaks.length === 0
          ? <p className="text-sm text-[var(--color-muted-foreground)]">No breaks taken.</p>
          : <ul className="space-y-2">{shift.breaks.map(x => <BreakRow key={x.id} shift={shift} brk={x} online={online} />)}</ul>}
      </section>
      <p className="text-sm">Time worked <span className="font-semibold tabular-nums">{formatMinutesSpan(worked)}</span></p>
      <section aria-labelledby="finish-travel" className="space-y-1">
        <h3 id="finish-travel" className="text-sm font-semibold">Travel</h3>
        <label htmlFor="finish-km" className="text-sm font-medium">Kilometres driven with {first} (optional)</label>
        <p id="finish-km-help" className={muted}>Only driving with {first}, not your trip to or from the shift.</p>
        <input
          id="finish-km" inputMode="decimal" className={fieldClass} aria-describedby="finish-km-help"
          aria-invalid={invalid === 'kilometres' || undefined} value={draft.kilometres} onChange={e => set({ kilometres: e.target.value })}
        />
      </section>
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
          <ul className="divide-y divide-[var(--color-border)]">{unticked.map(r => <RoutineRow key={r.id} routine={r} shiftId={shift.id} canAct={canAct} />)}</ul>
        </section>
      )}
      {shift.prn.length > 0 && (
        <section aria-labelledby="finish-prn" className="space-y-2">
          <h3 id="finish-prn" className="text-sm font-semibold">Did you give an as-needed medicine?</h3>
          <Fold summary={`As needed · ${plural(shift.prn.length, 'medicine')}`}>
            <ul className="divide-y divide-[var(--color-border)]">
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
export function ReportStep({ shift, answer, onYes, onNo }: {
  shift: PortalShiftDetailDto; answer: EndDraft['anythingToReport']; onYes: (note?: ShiftNoteDto) => void; onNo: () => void
}) {
  const { data: notes } = useShiftNotes(shift.id)
  const flagged = (notes ?? []).filter(n => n.flaggedCategories.length > 0 && !n.flagsAcknowledgedAt && !n.incidentId)
  return (
    <div className="space-y-3">
      <p className="text-sm">An injury, a fall, a near miss, a complaint, or anything that worried you.</p>
      {flagged.map(n => <FlaggedNoteLine key={n.id} note={n} />)}
      {answer === 'yes' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p>You said yes and opened the incident form.</p>
          <Button variant="secondary" size="md" onClick={() => onYes(flagged[0])}>Open the form again</Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {answer === 'no' && <p className="text-sm">You said there's nothing to report.</p>}
          <Button size="lg" variant="secondary" className="w-full" onClick={() => onYes(flagged[0])}>Yes, report it</Button>
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
        <p className="text-sm">{noteCount > 0 ? `${plural(noteCount, 'note')} on this shift.` : 'No notes yet.'}</p>
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
export function SubmitStep({ shift, draft, noteCount, now, refusals, go, moved, kilometres, drifted, onUseSubmitTime, onChangeTimes }: {
  shift: PortalShiftDetailDto; draft: EndDraft; noteCount: number; now: Date; refusals: Refusal[]; go: (step: FinishStepKey) => void
  moved: { start: string | null; end: string | null }; kilometres: number | null; drifted: boolean; onUseSubmitTime: () => void; onChangeTimes: () => void
}) {
  const tz = shift.timeZoneId
  const c = shift.completion
  const breakMinutes = shift.breaks.reduce((sum, b) => sum + b.minutes, 0)
  const worked = c ? Math.max(0, minutesBetween(moved.start ?? c.actualStart, moved.end ?? now.toISOString()) - breakMinutes) : 0
  const handover = draft.handoverText.trim()
  const groups: { step: FinishStepKey; title: string; items: FactListItem[] }[] = [
    { step: 'times', title: 'Times', items: [
      { label: 'Started', value: c ? (moved.start ? `${clock(moved.start, tz)} (changed from ${clock(c.actualStart, tz)})` : clock(c.actualStart, tz)) : null },
      { label: 'Finishing', value: moved.end ? clock(moved.end, tz) : 'When you submit' },
      ...(moved.start || moved.end ? [{ label: 'Reason', value: draft.adjustmentReason.trim() }] : []),
      { label: 'Breaks', value: breaksLabel(shift.breaks.length, breakMinutes) },
      { label: 'Time worked', value: formatMinutesSpan(worked) },
      { label: 'Kilometres', value: kilometres === null ? 'None' : `${kilometres} km` },
    ] },
    { step: 'doses', title: 'Doses and routines', items: [{ label: 'Recorded', value: dosesSummary(shift.medicationsDue, shift.shiftRoutines) || 'Nothing due' }] },
    { step: 'report', title: 'Report', items: [{ label: 'Anything to report', value: draft.anythingToReport === 'yes' ? 'Yes' : draft.anythingToReport === 'no' ? 'No' : 'Not answered' }] },
    { step: 'handover', title: 'Notes and handover', items: [
      { label: 'Notes', value: noteCount > 0 ? plural(noteCount, 'note') : 'Nothing to note' },
      { label: 'Handover', value: draft.nothingToHandOver || !handover ? 'Nothing to hand over' : handover.split('\n')[0] },
    ] },
  ]
  return (
    <div className="space-y-4">
      {drifted && (
        <Callout
          tone="warning"
          title="Your finish time is now more than 15 minutes ago."
          actions={(
            <>
              <Button variant="secondary" size="md" onClick={onUseSubmitTime}>Use the time I submit</Button>
              <Button variant="ghost" size="md" onClick={onChangeTimes}>Change it</Button>
            </>
          )}
        />
      )}
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
      {/* scroll-margin: the bar (about 5.5rem with its padding) plus the phone nav plus 16px, so the whole callout clears the bar. */}
      {refusals.length > 0 && (
        <div id="finish-refusals" tabIndex={-1} className="focus:outline-none scroll-mb-[calc(var(--mobile-nav-h)+5.5rem)] lg:scroll-mb-[5.5rem]">
          <Callout tone="info" title="You can't submit yet">
            <ul className="space-y-1">
              {refusals.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  {r.message}
                  {r.step && <Button variant="secondary" size="lg" onClick={() => go(r.step!)}>Go to {FINISH_STEPS.find(s => s.key === r.step)!.label}</Button>}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      )}
    </div>
  )
}
