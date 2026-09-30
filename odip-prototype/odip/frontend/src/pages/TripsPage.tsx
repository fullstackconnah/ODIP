import { useEffect, useState } from 'react'
import { useTrips, usePatchTrip, useTrip } from '@/api/hooks'
import type { TripStatus, TripListDto } from '@/api/types'
import { formatDateAu, getStatusColor } from '@/lib/utils'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Pencil, MapPin, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { CellText, DataTable, RowActions, type Column } from '@/components/DataTable'
import { SearchInput } from '@/components/SearchInput'
import { TAP_AREA } from '@/components/tapArea'
import { ToggleGroup } from '@/components/ToggleGroup'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { EditTripModal } from './trip-detail'

type Tab = 'active' | 'completed'
type TripsView = 'table' | 'cards'

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

const VIEW_STORAGE_KEY = 'odip.trips.view'
const WIDE_QUERY = '(min-width: 1280px)'

/** SSR-safe media-query hook — no window/matchMedia at import time, falls back to `false`
 * (narrow) when matchMedia isn't available (older browsers, some test environments). */
function useMinWidth(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let mql: MediaQueryList
    try {
      mql = window.matchMedia(query)
    } catch {
      return
    }
    const handler = () => setMatches(mql.matches)
    handler()
    mql.addEventListener?.('change', handler)
    return () => mql.removeEventListener?.('change', handler)
  }, [query])

  return matches
}

function readStoredView(): TripsView | null {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return stored === 'table' || stored === 'cards' ? stored : null
  } catch {
    return null
  }
}

function writeStoredView(view: TripsView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // private browsing / quota — the toggle still works for this session
  }
}

export default function TripsPage() {
  const { canWrite } = usePermissions()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [statusChangeError, setStatusChangeError] = useState<{ tripName: string; message: string } | null>(null)

  const isWideScreen = useMinWidth(WIDE_QUERY)
  const [storedView, setStoredView] = useState<TripsView | null>(() => readStoredView())
  const view: TripsView = storedView ?? (isWideScreen ? 'table' : 'cards')

  function handleViewChange(next: string) {
    const nextView = next as TripsView
    setStoredView(nextView)
    writeStoredView(nextView)
  }

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

  const switchTab = (newTab: string) => {
    setTab(newTab as Tab)
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

  // Every row is exactly --row-h from 1280 up: cells never wrap (DataTable), so a narrower window
  // costs width, never height. What gives, at the seeded data's widest rows, each column padded 2×12
  // (Manrope measured, see the density verdict report):
  //   1280 (content 1280 − 232 sidebar − 2×20 gutter = 1008, 1006 inside the table border):
  //     Trip 233 + Destination 216 + Dates 198 + Status 164 + Pax 95 + edit 48 = 953, spare 53.
  //     Lead, the trip code and "(4d)" are dropped. 1366 adds the code (+70) and lets the destination
  //     grow to 13.5rem (+24); 1536 adds Lead (+124).
  //   1536: 303 + 240 + 198 + 164 + 95 + 124 + 48 = 1172, spare 90. 1792 adds "(4d)" and room for
  //     the full destination; at 1920 the spare is ~370px and spreads over the columns.
  // The caps below bound the two cells that can grow without limit.
  // They are ranges that never overlap: Tailwind emits the arbitrary `min-[…px]` variants BEFORE the
  // named breakpoints, so they could not be trusted to override an `md:` / `2xl:` class on one element.
  const NAME_CAP = 'md:max-2xl:max-w-[14rem] 2xl:max-[1792px]:max-w-[18rem] min-[1792px]:max-w-[22rem]'
  const DESTINATION_CAP = 'md:max-[1366px]:max-w-[12rem] min-[1366px]:max-[1792px]:max-w-[13.5rem] min-[1792px]:max-w-[22rem]'
  const tripColumns: Column<TripListDto>[] = [
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      render: (t) => (
        // One line: name, then the muted code (13px, the floor for secondary table text). A
        // stacked name/code cell is two lines and pushes the row past --row-h. The name is cut at
        // its cap with the code in its tooltip; below 1366px the code itself gives way first.
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={`truncate font-semibold text-[var(--color-foreground)] ${NAME_CAP}`}
            title={t.tripCode ? `${t.tripName} (${t.tripCode})` : t.tripName}
          >
            {t.tripName}
          </span>
          {t.tripCode && <span className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--color-muted-foreground)] md:max-[1366px]:hidden">{t.tripCode}</span>}
        </div>
      ),
    },
    {
      key: 'destination',
      header: 'Destination',
      sortable: true,
      render: (t) => (
        <CellText className={`text-[var(--color-muted-foreground)] ${DESTINATION_CAP}`}>
          {`${t.destination || 'TBD'}${t.region ? ` · ${t.region}` : ''}`}
        </CellText>
      ),
    },
    {
      key: 'startDate',
      header: 'Dates',
      sortable: true,
      render: (t) => (
        <span className="tabular-nums text-[var(--color-muted-foreground)]">
          {formatDateAu(t.startDate)} – {formatDateAu(t.endDate)} <span className="text-[13px] md:max-[1792px]:hidden">({t.durationDays}d)</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      // "Open For Bookings" is the widest label: 104px of text + 10 left / 24 right padding for the
      // caret in the pill + 24 of cell padding = 162px. Reserved up front so the column doesn't jump
      // when a trip's status changes to it.
      minWidth: '10.25rem',
      render: (t) => (
        <span onClick={e => e.stopPropagation()} className="inline-flex items-center">
          <Dropdown
            variant="pill"
            value={t.status}
            onChange={val => handleStatusChange(t, val as TripStatus)}
            colorClass={`${getStatusColor(t.status)} h-[var(--control-h-sm)] whitespace-nowrap`}
            items={TRIP_STATUS_ITEMS}
          />
        </span>
      ),
    },
    {
      key: 'currentParticipantCount',
      header: 'Pax',
      align: 'center',
      render: (t) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {t.currentParticipantCount}/{t.maxParticipants || '—'}
          {t.waitlistCount > 0 && (
            <span className="badge-pending rounded-full px-1.5 py-0.5 text-xs">{t.waitlistCount} wait</span>
          )}
        </span>
      ),
    },
    {
      key: 'leadCoordinatorName',
      header: 'Lead',
      sortable: true,
      priority: 'low',
      maxWidth: '10rem',
      render: (t) => t.leadCoordinatorName || '—',
    },
    {
      key: 'actions',
      header: '',
      hidden: !canWrite,
      // 24px, revealed on row hover / focus and always shown on touch. handleOpenEdit stops the
      // click so it doesn't also open the trip.
      render: (t) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            title="Edit trip"
            aria-label={`Edit ${t.tripName}`}
            onClick={e => handleOpenEdit(t.id, e)}
          >
            <Pencil className="w-4 h-4" />
          </Button>
        </RowActions>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Plain wrapper keeps PageHeader's title and filter rows in block flow (32 + 8 + 32 = 72px)
          instead of the flex column's section gap opening between them. */}
      <div>
        <PageHeader
          title="Trips"
          subtitle={`${trips.length} trip${trips.length !== 1 ? 's' : ''}`}
          action={
            <div className="flex items-center gap-2">
              <ToggleGroup
                options={[{ key: 'table', label: 'Table' }, { key: 'cards', label: 'Cards' }]}
                value={view}
                onChange={handleViewChange}
                ariaLabel="Trips view"
              />
              {canWrite && (
                <Button to="/trips/new" size="md">
                  <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Trip</span><span className="sm:hidden">New</span>
                </Button>
              )}
            </div>
          }
        >
          <ToggleGroup
            options={[{ key: 'active', label: 'Active Trips' }, { key: 'completed', label: 'Completed' }]}
            value={tab}
            onChange={switchTab}
            ariaLabel="Trip status"
          />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={tab === 'completed' ? 'Search completed trips...' : 'Search trips...'}
            label={tab === 'completed' ? 'Search completed trips' : 'Search trips'}
          />
          {statusOptions.length > 0 && (
            <Dropdown
              variant="pill"
              value={statusFilter}
              onChange={setStatusFilter}
              label="All Statuses"
              items={statusOptions}
              colorClass="bg-[var(--color-surface-container-low)]"
            />
          )}
        </PageHeader>
      </div>

      {statusChangeError && (
        <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--color-error-container)] p-[var(--card-pad)] text-[var(--color-destructive)]">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm">
            <strong>Couldn't update {statusChangeError.tripName}.</strong> {statusChangeError.message}
          </p>
        </div>
      )}

      {/* Trips list */}
      {isLoading ? (
        <div className="py-12 text-center text-[var(--color-muted-foreground)]">Loading trips...</div>
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
      ) : view === 'table' ? (
        <DataTable
          data={trips}
          columns={tripColumns}
          keyField="id"
          sortable
          onRowClick={(t) => navigate(`/trips/${t.id}`)}
          emptyMessage="No trips found"
        />
      ) : (
        <div className="grid gap-[var(--section-gap)] md:grid-cols-2 xl:grid-cols-3">
          {trips.map((t: TripListDto) => (
            <div key={t.id} className="group rounded-[var(--radius-md)] bg-[var(--color-card)] p-[var(--card-pad)] transition-all hover:shadow-[0_24px_32px_-12px_rgba(27,28,26,0.08)]">
              {/* Title row */}
              <Link to={`/trips/${t.id}`} className="mb-3 block">
                <h3 className="truncate font-semibold transition-colors group-hover:text-[var(--color-primary)]">{t.tripName}</h3>
                {t.tripCode && <span className="font-mono text-xs text-[var(--color-muted-foreground)]">{t.tripCode}</span>}
              </Link>
              {/* Body */}
              <Link to={`/trips/${t.id}`} className="block">
                <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                  <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.destination || 'TBD'} {t.region ? `· ${t.region}` : ''}</p>
                  <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {formatDateAu(t.startDate)} — {formatDateAu(t.endDate)} ({t.durationDays}d)</p>
                </div>
              </Link>
              {/* Footer: status (far left, edit slides in on hover) + participant info. Touch has no hover
                  to slide the pencil in, so under `pointer: coarse` it is always shown (spec §4: row actions
                  are always visible on coarse pointers), its wrapper stops clipping so the 44px hit area
                  (TAP_AREA reaches 9px past the 26px pencil) survives, and the gap to the status pill
                  widens past that reach (9px) so the pill's taps stay the pill's. The pencil's 38px come out
                  of the footer's width, so under coarse the participant info wraps as a unit onto its own
                  line when it no longer fits (instead of a "1 waitlist" chip breaking in two). */}
              <div className="mt-1 flex items-center justify-between pt-3 pointer-coarse:flex-wrap pointer-coarse:gap-y-2">
                <div className="flex items-center gap-1 pointer-coarse:gap-3">
                  {canWrite && (
                    <div className="max-w-0 overflow-hidden transition-all duration-200 focus-within:max-w-[2rem] group-hover:max-w-[2rem] pointer-coarse:max-w-none pointer-coarse:overflow-visible">
                      <button
                        onClick={e => handleOpenEdit(t.id, e)}
                        title="Edit trip"
                        className={`${TAP_AREA} rounded-full p-1.5 opacity-0 transition-opacity hover:bg-[var(--color-surface-container-low)] focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100`}
                      >
                        <Pencil className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
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
                  {t.waitlistCount > 0 && <span className="badge-pending rounded-full px-2 py-0.5 text-xs">{t.waitlistCount} waitlist</span>}
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
