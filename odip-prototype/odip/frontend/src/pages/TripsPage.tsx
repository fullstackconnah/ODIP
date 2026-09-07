import { useTrips, usePatchTrip, useTrip } from '@/api/hooks'
import type { TripStatus, TripListDto } from '@/api/types'
import { formatDateAu, getStatusColor } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { Plus, Search, Filter, CheckCircle2, Pencil, MapPin, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { useState } from 'react'
import { Dropdown } from '@/components/Dropdown'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { EditTripModal } from './trip-detail'

type Tab = 'active' | 'completed'

const activeStatuses = ['Draft', 'Planning', 'OpenForBookings', 'Confirmed', 'InProgress']

const TRIP_STATUS_ITEMS = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Planning', label: 'Planning' },
  { value: 'OpenForBookings', label: 'Open For Bookings' },
  { value: 'WaitlistOnly', label: 'Waitlist Only' },
  { value: 'Confirmed', label: 'Confirmed' },
  { value: 'InProgress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Archived', label: 'Archived' },
]

export default function TripsPage() {
  const { canWrite } = usePermissions()
  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [statusChangeError, setStatusChangeError] = useState<{ tripName: string; message: string } | null>(null)

  const params: Record<string, string> = {}
  if (search) params.search = search
  if (statusFilter) {
    params.status = statusFilter
  } else if (tab === 'completed') {
    params.status = 'Completed'
  }

  const { data: allTrips = [], isLoading } = useTrips(params)
  // PP-63: the exact data EditTripModal needs — TripsPage already fetched it for the old
  // hand-rolled modal, so this stays even though the modal itself moved to trip-detail/.
  const { data: tripDetail } = useTrip(editingTripId ?? undefined)
  const patchTrip = usePatchTrip()

  const trips = tab === 'active' && !statusFilter
    ? allTrips.filter((t: TripListDto) => activeStatuses.includes(t.status))
    : allTrips

  const statusOptions = tab === 'active'
    ? [
        { value: 'Draft', label: 'Draft' },
        { value: 'Planning', label: 'Planning' },
        { value: 'OpenForBookings', label: 'Open for Bookings' },
        { value: 'Confirmed', label: 'Confirmed' },
        { value: 'InProgress', label: 'In Progress' },
      ]
    : []

  const switchTab = (newTab: Tab) => {
    setTab(newTab)
    setStatusFilter('')
  }

  const handleOpenEdit = (tripId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingTripId(tripId)
  }

  const handleCloseEdit = () => {
    setEditingTripId(null)
  }

  const handleStatusChange = (trip: TripListDto, status: TripStatus) => {
    setStatusChangeError(null)
    patchTrip.mutate({ id: trip.id, data: { status } }, {
      onError: (err) => {
        setStatusChangeError({
          tripName: trip.tripName,
          message: extractErrorMessage(err, "Couldn't update the trip status. Please try again."),
        })
      },
    })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Trips"
        subtitle={`${trips.length} trip${trips.length !== 1 ? 's' : ''}`}
        action={canWrite && (
          <Link to="/trips/new"
            className="flex items-center gap-2 px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white text-sm font-bold shadow-lg shadow-[var(--color-primary)]/20 hover:opacity-90 transition-all flex-shrink-0">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Trip</span><span className="sm:hidden">New</span>
          </Link>
        )}
      />

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-full bg-[var(--color-surface-container)] w-fit">
        <button
          onClick={() => switchTab('active')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
            tab === 'active'
              ? 'bg-white text-[var(--color-foreground)] shadow-sm'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
          }`}
        >
          Active Trips
        </button>
        <button
          onClick={() => switchTab('completed')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            tab === 'completed'
              ? 'bg-white text-[var(--color-foreground)] shadow-sm'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Completed
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 md:gap-3">
        <div className="relative flex-1 min-w-0 md:min-w-[200px]">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'completed' ? 'Search completed trips...' : 'Search trips...'}
            aria-label={tab === 'completed' ? 'Search completed trips' : 'Search trips'}
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
        </div>
        {statusOptions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Filter aria-hidden="true" className="w-4 h-4 text-[var(--color-muted-foreground)]" />
            <Dropdown
              variant="pill"
              value={statusFilter}
              onChange={setStatusFilter}
              label="All Statuses"
              items={statusOptions}
              colorClass="bg-[var(--color-surface-container-low)]"
            />
          </div>
        )}
      </div>

      {statusChangeError && (
        <div role="alert" className="flex items-start gap-3 p-4 rounded-xl bg-[var(--color-error-container)] text-[var(--color-destructive)]">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm">
            <strong>Couldn't update {statusChangeError.tripName}.</strong> {statusChangeError.message}
          </p>
        </div>
      )}

      {/* Trips grid */}
      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading trips...</div>
      ) : trips.length === 0 ? (
        tab === 'completed' ? (
          search ? (
            <EmptyState
              icon={MapPin}
              title="No completed trips match your search"
              description="Try a different search term, or clear your search to see all completed trips."
              action={{ label: 'Clear search', onClick: () => setSearch('') }}
            />
          ) : (
            <EmptyState
              icon={MapPin}
              title="No completed trips yet"
              description="Trips will appear here once they are marked as completed."
            />
          )
        ) : search || statusFilter ? (
          <EmptyState
            icon={MapPin}
            title="No trips match your filters"
            description="Try a different search term or status, or clear your filters to see all trips."
            action={{ label: 'Clear filters', onClick: () => { setSearch(''); setStatusFilter('') } }}
          />
        ) : (
          <EmptyState
            icon={MapPin}
            title="No trips yet"
            description="Trips are the group outings you plan for participants — set dates, capacity, and requirements, then book people onto them."
            action={canWrite ? { label: 'Create trip', to: '/trips/new' } : undefined}
          />
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {trips.map((t: TripListDto) => (
            <div key={t.id} className="bg-white rounded-2xl p-5 hover:shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)] transition-all group">
              {/* Title row */}
              <Link to={`/trips/${t.id}`} className="block mb-3">
                <h3 className="font-semibold group-hover:text-[var(--color-primary)] transition-colors truncate">{t.tripName}</h3>
                {t.tripCode && <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.tripCode}</span>}
              </Link>
              {/* Body */}
              <Link to={`/trips/${t.id}`} className="block">
                <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                  <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.destination || 'TBD'} {t.region ? `· ${t.region}` : ''}</p>
                  <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {formatDateAu(t.startDate)} — {formatDateAu(t.endDate)} ({t.durationDays}d)</p>
                </div>
              </Link>
              {/* Footer: status (far left, edit slides in on hover) + participant info */}
              <div className="flex items-center justify-between pt-3 mt-1">
                <div className="flex items-center gap-1">
                  {canWrite && (
                    <div className="max-w-0 overflow-hidden group-hover:max-w-[2rem] focus-within:max-w-[2rem] transition-all duration-200">
                      <button
                        onClick={e => handleOpenEdit(t.id, e)}
                        title="Edit trip"
                        className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:bg-[var(--color-surface-container-low)] transition-opacity"
                      >
                        <Pencil className="w-3.5 h-3.5 text-[var(--color-muted-foreground)]" />
                      </button>
                    </div>
                  )}
                  <Dropdown
                    variant="pill"
                    value={t.status}
                    onChange={val => handleStatusChange(t, val as TripStatus)}
                    colorClass={getStatusColor(t.status)}
                    items={TRIP_STATUS_ITEMS}
                  />
                </div>
                <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">person</span> {t.currentParticipantCount}/{t.maxParticipants || '—'}</span>
                  {t.waitlistCount > 0 && <span className="badge-pending text-xs px-2 py-0.5 rounded-full">{t.waitlistCount} waitlist</span>}
                  {t.leadCoordinatorName && <span className="text-xs">{t.leadCoordinatorName}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Trip Modal — PP-63: reuses the shared trip-detail modal instead of a hand-rolled
          duplicate, so it gets the same role="dialog"/focus-trap treatment for free. */}
      {editingTripId && tripDetail && (
        <EditTripModal trip={tripDetail} onClose={handleCloseEdit} />
      )}
    </div>
  )
}
