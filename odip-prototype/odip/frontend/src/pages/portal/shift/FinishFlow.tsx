import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useFinishShift, useSaveFinishDetails, useShiftNotes } from '@/api/hooks'
import { useQueueRecords } from '@/api/hooks/portal'
import { waitingKind } from '@/lib/offline/overlay'
import { usePermissions } from '@/lib/permissions'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { apiErrorMessages, apiErrorStatus, finishBlockersFromError, shiftDetailFromError } from '@/lib/shiftPackageErrors'
import type { ShiftIncidentPrefillState, ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'
import type { ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { clockLabel, detailLabel, offlineDueDoses, timeBounds, timesError, type DetailKey, type TimesField } from './checklist'
import { clearEndDraft, endDraftFromServer, loadEndDraft, saveEndDraft, timeQuestions, type EndDraft } from './endDraft'
import { buildDetails, effectiveEnd, missingNow, tapIsFresh, tappedEnd, timesInput } from './finishDetails'
import { BreaksFold, DosesStep, EndedCard, HandoverStep, ReportStep, TravelCard, type Refusal } from './finishSteps'
import { utcInstantToProviderLocal } from './shiftTime'
import { ActionBar } from './ui'
import { joinList, plural } from '@/lib/format'
import { formatWithTimeZone } from '@/lib/utils'
import type { DoseTarget } from './DoseSheet'
import type { PortalShiftDetailDto, ShiftNoteDto } from '@/api/types'

/** The element to focus for a refused field whose id is not `finish-<field>`. */
const FOCUS_ID: Partial<Record<TimesField, string>> = {
  kilometres: 'finish-km', preTravelMinutes: 'finish-pre-min', preTravelKilometres: 'finish-pre-km', postTravelMinutes: 'finish-post-min', postTravelKilometres: 'finish-post-km',
}
/** The first missing answer's field, for Submit while incomplete. */
const DETAIL_FOCUS: Record<DetailKey, string> = {
  kilometres: 'finish-km', tripTo: 'finish-pre-min', tripAfter: 'finish-post-min', notes: 'finish-add-notes', handover: 'handover-text', report: 'finish-report-yes',
}
const INLINE_FIELD = /^(pre|post)Travel|^kilometres$/

function prompt(key: DetailKey, first: string): string {
  switch (key) {
    case 'kilometres': return `Add the kilometres you drove with ${first}`
    case 'tripTo': return `Add your trip to ${first}, or tick No trip`
    case 'tripAfter': return 'Add your trip after the shift, or tick No trip'
    case 'notes': return 'Add a note, or tick Nothing to note'
    case 'handover': return 'Add a handover, or tick Nothing to hand over'
    case 'report': return 'Say whether there is anything to report'
  }
}

function blockedDoseMessage(doses: ReturnType<typeof offlineDueDoses>): string {
  const name = (d: (typeof doses)[number]) => `${d.medicationName}${d.strength ? ` ${d.strength}` : ''}`
  if (doses.length === 1) return `${name(doses[0])} was due at ${clockLabel(doses[0].scheduledAt)} with no outcome recorded, and recording a dose needs a connection. When you're back online, record it, then end the shift. What you've entered is kept.`
  return `${doses.length} doses are due with no outcome recorded: ${joinList(doses.map(d => `${name(d)} (${clockLabel(d.scheduledAt)})`))}. Recording a dose needs a connection. When you're back online, record them, then end the shift. What you've entered is kept.`
}

/** The draft to open with: what the worker typed here before, else what the server has saved, keeping the tap. */
function openDraft(shift: PortalShiftDetailDto): EndDraft {
  const saved = loadEndDraft(shift.id)
  if (saved?.touched) return { ...saved, open: true }
  return { ...endDraftFromServer(shift.completion), tappedAt: saved?.tappedAt ?? null, open: true }
}

/**
 * The finish page (finish later PR2), in the page, not a modal. End shift has already taken the end time at the tap; this page is the details:
 * the ended time, travel and kilometres, notes and handover, and "Anything to report?". It sends what is typed. Submit holds until everything is
 * answered; "Add details later" saves what is there and leaves. The server stays the floor.
 */
export function FinishFlow({ shift, online, canAct, ending, onRecord, onClose, onEditNotes }: {
  shift: PortalShiftDetailDto
  online: boolean
  canAct: boolean
  /** The page is still sending End shift: the buttons wait. */
  ending: boolean
  onRecord: (t: DoseTarget, notGiven: boolean) => void
  /** Leaves the page: true when every detail is in, false when the worker goes back to the shift (every entry is kept). */
  onClose: (submitted: boolean) => void
  /** Leaves the page for the Notes tab ("Add or edit notes"); every entry is kept, as with Back to shift. */
  onEditNotes: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const finish = useFinishShift()
  const save = useSaveFinishDetails()
  const records = useQueueRecords()
  const { id: currentUserId } = usePermissions()
  const { data: notes } = useShiftNotes(shift.id)
  const noteCount = notes?.length ?? 0
  const [mountedAt] = useState(() => new Date().toISOString())
  const [d, setD] = useState<EndDraft>(() => openDraft(shift))
  const [editStart, setEditStart] = useState(d.startOverride !== null)
  const [editEnd, setEditEnd] = useState(d.endOverride !== null)
  // An edit clears the refusal it may have fixed: a stale "choose a time between" next to a corrected time misleads.
  const set = (patch: Partial<EndDraft>) => { setError(null); setD(prev => ({ ...prev, ...patch, touched: true })) }
  const [error, setError] = useState<{ message: string; focus?: string; field?: TimesField } | null>(null)
  const [refusals, setRefusals] = useState<Refusal[]>([])
  const [networkError, setNetworkError] = useState(false)
  // One send per tap: set from the tap to the answer.
  const [submitting, setSubmitting] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const first = shift.participant.fullName.split(' ')[0]

  const input = timesInput(shift, d)
  const bounds = input ? timeBounds(input.stampedStart, shift.timeZoneId, input.tappedEnd) : null
  const tapped = tappedEnd(shift, d)
  const end = effectiveEnd(shift, d)
  const asks = end ? timeQuestions(shift, d, end) : { start: null, finish: null }
  const missing = missingNow(shift, d, noteCount)
  const complete = missing.length === 0
  const busy = submitting || ending
  const doseBlockers = online ? shift.finishBlockers.filter(b => b.code === 'DOSE_OUTCOME_MISSING').length : 0
  const offlineDoses = online ? [] : offlineDueDoses(shift)
  const dosesBlock = doseBlockers + offlineDoses.length > 0
  const focusFor = (field: TimesField) => (field === 'break' ? undefined : (FOCUS_ID[field] ?? `finish-${field}`))

  useEffect(() => { saveEndDraft(shift.id, d) }, [shift.id, d])
  // Opening the page focuses it, so a keyboard or screen-reader worker starts at the top.
  useEffect(() => { topRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => { if (error?.focus) document.getElementById(error.focus)?.focus() }, [error])
  // A server refusal is listed above the bar; focus brings it on screen, however long the page is.
  useEffect(() => {
    if (!refusals.length) return
    const el = document.getElementById('finish-refusals')
    el?.focus({ preventScroll: true })
    el?.scrollIntoView?.({ block: 'end' })
  }, [refusals])

  function leave() {
    saveEndDraft(shift.id, { ...d, open: false })   // the page unmounts now, before its effect could save
    onClose(false)
  }

  function editNotes() {
    saveEndDraft(shift.id, { ...d, open: false })
    onEditNotes()
  }

  /** Both buttons stop where the server would: a dose with no outcome, or a time outside its window. True when it is fine to send. */
  function gate(): boolean {
    if (doseBlockers > 0) {
      setError({ message: `Record an outcome for ${plural(doseBlockers, 'dose')} before you end the shift.`, focus: 'dose-blocker-0' })
      return false
    }
    if (offlineDoses.length > 0) {
      setError({ message: blockedDoseMessage(offlineDoses) })
      return false
    }
    const atTap = timesInput(shift, d)
    const problem = atTap && timesError(atTap)
    if (problem) {
      if (problem.field === 'end') setEditEnd(true)
      if (problem.field === 'start') setEditStart(true)
      setError({ message: problem.message, focus: focusFor(problem.field), field: problem.field })
      return false
    }
    return true
  }

  async function send(later: boolean) {
    setRefusals([])
    setNetworkError(false)
    setError(null)
    if (!gate()) return
    const sendsEnd = shift.status === 'InProgress' && !waitingKind(records, shift.id, 'finish')
    if (sendsEnd && !tapIsFresh(d.tappedAt)) {
      // The old tap is too old for the server: take a new one, show it, and send on the next press, so what is shown is what is saved.
      const now = new Date().toISOString()
      setD(prev => ({ ...prev, tappedAt: now }))
      setError({ message: `More than 25 minutes have passed, so your end time is now ${formatWithTimeZone(now, shift.timeZoneId, { hour: 'numeric', minute: '2-digit' })}. Use Change if you finished earlier.` })
      return
    }
    if (!later && !complete) {
      const key = missing[0]
      setError({ message: `${prompt(key, first)}, or tap Add details later.`, focus: DETAIL_FOCUS[key] })
      return
    }
    setSubmitting(true)
    try {
      // The page sends End shift at the tap; here only when a dose held it back, so the end is still that tap (a stale tap was renewed above).
      if (sendsEnd) await finish.mutateAsync({ id: shift.id, data: { detailsLater: true, endTappedAt: d.tappedAt } })
      if (d.touched) {
        const saved = await save.mutateAsync({ id: shift.id, data: buildDetails(shift, d, noteCount) })
        if (saved === undefined) {   // queued offline: keep the entries, they are sent when the connection is back
          saveEndDraft(shift.id, { ...d, open: false })
          onClose(false)
          return
        }
      }
      clearEndDraft(shift.id)
      onClose(complete)
    } catch (err) {
      const blockers = finishBlockersFromError(err)
      if (blockers.length) {
        const fresh = shiftDetailFromError(err)
        if (fresh) qc.setQueryData(['portal-shift-detail', shift.id], fresh)
        setRefusals(blockers.map(b => ({ message: b.message })))
      } else if (apiErrorStatus(err) !== undefined) {
        setRefusals([{ message: apiErrorMessages(err)[0] ?? "Couldn't save this shift. Your entries are kept. Try again." }])
      } else {
        setNetworkError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** Yes on "Anything to report?": the incident form, filled from the flagged note when there is one, else from the shift; it comes back here after. */
  function reportYes(note?: ShiftNoteDto) {
    saveEndDraft(shift.id, { ...d, anythingToReport: 'yes', touched: true })   // the page unmounts as it navigates: save now
    const returnTo = `/portal/shifts/${shift.id}`
    const prefill: ShiftIncidentPrefillState | ShiftNoteIncidentPrefillState = note ? {
      source: 'shift-note', shiftNoteId: note.id, categories: note.flaggedCategories as ShiftNoteFlagCategory[],
      participantId: shift.participant.id, participantName: shift.participant.fullName, noteBody: note.body,
      serviceDate: shift.serviceDate, startTime: shift.startTime, endTime: shift.endTime, endsNextDay: shift.endsNextDay,
      reportedByUserId: currentUserId, shiftId: shift.id, returnTo,
    } : {
      source: 'shift', shiftId: shift.id, participantId: shift.participant.id, participantName: shift.participant.fullName,
      serviceDate: shift.serviceDate, startTime: shift.startTime, endTime: shift.endTime, endsNextDay: shift.endsNextDay,
      reportedByUserId: currentUserId, returnTo,
      incidentAt: shift.completion ? utcInstantToProviderLocal(shift.completion.actualStart, shift.timeZoneId) : undefined,
    }
    navigate('/incidents/new', { state: prefill })
  }

  // One notice slot: a bar error first; the dose callout and the sync row already speak when a dose or an unsent change is waiting.
  const stillToAdd = !complete && !dosesBlock && records.length === 0
  const barError = (error && !INLINE_FIELD.test(error.field ?? '')) || networkError
  return (
    <div id="finish" ref={topRef} tabIndex={-1} className="space-y-4 outline-none">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={leave}>Back to shift</Button>
      </div>
      <EndedCard
        shift={shift} endIso={(end ?? new Date(mountedAt)).toISOString()} tappedIso={(tapped ?? new Date(mountedAt)).toISOString()} draft={d} set={set}
        editStart={editStart} editEnd={editEnd} setEditStart={setEditStart} setEditEnd={setEditEnd} bounds={bounds} invalid={error?.field} asks={asks}
      />
      {dosesBlock && (
        <section className="space-y-3">
          <Callout tone="warning" title={`Record ${plural(doseBlockers || offlineDoses.length, 'dose')} before the shift ends`}>
            {online ? 'A dose with no outcome stops the shift ending.' : 'Recording a dose needs a connection.'}
          </Callout>
          <DosesStep shift={shift} online={online} canAct={canAct} onRecord={onRecord} />
        </section>
      )}
      <TravelCard
        shift={shift} draft={d} set={set} invalid={error?.field}
        message={error && INLINE_FIELD.test(error.field ?? '') ? error.message : undefined}
      />
      <section aria-labelledby="finish-handover-card" className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 lg:p-5 space-y-3">
        <h2 id="finish-handover-card" className="font-semibold text-lg">Notes and handover</h2>
        <HandoverStep noteCount={noteCount} draft={d} set={set} onEditNotes={editNotes} />
      </section>
      <section aria-labelledby="finish-report" className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 lg:p-5 space-y-3">
        <h2 id="finish-report" className="font-semibold text-lg">Anything to report?</h2>
        <ReportStep shift={shift} answer={d.anythingToReport} onYes={reportYes} onNo={() => set({ anythingToReport: 'no' })} />
      </section>
      <BreaksFold shift={shift} />
      {refusals.length > 0 && (
        <div id="finish-refusals" tabIndex={-1} className="scroll-mb-28 outline-none">
          <Callout tone="error" title="This shift can't be saved yet">
            <ul className="space-y-1">{refusals.map((r, i) => <li key={i}>{r.message}</li>)}</ul>
          </Callout>
        </div>
      )}
      <ActionBar notice={barError ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error ? error.message : "Couldn't save. Check your connection. Your entries are kept: try again."}
        </p>
      ) : stillToAdd ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Still to add: {joinList(missing.map(k => detailLabel(k, first)))}</p>
      ) : undefined}>
        {!complete && <Button size="lg" variant="secondary" onClick={() => void send(true)} disabled={busy}>Add details later</Button>}
        <Button size="lg" className="flex-1 lg:flex-none" onClick={() => void send(false)} disabled={busy}>
          {submitting ? 'Saving…' : networkError ? 'Try again' : 'Submit shift'}
        </Button>
      </ActionBar>
    </div>
  )
}
