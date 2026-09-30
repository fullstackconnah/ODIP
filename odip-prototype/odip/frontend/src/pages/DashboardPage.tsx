import { useMemo } from 'react'
import { useDashboard, useSettings, useStaff, useParticipantAlertsAggregate, usePendingLeaveCount } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { ALERT_SEVERITY_STYLES, ALERT_TYPE_LABELS } from '@/components/alertSeverityStyles'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/Card'
import { StatCard } from '@/components/StatCard'
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

// Tint a KPI tile only when its count is actionable (> 0).
const tinted = (count: number, tone: 'danger' | 'warning') => (count > 0 ? tone : undefined)

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

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <PageHeader title="Management Dashboard" subtitle="Centralized overview of your NDIS trip operations." />

      {/* ── KPI row — every metric in one row, tinted only when actionable ── */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
        <StatCard label="Upcoming Trips" value={d.upcomingTripCount} />
        <StatCard label="Active Participants" value={d.activeParticipantCount} />
        <StatCard label="Outstanding Tasks" value={d.outstandingTaskCount} />
        <StatCard
          label="Qualification Issues"
          value={qualIssueCount}
          to="/qualifications"
          tone={tinted(qualIssueCount, 'danger')}
          caption={qualIssueCount === 0 ? 'All clear' : undefined}
        />
        {canViewAlerts && (
          <StatCard
            label="Critical Participant Alerts"
            value={criticalAlertItems.length}
            to="/participants"
            tone={tinted(criticalAlertItems.length, 'danger')}
            // Don't claim "All clear" while the alerts request is still in flight — a false
            // negative here is worse than a brief blank caption, since coordinators rely on
            // this tile to know whether any participant needs urgent attention.
            caption={!alertsLoading && criticalAlertItems.length === 0 ? 'All clear' : undefined}
          />
        )}
        <StatCard label="Overdue" value={d.overdueTaskCount} tone={tinted(d.overdueTaskCount, 'danger')} />
        <StatCard label="Missing Accomm." value={d.tripsMissingAccommodation} tone={tinted(d.tripsMissingAccommodation, 'warning')} />
        <StatCard label="Missing Vehicles" value={d.tripsMissingVehicles} tone={tinted(d.tripsMissingVehicles, 'warning')} />
        <StatCard label="Missing Staff" value={d.tripsMissingStaff} tone={tinted(d.tripsMissingStaff, 'warning')} />
        <StatCard label="Open Incidents" value={d.openIncidentCount} tone={tinted(d.openIncidentCount, 'warning')} />
        <StatCard label="QSC Overdue" value={d.qscOverdueCount} tone={tinted(d.qscOverdueCount, 'danger')} />
        {/* Pending Leave stays hidden at zero (not part of the fixed 10-tile KPI set) — nothing
            to action when the queue is empty. */}
        {canApproveLeave && pendingLeaveCount > 0 && (
          <StatCard label="Pending Leave" value={pendingLeaveCount} to="/rostering/leave" tone="warning" />
        )}
      </div>

      {/* ── Main Content Grid — Upcoming Trips (~60%) / Overdue Tasks (~40%) at 1920 ── */}
      <div className="grid grid-cols-1 gap-[var(--section-gap)] lg:grid-cols-[3fr_2fr]">

        {/* Upcoming Trips */}
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Upcoming Trips</h3>
            <Link to="/trips" className="text-xs font-bold text-[var(--color-primary)] hover:underline">
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
                    className="flex h-10 items-center gap-3 rounded-[var(--radius-sm)] px-2 transition-colors hover:bg-[var(--color-surface-container-low)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-foreground)]">{t.tripName}</span>
                    <span className="hidden shrink-0 tabular-nums text-xs text-[var(--color-muted-foreground)] sm:inline">
                      {formatDateAu(t.startDate)}
                    </span>
                    <span className="hidden w-28 shrink-0 truncate text-xs text-[var(--color-muted-foreground)] md:inline">
                      {t.destination || 'TBD'}
                    </span>
                    <span className="hidden shrink-0 tabular-nums text-xs text-[var(--color-muted-foreground)] sm:inline">
                      {t.currentParticipantCount}/{t.maxParticipants || '—'} pax
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge}`}>
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
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Overdue Tasks</h3>
            <Link to="/tasks" className="text-xs font-bold text-[var(--color-primary)] hover:underline">
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
                  <div key={t.id} className="flex h-10 items-center gap-3 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--color-surface-container-low)]">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
                      {t.priority || 'Medium'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-foreground)]">{t.title}</span>
                    <span className="hidden w-24 shrink-0 truncate text-xs text-[var(--color-muted-foreground)] md:inline">
                      {t.tripName}
                    </span>
                    <span className="hidden shrink-0 text-xs text-[var(--color-muted-foreground)] sm:inline">
                      Due {dueAgo(t.dueDate)}
                    </span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-fixed)] text-[9px] font-bold text-[var(--color-on-primary-fixed)]">
                      {initials}
                    </span>
                    <Link
                      to={`/tasks/${t.id}/edit`}
                      className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-[var(--color-primary)] hover:underline"
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
            <Link to="/participants" className="text-sm font-bold text-[var(--color-primary)] hover:underline">
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
                    <span className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${style.text}`}>
                      <Icon className="h-3 w-3" /> {style.label}
                    </span>
                  </div>
                  <h5 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[var(--color-foreground)]">
                    <ShieldAlert className="h-4 w-4 opacity-60" /> {participantName}
                  </h5>
                  {typeLabel && (
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{typeLabel}</p>
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
