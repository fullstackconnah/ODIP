import { Car, Flag } from 'lucide-react'
import { useShiftNotes } from '@/api/hooks'
import { fieldSurface } from '@/components/FormField'
import { Button } from '@/components/Button'
import { formatWithTimeZone } from '@/lib/utils'
import { formatFlaggedCategoryList, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { minutesWords } from '../lib/portal'
import { breaksLabel, clockLabel, dosesSummary, HANDOVER_MAX, REASON_MAX, unpaidBreakMinutes, type TimesField } from './checklist'
import { PrnRow, RoutineRow } from './DuringSection'
import { utcInstantToProviderLocal } from './shiftTime'
import { Chip, Fold } from './ui'
import { plural } from '@/lib/format'
import type { DoseTarget } from './DoseSheet'
import type { EndDraft } from './endDraft'
import type { PortalFinishBlockerDto, PortalShiftDetailDto, ShiftNoteDto } from '@/api/types'

const fieldClass = `w-full py-2 min-h-[44px] text-sm ${fieldSurface}`
const muted = 'text-xs text-[var(--color-muted-foreground)]'
const CARD = 'bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 lg:p-5 space-y-3'
const clock = (iso: string, tz: string) => formatWithTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit' })

/** A submit the server refused, in the server's words. */
export type Refusal = { message: string }

/** The breaks, read only: once the shift has ended they are fixed by the coordinator (the same help line the old Breaks step carried). */
export function BreaksFold({ shift }: { shift: PortalShiftDetailDto }) {
  const tz = shift.timeZoneId
  const first = shift.participant.fullName.split(' ')[0]
  const withMinutes = shift.breaks.reduce((sum, b) => sum + (b.withParticipant ? b.minutes : 0), 0)
  const summary = `Breaks · ${breaksLabel(shift.breaks.length, unpaidBreakMinutes(shift.breaks) + withMinutes, withMinutes, first)}`
  return (
    <section className={CARD} aria-label="Breaks">
      <Fold summary={summary}>
        {shift.breaks.length > 0 && (
          <ul className="space-y-1 text-sm">
            {shift.breaks.map(b => (
              <li key={b.id}>{clock(b.startedAt, tz)} to {b.endedAt ? clock(b.endedAt, tz) : 'now'}, {b.minutes} min{b.withParticipant ? `, with ${first}` : ''}</li>
            ))}
          </ul>
        )}
        <p className={muted}>To fix a break, ask your coordinator.</p>
      </Fold>
    </section>
  )
}

/** A flagged note, as one line of context on "Anything to report?": "Yes, report it" files the incident from it, so there is one way to report (finish review fix 4). */
export function FlaggedNoteLine({ note }: { note: ShiftNoteDto }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      <Flag className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>A note mentions {formatFlaggedCategoryList(note.flaggedCategories as ShiftNoteFlagCategory[])}. Yes fills the report in from that note.</span>
    </p>
  )
}

/** One time's Change editor: a datetime-local held to the server's window, with the way back to the recorded or tapped time. */
function TimeEditor({ id, name, value, bounds, helper, invalid, resetLabel, onChange, onReset }: {
  id: string; name: 'start' | 'finish'; value: string; bounds: { min: string; max: string } | null; helper: string; invalid: boolean
  resetLabel: string; onChange: (value: string) => void; onReset: () => void
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="sr-only">{`Your ${name} time`}</label>
      <input
        id={id} type="datetime-local" className={fieldClass} value={value} min={bounds?.min} max={bounds?.max}
        aria-describedby={`${id}-help`} aria-invalid={invalid || undefined} onChange={e => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className={muted}>{helper}</p>
      <Button variant="secondary" size="md" onClick={onReset} aria-label={`${resetLabel} for your ${name}`}>{resetLabel}</Button>
    </div>
  )
}

const early = (m: number) => (m < 0 ? 'early' : 'late')

/** The label for the one box: the start question, the finish question, or both. */
function timeQuestionLabel({ start, finish }: { start: number | null; finish: number | null }) {
  // A start question (a manual or moved start) takes the general wording; a finish alone names how far off it is.
  if (start !== null || finish === null) return 'Why are your times off roster? (optional)'
  return `Why are you finishing ${minutesWords(finish)} ${early(finish)}? (optional)`
}

/**
 * Where the shift ended: the tap's time as the heading, the start beneath it, and a Change for each. The finish can only move earlier than the tap;
 * the start by up to 15 minutes; either needs a reason, which the worker's coordinator sees.
 */
export function EndedCard({ shift, endIso, tappedIso, draft, set, editStart, editEnd, setEditStart, setEditEnd, bounds, invalid, asks }: {
  shift: PortalShiftDetailDto; endIso: string; tappedIso: string; draft: EndDraft; set: (patch: Partial<EndDraft>) => void
  editStart: boolean; editEnd: boolean; setEditStart: (v: boolean) => void; setEditEnd: (v: boolean) => void
  bounds: { start: { stamp: string; min: string; max: string }; end: { tap: string; min: string; max: string } } | null
  invalid?: TimesField; asks: { start: number | null; finish: number | null }
}) {
  const tz = shift.timeZoneId
  const c = shift.completion
  const rostered = { start: shift.startTime, end: shift.endTime }
  const say = (local: string) => clockLabel(`${local}:00`)
  const moved = Date.parse(endIso) < Date.parse(tappedIso)
  const asking = asks.start !== null || asks.finish !== null
  const startMoved = draft.startOverride !== null && bounds !== null && draft.startOverride !== bounds.start.stamp
  return (
    <section aria-labelledby="finish-ended" className={CARD}>
      <h2 id="finish-ended" className="font-semibold text-lg tabular-nums">Ended {clock(endIso, tz)}</h2>
      {moved && <p className="text-sm">Changed from {clock(tappedIso, tz)}</p>}
      <p className={muted}>Rostered {clockLabel(rostered.start)} to {clockLabel(rostered.end)}</p>
      {editEnd && bounds ? (
        <TimeEditor
          id="finish-end" name="finish" value={draft.endOverride ?? bounds.end.tap} bounds={bounds.end} invalid={invalid === 'end'}
          helper={`Between ${say(bounds.end.min)} and ${say(bounds.end.max)}`} resetLabel="Use the tapped time"
          onChange={v => set({ endOverride: v })} onReset={() => { setEditEnd(false); set({ endOverride: bounds.end.tap }) }}
        />
      ) : (
        <Button variant="secondary" size="md" onClick={() => { setEditEnd(true); if (bounds) set({ endOverride: draft.endOverride ?? utcInstantToProviderLocal(endIso, tz) }) }} disabled={!bounds} aria-label="Change your finish time">Change</Button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">Started <span className="font-semibold tabular-nums">{c ? clock(c.actualStart, tz) : 'Not recorded'}</span></p>
        {!editStart && <Button variant="secondary" size="md" onClick={() => { setEditStart(true); if (bounds) set({ startOverride: bounds.start.stamp }) }} disabled={!bounds} aria-label="Change your start time">Change</Button>}
      </div>
      {editStart && bounds && (
        <TimeEditor
          id="finish-start" name="start" value={draft.startOverride ?? bounds.start.stamp} bounds={bounds.start} invalid={invalid === 'start'}
          helper={`Between ${say(bounds.start.min)} and ${say(bounds.start.max)}`} resetLabel="Use the recorded time"
          onChange={v => set({ startOverride: v })} onReset={() => { setEditStart(false); set({ startOverride: bounds.start.stamp }) }}
        />
      )}
      {(moved || startMoved) && (
        <div className="space-y-1">
          <label htmlFor="finish-reason" className="text-sm font-medium">{startMoved ? 'Why did your times change?' : 'Why did your finish time change?'}</label>
          <p id="finish-reason-help" className={muted}>Your coordinator sees this.</p>
          <textarea
            id="finish-reason" rows={3} maxLength={REASON_MAX} className={fieldClass} aria-describedby="finish-reason-help"
            aria-invalid={invalid === 'reason' || undefined} value={draft.adjustmentReason} onChange={e => set({ adjustmentReason: e.target.value })}
          />
          <p className={muted}>{draft.adjustmentReason.length} of {REASON_MAX}</p>
        </div>
      )}
      {asking && (
        <div className="space-y-1">
          <label htmlFor="finish-time-reason" className="text-sm font-medium">{timeQuestionLabel(asks)}</label>
          <p id="finish-time-reason-help" className={muted}>Your coordinator sees this.</p>
          <textarea
            id="finish-time-reason" rows={3} maxLength={REASON_MAX} className={fieldClass} aria-describedby="finish-time-reason-help"
            value={draft.timeReason} onChange={e => set({ timeReason: e.target.value })}
          />
          <p className={muted}>{draft.timeReason.length} of {REASON_MAX}</p>
        </div>
      )}
    </section>
  )
}


/** The doses still to record, and the routines and as-needed medicines, shown only while a dose blocks the end. */
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


/** Anything to report? Optional. Yes leaves for the incident form; a flagged note keeps its own Report incident. */
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
          <Button id="finish-report-yes" size="lg" variant="secondary" className="w-full" onClick={() => onYes(flagged[0])}>Yes, report it</Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={onNo}>No, nothing to report</Button>
        </div>
      )}
    </div>
  )
}

/** Notes and handover. The notes stay in the Notes panel, mounted behind the flow, so a note half-typed there is never lost or doubled. */
export function HandoverStep({ noteCount, draft, set, onEditNotes }: {
  noteCount: number; draft: EndDraft; set: (patch: Partial<EndDraft>) => void; onEditNotes: () => void
}) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="finish-notes" className="space-y-2">
        <h3 id="finish-notes" className="text-sm font-semibold">Your notes</h3>
        <p className="text-sm">{noteCount > 0 ? `${plural(noteCount, 'note')} on this shift.` : 'No notes yet.'}</p>
        <Button id="finish-add-notes" variant="secondary" size="md" onClick={onEditNotes}>Add or edit notes</Button>
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


/** One leg of provider travel: minutes and kilometres side by side, or "No trip" (answered with nothing). */
function TravelLeg({ id, legend, help, draft, set, invalid, message }: {
  id: 'pre' | 'post'; legend: string; help: string; draft: EndDraft; set: (patch: Partial<EndDraft>) => void; invalid?: TimesField; message?: string
}) {
  const none = draft[`${id}TravelNone`]
  const inputs = [
    { part: 'min', label: 'Minutes', unit: 'min', mode: 'numeric', field: `${id}TravelMinutes` },
    { part: 'km', label: 'Kilometres', unit: 'km', mode: 'decimal', field: `${id}TravelKilometres` },
  ] as const
  const bad = inputs.some(x => invalid === x.field)
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <p id={`finish-${id}-help`} className={muted}>{help}</p>
      <div className="grid grid-cols-2 gap-3">
        {inputs.map(x => {
          const mine = invalid === x.field
          return (
            <div key={x.part}>
              <label htmlFor={`finish-${id}-${x.part}`} className={muted}>{x.label}</label>
              <div className="relative">
                <input
                  id={`finish-${id}-${x.part}`} inputMode={x.mode} className={`${fieldClass} pr-12`} value={none ? '' : draft[x.field]} disabled={none}
                  aria-describedby={mine ? `finish-${id}-help finish-${id}-error` : `finish-${id}-help`} aria-invalid={mine || undefined}
                  onChange={e => set({ [x.field]: e.target.value })}
                />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[var(--color-muted-foreground)]">{x.unit}</span>
              </div>
            </div>
          )
        })}
      </div>
      <label className="flex items-center gap-2 text-sm min-h-[44px]">
        <input
          type="checkbox" checked={none}
          onChange={e => set(e.target.checked ? { [`${id}TravelNone`]: true, [`${id}TravelMinutes`]: '', [`${id}TravelKilometres`]: '' } : { [`${id}TravelNone`]: false })}
        />
        No trip
      </label>
      {bad && message && <p id={`finish-${id}-error`} className="text-xs text-[var(--color-destructive)]">{message}</p>}
    </fieldset>
  )
}

/** The paid travel and kilometres, set apart with the primary border so it is not missed. Without travel asked it is just the kilometres. */
export function TravelCard({ shift, draft, set, invalid, message }: {
  shift: PortalShiftDetailDto; draft: EndDraft; set: (patch: Partial<EndDraft>) => void; invalid?: TimesField; message?: string
}) {
  const first = shift.participant.fullName.split(' ')[0]
  const asked = shift.travelAsked
  const kmBad = invalid === 'kilometres'
  return (
    <section aria-labelledby="finish-travel" className={`${CARD} border-2 border-[var(--color-primary)]`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="finish-travel" className="font-semibold text-lg flex items-center gap-2"><Car className="w-5 h-5" aria-hidden="true" />{asked ? 'Travel and kilometres' : 'Kilometres'}</h2>
        {asked && <Chip tone="info">For pay</Chip>}
      </div>
      {asked && (
        <TravelLeg id="pre" legend={`Your trip to ${first}`} help="From wherever you were before this shift." draft={draft} set={set} invalid={invalid} message={message} />
      )}
      <div className="space-y-1">
        <label htmlFor="finish-km" className="text-sm font-medium">{`Kilometres driven with ${first}`}</label>
        <p id="finish-km-help" className={muted}>{`Only driving with ${first} during the shift. Enter 0 if you didn't drive.`}</p>
        <div className="relative">
          <input
            id="finish-km" inputMode="decimal" className={`${fieldClass} pr-12`} value={draft.kilometres} onChange={e => set({ kilometres: e.target.value })}
            aria-describedby={kmBad ? 'finish-km-help finish-km-error' : 'finish-km-help'} aria-invalid={kmBad || undefined}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[var(--color-muted-foreground)]">km</span>
        </div>
        {kmBad && message && <p id="finish-km-error" className="text-xs text-[var(--color-destructive)]">{message}</p>}
      </div>
      {asked && (
        <TravelLeg id="post" legend="Your trip after the shift" help="To your base or home. Going straight to another shift? Tick No trip and add the trip on that shift." draft={draft} set={set} invalid={invalid} message={message} />
      )}
    </section>
  )
}
