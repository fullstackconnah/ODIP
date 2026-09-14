import { useMemo } from 'react'
import { useDashboard, useSettings, useStaff, useParticipantAlertsAggregate, usePendingLeaveCount } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { ALERT_SEVERITY_STYLES, ALERT_TYPE_LABELS } from '@/components/alertSeverityStyles'
import { Link } from 'react-router-dom'
import {
  Map, Users, ListChecks, ChevronRight, CalendarDays, MapPin, ShieldAlert
} from 'lucide-react'

// ── Helpers ──

function dueAgo(dueDate: string): string {
  const diffMs = Date.now() - new Date(dueDate).getTime()
  if (diffMs < 0) return 'upcoming'
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

const priorityStyle: Record<string, { badge: string; card: string }> = {
  High:   { badge: 'text-[var(--color-destructive)] bg-[var(--color-error-container)]/30 uppercase tracking-widest', card: 'bg-[var(--color-error-container)]/10 border border-[var(--color-destructive)]/10' },
  Medium: { badge: 'text-[var(--color-muted-foreground)] bg-[var(--color-surface-container)] uppercase tracking-widest', card: 'bg-[var(--color-surface-container-low)] border border-[rgba(195,201,181,0.3)]' },
  Low:    { badge: 'text-[var(--color-info)] bg-[var(--color-surface-container-low)] uppercase tracking-widest', card: 'bg-[var(--color-surface-container-low)] border border-[rgba(195,201,181,0.3)]' },
}

const tripCardGradient: Record<string, string> = {
  Draft:           'from-[var(--color-surface-container)] to-[var(--color-input)]',
  Planning:        'from-[var(--color-secondary-container)] to-[#b9c7df]',
  OpenForBookings: 'from-[var(--color-primary)] to-[var(--color-primary-container)]',
  WaitlistOnly:    'from-amber-500 to-amber-700',
  Confirmed:       'from-[var(--color-primary)] to-[var(--color-primary-container)]',
  InProgress:      'from-[#8e337b] to-[#ab4c95]',
  Completed:       'from-[var(--color-surface-container)] to-[var(--color-input)]',
}

const tripCardIconColor: Record<string, string> = {
  Draft:           'text-[var(--color-muted-foreground)]/50',
  Planning:        'text-[var(--color-info)]',
  OpenForBookings: 'text-white',
  WaitlistOnly:    'text-white',
  Confirmed:       'text-white',
  InProgress:      'text-white',
  Completed:       'text-[var(--color-muted-foreground)]/50',
}

const statusBadge: Record<string, string> = {
  Draft:           'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
  Planning:        'bg-[var(--color-secondary-container)]/60 text-[var(--color-secondary)]',
  OpenForBookings: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  WaitlistOnly:    'bg-amber-100 text-amber-700',
  Confirmed:       'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  InProgress:      'bg-[#ffd7ef]/60 text-[#8e337b]',
  Completed:       'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
}

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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (isError) return (
    <div className="p-8 text-center text-red-600">Failed to load dashboard. Please refresh the page.</div>
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

  const smallStats = [
    d.overdueTaskCount > 0 && { label: 'Overdue', value: d.overdueTaskCount, color: 'text-[var(--color-destructive)]', bg: 'bg-[var(--color-error-container)]/20' },
    d.tripsMissingAccommodation > 0 && { label: 'Missing Accomm.', value: d.tripsMissingAccommodation, color: 'text-[var(--color-foreground)]', bg: 'bg-[var(--color-surface-container)]' },
    d.tripsMissingVehicles > 0 && { label: 'Missing Vehicles', value: d.tripsMissingVehicles, color: 'text-[var(--color-foreground)]', bg: 'bg-[var(--color-surface-container)]' },
    d.tripsMissingStaff > 0 && { label: 'Missing Staff', value: d.tripsMissingStaff, color: 'text-[var(--color-foreground)]', bg: 'bg-[var(--color-surface-container)]' },
    d.openIncidentCount > 0 && { label: 'Open Incidents', value: d.openIncidentCount, color: 'text-[var(--color-on-warning-container)]', bg: 'bg-[var(--color-warning-container)]' },
    d.qscOverdueCount > 0 && { label: 'QSC Overdue', value: d.qscOverdueCount, color: 'text-[var(--color-destructive)]', bg: 'bg-[var(--color-error-container)]/20' },
  ].filter(Boolean) as Array<{ label: string; value: number; color: string; bg: string }>

  return (
    <div className="space-y-6 md:space-y-10">
      {/* ── Page Header ── */}
      <div>
        <h1 className="font-display font-extrabold text-2xl md:text-4xl text-[var(--color-foreground)] tracking-tight mb-1 md:mb-2">
          Management Dashboard
        </h1>
        <p className="text-sm md:text-base text-[var(--color-muted-foreground)] font-medium">
          Centralized overview of your NDIS trip operations.
        </p>
      </div>

      {/* ── Metrics Bento Grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 md:gap-4">
        {/* Upcoming Trips */}
        <div className="col-span-1 lg:col-span-2 bg-[var(--color-surface-container-low)] p-4 md:p-6 rounded-2xl md:rounded-[2rem]">
          <p className="text-xs md:text-sm text-[var(--color-muted-foreground)] mb-1 font-medium">Upcoming Trips</p>
          <p className="text-2xl md:text-3xl font-display font-bold text-[var(--color-primary)]">{d.upcomingTripCount}</p>
        </div>

        {/* Active Participants */}
        <div className="col-span-1 lg:col-span-2 bg-[var(--color-surface-container-low)] p-4 md:p-6 rounded-2xl md:rounded-[2rem]">
          <p className="text-xs md:text-sm text-[var(--color-muted-foreground)] mb-1 font-medium">Active Participants</p>
          <p className="text-2xl md:text-3xl font-display font-bold text-[var(--color-primary)]">{d.activeParticipantCount}</p>
        </div>

        {/* Outstanding Tasks - accent */}
        <div className="col-span-2 lg:col-span-3 bg-[#ffd7ef]/20 p-4 md:p-6 rounded-2xl md:rounded-[2rem] border border-[#8e337b]/20">
          <p className="text-xs md:text-sm text-[#8e337b] mb-1 font-medium">Outstanding Tasks</p>
          <p className="text-2xl md:text-3xl font-display font-bold text-[#8e337b]">{d.outstandingTaskCount}</p>
        </div>

        {/* Qualification Issues */}
        <Link
          to="/qualifications"
          className={`col-span-2 lg:col-span-2 p-6 rounded-[2rem] flex flex-col justify-between hover:opacity-90 transition-opacity ${
            qualIssueCount > 0
              ? 'bg-[var(--color-error-container)]/30 border border-[var(--color-destructive)]/20'
              : 'bg-[var(--color-surface-container-low)]'
          }`}
        >
          <p className={`text-sm mb-1 font-medium ${qualIssueCount > 0 ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>
            Qualification Issues
          </p>
          <p className={`text-3xl font-display font-bold ${qualIssueCount > 0 ? 'text-[var(--color-destructive)]' : 'text-[var(--color-primary)]'}`}>
            {qualIssueCount > 0 ? qualIssueCount : <span className="material-symbols-outlined text-3xl leading-none">check_circle</span>}
          </p>
          {qualIssueCount === 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">All clear</p>
          )}
        </Link>

        {/* Critical Participant Alerts */}
        {canViewAlerts && (
          <Link
            to="/participants"
            className={`col-span-2 lg:col-span-3 p-6 rounded-[2rem] flex flex-col justify-between hover:opacity-90 transition-opacity ${
              criticalAlertItems.length > 0
                ? 'bg-[var(--color-error-container)]/30 border border-[var(--color-destructive)]/20'
                : 'bg-[var(--color-surface-container-low)]'
            }`}
          >
            <p className={`text-sm mb-1 font-medium ${criticalAlertItems.length > 0 ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>
              Critical Participant Alerts
            </p>
            <p className={`text-3xl font-display font-bold ${criticalAlertItems.length > 0 ? 'text-[var(--color-destructive)]' : 'text-[var(--color-primary)]'}`}>
              {alertsLoading ? (
                <span className="inline-block h-7 w-7 rounded-full bg-[var(--color-muted)] animate-pulse" />
              ) : criticalAlertItems.length > 0 ? (
                criticalAlertItems.length
              ) : (
                <span className="material-symbols-outlined text-3xl leading-none" aria-hidden="true">check_circle</span>
              )}
            </p>
            {/* Don't claim "All clear" while the alerts request is still in flight — a false
                negative here is worse than a brief blank line, since coordinators rely on this
                tile to know whether any participant needs urgent attention. */}
            {!alertsLoading && criticalAlertItems.length === 0 && (
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1">All clear</p>
            )}
          </Link>
        )}

        {/* Small alert cards */}
        {smallStats.map(s => (
          <div key={s.label} className={`${s.bg} p-3 md:p-4 rounded-2xl md:rounded-[2rem] flex flex-col justify-center`}>
            <p className="text-[10px] md:text-xs text-[var(--color-muted-foreground)] mb-1 font-medium">{s.label}</p>
            <p className={`text-lg md:text-xl font-display font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}

        {/* Pending Leave — coordinator/admin-facing (I-6), same zero-hides-the-card idiom as the
            other small alert cards above, but clickable through to the approvals queue. */}
        {canApproveLeave && pendingLeaveCount > 0 && (
          <Link
            to="/rostering/leave"
            className="bg-[var(--color-warning-container)] p-3 md:p-4 rounded-2xl md:rounded-[2rem] flex flex-col justify-center hover:opacity-90 transition-opacity"
          >
            <p className="text-[10px] md:text-xs text-[var(--color-muted-foreground)] mb-1 font-medium">Pending Leave</p>
            <p className="text-lg md:text-xl font-display font-bold text-[var(--color-on-warning-container)]">{pendingLeaveCount}</p>
          </Link>
        )}
      </div>

      {/* ── Main Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">

        {/* Upcoming Trips — takes 2 columns */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl md:text-2xl font-display font-bold text-[var(--color-foreground)]">Upcoming Trips</h3>
            <Link to="/trips" className="text-[var(--color-primary)] font-bold text-sm hover:underline">
              View All
            </Link>
          </div>

          <div className="space-y-4">
            {d.upcomingTrips.length === 0 ? (
              <div className="bg-[var(--color-surface-container-low)] rounded-[2rem] p-8 text-center">
                <Map className="w-8 h-8 text-[var(--color-muted-foreground)] mx-auto mb-3 opacity-40" />
                <p className="text-sm text-[var(--color-muted-foreground)]">No upcoming trips</p>
              </div>
            ) : d.upcomingTrips.slice(0, 5).map((t: any) => {
              const grad = tripCardGradient[t.status] || tripCardGradient.Draft
              const iconColor = tripCardIconColor[t.status] || 'text-[var(--color-muted-foreground)]/50'
              const badge = statusBadge[t.status] || statusBadge.Draft
              return (
                <Link key={t.id} to={`/trips/${t.id}`}
                  className="group bg-white hover:bg-[var(--color-surface-container-low)] transition-all duration-300 rounded-2xl md:rounded-[2rem] p-4 md:p-5 flex items-center gap-3 md:gap-5"
                  style={{ boxShadow: '0 2px 12px rgba(27,28,26,0.04)' }}
                >
                  {/* Gradient thumbnail */}
                  <div className={`w-14 h-14 md:w-20 md:h-20 rounded-xl md:rounded-[1.25rem] bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:scale-105 transition-transform duration-300`}>
                    <Map className={`w-5 h-5 md:w-7 md:h-7 ${iconColor}`} />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1 md:mb-2 gap-2 md:gap-3">
                      <h4 className="text-sm md:text-base font-bold text-[var(--color-foreground)] truncate">{t.tripName}</h4>
                      <span className={`text-[10px] font-bold px-2 md:px-3 py-0.5 md:py-1 rounded-full flex-shrink-0 ${badge}`}>
                        {t.status.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 md:gap-4 text-[var(--color-muted-foreground)] text-[11px] md:text-xs font-medium flex-wrap">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3 h-3 md:w-3.5 md:h-3.5" />
                        {formatDateAu(t.startDate)}
                      </span>
                      {t.destination && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 md:w-3.5 md:h-3.5" />
                          {t.destination}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3 md:w-3.5 md:h-3.5" />
                        {t.currentParticipantCount}/{t.maxParticipants || '—'} pax
                      </span>
                    </div>
                  </div>

                  {/* Chevron - hidden on small mobile */}
                  <button className="hidden sm:flex w-10 h-10 rounded-full border border-[rgba(195,201,181,0.5)] items-center justify-center text-[var(--color-muted-foreground)] hover:bg-[var(--color-primary)] hover:text-white hover:border-[var(--color-primary)] transition-all flex-shrink-0">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Overdue Tasks — 1 column */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl md:text-2xl font-display font-bold text-[var(--color-foreground)]">Overdue Tasks</h3>
            <Link to="/tasks" className="text-[var(--color-primary)] font-bold text-sm hover:underline">
              View All
            </Link>
          </div>

          <div className="space-y-4">
            {d.overdueTasks.length === 0 ? (
              <div className="bg-[var(--color-surface-container-low)] rounded-[2rem] p-8 text-center">
                <ListChecks className="w-8 h-8 text-[var(--color-muted-foreground)] mx-auto mb-3 opacity-40" />
                <p className="text-sm text-[var(--color-muted-foreground)]">No overdue tasks</p>
              </div>
            ) : d.overdueTasks.slice(0, 5).map((t: any) => {
              const ps = priorityStyle[t.priority] || priorityStyle.Medium
              const initials = (t.ownerName || 'UN').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
              return (
                <div key={t.id} className={`${ps.card} p-5 rounded-[1.5rem]`}>
                  <div className="flex items-start justify-between mb-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${ps.badge}`}>
                      {t.priority || 'Medium'}
                    </span>
                    <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                      Due {dueAgo(t.dueDate)}
                    </span>
                  </div>
                  <h5 className="font-bold text-[var(--color-foreground)] mb-1 text-sm">{t.title}</h5>
                  <p className="text-xs text-[var(--color-muted-foreground)] mb-4">{t.tripName}</p>
                  <div className="flex items-center justify-between">
                    <div className="w-7 h-7 rounded-full bg-[var(--color-primary-fixed)] border-2 border-white flex items-center justify-center text-[9px] font-bold text-[var(--color-on-primary-fixed)]">
                      {initials}
                    </div>
                    <Link to={`/tasks/${t.id}/edit`} className="text-[var(--color-primary)] text-xs font-bold flex items-center gap-1 hover:underline">
                      View <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Critical Participant Alerts — coordinator/admin-facing (task 6c) */}
      {canViewAlerts && criticalAlertItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl md:text-2xl font-display font-bold text-[var(--color-foreground)]">Critical Participant Alerts</h3>
            <Link to="/participants" className="text-[var(--color-primary)] font-bold text-sm hover:underline">
              View All
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                  className={`p-5 rounded-[1.5rem] ${style.bg} border border-[var(--color-destructive)]/10 hover:opacity-90 transition-opacity`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-widest ${style.text}`}>
                      <Icon className="w-3 h-3" /> {style.label}
                    </span>
                  </div>
                  <h5 className="font-bold text-[var(--color-foreground)] mb-1 text-sm flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 opacity-60" /> {participantName}
                  </h5>
                  {typeLabel && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-0.5">{typeLabel}</p>
                  )}
                  <p className="text-xs text-[var(--color-muted-foreground)] mb-4">{alert.message}</p>
                  <div className="flex items-center justify-end">
                    <span className="text-[var(--color-primary)] text-xs font-bold flex items-center gap-1">
                      View <ChevronRight className="w-3.5 h-3.5" />
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
