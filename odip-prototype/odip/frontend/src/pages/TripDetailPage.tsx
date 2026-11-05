import { Navigate, useLocation, useParams } from 'react-router-dom'
import { usePermissions } from '@/lib/permissions'
import { useTrip, useTripBookings, useTripAccommodation, useTripVehicles, useTripStaff, useTripTasks, useTripSchedule, useTripClaims, useTripIncidents, useParticipants } from '@/api/hooks'
import { CAN_RECEIVE_SERVICES } from '@/api/types/participants'
import { formatDateRange } from '@/lib/dateRange'
import { Users, Building2, UserCog, ListChecks, Calendar, Pencil, ClipboardList, ClockIcon, FileText, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { Tabs, type TabItem } from '@/components/Tabs'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { useTabParam } from '@/hooks/useTabParam'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { StatusBadge } from '@/components/StatusBadge'
import { TRIP_STATUS_LABELS } from '@/lib/tone'
import { FactBar, type FactBarSegment } from '@/components/FactBar'
import { glanceState } from '@/components/glanceState'
import { formatRatio, plural } from '@/lib/format'
import { OverviewTab, BookingsTab, AccommodationTab, VehiclesTab, StaffTab, TasksTab, ActivitiesTab, ClaimsTab, IncidentsTab, EditTripModal } from './trip-detail'
import { retryingAfterError } from '@/lib/queryPhase'

/** Material Symbols category glyph for a fact-bar segment — the same icons the pre-density stat
 * tiles carried (people, checklist, wheelchair, shield). FactBar pins the size and colour. */
const factIcon = (glyph: string) => <span className="material-symbols-outlined">{glyph}</span>

type Tab = 'overview' | 'bookings' | 'staff' | 'stay' | 'tasks' | 'activities' | 'claims' | 'incidents' | 'history'

const TAB_KEYS: Tab[] = ['overview', 'bookings', 'staff', 'stay', 'tasks', 'activities', 'claims', 'incidents', 'history']

// Accommodation and Vehicles share the Stay and transport tab; a saved link to either still lands there.
const LEGACY_TABS: Record<string, Tab> = { accommodation: 'stay', vehicles: 'stay' }

// What a tab's failed list is called in its error: "Couldn't load this booking list".
const LIST_NOUNS: Partial<Record<Tab, string>> = {
  bookings: 'booking list', staff: 'staff list',
  tasks: 'task list', activities: 'activity schedule', claims: 'claim list', incidents: 'incident list',
}

export default function TripDetailPage() {
  const { canWrite, canAccessPage, isAdmin: isAdminRole, isSuperAdmin } = usePermissions()
  const { id } = useParams()
  const location = useLocation()
  const isAdmin = isAdminRole || isSuperAdmin
  const canAccessIncidents = canAccessPage('incidents')
  // ClaimsController admits only SuperAdmin, Admin and Coordinator: anyone else gets no Claims tab and sends no claims request.
  const canAccessClaims = canAccessPage('claims')
  // PP-60: URL-synced so a shared/reloaded link lands on the same tab. Only the tabs this role can see are valid keys (L5-05): a ?tab= for
  // a tab it cannot see (incidents, history) reads as Overview, instead of selecting nothing over an empty body.
  const tabKeys = useMemo(
    () => TAB_KEYS.filter(key => (key === 'incidents' ? canAccessIncidents : key === 'claims' ? canAccessClaims : key === 'history' ? isAdmin : true)),
    [canAccessIncidents, canAccessClaims, isAdmin],
  )
  const [activeTab, setActiveTab] = useTabParam(tabKeys, 'overview')
  const [showEditTrip, setShowEditTrip] = useState(false)

  const pageQuery = useTrip(id)
  const { data: trip, isLoading, isError, error, refetch } = pageQuery
  // Each tab's own list, by tab key: a list that failed to load shows its error in the tab, never the tab's "none yet" body.
  const tabLists = {
    bookings: useTripBookings(id),
    accommodation: useTripAccommodation(id),
    vehicles: useTripVehicles(id),
    staff: useTripStaff(id),
    tasks: useTripTasks(id),
    // PP-61 follow-up: NOT gated by activeTab, despite schedule/claims being among the
    // least-visited tabs — both `schedule.reduce(...)` and `claims.length` feed the tab-label
    // count badges below, which render outside the Activities/Claims tabpanels (i.e. before
    // either tab is ever opened). Gating these on `activeTab` made those badges misleadingly show
    // 0 until the corresponding tab was visited once. The `enabled` option added to
    // useTripSchedule/useTripClaims for this stays in place; the claims call uses it for the role gate only.
    activities: useTripSchedule(id),
    claims: useTripClaims(id, { enabled: canAccessClaims }),
    incidents: useTripIncidents(id),
  }
  const bookings = tabLists.bookings.data ?? []
  const accommodation = tabLists.accommodation.data ?? []
  const vehicles = tabLists.vehicles.data ?? []
  const staff = tabLists.staff.data ?? []
  const tasks = tabLists.tasks.data ?? []
  const schedule = tabLists.activities.data ?? []
  const claims = tabLists.claims.data ?? []
  const incidents = tabLists.incidents.data ?? []
  // A refetch that fails over rows already on screen keeps them (Q4b): only a list with nothing loaded counts as failed.
  const activeList: { isError: boolean; data?: unknown[]; isFetching?: boolean; errorUpdateCount?: number; refetch: () => unknown } | undefined = tabLists[activeTab as keyof typeof tabLists]
  const listFailed = (list: NonNullable<typeof activeList>) => (list.isError || retryingAfterError(list)) && !list.data?.length
  const activeListFailed = !!activeList && listFailed(activeList)
  // INTAKE-08: the trip/booking picker (BookingsTab) excludes drafts.
  const { data: participants = [] } = useParticipants(CAN_RECEIVE_SERVICES)

  const isReadOnly = trip?.status === 'Cancelled' || trip?.status === 'Archived'

  // Rewritten before anything renders, so the old tab key never flashes Overview.
  const legacyTab = LEGACY_TABS[new URLSearchParams(location.search).get('tab') ?? '']
  if (legacyTab) {
    const params = new URLSearchParams(location.search)
    params.set('tab', legacyTab)
    return <Navigate to={{ search: params.toString() }} replace />
  }
  if (!id) return null
  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="trip" />
  if (!trip) {
    return (isError || retryingAfterError(pageQuery)) && !isNotFoundError(error)
      ? <PageState kind="error" noun="trip" onRetry={() => refetch()} />
      : <PageState kind="not-found" noun="trip" backTo="/trips" backLabel="trips" />
  }

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: ClipboardList },
    { id: 'bookings', label: 'Bookings', icon: Users, badge: bookings.length },
    { id: 'staff', label: 'Staff', icon: UserCog, badge: staff.length },
    // No count: rooms plus vans sum to nothing meaningful.
    { id: 'stay', label: 'Stay and transport', icon: Building2 },
    { id: 'tasks', label: 'Tasks', icon: ListChecks, badge: tasks.length },
    { id: 'activities', label: 'Activities', icon: Calendar, badge: schedule.reduce((sum: number, d: any) => sum + (d.scheduledActivities?.length || 0), 0) },
    ...(canAccessClaims ? [{ id: 'claims' as string, label: 'Claims', icon: FileText, badge: claims.length }] : []),
    ...(canAccessIncidents ? [{ id: 'incidents' as string, label: 'Incidents', icon: ShieldAlert, badge: incidents.length }] : []),
    ...(isAdmin ? [{ id: 'history' as string, label: 'History', icon: ClockIcon }] : []),
  ]

  // Each tile is have / need of ONE noun (formatRatio), its chip AND its attention tint come from one tone (`glanceState`) so the
  // strip can never tint a tile its own chip calls fine, and each tile opens the tab that fixes the gap it states. A Cancelled or
  // Archived trip is past fixing, so its tiles keep the figures and drop the chips and tints. Waitlist and a staff shortfall are warning; the other gaps are negative.
  const insuranceConfirmed = trip.insuranceConfirmedCount ?? 0
  const insuranceOutstanding = trip.insuranceOutstandingCount ?? 0
  const staffShort = Math.max(0, (trip.staffRequired ?? 0) - trip.staffAssignedCount)
  const gap = (n: number, tone: 'warning' | 'negative', chip: string) => (n > 0 && !isReadOnly ? glanceState(tone, chip) : {})
  const factBarSegments: FactBarSegment[] = [
    {
      label: trip.maxParticipants != null ? 'Places booked' : 'Participants booked',
      icon: factIcon('groups'),
      value: trip.maxParticipants != null ? formatRatio(trip.currentParticipantCount, trip.maxParticipants) : trip.currentParticipantCount,
      ...gap(trip.waitlistCount ?? 0, 'warning', `${trip.waitlistCount} on waitlist`),
      onSelect: () => setActiveTab('bookings'),
    },
    {
      label: 'Staff assigned',
      icon: factIcon('badge'),
      value: trip.staffRequired != null ? formatRatio(trip.staffAssignedCount, trip.staffRequired) : trip.staffAssignedCount,
      ...gap(staffShort, 'warning', `${staffShort} short`),
      onSelect: () => setActiveTab('staff'),
    },
    {
      label: 'Insurance confirmed',
      icon: factIcon('health_and_safety'),
      value: insuranceConfirmed + insuranceOutstanding > 0 ? formatRatio(insuranceConfirmed, insuranceConfirmed + insuranceOutstanding) : 0,
      ...gap(insuranceOutstanding, 'negative', `${insuranceOutstanding} to confirm`),
      onSelect: () => setActiveTab('bookings'),
    },
    {
      label: 'Open tasks',
      icon: factIcon('checklist'),
      value: trip.outstandingTaskCount ?? 0,
      ...gap(trip.outstandingTaskCount ?? 0, 'negative', 'To do'),
      onSelect: () => setActiveTab('tasks'),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Detail header pattern: display title + meta row (PageHeader variant="detail"), then the glance strip
          (FactBar variant="glance"). The tab strip and everything below it is the ordinary dense page. */}
      <div className="flex items-start gap-2">
        <BackButton to="/trips" label="trips" variant="icon" className="mt-1.5" />
        <div className="flex-1 min-w-0">
          <PageHeader
            variant="detail"
            title={trip.tripName}
            subtitle={
              <PageHeaderMeta>
                <StatusBadge status={trip.status} label={TRIP_STATUS_LABELS[trip.status] ?? trip.status} size="md" />
                {trip.destination}
                {trip.tripCode && <span className="font-mono text-[var(--color-secondary)]">{trip.tripCode}</span>}
                {formatDateRange(trip.startDate, trip.endDate)}
                {typeof trip.durationDays === 'number' && plural(trip.durationDays, 'day')}
              </PageHeaderMeta>
            }
            action={canWrite && (
              <Button variant="primary" size="md" onClick={() => setShowEditTrip(true)}>
                <Pencil className="w-4 h-4" />
                Edit
              </Button>
            )}
          />
        </div>
      </div>

      <FactBar variant="glance" segments={factBarSegments} />

      {/* Tabs */}
      <div className="-mx-4 md:mx-0 px-4 md:px-0">
        <Tabs
          tabs={tabs.map(t => ({ ...t, panelId: `trip-tabpanel-${t.id}` }))}
          active={activeTab}
          onChange={setActiveTab}
          ariaLabel="Trip detail sections"
          idPrefix="trip"
          overflow="scroll"
        />
      </div>

      {/* Tab content */}
      <div
        className="animate-fade-in"
        role="tabpanel"
        id={`trip-tabpanel-${activeTab}`}
        aria-labelledby={`trip-tab-${activeTab}`}
      >
        {activeListFailed ? (
          <PageState kind="error" noun={LIST_NOUNS[activeTab] ?? 'list'} onRetry={() => activeList?.refetch()} />
        ) : (
          <>
        {activeTab === 'overview' && id && (
          <OverviewTab tripId={id} trip={trip} bookings={bookings} accommodation={accommodation} vehicles={vehicles} onSwitchTab={setActiveTab} />
        )}

        {activeTab === 'bookings' && (
          <BookingsTab tripId={id} trip={trip} bookings={bookings} participants={participants} canWrite={canWrite} isReadOnly={isReadOnly} />
        )}

        {activeTab === 'staff' && (
          <StaffTab tripId={id} trip={trip} staff={staff} canWrite={canWrite} />
        )}

        {/* Two lists, so each section decides alone: a failed one shows its own retry and the other still renders. */}
        {activeTab === 'stay' && (
          <div className="flex flex-col gap-[var(--section-gap)]">
            <section aria-labelledby="trip-stay-accommodation" className="flex flex-col gap-3">
              <h2 id="trip-stay-accommodation" className="text-base font-semibold text-[var(--color-foreground)]">Accommodation</h2>
              {listFailed(tabLists.accommodation)
                ? <PageState kind="error" noun="accommodation list" onRetry={() => tabLists.accommodation.refetch()} />
                : <AccommodationTab tripId={id} trip={trip} accommodation={accommodation} canWrite={canWrite} />}
            </section>
            <section aria-labelledby="trip-stay-vehicles" className="flex flex-col gap-3">
              <h2 id="trip-stay-vehicles" className="text-base font-semibold text-[var(--color-foreground)]">Vehicles</h2>
              {listFailed(tabLists.vehicles)
                ? <PageState kind="error" noun="vehicle list" onRetry={() => tabLists.vehicles.refetch()} />
                : <VehiclesTab tripId={id} vehicles={vehicles} staff={staff} canWrite={canWrite} />}
            </section>
          </div>
        )}

        {activeTab === 'tasks' && (
          <TasksTab tripId={id} tasks={tasks} canWrite={canWrite} />
        )}

        {activeTab === 'activities' && (
          <ActivitiesTab tripId={id} trip={trip} schedule={schedule} canWrite={canWrite} isReadOnly={isReadOnly} />
        )}

        {activeTab === 'claims' && canAccessClaims && trip && (
          <ClaimsTab tripId={String(trip.id)} claims={claims} trip={trip} canWrite={canWrite} />
        )}

        {activeTab === 'incidents' && canAccessIncidents && (
          <IncidentsTab incidents={incidents} />
        )}

        {activeTab === 'history' && isAdmin && trip && (
          <AuditHistoryTab entityType="TripInstance" entityId={String(trip.id)} />
        )}
          </>
        )}
      </div>

      {/* Edit Trip Modal */}
      {showEditTrip && (
        <EditTripModal trip={trip} onClose={() => setShowEditTrip(false)} />
      )}
    </div>
  )
}
