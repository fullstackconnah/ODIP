import { useParams, useSearchParams } from 'react-router-dom'
import { usePermissions } from '@/lib/permissions'
import { useTrip, useTripBookings, useTripAccommodation, useTripVehicles, useTripStaff, useTripTasks, useTripSchedule, useTripClaims, useTripIncidents, useParticipants } from '@/api/hooks'
import { formatDateAu } from '@/lib/utils'
import { ArrowLeft, Users, Building2, Truck, UserCog, ListChecks, Calendar, Pencil, ClipboardList, ClockIcon, FileText, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { Tabs, type TabItem } from '@/components/Tabs'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { FactBar, type FactBarSegment } from '@/components/FactBar'
import { OverviewTab, BookingsTab, AccommodationTab, VehiclesTab, StaffTab, TasksTab, ActivitiesTab, ClaimsTab, IncidentsTab, EditTripModal } from './trip-detail'

/** Small pill used inside FactBar segments — matches StatusBadge's visual language (same
 * rounded-full/text-xs shape) for the "state" chips (Waitlist/Active, Action Needed/On Track, etc.)
 * that aren't themselves a StatusBadge status value. */
function FactChip({ tone, children }: { tone: 'positive' | 'warning' | 'negative' | 'neutral'; children: React.ReactNode }) {
  const toneClass = {
    positive: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
    warning: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
    negative: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
    neutral: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
  }[tone]
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${toneClass}`}>{children}</span>
}

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

  const factBarSegments: FactBarSegment[] = [
    {
      label: 'Participants / Staff',
      icon: factIcon('groups'),
      value: `${trip.currentParticipantCount} / ${trip.staffAssignedCount}`,
      badge: (trip.waitlistCount ?? 0) > 0
        ? <FactChip tone="warning">Waitlist</FactChip>
        : <FactChip tone="positive">Active</FactChip>,
    },
    {
      label: 'Outstanding Tasks',
      icon: factIcon('checklist'),
      value: trip.outstandingTaskCount ?? 0,
      badge: (trip.outstandingTaskCount ?? 0) > 0
        ? <FactChip tone="negative">Action Needed</FactChip>
        : <FactChip tone="positive">On Track</FactChip>,
    },
    {
      label: 'High Support / Overnight',
      icon: factIcon('accessible'),
      value: `${trip.highSupportCount ?? 0} / ${trip.overnightSupportCount ?? 0}`,
      badge: <FactChip tone="neutral">{trip.wheelchairCount ?? 0} WC</FactChip>,
    },
    {
      label: 'Insurance',
      icon: factIcon('health_and_safety'),
      value: `${trip.insuranceConfirmedCount ?? 0}/${(trip.insuranceConfirmedCount ?? 0) + (trip.insuranceOutstandingCount ?? 0)}`,
      badge: (trip.insuranceOutstandingCount ?? 0) > 0
        ? <FactChip tone="negative">Outstanding</FactChip>
        : <FactChip tone="positive">Covered</FactChip>,
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title={trip.tripName}
        subtitle={
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--color-muted-foreground)]">
            <StatusBadge status={trip.status} />
            {trip.destination && (
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>location_on</span>
                {trip.destination}
              </span>
            )}
            {trip.tripCode && <span className="font-mono text-[var(--color-secondary)]">{trip.tripCode}</span>}
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>calendar_month</span>
              {formatDateAu(trip.startDate)} — {formatDateAu(trip.endDate)} ({trip.durationDays} days)
            </span>
          </div>
        }
        action={
          <div className="flex gap-2 shrink-0">
            <Button to="/trips" variant="secondary" size="md">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            {canWrite && (
              <Button variant="primary" size="md" onClick={() => setShowEditTrip(true)}>
                <Pencil className="w-4 h-4" />
                Edit Trip
              </Button>
            )}
          </div>
        }
      />

      <FactBar segments={factBarSegments} />

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
