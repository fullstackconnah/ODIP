import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDashboard, useSettings, useStaff, useParticipantAlertsAggregate, usePendingLeaveQueue, usePendingCompletionQueue, useModuleVisibility, useSetupStatus, useProviderSettings } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { TRIP_STATUS_LABELS } from '@/lib/tone'
import type { TripStatus } from '@/api/types'
import { formatRatio, plural } from '@/lib/format'
import { credentialIssueCount, staffCredentials } from '@/lib/credentials'
import { awaitsData, retryingAfterError } from '@/lib/queryPhase'
import { localIsoDate } from '@/lib/dateOnly'
import { formatToday, greetingFor } from '@/lib/greeting'
import { usePermissions } from '@/lib/permissions'
import { isSetupHidden, setupCard } from '@/lib/organisationSetup'
import { useNow } from '@/hooks/useNow'
import { ALERT_SEVERITY_STYLES, ALERT_TYPE_LABELS } from '@/components/alertSeverityStyles'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Card } from '@/components/Card'
import { PageState } from '@/components/PageState'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { StatusBadge } from '@/components/StatusBadge'
import { TAP_FLOOR } from '@/components/tapArea'
import { SetupSteps } from './dashboard/SetupSteps'
import { AllClearField, AttentionBand, type BandItem } from './dashboard/AttentionBand'
import { decisionGates } from './dashboard/decisionGates'
import { useDecisionGroups } from './dashboard/useDecisionGroups'
import { useDecisionState } from './dashboard/useDecisionState'
import { NeedsYourDecision } from './dashboard/NeedsYourDecision'
import { isPresent } from './dashboard/quickGroupModel'
import { DashboardShortcuts, PlatformEntryRail } from '@/components/layout/PlatformDirectory'
import { platformNavigation } from '@/components/layout/platformDirectoryModel'
import { BUDGET_OVER_ALERT, budgetsAtRisk } from '@/lib/budgetRisk'
import { budgetsAtRiskItem } from './budgets/budgetBand'
import { Link } from 'react-router-dom'
import {
  Map, ChevronRight, ShieldAlert
} from 'lucide-react'

// ── Helpers ──

// The server's "upcoming" window (DashboardController.GetSummary): a trip that starts today or in the next 60 days. The three "Missing …" counts are of those trips,
// so their lines say so, and a count of one reads in the singular.
const tripsStart = (n: number) => (n === 1 ? 'Trip starts' : 'Trips start')

// The title: a greeting by the hour with today's date after it, both read from the viewer's clock (lib/greeting.ts), which the page refreshes every minute (`useNow`), so a
// page left open since the morning is not still saying "Good morning" at three, or yesterday's date at midnight. The tab keeps naming the page, whatever the hour: the `h1`
// is the greeting, the document title stays "Management Dashboard".
// The greeting and the date need no data (the clock and the sign-in are enough), so the page opens with them while the summary is still on its way; the counts line is data, and
// is left out until the counts are.
function DashboardHeader({ now, fullName, counts, action }: {
  now: Date
  fullName: string | null
  counts?: { upcomingTrips: number; activeParticipants: number; outstandingTasks: number }
  action?: ReactNode
}) {
  return (
    <PageHeader
      variant="detail"
      title={greetingFor(now, fullName)}
      titleNote={<time dateTime={localIsoDate(now)}>{formatToday(now)}</time>}
      documentTitle="Management Dashboard"
      action={action}
      subtitle={
        counts && (
          <PageHeaderMeta>
            <span className="tabular-nums">{plural(counts.upcomingTrips, 'upcoming trip')}</span>
            <span className="tabular-nums">{plural(counts.activeParticipants, 'active participant')}</span>
            <span className="tabular-nums">{plural(counts.outstandingTasks, 'outstanding task')}</span>
          </PageHeaderMeta>
        )
      }
    />
  )
}

const SETUP_HIDDEN_MESSAGE = 'Setup steps hidden. Show them again from Settings, Organisation setup.'

export default function DashboardPage() {
  const permissions = usePermissions()
  const visibility = useModuleVisibility()
  const platform = platformNavigation(permissions, visibility.isError ? undefined : visibility.data)
  const { canViewAlerts, canApproveLeave, canReviewCompletions, canAccessPage, isReadOnly, fullName, id, isAdmin, isSuperAdmin, canImportData } = permissions
  // The viewer's clock, ticking every minute. The title reads it, and so does the one figure that depends on the day (the qualification count below), so the page never
  // advertises a new date beside a count that still belongs to yesterday.
  const now = useNow()
  const today = localIsoDate(now)
  const summary = useDashboard()
  const { data: settings } = useSettings()
  const staff = useStaff({ isActive: 'true' })
  const alerts = useParticipantAlertsAggregate(canViewAlerts)
  // "Waiting" is not `isLoading`: a request PAUSED while the browser is offline is pending with isLoading false (lib/queryPhase.ts), and reading that as an answer
  // is how a band says "All clear" over data that was never asked for. A disabled query (the alerts, for a role that cannot view them) is not waiting.
  const { data: allStaff = [], isError: staffError } = staff
  const { data: alertsAggregate = [], isError: alertsError } = alerts
  const staffLoading = awaitsData(staff)
  const alertsLoading = awaitsData(alerts)
  const warningDays = settings?.qualificationWarningDays ?? 30

  // The groups this viewer decides here, by the server's own gates (SHAPE §3). A SuperAdmin decides only inside an organisation: the key canImportData reads.
  const gates = decisionGates(permissions, !!localStorage.getItem('odip_viewing_tenant'))
  const groups = useDecisionGroups(gates, { viewerId: id, today, warningDays, mayCloseBudgetReview: isAdmin || isSuperAdmin, staff })
  const decision = useDecisionState()
  const [hasRecovery, setHasRecovery] = useState(false)
  // The Critical participant alerts disclosure: collapsed on every visit; its header carries what the band tile did (card42 §3.2).
  const [alertsOpen, setAlertsOpen] = useState(false)
  const alertsPanelId = useId()
  // A queue is counted in the band only where its group is not shown (call 6); a viewer with the group reads the same requests there.
  const pendingLeave = usePendingLeaveQueue(canApproveLeave && !gates.leave)
  const pendingCompletions = usePendingCompletionQueue(canReviewCompletions && !gates.completions)

  // The same rule as the Qualifications list (lib/credentials.ts), so this figure is the sum of that page's issue counts: a credential
  // needs action when it has no date, is expired, is due today or is due within the warning window. Counted against `today`, and recounted when the day turns over
  // (a window that opens at midnight is counted at midnight, though react-query hands back the same staff array until something changes).
  const { qualIssueCount, qualIssueStaffCount } = useMemo(() => {
    let issues = 0
    let staffWithIssues = 0
    for (const s of allStaff) {
      const n = credentialIssueCount(staffCredentials(s, { warnDays: warningDays, today }))
      issues += n
      if (n > 0) staffWithIssues += 1
    }
    return { qualIssueCount: issues, qualIssueStaffCount: staffWithIssues }
  }, [allStaff, warningDays, today])

  // No summary yet (in flight, or paused offline) is a spinner in the Alerts slot, never a band of zeros, and a failed one is an error there: neither holds the
  // decision groups hostage (SHAPE §6). The greeting and the date need no data.
  const d = summary.data

  // Defensive filter (fix round 1 — review finding): the aggregate endpoint already excludes
  // inactive/archived participants server-side, but an archived participant's stale data (e.g. a
  // PlanEndDate from before they left) must never surface as a permanent, undismissable Critical
  // alert here even if this hook is ever reused without that server-side default.
  const criticalAlertItems = alertsAggregate
    .filter((p) => p.isActive)
    .flatMap((p) =>
      p.alerts
        .filter((a) => a.severity === 'Critical' && a.type !== BUDGET_OVER_ALERT)   // "over budget" is the Budgets at risk tile's: see budgetRisk below
        .map((a) => ({ participantId: p.participantId, participantName: p.participantName, alert: a }))
    )
  // How many participants those alerts belong to: one flagged row each on the Participants table.
  const criticalParticipantCount = new Set(criticalAlertItems.map((i) => i.participantId)).size
  // Budgets at risk (phase 2b) counts participants from the same aggregate. A participant already over budget has a Critical alert, which would be counted a second time as a Critical Participant
  // Alert beside this tile, so that one alert (and only that one) is left out of the Critical count and list: the tile, in the danger tone, is where "over" reaches the dashboard. The NDIA's
  // "the funds ran out" alert is a different fact and stays with the Critical alerts.
  const budgetRisk = budgetsAtRisk(alertsAggregate)
  // A loaded or held list of Critical alerts is shown as the disclosure under the band, so the band does not repeat it as a tile (card42).
  const criticalListed = canViewAlerts && criticalAlertItems.length > 0

  // The needs-attention band: every item the dashboard counts, in a fixed order, handed to the band, which makes a tile of each one that needs somebody and names the rest
  // in one "All clear" row. An item is left out only by what the role can open: Qualification Issues needs the Qualifications page, the alerts item needs canViewAlerts,
  // Pending Leave needs canApproveLeave and Shift Completions needs canReviewCompletions (the same gates as the nav badge). Every count but Shift Completions is one the KPI
  // row carried; the everyday counts live in the header's summary line. Each line says what the count means in the server's own terms, and each link goes to the page where
  // it is fixed (a route that exists today). "Nothing needs you right now" is only as true as this list, so it carries what the nav badges count too (leave AND completions).
  //
  // The four items computed from their own request never claim "All clear", or show a definite 0, without data: while the request is in flight (`loading`) or after it
  // failed (`error`) the item is an en dash placeholder, never tinted, with no line and no link of its own, and the band is not "all clear" while one is. A false negative
  // here is worse than a placeholder, since coordinators rely on these items to know whether any staff qualification, participant, leave request or shift needs them.
  // Qualification Issues counts the staff list; Critical Participant Alerts counts the participant-alerts aggregate; Pending Leave and Shift Completions count their queues.
  // (The summary's `conflictCount` is not an item: no page lists or fixes conflicts, and it counts every flagged record regardless of date, including the staff overrides a
  // coordinator has already acknowledged.)
  // An item that became one of this viewer's decision groups is left out; for everyone else it stays a tile, exactly as before (SHAPE call 6).
  const attentionItems: BandItem[] = []
  // The tile links to the Qualifications page, so a role that cannot open it (a SupportWorker) gets no tile rather than one that bounces.
  if (canAccessPage('qualifications') && !gates.compliance) {
    attentionItems.push({
      label: 'Qualification issues',
      noun: 'qualification issues',
      count: qualIssueCount,
      tone: 'danger',
      // The tile counts credential issues; the Qualifications page's tabs count staff ("All Issues (4)"). Say both, so 12 reads against 4.
      detail: `Expired, undated or due within ${plural(warningDays, 'day')}, across ${plural(qualIssueStaffCount, 'staff member')}.`,
      action: { label: 'Review qualifications', to: '/qualifications' },
      to: '/qualifications',
      loading: staffLoading,
      error: staffError,
    })
  }
  // Only a count that is not known yet stays a tile (the en dash while loading or after a failure); a zero is named in the All clear row; a loaded positive is the
  // disclosure under the band instead.
  if (canViewAlerts && (!criticalListed || alertsLoading || alertsError)) {
    attentionItems.push({
      label: 'Critical participant alerts',
      noun: 'critical participant alerts',
      count: criticalAlertItems.length,
      tone: 'danger',
      // The tile counts alerts; the Participants table shows one flagged row per participant. Say both, so 3 reads against 2 rows.
      detail: `Critical alerts across ${plural(criticalParticipantCount, 'participant')}.`,
      action: { label: 'Review participants', to: '/participants' },
      to: '/participants',
      loading: alertsLoading,
      error: alertsError,
    })
  }
  // Budgets at risk: counted from the same alerts, so while they are loading or failed the Critical Participant Alerts tile above is already the en dash that says so, and this one is simply not
  // there (a tile is only ever a count that arrived). The tile opens the Budgets list, so only a role that can open it is offered it. At zero it is a name in the All clear row, never a tile; and it is
  // named there only where a budget is in force and the NDIA has not said the funds ran out, so the band never says "all clear" about budgets nobody has recorded (budgetsAtRiskItem is null then).
  if (canViewAlerts && canAccessPage('budgets') && !alertsLoading && !alertsError) {
    const budgetItem = budgetsAtRiskItem(budgetRisk)
    if (budgetItem) attentionItems.push(budgetItem)
  }
  // ReadOnly reaches the Schedule but its writes are refused (canWrite is false for it: the server answers every write with 403), so it is offered the page and not a verb it
  // cannot use. Both links go to the same page, so they may share a name.
  const scheduleVerb = (verb: string) => (isReadOnly ? 'Open schedule' : verb)
  // The summary counts: drawn once the summary has arrived (the band waits for it, SHAPE §6).
  if (d) {
    if (!gates.tasks) attentionItems.push(
      // Opens the Tasks list on its Overdue filter: the same rule the figure counts (TaskOverdue on the server), so the rows match the number.
      {
        label: 'Overdue', noun: 'overdue tasks', count: d.overdueTaskCount, tone: 'danger',
        detail: 'Tasks past their due date and still open.',
        action: { label: 'Open overdue tasks', to: '/tasks?status=Overdue' },
      },
    )
    attentionItems.push(
      // The three "Missing" counts are of the trips the server calls upcoming (they start today or within 60 days). A vehicle or a staff member is assigned to a trip on the
      // Schedule (the same assignments the count reads), and accommodation on the trip's own tab, so that one opens the Trips list to choose the trip.
      {
        label: 'Missing accommodation', noun: 'trips missing accommodation', count: d.tripsMissingAccommodation, tone: 'warning',
        detail: `${tripsStart(d.tripsMissingAccommodation)} within 60 days with no accommodation reserved.`,
        action: { label: 'Open trips', to: '/trips' },
      },
      {
        label: 'Missing vehicles', noun: 'trips missing vehicles', count: d.tripsMissingVehicles, tone: 'warning',
        detail: `${tripsStart(d.tripsMissingVehicles)} within 60 days with no vehicle assigned.`,
        action: { label: scheduleVerb('Assign vehicles'), to: '/schedule' },
      },
      {
        label: 'Missing staff', noun: 'trips missing staff', count: d.tripsMissingStaff, tone: 'warning',
        detail: `${tripsStart(d.tripsMissingStaff)} within 60 days with no staff assigned.`,
        action: { label: scheduleVerb('Assign staff'), to: '/schedule' },
      },
    )
    if (!gates.incidents) attentionItems.push(
      {
        label: 'Open incidents', noun: 'open incidents', count: d.openIncidentCount, tone: 'warning',
        detail: 'Incidents not yet resolved or closed.',
        action: { label: 'Open incidents', to: '/incidents' },
      },
      // The Incidents list already has this filter (?qsc=overdue): the same rule the figure counts.
      {
        label: 'QSC overdue', noun: 'overdue QSC reports', count: d.qscOverdueCount, tone: 'danger',
        detail: 'Reportable incidents with no QSC report after 24 hours.',
        action: { label: 'Review QSC reports', to: '/incidents?qsc=overdue' },
      },
    )
  }
  if (canApproveLeave && !gates.leave) {
    attentionItems.push({
      label: 'Pending leave',
      noun: 'pending leave',
      count: pendingLeave.count,
      tone: 'warning',
      detail: 'Leave and unavailability requests waiting for a decision.',
      action: { label: 'Review leave requests', to: '/rostering/leave' },
      to: '/rostering/leave',
      loading: pendingLeave.loading,
      error: pendingLeave.error,
    })
  }
  // The other half of what the Staff & roster badge counts (leave plus completions): without it the band could say nothing needs anybody beside a red badge.
  if (canReviewCompletions && !gates.completions) {
    attentionItems.push({
      label: 'Shift completions',
      noun: 'shift completions',
      count: pendingCompletions.count,
      tone: 'warning',
      detail: 'Submitted shifts waiting for review before they are billed.',
      action: { label: 'Review completions', to: '/rostering/completions' },
      to: '/rostering/completions',
      loading: pendingCompletions.loading,
      error: pendingCompletions.error,
    })
  }
  // Every item has data and is at zero: the band is clear.
  const bandClear = !!d && !criticalListed && attentionItems.every((item) => !item.loading && !item.error && item.count === 0)
  // "Nothing needs you" only when it is true: every group and every alert has data and is at zero, and no consequence notice is waiting (SHAPE §6).
  const groupsClear = !hasRecovery && groups.every((group) => !isPresent(group, decision.gone, decision.notices.filter((n) => n.subject === group.key).length, decision.running.has(group.key)))
  // Setup card (onboarding phase 1): the people who can import are the people who set the organisation up. A hidden card does not query.
  const [setupHidden, setSetupHiddenState] = useState(isSetupHidden)
  const [hideNote, setHideNote] = useState('')
  const wantSetup = canImportData && !setupHidden
  // Hide unmounts the card, and the Alerts heading may be swapped for the All clear field in the same render: focus the id once that has committed.
  const justHid = useRef(false)
  useEffect(() => {
    if (setupHidden && justHid.current) { justHid.current = false; document.getElementById('dashboard-alerts')?.focus() }
  }, [setupHidden])
  const setup = useSetupStatus(wantSetup)
  const provider = useProviderSettings(wantSetup, 'always')
  // A failed query with no data goes back to pending/fetching on every retry: that is a failure, not a wait (lib/queryPhase.ts).
  const waits = (q: Parameters<typeof awaitsData>[0] & Parameters<typeof retryingAfterError>[0]) => awaitsData(q) && !retryingAfterError(q)
  const setupFailed = setup.isError || retryingAfterError(setup) || provider.isError || retryingAfterError(provider)
  const card = wantSetup ? setupCard(setup.data, { waiting: waits(setup) || waits(provider), failed: setupFailed }, today) : 'none'
  // The empty org's own card says what to do, so the page is not also "All clear"; a failed setup query is not known to be clear either.
  const pageClear = bandClear && groupsClear && card !== 'waiting' && card !== 'steps' && !(wantSetup && setupFailed)
  // Only the Alerts block waits for the card, so the decision groups below are not held back.
  const holdMain = card === 'waiting'
  const spinner = (
    <div className="flex h-32 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
    </div>
  )

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* The greeting and today's date at the display step, the everyday counts as one quiet line in the meta row; then what someone must fix (Alerts: the band and
          the Critical Participant Alerts cards), then what only this viewer can decide ("Needs your decision", one tab per kind), then what is coming
          (Upcoming trips). When the whole page is clear, one Pale Sprout field stands in place of both sections (SHAPE §3, §6). */}
      <DashboardHeader
        now={now}
        fullName={fullName}
        action={<DashboardShortcuts entries={platform} permissions={permissions} />}
        counts={d && { upcomingTrips: d.upcomingTripCount, activeParticipants: d.activeParticipantCount, outstandingTasks: d.outstandingTaskCount }}
      />
      {/* Mounted before any group can speak, outside the sections, so it survives the page turning all clear (SHAPE §10). sr-only, so it takes no gap. */}
      {groups.length > 0 && <AnnouncementRegion message={decision.announcement} />}
      {canImportData && <AnnouncementRegion message={hideNote} />}

      <div className={`grid gap-[var(--section-gap)] ${platform.length > 0 ? 'xl:grid-cols-[minmax(0,1fr)_18rem]' : ''}`}>
      <div className="flex min-w-0 flex-col gap-[var(--section-gap)]">
      {(card === 'steps' || card === 'done') && setup.data && (
        <SetupSteps status={setup.data} provider={provider.data ?? null} card={card} onHide={() => { justHid.current = true; setHideNote(SETUP_HIDDEN_MESSAGE); setSetupHiddenState(true) }} />
      )}
      {pageClear ? (
        // Same id as the Alerts heading, which it replaces: where focus lands when the last decision turns the page clear (QuickGroup's finish).
        <div id="dashboard-alerts" tabIndex={-1} className="focus:outline-none">
          <AllClearField labels={[...groups.map((group) => group.noun), ...attentionItems.map((item) => item.noun ?? item.label)]} />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {!holdMain && <h2 id="dashboard-alerts" tabIndex={-1} className="text-sm font-semibold focus:outline-none">Alerts</h2>}
            {holdMain ? spinner : summary.isError || retryingAfterError(summary) ? (
              <PageState kind="error" noun="dashboard summary" onRetry={() => summary.refetch()} />
            ) : !d ? (
              // No summary yet (in flight, or paused offline) is a spinner, never a band of zeros.
              spinner
            ) : (
              <>
                <AttentionBand items={attentionItems} />

                {/* Critical participant alerts (task 6c, card42): an APG disclosure under the band, collapsed by default. Its header does the old tile's job (severity,
                    count, how many participants, the link); the rows are one press away. Not <details>: an h3 inside <summary> drops out of heading navigation. */}
                {criticalListed && (
                  <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
                    <div className="flex flex-wrap items-center gap-x-2 px-[var(--card-pad)]">
                      <h3 className="text-sm font-semibold">
                        <button type="button" aria-expanded={alertsOpen} aria-controls={alertsPanelId} onClick={() => setAlertsOpen((open) => !open)}
                          className="flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-sm)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]">
                          <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-150 ease-out ${alertsOpen ? 'rotate-90' : ''}`} />
                          <span aria-hidden="true">Critical participant alerts</span>
                          <span aria-hidden="true" className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${ALERT_SEVERITY_STYLES.Critical.bg} ${ALERT_SEVERITY_STYLES.Critical.text}`}>
                            <ALERT_SEVERITY_STYLES.Critical.icon className="h-3 w-3" /> {criticalAlertItems.length}
                          </span>
                          <span className="sr-only">Critical participant alerts ({criticalAlertItems.length})</span>
                        </button>
                      </h3>
                      {/* Outside the heading, so its name stays the count: 3 alerts read against the 2 flagged rows on the Participants table. */}
                      <span className="text-[13px] text-[var(--color-muted-foreground)] max-md:order-last max-md:basis-full max-md:pb-2 max-md:pl-6">
                        across {plural(criticalParticipantCount, 'participant')}
                      </span>
                      <Link to="/participants" className={`${TAP_FLOOR} pointer-coarse:min-w-11 pointer-coarse:justify-end ml-auto text-xs font-bold text-[var(--color-primary)] hover:underline`}>
                        See all
                      </Link>
                    </div>

                    <div id={alertsPanelId} hidden={!alertsOpen} className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                      {criticalAlertItems.slice(0, 6).map(({ participantId, participantName, alert }) => {
                        const style = ALERT_SEVERITY_STYLES.Critical
                        const Icon = style.icon
                        // Alerts whose target isn't a participant-page tab (e.g. an open incident) link
                        // straight to that route instead of the participant's tab.
                        const href = alert.linkTo ?? `/participants/${participantId}?tab=${alert.deepLinkTab}`
                        const typeLabel = ALERT_TYPE_LABELS[alert.type]
                        return (
                          <Link
                            key={`${participantId}:${alert.type}:${alert.message}`}
                            to={href}
                            className={`flex items-center gap-3 px-[var(--card-pad)] py-3 ${style.bg} transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]`}
                          >
                            <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-bold ${style.text}`}><Icon className="h-3 w-3" /> {style.label}</span>
                            <div className="min-w-0 flex-1">
                            <h5 className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-foreground)]">
                              <ShieldAlert className="h-4 w-4 opacity-60" /> {participantName}
                            </h5>
                            {typeLabel && (
                              <p className="mb-0.5 text-xs font-semibold text-[var(--color-muted-foreground)]">{typeLabel}</p>
                            )}
                            <p className="text-xs text-[var(--color-muted-foreground)]">{alert.message}</p>
                            </div>
                            <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--color-primary)]">
                                View <ChevronRight className="h-3.5 w-3.5" />
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* The worklist under the Alerts (the owner's order): one tab per kind of decision. */}
          {gates.needsOrganisation && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Needs your decision</h2>
              <p className="text-[13px] text-[var(--color-muted-foreground)]">Choose an organisation to see its approvals.</p>
            </div>
          )}
          {groups.length > 0 && <NeedsYourDecision groups={groups} state={decision} onRecoveryPresenceChange={setHasRecovery} />}
        </>
      )}

      {/* Upcoming trips: the full width (its half-width partner, the Overdue Tasks panel, is gone: the Tasks due group replaced it). The card is its own size
          container, so its rows show their date, destination and pax columns as the card's width allows. */}
      {d && (
        <Card className="@container">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Upcoming trips</h2>
            <Link to="/trips" className={`${TAP_FLOOR} text-xs font-bold text-[var(--color-primary)] hover:underline`}>
              See all
            </Link>
          </div>

          {d.upcomingTrips.length === 0 ? (
            <div className="py-6 text-center">
              <Map className="mx-auto mb-2 h-6 w-6 text-[var(--color-muted-foreground)] opacity-40" />
              <p className="text-sm text-[var(--color-muted-foreground)]">No upcoming trips</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {d.upcomingTrips.slice(0, 5).map((t: any) => {
                return (
                  <Link
                    key={t.id}
                    to={`/trips/${t.id}`}
                    className="flex h-10 min-h-[var(--tap-min)] items-center gap-2 rounded-[var(--radius-sm)] px-2 transition-colors hover:bg-[var(--color-surface-container-low)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-foreground)]" title={t.tripName}>{t.tripName}</span>
                    <span className="hidden shrink-0 tabular-nums text-xs text-[var(--color-muted-foreground)] @md:inline">
                      {formatDateAu(t.startDate)}
                    </span>
                    <span className="hidden w-28 shrink-0 truncate text-xs text-[var(--color-muted-foreground)] @2xl:inline" title={t.destination || 'TBD'}>
                      {t.destination || 'TBD'}
                    </span>
                    <span className="hidden shrink-0 tabular-nums text-xs text-[var(--color-muted-foreground)] @lg:inline">
                      {formatRatio(t.currentParticipantCount, t.maxParticipants || '—')} pax
                    </span>
                    {/* The trip status is coloured by StatusBadge's own tones (lib/tone.ts), the same as the trip header, the schedule and the trips list. */}
                    <StatusBadge status={t.status} label={TRIP_STATUS_LABELS[t.status as TripStatus] ?? t.status} className="shrink-0 font-bold" />
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      )}
      </div>
      <PlatformEntryRail entries={platform} />
      </div>
    </div>
  )
}
