import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, Armchair, Clock, ScrollText, WifiOff } from 'lucide-react'
import { usePortalShiftDetail, useShiftNotes, useStartShift, useStartBreak, useEndBreak } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { StatusBadge } from '@/components/StatusBadge'
import { BackButton } from '@/components/BackButton'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useIsBelowLg } from '@/hooks/useIsBelowLg'
import { useTabParam } from '@/hooks/useTabParam'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FactBar, type FactBarSegment } from '@/components/FactBar'
import { glanceState } from '@/components/glanceState'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { Tabs } from '@/components/Tabs'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import { formatShiftTimeRange, RATIO_LABELS, formatElapsedSince, formatMinutesSpan, formatVarianceMinutes } from '@/pages/rostering/lib/roster'
import { formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { httpStatusOf, isNotFoundError } from '@/lib/httpStatus'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { EARLIEST_START_LEAD_MINUTES, OVERNIGHT_SUPPORT_LABELS, portalStatusLabel, rosteredInstants } from './lib/portal'
import { ShiftNotesSection } from './components/ShiftNotesSection'
import { HandoverSection, GlanceSection, ContactsSection, MustKnowLine } from './shift/BeforeSection'
import { DuringSection } from './shift/DuringSection'
import { FinishFlow } from './shift/FinishFlow'
import { DoseSheet, type DoseTarget } from './shift/DoseSheet'
import { dueDoseKeys } from './shift/checklist'
import { loadEndDraft } from './shift/endDraft'
import { requestGeolocation } from './shift/geolocation'
import { useOnline } from './shift/useOnline'
import { ActionBar, Chip, Section } from './shift/ui'
import { useNow } from './shift/useNow'
import type { PortalShiftDetailDto, StartShiftDto } from '@/api/types'

const TAB_KEYS = ['now', 'about', 'notes'] as const
type TabKey = typeof TAB_KEYS[number]

const clock = (iso: string, tz: string) => formatWithTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit' })

/** Two figures by state (SHAPE §3), so one row on a phone. "On shift" ticks every 30 seconds and is not a live region. */
function GlanceStrip({ shift }: { shift: PortalShiftDetailDto }) {
  const [now] = useNow(30_000)
  const c = shift.completion
  let segments: FactBarSegment[] = []
  if (shift.status === 'Published') {
    const start = rosteredInstants(shift).start
    segments = [
      { label: 'Starts', value: start ? clock(start, shift.timeZoneId) : '—' },
      { label: 'Due this shift', value: shift.medicationsDue.length + shift.shiftRoutines.length },
    ]
  } else if (shift.status === 'InProgress' && c) {
    const due = dueDoseKeys(shift.finishBlockers).size
    // The Attention Tint Rule: the tint and its chip only when something is overdue, time-bound compliance.
    const overdue = shift.medicationsDue.some(d => d.state === 'Overdue' && !d.outcome)
    segments = [
      { label: 'On shift', value: <span aria-label="Time on shift">{formatElapsedSince(c.actualStart, now)}</span> },
      { label: 'Due now', value: due, ...(overdue ? glanceState('warning', 'Overdue') : due === 0 ? glanceState('positive', 'All done') : {}) },
    ]
  } else if ((shift.status === 'PendingReview' || shift.status === 'Completed') && c) {
    segments = [
      { label: 'Time worked', value: formatMinutesSpan(c.netWorkedMinutes) },
      { label: 'Breaks', value: `${c.breakMinutes} min` },
    ]
  }
  return segments.length ? <FactBar variant="glance" segments={segments} /> : null
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
        {c.originalActualStart && (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Start changed from</dt>
            <dd>{formatWithTimeZone(c.originalActualStart, tz, { hour: 'numeric', minute: '2-digit' })}</dd>
          </>
        )}
        {c.originalActualEnd && (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Finish changed from</dt>
            <dd>{formatWithTimeZone(c.originalActualEnd, tz, { hour: 'numeric', minute: '2-digit' })}</dd>
          </>
        )}
        {c.timeAdjustmentReason && (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Reason</dt>
            <dd>{c.timeAdjustmentReason}</dd>
          </>
        )}
        {c.kilometres != null && (
          <>
            <dt className="text-[var(--color-muted-foreground)]">Kilometres</dt>
            <dd>{c.kilometres} km</dd>
          </>
        )}
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
  useDocumentTitle(shift ? shift.participant.fullName : 'Shift')   // also covers the loading and error states, which have no PageHeader
  const { canCompleteOwnShifts } = usePermissions()
  const online = useOnline()
  const belowLg = useIsBelowLg()
  const [now] = useNow(30_000)
  const [tab, setTab] = useTabParam(TAB_KEYS, 'now')
  const { data: notes } = useShiftNotes(id)
  const startShift = useStartShift()
  const startBreak = useStartBreak()
  const endBreak = useEndBreak()
  const [actionError, setActionError] = useState<string | null>(null)
  // A draft with an open step means the worker was mid-finish (left for the incident form, or reloaded): open it again at that step.
  const [finishing, setFinishing] = useState(() => !!id && loadEndDraft(id)?.step != null)
  const [submitted, setSubmitted] = useState(false)
  const submittedTitle = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (submitted) submittedTitle.current?.focus() }, [submitted])
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

  function openFinish() {
    setFinishing(true)
    setTimeout(() => document.getElementById('finish')?.scrollIntoView?.({ block: 'start' }), 0)
  }

  function closeFinish(done: boolean) {
    setFinishing(false)
    if (done) {
      setSubmitted(true)
      setTab('now')
    } else {
      // Back to shift returns focus to the control that opened the flow (SHAPE §6).
      setTimeout(() => document.getElementById('end-shift')?.focus(), 0)
    }
  }


  // Step 4's "Add or edit notes": close the flow (its entries are saved) and open Notes, focusing its tab as a tap on it would.
  function editNotes() {
    setFinishing(false)
    setTab('notes')
    setTimeout(() => document.getElementById('shift-tab-notes')?.focus(), 0)
  }

  function showAbout() {
    setTab('about')
    // A tab chosen from a link leaves focus on the link; move it to the tab, as a tap on the tab would (SHAPE §6).
    setTimeout(() => document.getElementById('shift-tab-about')?.focus(), 0)
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
  const tz = shift.timeZoneId
  const returned = shift.status === 'Published' && shift.returnCount > 0 && !!shift.lastReturnReason
  const inProgress = shift.status === 'InProgress'
  const showBefore = shift.status === 'Published' || inProgress
  const running = shift.breaks.find(b => b.isRunning)
  const h = shift.handover
  // Before the start the handover is read on Now. Mid-shift it stays there only while it waits to be acknowledged; else it lives in Notes.
  const handoverOnNow = shift.status === 'Published' || (inProgress && !!h?.requiresAcknowledgement && !h.isRead)
  const startAt = rosteredInstants(shift).start
  const opensAt = startAt ? Date.parse(startAt) - EARLIEST_START_LEAD_MINUTES * 60_000 : 0
  const canStartNow = now.getTime() >= opensAt
  // A draft can outlive the shift being in progress (another device submitted it): only an in-progress shift opens the flow.
  const inFlow = finishing && inProgress
  const tabbed = belowLg && !inFlow
  // Phone: real tab panels, all mounted. Desktop, or while finishing: plain columns, the flow in place of Now (Notes and, on a phone, About are hidden but stay mounted).
  const panel = (key: TabKey) => tabbed
    ? { role: 'tabpanel' as const, id: `shift-panel-${key}`, 'aria-labelledby': `shift-tab-${key}`, hidden: tab !== key }
    : { id: `shift-panel-${key}`, hidden: inFlow && (key === 'notes' || (belowLg && key === 'about')) }
  const noteCount = notes?.length ?? 0

  const nowContent = (
    <>
      {submitted && (
        <Callout
          tone="success"
          announce={false}
          title={<span ref={submittedTitle} tabIndex={-1} className="focus:outline-none">Shift submitted</span>}
          actions={<Button to="/portal" variant="secondary" size="lg">Back to my shifts</Button>}
        >
          A coordinator will review it. You can still add notes.
        </Callout>
      )}
      {returned && <Callout tone="info" title="Returned for changes">{shift.lastReturnReason}</Callout>}
      {shift.status === 'Cancelled' && <Callout tone="info">This shift was cancelled.</Callout>}
      {!canAct && <Callout tone="info">You can look at this shift but you can't change it.</Callout>}
      {shift.status === 'Published' && canAct && !canStartNow && (
        <p className="text-sm">You can start from {clock(new Date(opensAt).toISOString(), tz)}.</p>
      )}
      {handoverOnNow && <HandoverSection shift={shift} canAct={canAct} online={online} />}
      {showBefore && <MustKnowLine shift={shift} onAbout={showAbout} />}
      {shift.notes && (
        <Section id="roster-notes" title="From the roster" icon={<ScrollText className="w-4 h-4" aria-hidden="true" />}>
          <p className="text-sm whitespace-pre-wrap">{shift.notes}</p>
        </Section>
      )}
      {inProgress && <DuringSection shift={shift} canAct={canAct} online={online} onRecord={target => setSheet({ target, notGiven: false })} />}
      {showBefore && <ContactsSection shift={shift} compact />}
      {shift.status === 'PendingReview' && !submitted && <Callout tone="info">Submitted. It is waiting for a coordinator to review it.</Callout>}
      {(shift.status === 'PendingReview' || shift.status === 'Completed') && <SubmittedSummary shift={shift} />}
    </>
  )

  const notesContent = (
    <>
      {showBefore && !handoverOnNow && <HandoverSection shift={shift} canAct={canAct} online={online} title="From the last shift" />}
      {shift.status === 'Published'
        ? <p className="text-sm text-[var(--color-muted-foreground)]">You can add notes once your shift starts.</p>
        : <ShiftNotesSection shiftId={shift.id} participantId={participant.id} participantName={participant.fullName}
            serviceDate={shift.serviceDate} startTime={shift.startTime} endTime={shift.endTime} endsNextDay={shift.endsNextDay} />}
    </>
  )

  // About, safety first (SHAPE §3): At a glance, Risks, About this participant.
  const aboutContent = (
    <>
      {/* As today, At a glance is drawn only before and during the shift. */}
      {showBefore && <GlanceSection shift={shift} />}
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
    </>
  )

  // At lg the bar spans the main column only: the 22rem About column plus the 1rem grid gap (finish review fix 7).
  const MAIN_COLUMN_BAR = 'lg:mr-[23rem]'
  let bar: ReactNode = null
  if (canAct && shift.status === 'Published' && canStartNow) {
    bar = (
      <ActionBar className={MAIN_COLUMN_BAR}>
        <Button size="lg" className="flex-1 lg:flex-none" onClick={handleStart} disabled={startShift.isPending || !online}>
          {startShift.isPending ? 'Starting…' : 'Start shift'}
        </Button>
      </ActionBar>
    )
  } else if (canAct && inProgress && !inFlow && !submitted) {
    bar = (
      <ActionBar className={MAIN_COLUMN_BAR}>
        <Button size="lg" variant={running ? 'primary' : 'secondary'} className="flex-1 lg:flex-none" onClick={() => handleBreak(running?.id)}
          disabled={!online || startBreak.isPending || endBreak.isPending}>
          {running ? 'End break' : 'Start break'}
        </Button>
        <Button id="end-shift" size="lg" variant={running ? 'secondary' : 'primary'} className="flex-1 lg:flex-none" onClick={openFinish}>End shift</Button>
      </ActionBar>
    )
  }

  // No bottom padding on a phone: the sticky bar, then the bottom nav's own padding, end the page.
  return (
    <div className="space-y-3 lg:space-y-4 animate-fade-in lg:pb-4">
      <AnnouncementRegion message={submitted ? 'Shift submitted. A coordinator will review it.' : ''} />
      <BackButton to="/portal" label="my shifts" variant="link" history={false} className="py-3" />
      <PageHeader
        variant="detail"
        title={participant.fullName}
        subtitle={
          <PageHeaderMeta>
            <StatusBadge status={shift.status} label={portalStatusLabel(shift)} size="md" />
            {format(parseISO(shift.serviceDate), 'EEE d MMM')}
            {`${formatShiftTimeRange(shift.startTime, shift.endTime)}${shift.endsNextDay ? ' (+1 day)' : ''}`}
            {shift.ratio !== 'OneToOne' && (RATIO_LABELS[shift.ratio] ?? shift.ratio)}
            {shift.nightType !== 'None' && `Overnight: ${shift.nightType}`}
            {running && `On a break since ${clock(running.startedAt, tz)}`}
          </PageHeaderMeta>
        }
      />
      {!(belowLg && inFlow) && <GlanceStrip shift={shift} />}
      {!online && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm">
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          You're offline. Recording, breaks and Finish need a connection, so they're switched off until it's back.
        </div>
      )}
      {tabbed && (
        <Tabs
          tabs={[
            { id: 'now', label: 'Now', panelId: 'shift-panel-now' },
            { id: 'about', label: 'About', panelId: 'shift-panel-about' },
            { id: 'notes', label: 'Notes', badge: noteCount || undefined, panelId: 'shift-panel-notes' },
          ]}
          active={tab}
          onChange={setTab}
          ariaLabel="Shift"
          idPrefix="shift"
        />
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-4 min-w-0">
          <div {...panel('now')} className="space-y-3 lg:space-y-4">
            {inFlow
              ? <FinishFlow shift={shift} online={online} canAct={canAct} onRecord={(target, notGiven) => setSheet({ target, notGiven })} onClose={closeFinish} onEditNotes={editNotes} />
              : nowContent}
          </div>
          {/* Hidden, never unmounted, while finishing: ShiftNotesSection keeps a half-typed note in its own state (plan check S1). */}
          <div {...panel('notes')} className="space-y-4">{notesContent}</div>
        </div>
        <div {...panel('about')} className="space-y-4">{aboutContent}</div>
      </div>
      {actionError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{actionError}</p>}
      {bar}
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
