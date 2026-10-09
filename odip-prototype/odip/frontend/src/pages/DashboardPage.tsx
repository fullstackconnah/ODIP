import { useMemo } from 'react'
import { useDashboard, useSettings, useStaff, useParticipantAlertsAggregate, usePendingLeaveQueue, usePendingCompletionQueue } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { formatRatio, formatRelative, plural } from '@/lib/format'
import { credentialIssueCount, staffCredentials } from '@/lib/credentials'
import { awaitsData } from '@/lib/queryPhase'
import { localIsoDate } from '@/lib/dateOnly'
import { formatToday, greetingFor } from '@/lib/greeting'
import { usePermissions } from '@/lib/permissions'
import { useNow } from '@/hooks/useNow'
import { ALERT_SEVERITY_STYLES, ALERT_TYPE_LABELS } from '@/components/alertSeverityStyles'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Card } from '@/components/Card'
import { StatusBadge } from '@/components/StatusBadge'
import { TAP_FLOOR } from '@/components/tapArea'
import { AttentionBand, type BandItem } from './dashboard/AttentionBand'
import { BUDGET_OVER_ALERT, budgetsAtRisk } from '@/lib/budgetRisk'
import { budgetsAtRiskItem } from './budgets/budgetBand'
import { Link } from 'react-router-dom'
import {
  Map, ListChecks, ChevronRight, ShieldAlert
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
function DashboardHeader({ now, fullName, counts }: {
  now: Date
  fullName: string | null
  counts?: { upcomingTrips: number; activeParticipants: number; outstandingTasks: number }
}) {
  return (
    <PageHeader
      variant="detail"
      title={greetingFor(now, fullName)}
      titleNote={<time dateTime={localIsoDate(now)}>{formatToday(now)}</time>}
      documentTitle="Management Dashboard"
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

export default function DashboardPage() {
  const { canViewAlerts, canApproveLeave, canReviewCompletions, canAccessPage, isReadOnly, fullName } = usePermissions()
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
  const pendingLeave = usePendingLeaveQueue(canApproveLeave)
  const pendingCompletions = usePendingCompletionQueue(canReviewCompletions)

  const warningDays = settings?.qualificationWarningDays ?? 30

  // Hooks must run unconditionally on every render — this has to sit above the loading/error
  // early returns below, not after them.
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

  if (summary.isError) return (
    <div className="p-[var(--card-pad)] text-center text-[var(--color-destructive)]">Failed to load dashboard. Please refresh the page.</div>
  )

  // No summary yet (in flight, or paused offline) is a spinner, never a summary of zeros: the band's "All clear" is only ever said over data that arrived. The greeting and the
  // date do not wait for it, so the personality is the first thing on screen and the spinner sits under it.
  const d = summary.data
  if (!d) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)]">
        <DashboardHeader now={now} fullName={fullName} />
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
        </div>
      </div>
    )
  }

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
  const attentionItems: BandItem[] = []
  // The tile links to the Qualifications page, so a role that cannot open it (a SupportWorker) gets no tile rather than one that bounces.
  if (canAccessPage('qualifications')) {
    attentionItems.push({
      label: 'Qualification Issues',
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
  if (canViewAlerts) {
    attentionItems.push({
      label: 'Critical Participant Alerts',
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
  // ReadOnly reaches the Schedule but its writes are refused (permissions.ts keeps canWrite for it and the server answers 403), so it is offered the page and not a verb it
  // cannot use. Both links go to the same page, so they may share a name.
  const scheduleVerb = (verb: string) => (isReadOnly ? 'Open schedule' : verb)
  attentionItems.push(
    // Opens the Tasks list on its Overdue filter: the same rule the figure counts (TaskOverdue on the server), so the rows match the number.
    {
      label: 'Overdue', noun: 'overdue tasks', count: d.overdueTaskCount, tone: 'danger',
      detail: 'Tasks past their due date and still open.',
      action: { label: 'Open overdue tasks', to: '/tasks?status=Overdue' },
    },
    // The three "Missing" counts are of the trips the server calls upcoming (they start today or within 60 days). A vehicle or a staff member is assigned to a trip on the
    // Schedule (the same assignments the count reads), and accommodation on the trip's own tab, so that one opens the Trips list to choose the trip.
    {
      label: 'Missing Accommodation', noun: 'trips missing accommodation', count: d.tripsMissingAccommodation, tone: 'warning',
      detail: `${tripsStart(d.tripsMissingAccommodation)} within 60 days with no accommodation reserved.`,
      action: { label: 'Open trips', to: '/trips' },
    },
    {
      label: 'Missing Vehicles', noun: 'trips missing vehicles', count: d.tripsMissingVehicles, tone: 'warning',
      detail: `${tripsStart(d.tripsMissingVehicles)} within 60 days with no vehicle assigned.`,
      action: { label: scheduleVerb('Assign vehicles'), to: '/schedule' },
    },
    {
      label: 'Missing Staff', noun: 'trips missing staff', count: d.tripsMissingStaff, tone: 'warning',
      detail: `${tripsStart(d.tripsMissingStaff)} within 60 days with no staff assigned.`,
      action: { label: scheduleVerb('Assign staff'), to: '/schedule' },
    },
    {
      label: 'Open Incidents', noun: 'open incidents', count: d.openIncidentCount, tone: 'warning',
      detail: 'Incidents not yet resolved or closed.',
      action: { label: 'Open incidents', to: '/incidents' },
    },
    // The Incidents list already has this filter (?qsc=overdue): the same rule the figure counts.
    {
      label: 'QSC Overdue', noun: 'overdue QSC reports', count: d.qscOverdueCount, tone: 'danger',
      detail: 'Reportable incidents with no QSC report after 24 hours.',
      action: { label: 'Review QSC reports', to: '/incidents?qsc=overdue' },
    },
  )
  if (canApproveLeave) {
    attentionItems.push({
      label: 'Pending Leave',
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
  if (canReviewCompletions) {
    attentionItems.push({
      label: 'Shift Completions',
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

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* The top of the page is the peak: a greeting and today's date at the display step, the everyday counts as one quiet line in the meta row (context, not
          something to act on), and under them the needs-attention band, which is as big as the day's trouble: a tall tile per item that needs somebody, or one
          Pale Sprout field when nothing does (DESIGN.md "Attention band"). Everything below is the ordinary dense page. */}
      <DashboardHeader
        now={now}
        fullName={fullName}
        counts={{ upcomingTrips: d.upcomingTripCount, activeParticipants: d.activeParticipantCount, outstandingTasks: d.outstandingTaskCount }}
      />

      <AttentionBand items={attentionItems} />

      {/* ── Main Content Grid — Upcoming Trips / Overdue Tasks ──
          One column below xl, then an even split (1920: (1648 − 16) / 2 = 816px each). Each panel
          is its own size container, and row columns switch on the *panel's* width rather than the
          viewport's, so a column only shows when the row can afford it: at 1920 the Overdue Tasks
          panel has 790px inside its padding, i.e. a 774px row = 62 badge + 176 trip + 66 due +
          24 avatar + 43 "View" + 5×8 gaps = 412px of fixed cells, leaving ~362px for the title
          (longest seeded title is 328px). Narrower panels drop the trip / due cells first, so the
          title — which carries the participant name — is what gets the space. ── */}
      <div className="grid grid-cols-1 items-start gap-[var(--section-gap)] xl:grid-cols-2">

        {/* Upcoming Trips */}
        <Card className="@container">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Upcoming Trips</h3>
            <Link to="/trips" className={`${TAP_FLOOR} text-xs font-bold text-[var(--color-primary)] hover:underline`}>
              View All
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
                    <StatusBadge status={t.status} label={t.status.replace(/([A-Z])/g, ' $1').trim()} className="shrink-0 font-bold" />
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        {/* Overdue Tasks */}
        <Card className="@container">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Overdue Tasks</h3>
            <Link to="/tasks?status=Overdue" className={`${TAP_FLOOR} text-xs font-bold text-[var(--color-primary)] hover:underline`}>
              View All
            </Link>
          </div>

          {d.overdueTasks.length === 0 ? (
            <div className="py-6 text-center">
              <ListChecks className="mx-auto mb-2 h-6 w-6 text-[var(--color-muted-foreground)] opacity-40" />
              <p className="text-sm text-[var(--color-muted-foreground)]">No overdue tasks</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {d.overdueTasks.slice(0, 5).map((t: any) => {
                const initials = (t.ownerName || 'UN').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={t.id} className="flex h-10 min-h-[var(--tap-min)] items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--color-surface-container-low)]">
                    {/* One priority mapping everywhere (Low info, Medium warning, High and Urgent danger): StatusBadge's tones. */}
                    <StatusBadge status={t.priority || 'Medium'} className="shrink-0 font-bold uppercase tracking-widest" />
                    {/* The title carries the participant name (e.g. "… — Sienna W."), so it is the
                        cell that flexes; the trip and due cells give way to it when the panel is
                        narrow. `title` reveals the full text where it still has to truncate. */}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-foreground)]" title={t.title}>{t.title}</span>
                    <span className="hidden w-44 shrink-0 truncate text-xs text-[var(--color-muted-foreground)] @3xl:inline" title={t.tripName}>
                      {t.tripName}
                    </span>
                    <span className="hidden shrink-0 text-xs text-[var(--color-muted-foreground)] @2xl:inline">
                      Due {formatRelative(t.dueDate, { style: 'compact' })}
                    </span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-fixed)] text-xs font-bold text-[var(--color-on-primary-fixed)]">
                      {initials}
                    </span>
                    <Link
                      to={`/tasks/${t.id}/edit`}
                      className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center gap-0.5 text-xs font-bold text-[var(--color-primary)] hover:underline"
                    >
                      View <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Critical Participant Alerts — coordinator/admin-facing (task 6c). The same detail as the band's alerts tile, listed: it takes the panels' own heading and
          link size (the title step, 12px "View All") rather than the 18px heading it used to have, so the band above stays the loudest thing on the page. */}
      {canViewAlerts && criticalAlertItems.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Critical Participant Alerts</h3>
            <Link to="/participants" className={`${TAP_FLOOR} text-xs font-bold text-[var(--color-primary)] hover:underline`}>
              View All
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-[var(--section-gap)] md:grid-cols-2 lg:grid-cols-3">
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
                  className={`rounded-[var(--radius-md)] p-[var(--card-pad)] ${style.bg} border border-[var(--color-destructive)]/10 transition-opacity hover:opacity-90`}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <span className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-bold uppercase tracking-widest ${style.text}`}>
                      <Icon className="h-3 w-3" /> {style.label}
                    </span>
                  </div>
                  <h5 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[var(--color-foreground)]">
                    <ShieldAlert className="h-4 w-4 opacity-60" /> {participantName}
                  </h5>
                  {typeLabel && (
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{typeLabel}</p>
                  )}
                  <p className="mb-2 text-xs text-[var(--color-muted-foreground)]">{alert.message}</p>
                  <div className="flex items-center justify-end">
                    <span className="flex items-center gap-1 text-xs font-bold text-[var(--color-primary)]">
                      View <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
