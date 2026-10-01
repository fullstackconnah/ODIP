import { useParams, useSearchParams } from 'react-router-dom'
import { usePermissions } from '@/lib/permissions'
import { useTrip, useTripBookings, useTripAccommodation, useTripVehicles, useTripStaff, useTripTasks, useTripSchedule, useTripClaims, useTripIncidents, useParticipants } from '@/api/hooks'
import { formatDateRange } from '@/lib/dateRange'
import { Users, Building2, Truck, UserCog, ListChecks, Calendar, Pencil, ClipboardList, ClockIcon, FileText, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { Tabs, type TabItem } from '@/components/Tabs'
import { PageHeader, PageHeaderMeta } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { StatusBadge } from '@/components/StatusBadge'
import { TRIP_STATUS_LABELS } from '@/lib/tone'
import { FactBar, type FactBarSegment } from '@/components/FactBar'
import { glanceState } from '@/components/glanceState'
import { formatRatio, plural } from '@/lib/format'
import { OverviewTab, BookingsTab, AccommodationTab, VehiclesTab, StaffTab, TasksTab, ActivitiesTab, ClaimsTab, IncidentsTab, EditTripModal } from './trip-detail'

/** Material Symbols category glyph for a fact-bar segment — the same icons the pre-density stat
 * tiles carried (people, checklist, wheelchair, shield). FactBar pins the size and colour. */
const factIcon = (glyph: string) => <span className="material-symbols-outlined">{glyph}</span>

type Tab = 'overview' | 'bookings' | 'accommodation' | 'vehicles' | 'staff' | 'tasks' | 'activities' | 'claims' | 'incidents' | 'history'

const TAB_KEYS: Tab[] = ['overview', 'bookings', 'accommodation', 'vehicles', 'staff', 'tasks', 'activities', 'claims', 'incidents', 'history']

export default function TripDetailPage() {
  const { canWrite, canAccessPage } = usePermissions()
  const { id } = useParams()
  const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const isAdmin = currentUser.role === 'Admin'
  // PP-60: URL-synced so a shared/reloaded link lands on the same tab.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: Tab = (tabParam && (TAB_KEYS as string[]).includes(tabParam) ? tabParam : 'overview') as Tab
  const setActiveTab = (tab: Tab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', tab)
      return next
    }, { replace: true })
  }
  const [showEditTrip, setShowEditTrip] = useState(false)

  const { data: trip, isLoading } = useTrip(id)
  const { data: bookings = [] } = useTripBookings(id)
  const { data: accommodation = [] } = useTripAccommodation(id)
  const { data: vehicles = [] } = useTripVehicles(id)
  const { data: staff = [] } = useTripStaff(id)
  const { data: tasks = [] } = useTripTasks(id)
  // PP-61 follow-up: NOT gated by activeTab, despite schedule/claims being among the
  // least-visited tabs — both `schedule.reduce(...)` and `claims.length` feed the tab-label
  // count badges below, which render outside the Activities/Claims tabpanels (i.e. before
  // either tab is ever opened). Gating these on `activeTab` made those badges misleadingly show
  // 0 until the corresponding tab was visited once. The `enabled` option added to
  // useTripSchedule/useTripClaims for this stays in place as a harmless additive parameter, but
  // nothing on this page currently uses it.
  const { data: schedule = [] } = useTripSchedule(id)
  const { data: claims = [] } = useTripClaims(id)
  const { data: incidents = [] } = useTripIncidents(id)
  // INTAKE-08: the trip/booking picker (BookingsTab) excludes drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })

  const canAccessIncidents = canAccessPage('incidents')
  const isReadOnly = trip?.status === 'Cancelled' || trip?.status === 'Archived'

  if (!id) return null
  if (isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading trip...</div>
  if (!trip) return <div className="text-center py-12">Trip not found</div>

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: ClipboardList },
    { id: 'bookings', label: 'Bookings', icon: Users, badge: bookings.length },
    { id: 'accommodation', label: 'Accommodation', icon: Building2, badge: accommodation.length },
    { id: 'vehicles', label: 'Vehicles', icon: Truck, badge: vehicles.length },
    { id: 'staff', label: 'Staff', icon: UserCog, badge: staff.length },
    { id: 'tasks', label: 'Tasks', icon: ListChecks, badge: tasks.length },
    { id: 'activities', label: 'Activities', icon: Calendar, badge: schedule.reduce((sum: number, d: any) => sum + (d.scheduledActivities?.length || 0), 0) },
    { id: 'claims', label: 'Claims', icon: FileText, badge: claims.length },
    ...(canAccessIncidents ? [{ id: 'incidents' as string, label: 'Incidents', icon: ShieldAlert, badge: incidents.length }] : []),
    ...(isAdmin ? [{ id: 'history' as string, label: 'History', icon: ClockIcon }] : []),
  ]

  // Each segment's chip AND its attention tint come from one tone (`glanceState`), so the strip can never tint a
  // segment its own badge calls fine. Waitlist is warning; Action Needed and Outstanding are negative; the rest
  // (Active, On Track, Covered, the wheelchair count) are quiet and keep the card fill. Every "x / y" figure is spelled
  // by `formatRatio`, so the ratios in one strip cannot drift apart at display size.
  const insuranceConfirmed = trip.insuranceConfirmedCount ?? 0
  const insuranceOutstanding = trip.insuranceOutstandingCount ?? 0
  const factBarSegments: FactBarSegment[] = [
    {
      label: 'Participants / Staff',
      icon: factIcon('groups'),
      value: formatRatio(trip.currentParticipantCount, trip.staffAssignedCount),
      ...((trip.waitlistCount ?? 0) > 0 ? glanceState('warning', 'Waitlist') : glanceState('positive', 'Active')),
    },
    {
      label: 'Outstanding Tasks',
      icon: factIcon('checklist'),
      value: trip.outstandingTaskCount ?? 0,
      ...((trip.outstandingTaskCount ?? 0) > 0 ? glanceState('negative', 'Action Needed') : glanceState('positive', 'On Track')),
    },
    {
      label: 'High Support / Overnight',
      icon: factIcon('accessible'),
      value: formatRatio(trip.highSupportCount ?? 0, trip.overnightSupportCount ?? 0),
      ...glanceState('neutral', `${trip.wheelchairCount ?? 0} WC`),
    },
    {
      label: 'Insurance',
      icon: factIcon('health_and_safety'),
      value: formatRatio(insuranceConfirmed, insuranceConfirmed + insuranceOutstanding),
      ...(insuranceOutstanding > 0 ? glanceState('negative', 'Outstanding') : glanceState('positive', 'Covered')),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Detail header pattern: display title + meta row (PageHeader variant="detail"), then the glance strip
          (FactBar variant="glance"). The tab strip and everything below it is the ordinary dense page. */}
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
        action={
          <div className="flex gap-2 shrink-0">
            <BackButton to="/trips" label="trips" history={false} />
            {canWrite && (
              <Button variant="primary" size="md" onClick={() => setShowEditTrip(true)}>
                <Pencil className="w-4 h-4" />
                Edit Trip
              </Button>
            )}
          </div>
        }
      />

      <FactBar variant="glance" segments={factBarSegments} />

      {/* Tabs */}
      <div className="-mx-4 md:mx-0 px-4 md:px-0">
        <Tabs
          tabs={tabs.map(t => ({ ...t, panelId: `trip-tabpanel-${t.id}` }))}
          active={activeTab}
          onChange={key => setActiveTab(key as Tab)}
          ariaLabel="Trip detail sections"
        />
      </div>

      {/* Tab content */}
      <div
        className="animate-fade-in"
        role="tabpanel"
        id={`trip-tabpanel-${activeTab}`}
        aria-labelledby={`trip-tab-${activeTab}`}
      >
        {activeTab === 'overview' && id && (
          <OverviewTab tripId={id} trip={trip} bookings={bookings} accommodation={accommodation} staff={staff} vehicles={vehicles} onSwitchTab={tab => setActiveTab(tab as Tab)} />
        )}

        {activeTab === 'bookings' && (
          <BookingsTab tripId={id} trip={trip} bookings={bookings} participants={participants} canWrite={canWrite} isReadOnly={isReadOnly} />
        )}

        {activeTab === 'accommodation' && (
          <AccommodationTab tripId={id} trip={trip} accommodation={accommodation} canWrite={canWrite} />
        )}

        {activeTab === 'vehicles' && (
          <VehiclesTab tripId={id} vehicles={vehicles} staff={staff} canWrite={canWrite} />
        )}

        {activeTab === 'staff' && (
          <StaffTab tripId={id} trip={trip} staff={staff} bookings={bookings} canWrite={canWrite} />
        )}

        {activeTab === 'tasks' && (
          <TasksTab tripId={id} tasks={tasks} canWrite={canWrite} />
        )}

        {activeTab === 'activities' && (
          <ActivitiesTab tripId={id} trip={trip} schedule={schedule} canWrite={canWrite} isReadOnly={isReadOnly} />
        )}

        {activeTab === 'claims' && trip && (
          <ClaimsTab tripId={String(trip.id)} claims={claims} trip={trip} canWrite={canWrite} />
        )}

        {activeTab === 'incidents' && canAccessIncidents && (
          <IncidentsTab incidents={incidents} />
        )}

        {activeTab === 'history' && isAdmin && trip && (
          <AuditHistoryTab entityType="TripInstance" entityId={String(trip.id)} />
        )}
      </div>

      {/* Edit Trip Modal */}
      {showEditTrip && (
        <EditTripModal trip={trip} onClose={() => setShowEditTrip(false)} />
      )}
    </div>
  )
}
