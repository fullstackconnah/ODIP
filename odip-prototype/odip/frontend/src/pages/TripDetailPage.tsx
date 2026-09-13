import { useParams, useSearchParams, Link } from 'react-router-dom'
import { usePermissions } from '@/lib/permissions'
import { useTrip, useTripBookings, useTripAccommodation, useTripVehicles, useTripStaff, useTripTasks, useTripSchedule, useTripClaims, useTripIncidents, useParticipants } from '@/api/hooks'
import { formatDateAu, getStatusColor } from '@/lib/utils'
import { ArrowLeft, Users, Building2, Truck, UserCog, ListChecks, Calendar, Pencil, ClipboardList, ClockIcon, FileText, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import AuditHistoryTab from '@/components/AuditHistoryTab'
import { OverviewTab, BookingsTab, AccommodationTab, VehiclesTab, StaffTab, TasksTab, ActivitiesTab, ClaimsTab, IncidentsTab, EditTripModal } from './trip-detail'

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

  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: ClipboardList },
    { key: 'bookings', label: 'Bookings', icon: Users, count: bookings.length },
    { key: 'accommodation', label: 'Accommodation', icon: Building2, count: accommodation.length },
    { key: 'vehicles', label: 'Vehicles', icon: Truck, count: vehicles.length },
    { key: 'staff', label: 'Staff', icon: UserCog, count: staff.length },
    { key: 'tasks', label: 'Tasks', icon: ListChecks, count: tasks.length },
    { key: 'activities', label: 'Activities', icon: Calendar, count: schedule.reduce((sum: number, d: any) => sum + (d.scheduledActivities?.length || 0), 0) },
    { key: 'claims', label: 'Claims', icon: FileText, count: claims.length },
    ...(canAccessIncidents ? [{ key: 'incidents' as Tab, label: 'Incidents', icon: ShieldAlert, count: incidents.length }] : []),
    ...(isAdmin ? [{ key: 'history' as Tab, label: 'History', icon: ClockIcon }] : []),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero Header */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1 text-xs font-bold rounded-full tracking-wider uppercase ${getStatusColor(trip.status)}`}>
              {trip.status}
            </span>
            {trip.destination && (
              <span className="text-[var(--color-muted-foreground)] text-sm flex items-center gap-1">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>location_on</span>
                {trip.destination}
              </span>
            )}
            {trip.tripCode && (
              <span className="text-xs font-mono text-[var(--color-secondary)] bg-[var(--color-surface-container)] px-2 py-0.5 rounded-full">{trip.tripCode}</span>
            )}
          </div>
          <h1 className="text-2xl sm:text-4xl lg:text-[3.5rem] font-extrabold text-[var(--color-foreground)] leading-tight tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {trip.tripName}
          </h1>
          <p className="text-[var(--color-muted-foreground)] font-medium flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>calendar_month</span>
            {formatDateAu(trip.startDate)} — {formatDateAu(trip.endDate)} ({trip.durationDays} days)
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <Link to="/trips" className="px-5 py-2.5 bg-[var(--color-surface-container)] text-[var(--color-foreground)] rounded-full font-bold hover:opacity-90 transition-all flex items-center gap-2 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          {canWrite && (
            <button
              onClick={() => setShowEditTrip(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white text-sm font-bold shadow-lg shadow-[var(--color-primary)]/20 hover:opacity-90 transition-all"
            >
              <Pencil className="w-4 h-4" />
              Edit Trip
            </button>
          )}
        </div>
      </section>

      {/* Quick Metrics Bento */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
        {/* Participants */}
        <div className="bg-[var(--color-surface-container-low)] p-4 md:p-6 rounded-2xl space-y-2 md:space-y-3">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-[var(--color-primary)] text-2xl md:text-4xl">groups</span>
            {(trip.waitlistCount ?? 0) > 0
              ? <span className="text-xs font-bold text-[#92400e] px-2 py-1 bg-[#fef3c7] rounded-full">Waitlist</span>
              : <span className="text-xs font-bold text-[var(--color-success)] px-2 py-1 bg-[var(--color-primary-fixed)] rounded-full">Active</span>
            }
          </div>
          <div>
            <p className="text-sm text-[var(--color-muted-foreground)] font-medium">Participants / Staff</p>
            <h4 className="text-xl md:text-2xl font-bold text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {trip.currentParticipantCount} / {trip.staffAssignedCount}
            </h4>
          </div>
        </div>

        {/* Tasks / Outstanding */}
        <div className="bg-[var(--color-surface-container-low)] p-4 md:p-6 rounded-2xl space-y-2 md:space-y-3">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-[var(--color-secondary)] text-2xl md:text-4xl">checklist</span>
            {(trip.outstandingTaskCount ?? 0) > 0
              ? <span className="text-xs font-bold text-[var(--color-destructive)] px-2 py-1 bg-[var(--color-error-container)] rounded-full">Action Needed</span>
              : <span className="text-xs font-bold text-[var(--color-success)] px-2 py-1 bg-[var(--color-primary-fixed)] rounded-full">On Track</span>
            }
          </div>
          <div>
            <p className="text-sm text-[var(--color-muted-foreground)] font-medium">Outstanding Tasks</p>
            <h4 className="text-xl md:text-2xl font-bold text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {trip.outstandingTaskCount ?? 0}
            </h4>
          </div>
        </div>

        {/* Support needs */}
        <div className="bg-[var(--color-surface-container-low)] p-4 md:p-6 rounded-2xl space-y-2 md:space-y-3">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-[var(--color-secondary)] text-2xl md:text-4xl">accessible</span>
            <span className="text-xs font-bold text-[var(--color-muted-foreground)] px-2 py-1 bg-[var(--color-input)] rounded-full">{trip.wheelchairCount ?? 0} WC</span>
          </div>
          <div>
            <p className="text-sm text-[var(--color-muted-foreground)] font-medium">High Support / Overnight</p>
            <h4 className="text-xl md:text-2xl font-bold text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {trip.highSupportCount ?? 0} / {trip.overnightSupportCount ?? 0}
            </h4>
          </div>
        </div>

        {/* Insurance */}
        <div className="bg-[var(--color-surface-container-low)] p-4 md:p-6 rounded-2xl space-y-2 md:space-y-3">
          <div className="flex justify-between items-start">
            <span className="material-symbols-outlined text-[var(--color-destructive)] text-2xl md:text-4xl">health_and_safety</span>
            {(trip.insuranceOutstandingCount ?? 0) > 0
              ? <span className="text-xs font-bold text-[var(--color-destructive)] px-2 py-1 bg-[var(--color-error-container)] rounded-full">Outstanding</span>
              : <span className="text-xs font-bold text-[var(--color-success)] px-2 py-1 bg-[var(--color-primary-fixed)] rounded-full">Covered</span>
            }
          </div>
          <div>
            <p className="text-sm text-[var(--color-muted-foreground)] font-medium">Insurance Status</p>
            <h4 className="text-xl md:text-2xl font-bold text-[var(--color-foreground)]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {trip.insuranceConfirmedCount ?? 0}/{(trip.insuranceConfirmedCount ?? 0) + (trip.insuranceOutstandingCount ?? 0)}
            </h4>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="-mx-4 md:mx-0 px-4 md:px-0">
        <div
          role="tablist"
          aria-label="Trip detail sections"
          className="flex gap-1 overflow-x-auto pb-1 scrollbar-none"
          onKeyDown={e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const currentIndex = tabs.findIndex(t => t.key === activeTab)
            const delta = e.key === 'ArrowRight' ? 1 : -1
            const nextIndex = (currentIndex + delta + tabs.length) % tabs.length
            const nextTab = tabs[nextIndex]
            setActiveTab(nextTab.key)
            document.getElementById(`trip-tab-${nextTab.key}`)?.focus()
          }}
        >
          {tabs.map(tab => (
            <button
              key={tab.key}
              id={`trip-tab-${tab.key}`}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`trip-tabpanel-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-[var(--color-primary)] text-white shadow-md shadow-[var(--color-primary)]/20'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-container)]'
              }`}>
              <tab.icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.slice(0, 5)}{tab.label.length > 5 ? '.' : ''}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`ml-0.5 text-[10px] md:text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
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
