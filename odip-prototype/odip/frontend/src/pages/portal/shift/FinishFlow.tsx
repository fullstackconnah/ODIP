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
import { breaksSignature, FINISH_STEPS, handoverForward, stepForCode, type FinishStepKey } from './checklist'
import { clearEndDraft, EMPTY_END_DRAFT, loadEndDraft, saveEndDraft, type EndDraft } from './endDraft'
import { DosesStep, HandoverStep, ReportStep, SubmitStep, TimesStep, type Refusal } from './finishSteps'
import { requestGeolocation } from './geolocation'
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
  const [error, setError] = useState<{ message: string; focus?: string } | null>(null)
  const [refusals, setRefusals] = useState<Refusal[]>([])
  const [networkError, setNetworkError] = useState(false)
  // Set from the tap, through the location wait (up to 5 s), to the answer: one Finish per tap (plan check S5).
  const [submitting, setSubmitting] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const step = d.step ?? 'times'

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
      const running = shift.breaks.find(b => b.isRunning)
      if (running) return setError({ message: 'End your break first.', focus: `brk-end-now-${running.id}` })
      return set({ step: 'doses', reached: later(d.reached, 'doses'), timesSig: breaksSignature(shift.breaks) })
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
    setRefusals([])
    setNetworkError(false)
    setSubmitting(true)
    try {
      const geo = await requestGeolocation()
      await finish.mutateAsync({
        id: shift.id,
        data: {
          ...geo,
          actualStart: null,
          actualEnd: null,
          timeAdjustmentReason: null,
          kilometres: null,
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
        <div className="flex items-start justify-between gap-2">
          <WizardStepRail
            steps={RAIL}
            visitedSteps={new Set(FINISH_STEPS.slice(0, index(d.reached) + 1).map(s => s.key))}
            currentKey={step}
            onSelect={k => go(k as FinishStepKey)}
            orientation="horizontal"
            ariaLabel="Finish shift steps"
            filled
          />
          {step !== 'times' && <Button variant="ghost" size="md" onClick={leave}>Back to shift</Button>}
        </div>
        <WizardStepHeading stepKey={step} label={current.heading} />
      </div>
      {opened.breaksChanged && step === 'times' && <Callout tone="info">Your breaks changed. Check your times again.</Callout>}
      {step === 'times' && <TimesStep shift={shift} online={online} now={tick} />}
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
      {step === 'submit' && <SubmitStep shift={shift} draft={d} noteCount={noteCount} now={tick} refusals={refusals} go={go} />}
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error.message}</p>}
      {networkError && <p role="alert" className="text-sm text-[var(--color-destructive)]">Couldn't submit. Check your connection. Your entries are kept: try again.</p>}
      <ActionBar>
        <Button size="lg" variant="secondary" onClick={back}>{step === 'times' ? 'Back to shift' : 'Back'}</Button>
        <Button size="lg" className="flex-1" onClick={forward} disabled={submitting || (step === 'submit' && !online)}>{forwardLabel}</Button>
      </ActionBar>
    </div>
  )
}
