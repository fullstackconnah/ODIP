import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Armchair, Clock, WifiOff } from 'lucide-react'
import { usePortalShiftDetail, useStartShift, useStartBreak, useEndBreak } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { StatusBadge } from '@/components/StatusBadge'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import {
  formatShiftTimeRange, formatDayAccessibleName, RATIO_LABELS, formatElapsedSince, formatVarianceMinutes,
} from '@/pages/rostering/lib/roster'
import { formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { httpStatusOf, isNotFoundError } from '@/lib/httpStatus'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { OVERNIGHT_SUPPORT_LABELS } from './lib/portal'
import { ShiftNotesSection } from './components/ShiftNotesSection'
import { HandoverSection, GlanceSection, ContactsSection } from './shift/BeforeSection'
import { DuringSection } from './shift/DuringSection'
import { EndSection } from './shift/EndSection'
import { DoseSheet, type DoseTarget } from './shift/DoseSheet'
import { loadEndDraft } from './shift/endDraft'
import { requestGeolocation } from './shift/geolocation'
import { useOnline } from './shift/useOnline'
import { Chip, Section } from './shift/ui'
import type { PortalShiftDetailDto, StartShiftDto } from '@/api/types'

/** A live "Xh Ym" since the shift started; re-renders every 30 seconds. */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return <span aria-label="Time on shift">{formatElapsedSince(since, now)} on shift</span>
}

function ShiftHeader({ shift }: { shift: PortalShiftDetailDto }) {
  const { participant, completion } = shift
  const running = shift.breaks.find(b => b.isRunning)
  const overnight = shift.endsNextDay || shift.nightType !== 'None'
  return (
    <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{participant.fullName}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {formatDayAccessibleName(shift.serviceDate)} · {formatShiftTimeRange(shift.startTime, shift.endTime)}
            {shift.endsNextDay && ' (+1 day)'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={shift.status} />
          {running && <Chip>On break</Chip>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
        {shift.status === 'InProgress' && completion && <span className="font-medium"><Elapsed since={completion.actualStart} /></span>}
        {running && (
          <span>Break since {formatWithTimeZone(running.startedAt, shift.timeZoneId, { hour: 'numeric', minute: '2-digit' })}, {running.minutes} min</span>
        )}
        <Chip>{RATIO_LABELS[shift.ratio] ?? shift.ratio}</Chip>
        {overnight && <Chip>Overnight{shift.nightType !== 'None' ? `: ${shift.nightType}` : ''}</Chip>}
        {completion && shift.status !== 'Published' && (
          <Chip>Start {formatVarianceMinutes(completion.varianceMinutesStart)}</Chip>
        )}
        {participant.isHighSupport && <Chip>High support</Chip>}
        {participant.isIntensiveSupport && <Chip>Intensive support</Chip>}
        {participant.hasRestrictivePracticeFlag && <Chip>Restrictive practice</Chip>}
      </div>
      {shift.notes && <p className="mt-3 text-sm whitespace-pre-wrap">{shift.notes}</p>}
    </div>
  )
}

function SubmittedSummary({ shift }: { shift: PortalShiftDetailDto }) {
  const c = shift.completion
  if (!c) return null
  const tz = c.timeZoneId
  return (
    <Section id="summary" title={shift.status === 'Completed' ? 'Shift completed' : 'Submitted for review'} icon={<Clock className="w-4 h-4" aria-hidden="true" />}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-[var(--color-muted-foreground)]">Actual</dt>
        <dd>
          {formatWithTimeZone(c.actualStart, tz, { dateStyle: 'medium', timeStyle: 'short' })}
          {' to '}
          {c.actualEnd ? formatWithTimeZone(c.actualEnd, tz, { timeStyle: 'short' }) : 'Not recorded'}
        </dd>
        <dt className="text-[var(--color-muted-foreground)]">Variance</dt>
        <dd>{formatVarianceMinutes(c.varianceMinutesStart)} start / {formatVarianceMinutes(c.varianceMinutesEnd)} end</dd>
        <dt className="text-[var(--color-muted-foreground)]">Breaks</dt>
        <dd>{c.breaks.length}, {c.breakMinutes} min</dd>
        <dt className="text-[var(--color-muted-foreground)]">Time worked</dt>
        <dd>{c.netWorkedMinutes} min</dd>
        {c.reviewedByName && (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Approved by</dt>
            <dd>{c.reviewedByName}</dd>
          </>
        )}
      </dl>
    </Section>
  )
}

export default function PortalShiftDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: shift, isLoading, isError, error, refetch } = usePortalShiftDetail(id)
  const { canCompleteOwnShifts } = usePermissions()
  const online = useOnline()
  const startShift = useStartShift()
  const startBreak = useStartBreak()
  const endBreak = useEndBreak()
  const [actionError, setActionError] = useState<string | null>(null)
  // A saved End draft means the worker was mid-End (e.g. left to Report incident): open End again.
  const [endOpen, setEndOpen] = useState(() => !!id && loadEndDraft(id) !== null)
  const [sheet, setSheet] = useState<{ target: DoseTarget; notGiven: boolean } | null>(null)

  async function handleStart() {
    if (!id) return
    setActionError(null)
    try {
      const geo = await requestGeolocation()
      await startShift.mutateAsync({ id, data: geo satisfies StartShiftDto })
    } catch (err) {
      setActionError(extractErrorMessage(err, "Couldn't start this shift. Check your connection and try again."))
    }
  }

  async function handleBreak(runningId: string | undefined) {
    if (!id) return
    setActionError(null)
    try {
      if (runningId) await endBreak.mutateAsync({ id, breakId: runningId })
      else await startBreak.mutateAsync({ id })
    } catch (err) {
      setActionError(apiErrorMessages(err)[0] ?? "Couldn't save the break. Check your connection and try again.")
    }
  }

  function openEnd() {
    setEndOpen(true)
    // After the section mounts, bring it into view.
    setTimeout(() => document.getElementById('end')?.scrollIntoView?.({ block: 'start' }), 0)
  }

  if (isLoading) return <PageState kind="loading" noun="shift" />

  if (!shift) {
    if (isError && httpStatusOf(error) === 403) {
      return (
        <div className="space-y-4 animate-fade-in">
          <BackButton to="/portal" label="my shifts" variant="link" history={false} className="py-3" />
          <Callout tone="info" title="You can't open this shift">This shift isn't assigned to you.</Callout>
        </div>
      )
    }
    return isError && !isNotFoundError(error)
      ? <PageState kind="error" noun="shift" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="shift" backTo="/portal" backLabel="my shifts" />
  }

  const canAct = canCompleteOwnShifts
  const { participant } = shift
  const returned = shift.status === 'Published' && shift.returnCount > 0 && !!shift.lastReturnReason
  const inProgress = shift.status === 'InProgress'
  const showBefore = shift.status === 'Published' || inProgress
  const running = shift.breaks.find(b => b.isRunning)

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <BackButton to="/portal" label="my shifts" variant="link" history={false} className="py-3" />

      {!online && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm">
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          You're offline. Recording, breaks and Finish need a connection, so they're switched off until it's back.
        </div>
      )}

      <ShiftHeader shift={shift} />

      {returned && (
        <Callout tone="info" title="Returned for changes">{shift.lastReturnReason}</Callout>
      )}
      {shift.status === 'Cancelled' && <Callout tone="info">This shift was cancelled.</Callout>}
      {shift.status === 'PendingReview' && <Callout tone="info">Submitted. It is waiting for a coordinator to review it.</Callout>}
      {!canAct && <Callout tone="info">You can look at this shift but you can't change it.</Callout>}

      {(shift.status === 'PendingReview' || shift.status === 'Completed') && <SubmittedSummary shift={shift} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {showBefore && (
          <div className="space-y-4 lg:col-start-1">
            <HandoverSection shift={shift} canAct={canAct} online={online} />
          </div>
        )}
        {showBefore && (
          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:sticky lg:top-4">
            <GlanceSection shift={shift} />
          </div>
        )}
        {showBefore && (
          <div className="space-y-4 lg:col-start-1">
            <ContactsSection shift={shift} />
            {shift.status === 'Published' && canAct && (
              <Section id="start" title="Ready to start?" icon={<Clock className="w-4 h-4" aria-hidden="true" />}>
                {actionError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{actionError}</p>}
                <Button size="lg" onClick={handleStart} disabled={startShift.isPending || !online}>
                  {startShift.isPending ? 'Starting…' : 'Start shift'}
                </Button>
              </Section>
            )}
          </div>
        )}

        {inProgress && (
          <div className="space-y-4 lg:col-start-1">
            <DuringSection shift={shift} canAct={canAct} online={online} onRecord={(target) => setSheet({ target, notGiven: false })} />
            <ShiftNotesSection
              shiftId={shift.id}
              participantId={participant.id}
              participantName={participant.fullName}
              serviceDate={shift.serviceDate}
              startTime={shift.startTime}
              endTime={shift.endTime}
              endsNextDay={shift.endsNextDay}
            />
            {endOpen && (
              <EndSection shift={shift} online={online} canAct={canAct} onRecord={(target, notGiven) => setSheet({ target, notGiven })} />
            )}
          </div>
        )}

        {!inProgress && shift.status !== 'Published' && (
          <div className="space-y-4 lg:col-start-1">
            <ShiftNotesSection
              shiftId={shift.id}
              participantId={participant.id}
              participantName={participant.fullName}
              serviceDate={shift.serviceDate}
              startTime={shift.startTime}
              endTime={shift.endTime}
              endsNextDay={shift.endsNextDay}
            />
          </div>
        )}

        <div className="space-y-4 lg:col-start-1">
          <Section id="about" title="About this participant" icon={<Armchair className="w-4 h-4" aria-hidden="true" />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-[var(--color-muted-foreground)] text-xs">Support ratio</dt>
                <dd>{RATIO_LABELS[participant.supportRatio] ?? participant.supportRatio}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted-foreground)] text-xs">Overnight support</dt>
                <dd>{OVERNIGHT_SUPPORT_LABELS[participant.overnightSupport] ?? participant.overnightSupport}</dd>
              </div>
            </dl>
            {participant.medicalSummary && (
              <div>
                <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Medical summary</p>
                <p className="text-sm whitespace-pre-wrap">{participant.medicalSummary}</p>
              </div>
            )}
            {participant.behaviourRiskSummary && (
              <div>
                <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Behaviour / risk summary</p>
                <p className="text-sm whitespace-pre-wrap">{participant.behaviourRiskSummary}</p>
              </div>
            )}
            {participant.mobilityNotes && (
              <div>
                <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Mobility notes</p>
                <p className="text-sm whitespace-pre-wrap">{participant.mobilityNotes}</p>
              </div>
            )}
            {participant.equipmentRequirements && (
              <div>
                <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Equipment requirements</p>
                <p className="text-sm whitespace-pre-wrap">{participant.equipmentRequirements}</p>
              </div>
            )}
            {participant.transportRequirements && (
              <div>
                <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Transport requirements</p>
                <p className="text-sm whitespace-pre-wrap">{participant.transportRequirements}</p>
              </div>
            )}
          </Section>

          <Section id="risks" title="Risks" icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}>
            {shift.riskEntries.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No risks recorded for this participant.</p>
            ) : (
              <ul className="space-y-2">
                {shift.riskEntries.map(entry => (
                  <li key={entry.id} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm">
                    <Chip>{AT_RISK_PARTY_LABELS[entry.atRiskParty]}</Chip>
                    <p className="mt-1 whitespace-pre-wrap">{entry.description}</p>
                    {entry.mitigationNotes && (
                      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]"><span className="font-medium">Mitigation:</span> {entry.mitigationNotes}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {inProgress && canAct && (
        <div
          role="toolbar"
          aria-label="Shift actions"
          className="sticky bottom-[var(--mobile-nav-h)] lg:bottom-0 z-20 -mx-4 flex gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 lg:mx-0 lg:rounded-lg lg:border"
        >
          <Button
            size="lg"
            variant={running ? 'primary' : 'secondary'}
            className="flex-1"
            onClick={() => handleBreak(running?.id)}
            disabled={!online || startBreak.isPending || endBreak.isPending}
          >
            {running ? 'End break' : 'Start break'}
          </Button>
          <Button size="lg" className="flex-1" onClick={openEnd} disabled={endOpen}>End shift</Button>
        </div>
      )}
      {inProgress && actionError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{actionError}</p>}

      <DoseSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        shift={shift}
        target={sheet?.target ?? null}
        initialOutcome={sheet?.notGiven ? 'Missed' : 'Administered'}
        allowMissed={sheet?.notGiven ?? false}
        online={online}
      />
    </div>
  )
}
