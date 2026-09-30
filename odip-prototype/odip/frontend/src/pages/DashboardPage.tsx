import { useMemo } from 'react'
import { useDashboard, useSettings, useStaff, useParticipantAlertsAggregate, usePendingLeaveCount } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { ALERT_SEVERITY_STYLES, ALERT_TYPE_LABELS } from '@/components/alertSeverityStyles'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Card } from '@/components/Card'
import { StatCard, type StatCardProps } from '@/components/StatCard'
import { TAP_FLOOR } from '@/components/tapArea'
import { Link } from 'react-router-dom'
import {
  Map, ListChecks, ChevronRight, ShieldAlert
} from 'lucide-react'

// ── Helpers ──

function dueAgo(dueDate: string): string {
  const diffMs = Date.now() - new Date(dueDate).getTime()
  if (diffMs < 0) return 'upcoming'
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

const priorityStyle: Record<string, string> = {
  High: 'text-[var(--color-destructive)] bg-[var(--color-error-container)]/30 uppercase tracking-widest',
  Medium: 'text-[var(--color-muted-foreground)] bg-[var(--color-surface-container)] uppercase tracking-widest',
  Low: 'text-[var(--color-info)] bg-[var(--color-surface-container-low)] uppercase tracking-widest',
}

const statusBadge: Record<string, string> = {
  Draft:           'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
  Planning:        'bg-[var(--color-secondary-container)]/60 text-[var(--color-secondary)]',
  OpenForBookings: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  WaitlistOnly:    'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  Confirmed:       'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  InProgress:      'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
  Completed:       'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
}

// Tint an attention tile only when its count is actionable (> 0); at zero it is quiet.
const tinted = (count: number, tone: 'danger' | 'warning') => (count > 0 ? tone : undefined)

// The noun agrees with the count: 1 is singular, and 0 and everything else plural ("0 upcoming trips").
const counted = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`

// The attention band's shape by item count (7 without alerts, 8 with them, 9 with a pending-leave item too). Below md it is two
// columns (an odd last item takes the whole row, like the trip glance strip on a phone). From md it is two balanced rows
// (ceil(n / 2) columns; an odd last item stretches over the spare slot, so a row is never left with a hole). It becomes ONE
// row once the band's own width gives every item 9.5rem (152px): n × 152 + (n − 1) × 8px gaps. That is a container query on
// the band, not a viewport breakpoint, so the 232px sidebar and the pointer's gutter do not matter. Full class strings, so
// Tailwind can see them.
const BAND_SHAPE: Record<number, { grid: string; last: string }> = {
  7: { grid: 'md:grid-cols-4 @min-[1112px]:grid-cols-7', last: 'col-span-2 @min-[1112px]:col-span-1' },
  8: { grid: 'md:grid-cols-4 @min-[1272px]:grid-cols-8', last: '' },
  9: { grid: 'md:grid-cols-5 @min-[1432px]:grid-cols-9', last: 'col-span-2 @min-[1432px]:col-span-1' },
}
const BAND_SHAPE_FALLBACK = { grid: 'md:grid-cols-4', last: '' }

export default function DashboardPage() {
  const { canViewAlerts, canApproveLeave } = usePermissions()
  const { data, isLoading, isError } = useDashboard()
  const { data: settings } = useSettings()
  const { data: allStaff = [] } = useStaff({ isActive: 'true' })
  const { data: alertsAggregate = [], isLoading: alertsLoading } = useParticipantAlertsAggregate(canViewAlerts)
  const pendingLeaveCount = usePendingLeaveCount(canApproveLeave)

  const warningDays = settings?.qualificationWarningDays ?? 30

  // Hooks must run unconditionally on every render — this has to sit above the isLoading/isError
  // early returns below, not after them.
  const qualIssueCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return (allStaff as any[]).reduce((count: number, s: any) => {
      const checks = [
        { flag: s.isFirstAidQualified, expiry: s.firstAidExpiryDate },
        { flag: s.isDriverEligible, expiry: s.driverLicenceExpiryDate },
        { flag: s.isManualHandlingCompetent, expiry: s.manualHandlingExpiryDate },
        { flag: s.isMedicationCompetent, expiry: s.medicationCompetencyExpiryDate },
        // Worker screening has no boolean qualification flag — it only "applies" (and can be
        // an issue) once an expiry date has actually been entered.
        { flag: !!s.workerScreeningExpiryDate, expiry: s.workerScreeningExpiryDate },
      ]
      return count + checks.filter(({ flag, expiry }) => {
        if (!flag) return false
        if (!expiry) return true  // no date set counts as an issue
        const diff = Math.floor((new Date(expiry + 'T00:00:00').getTime() - today.getTime()) / 86400000)
        return diff <= warningDays
      }).length
    }, 0)
  }, [allStaff, warningDays])

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      </div>
    )
  }

  if (isError) return (
    <div className="p-[var(--card-pad)] text-center text-[var(--color-destructive)]">Failed to load dashboard. Please refresh the page.</div>
  )

  const d = data || {
    upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0,
    overdueTaskCount: 0, conflictCount: 0, tripsMissingAccommodation: 0,
    tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0,
    qscOverdueCount: 0, upcomingTrips: [], overdueTasks: [],
  }

  // Defensive filter (fix round 1 — review finding): the aggregate endpoint already excludes
  // inactive/archived participants server-side, but an archived participant's stale data (e.g. a
  // PlanEndDate from before they left) must never surface as a permanent, undismissable Critical
  // alert here even if this hook is ever reused without that server-side default.
  const criticalAlertItems = alertsAggregate
    .filter((p) => p.isActive)
    .flatMap((p) =>
      p.alerts
        .filter((a) => a.severity === 'Critical')
        .map((a) => ({ participantId: p.participantId, participantName: p.participantName, alert: a }))
    )

  // The needs-attention band: a fixed order, so a position always means the same item. An item is dropped only by the two
  // conditions the dashboard always had (the alerts item needs canViewAlerts, Pending Leave needs canApproveLeave and a
  // non-empty queue); everything else stays in place at zero and just goes quiet. Every count, link and caption is the one
  // the KPI row carried; the everyday counts moved into the header's summary line.
  const attentionItems: StatCardProps[] = [
    {
      label: 'Qualification Issues',
      value: qualIssueCount,
      to: '/qualifications',
      tone: tinted(qualIssueCount, 'danger'),
      caption: qualIssueCount === 0 ? 'All clear' : undefined,
    },
    ...(canViewAlerts
      ? [
          {
            label: 'Critical Participant Alerts',
            value: criticalAlertItems.length,
            to: '/participants',
            tone: tinted(criticalAlertItems.length, 'danger'),
            // Don't claim "All clear" — or a definite zero — while the alerts request is still in flight: a false
            // negative here is worse than a placeholder, since coordinators rely on this item to know whether any
            // participant needs urgent attention. `loading` shows an en dash instead of the 0 and never tints it.
            loading: alertsLoading,
            caption: !alertsLoading && criticalAlertItems.length === 0 ? 'All clear' : undefined,
          },
        ]
      : []),
    { label: 'Overdue', value: d.overdueTaskCount, tone: tinted(d.overdueTaskCount, 'danger') },
    { label: 'Missing Accommodation', value: d.tripsMissingAccommodation, tone: tinted(d.tripsMissingAccommodation, 'warning') },
    { label: 'Missing Vehicles', value: d.tripsMissingVehicles, tone: tinted(d.tripsMissingVehicles, 'warning') },
    { label: 'Missing Staff', value: d.tripsMissingStaff, tone: tinted(d.tripsMissingStaff, 'warning') },
    { label: 'Open Incidents', value: d.openIncidentCount, tone: tinted(d.openIncidentCount, 'warning') },
    { label: 'QSC Overdue', value: d.qscOverdueCount, tone: tinted(d.qscOverdueCount, 'danger') },
    // Pending Leave stays out at zero (it was never one of the fixed items): nothing to action when the queue is empty.
    ...(canApproveLeave && pendingLeaveCount > 0
      ? [{ label: 'Pending Leave', value: pendingLeaveCount, to: '/rostering/leave', tone: 'warning' as const }]
      : []),
  ]
  const bandShape = BAND_SHAPE[attentionItems.length] ?? BAND_SHAPE_FALLBACK

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* Title at the display step (PageHeader variant="detail"), with the everyday counts as one quiet line in the meta
          row: they are context, not something to act on, so they no longer take a tile each. */}
      <PageHeader
        variant="detail"
        title="Management Dashboard"
        subtitle={
          <PageHeaderMeta>
            <span className="tabular-nums">{counted(d.upcomingTripCount, 'upcoming trip', 'upcoming trips')}</span>
            <span className="tabular-nums">{counted(d.activeParticipantCount, 'active participant', 'active participants')}</span>
            <span className="tabular-nums">{counted(d.outstandingTaskCount, 'outstanding task', 'outstanding tasks')}</span>
          </PageHeaderMeta>
        }
      />

      {/* ── Needs attention — display-step figures; only a non-zero item is tinted (DESIGN.md "Attention band") ── */}
      <section aria-label="Needs attention" className="@container">
        <div className={`grid grid-cols-2 gap-2 ${bandShape.grid}`}>
          {attentionItems.map((item, i) => (
            <StatCard
              key={item.label}
              variant="attention"
              {...item}
              className={i === attentionItems.length - 1 ? bandShape.last || undefined : undefined}
            />
          ))}
        </div>
      </section>

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
                const badge = statusBadge[t.status] || statusBadge.Draft
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
                      {t.currentParticipantCount}/{t.maxParticipants || '—'} pax
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${badge}`}>
                      {t.status.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
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
            <Link to="/tasks" className={`${TAP_FLOOR} text-xs font-bold text-[var(--color-primary)] hover:underline`}>
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
                const badgeClass = priorityStyle[t.priority] || priorityStyle.Medium
                const initials = (t.ownerName || 'UN').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={t.id} className="flex h-10 min-h-[var(--tap-min)] items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--color-surface-container-low)]">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass}`}>
                      {t.priority || 'Medium'}
                    </span>
                    {/* The title carries the participant name (e.g. "… — Sienna W."), so it is the
                        cell that flexes; the trip and due cells give way to it when the panel is
                        narrow. `title` reveals the full text where it still has to truncate. */}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-foreground)]" title={t.title}>{t.title}</span>
                    <span className="hidden w-44 shrink-0 truncate text-xs text-[var(--color-muted-foreground)] @3xl:inline" title={t.tripName}>
                      {t.tripName}
                    </span>
                    <span className="hidden shrink-0 text-xs text-[var(--color-muted-foreground)] @2xl:inline">
                      Due {dueAgo(t.dueDate)}
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

      {/* Critical Participant Alerts — coordinator/admin-facing (task 6c) */}
      {canViewAlerts && criticalAlertItems.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-display font-bold text-[var(--color-foreground)]">Critical Participant Alerts</h3>
            <Link to="/participants" className={`${TAP_FLOOR} text-sm font-bold text-[var(--color-primary)] hover:underline`}>
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
