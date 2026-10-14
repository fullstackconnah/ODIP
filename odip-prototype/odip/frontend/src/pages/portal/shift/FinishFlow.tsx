import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useFinishShift, useShiftNotes } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { WizardStepHeading } from '@/components/wizard/WizardStepHeading'
import { WizardStepRail } from '@/components/wizard/WizardStepRail'
import type { WizardStepDef } from '@/components/wizard/types'
import { apiErrorCode, apiErrorMessages, apiErrorStatus, finishBlockersFromError, shiftDetailFromError } from '@/lib/shiftPackageErrors'
import type { ShiftIncidentPrefillState } from '@/lib/incidentPrefill'
import { breaksSignature, FINISH_STEPS, handoverForward, movedTimes, parseKilometres, stepForCode, timesError, type FinishStepKey, type TimesField, type TimesInput } from './checklist'
import { clearEndDraft, EMPTY_END_DRAFT, loadEndDraft, saveEndDraft, type EndDraft } from './endDraft'
import { DosesStep, HandoverStep, ReportStep, SubmitStep, TimesStep, type Refusal } from './finishSteps'
import { requestGeolocation } from './geolocation'
import { utcInstantToProviderLocal } from './shiftTime'
import { ActionBar } from './ui'
import { useNow } from './useNow'
import type { DoseTarget } from './DoseSheet'
import type { PortalShiftDetailDto } from '@/api/types'

const RAIL: WizardStepDef<Record<string, never>>[] = FINISH_STEPS.map(s => ({ key: s.key, label: s.label, fields: [] }))
const index = (k: FinishStepKey) => FINISH_STEPS.findIndex(s => s.key === k)
const later = (a: FinishStepKey, b: FinishStepKey) => (index(a) >= index(b) ? a : b)

/** The draft to open with: at its saved step, or step 1; back at step 1 when the breaks changed after the times were confirmed. */
function openDraft(shift: PortalShiftDetailDto): { draft: EndDraft; breaksChanged: boolean } {
  const saved = loadEndDraft(shift.id) ?? EMPTY_END_DRAFT
  const breaksChanged = saved.timesSig !== null && saved.timesSig !== breaksSignature(shift.breaks)
  return { draft: { ...saved, step: breaksChanged ? 'times' : saved.step ?? 'times' }, breaksChanged }
}

/**
 * The five-step finish (SHAPE §4), in the page, not a modal: the dose sheet opens from step 2 and Yes on step 3 leaves for the incident form.
 * Local step state, the extended endDraft, the house rail and heading. A step stops a forward tap only where the server would refuse, says why
 * above the bar and focuses the thing to fix; the server stays the floor.
 */
export function FinishFlow({ shift, online, canAct, onRecord, onClose, onEditNotes }: {
  shift: PortalShiftDetailDto
  online: boolean
  canAct: boolean
  onRecord: (t: DoseTarget, notGiven: boolean) => void
  /** Leaves the flow: true after a submit, false when the worker goes back to the shift (every entry is kept). */
  onClose: (submitted: boolean) => void
  /** Leaves the flow for the Notes tab (step 4's "Add or edit notes"); every entry is kept, as with Back to shift. */
  onEditNotes: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const finish = useFinishShift()
  const { id: currentUserId } = usePermissions()
  const { data: notes } = useShiftNotes(shift.id)
  const noteCount = notes?.length ?? 0
  // The flow's clock: state (render must not read the clock), ticking every 30 s and read again on every tap that changes the step.
  const [tick, refreshClock] = useNow(30_000)
  const [opened] = useState(() => openDraft(shift))
  const [d, setD] = useState<EndDraft>(opened.draft)
  const set = (patch: Partial<EndDraft>) => setD(prev => ({ ...prev, ...patch }))
  const [error, setError] = useState<{ message: string; focus?: string; field?: TimesField } | null>(null)
  const [refusals, setRefusals] = useState<Refusal[]>([])
  const [networkError, setNetworkError] = useState(false)
  // Set from the tap, through the location wait (up to 5 s), to the answer: one Finish per tap (plan check S5).
  const [submitting, setSubmitting] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const step = d.step ?? 'times'
  // Render reads the flow's clock (`tick`, refreshed on every step change and every 30 s); the step-1 gate and submit read the clock at the tap,
  // because the server judges the end against its own clock at submit (Review Focus 2).
  const timesInput = (at: Date): TimesInput | null => shift.completion ? {
    tz: shift.timeZoneId, stampedStart: shift.completion.actualStart, startOverride: d.startOverride, endOverride: d.endOverride,
    reason: d.adjustmentReason, kilometres: d.kilometres, breaks: shift.breaks, now: at,
  } : null
  const live = timesInput(tick)
  const moved = live ? movedTimes(live) : { start: null, end: null }
  const km = parseKilometres(d.kilometres)
  const drifted = step === 'submit' && !!live && timesError(live)?.field === 'end'
  /** The element to fix for a step-1 refusal: the field, or the break (its End break while it runs, else its Edit). */
  const focusFor = (p: { field: TimesField; breakId?: string }) =>
    p.field === 'break'
      ? (shift.breaks.find(x => x.id === p.breakId)?.isRunning ? `brk-end-now-${p.breakId}` : `brk-edit-${p.breakId}`)
      : p.field === 'kilometres' ? 'finish-km' : `finish-${p.field}`

  useEffect(() => { saveEndDraft(shift.id, d) }, [shift.id, d])
  // WizardStepHeading moves focus on a step change but skips its first mount, so opening (or resuming) the flow focuses the heading here.
  useEffect(() => { topRef.current?.querySelector<HTMLElement>('h2')?.focus() }, [])
  useEffect(() => { if (error?.focus) document.getElementById(error.focus)?.focus() }, [error])

  function go(key: FinishStepKey) {
    refreshClock()
    setError(null)
    setRefusals([])
    set({ step: key, reached: later(d.reached, key) })
  }

  function leave() {
    saveEndDraft(shift.id, { ...d, step: null })   // the flow unmounts now, before its effect could save
    onClose(false)
  }

  function editNotes() {
    saveEndDraft(shift.id, { ...d, step: null })
    onEditNotes()
  }


  function back() {
    if (step === 'times') leave()
    else go(FINISH_STEPS[index(step) - 1].key)
  }

  function forward() {
    refreshClock()
    setError(null)
    if (step === 'times') {
      const atTap = timesInput(new Date())
      const problem = atTap && timesError(atTap)
      if (problem) return setError({ message: problem.message, focus: focusFor(problem), field: problem.field })
      const kept = atTap ? movedTimes(atTap) : { start: null, end: null }
      // A Change left on the recorded minute is no change: drop it now, so it can't become a move as the clock runs on.
      return set({
        step: 'doses', reached: later(d.reached, 'doses'), timesSig: breaksSignature(shift.breaks),
        startOverride: kept.start ? d.startOverride : null, endOverride: kept.end ? d.endOverride : null,
      })
    }
    if (step === 'doses') {
      const missing = shift.finishBlockers.filter(b => b.code === 'DOSE_OUTCOME_MISSING').length
      if (missing) return setError({ message: `Record an outcome for ${missing} dose${missing === 1 ? '' : 's'} before you go on.`, focus: 'dose-blocker-0' })
      return go('report')
    }
    if (step === 'report') return go('handover')   // unanswered is fine: the question is optional, and null is sent
    if (step === 'handover') {
      // The forward button said which answers it gives (handoverForward); the tap gives them.
      return set({
        step: 'submit', reached: 'submit',
        nothingToNote: d.nothingToNote || noteCount === 0,
        nothingToHandOver: d.nothingToHandOver || !d.handoverText.trim(),
      })
    }
    void submit()
  }

  async function submit() {
    const atSubmit = timesInput(new Date())
    const problem = atSubmit && timesError(atSubmit)
    if (problem) {   // the clock ran on past the window: the server would refuse the same way, so say it on step 1
      go('times')
      setError({ message: problem.message, focus: focusFor(problem), field: problem.field })
      return
    }
    const sent = atSubmit ? movedTimes(atSubmit) : { start: null, end: null }
    setRefusals([])
    setNetworkError(false)
    setSubmitting(true)
    try {
      const geo = await requestGeolocation()
      await finish.mutateAsync({
        id: shift.id,
        data: {
          ...geo,
          actualStart: sent.start,
          actualEnd: sent.end,
          timeAdjustmentReason: sent.start || sent.end ? d.adjustmentReason.trim() : null,
          kilometres: km === 'invalid' ? null : km,
          anythingToReport: d.anythingToReport === null ? null : d.anythingToReport === 'yes',
          handoverText: d.nothingToHandOver ? null : d.handoverText.trim() || null,
          nothingToHandOver: d.nothingToHandOver,
          nothingToNote: noteCount === 0 && d.nothingToNote,
        },
      })
      clearEndDraft(shift.id)
      onClose(true)
    } catch (err) {
      const blockers = finishBlockersFromError(err)
      if (blockers.length) {
        const fresh = shiftDetailFromError(err)
        if (fresh) qc.setQueryData(['portal-shift-detail', shift.id], fresh)
        setRefusals(blockers.map(b => ({ message: b.message, step: stepForCode(b.code) })))
      } else if (apiErrorStatus(err) !== undefined) {
        setRefusals([{ message: apiErrorMessages(err)[0] ?? "Couldn't submit this shift. Your entries are kept. Try again.", step: stepForCode(apiErrorCode(err)) }])
      } else {
        setNetworkError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function reportYes() {
    saveEndDraft(shift.id, { ...d, anythingToReport: 'yes' })   // the page unmounts as it navigates: save now
    const prefill: ShiftIncidentPrefillState = {
      source: 'shift', shiftId: shift.id, participantId: shift.participant.id, participantName: shift.participant.fullName,
      serviceDate: shift.serviceDate, startTime: shift.startTime, endTime: shift.endTime, endsNextDay: shift.endsNextDay,
      reportedByUserId: currentUserId, returnTo: `/portal/shifts/${shift.id}`,
      incidentAt: shift.completion ? utcInstantToProviderLocal(shift.completion.actualStart, shift.timeZoneId) : undefined,
    }
    navigate('/incidents/new', { state: prefill })
  }

  const forwardLabel = step === 'times' ? 'Confirm times'
    : step === 'report' ? (d.anythingToReport ? 'Next' : 'Skip')
    : step === 'handover' ? handoverForward(noteCount, d.nothingToNote, d.handoverText, d.nothingToHandOver)
    : step === 'submit' ? (submitting ? 'Submitting…' : networkError ? 'Try again' : 'Submit shift')
    : 'Next'

  const current = FINISH_STEPS[index(step)]
  return (
    <div id="finish" className="space-y-4">
      <div ref={topRef} className="space-y-2">
        <WizardStepRail
          steps={RAIL}
          visitedSteps={new Set(FINISH_STEPS.slice(0, index(d.reached) + 1).map(s => s.key))}
          currentKey={step}
          onSelect={k => go(k as FinishStepKey)}
          orientation="horizontal"
          ariaLabel="Finish shift steps"
          filled
        />
        {/* Back to shift sits on the heading line, not the rail line: the rail scrolls inside whatever width is left, so a button beside it clipped the last pill on desktop. */}
        <div className="flex items-center justify-between gap-2">
          <WizardStepHeading stepKey={step} label={current.heading} />
          {step !== 'times' && <Button variant="ghost" size="md" className="shrink-0" onClick={leave}>Back to shift</Button>}
        </div>
      </div>
      {opened.breaksChanged && step === 'times' && <Callout tone="info">Your breaks changed. Check your times again.</Callout>}
      {step === 'times' && <TimesStep shift={shift} online={online} now={tick} draft={d} set={set} invalid={error?.field} />}
      {step === 'doses' && <DosesStep shift={shift} online={online} canAct={canAct} onRecord={onRecord} />}
      {step === 'report' && (
        <ReportStep
          shift={shift}
          answer={d.anythingToReport}
          onYes={reportYes}
          onNo={() => set({ anythingToReport: 'no', step: 'handover', reached: later(d.reached, 'handover') })}
          onLeave={() => saveEndDraft(shift.id, { ...d, anythingToReport: 'yes' })}
        />
      )}
      {step === 'handover' && <HandoverStep noteCount={noteCount} draft={d} set={set} onEditNotes={editNotes} />}
      {step === 'submit' && (
        <SubmitStep
          shift={shift} draft={d} noteCount={noteCount} now={tick} refusals={refusals} go={go}
          moved={moved} kilometres={km === 'invalid' ? null : km} drifted={drifted}
          onUseSubmitTime={() => set({ endOverride: null })} onChangeTimes={() => go('times')}
        />
      )}
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error.message}</p>}
      {networkError && <p role="alert" className="text-sm text-[var(--color-destructive)]">Couldn't submit. Check your connection. Your entries are kept: try again.</p>}
      <ActionBar>
        <Button size="lg" variant="secondary" onClick={back}>{step === 'times' ? 'Back to shift' : 'Back'}</Button>
        <Button size="lg" className="flex-1" onClick={forward} disabled={submitting || (step === 'submit' && !online)}>{forwardLabel}</Button>
      </ActionBar>
    </div>
  )
}
