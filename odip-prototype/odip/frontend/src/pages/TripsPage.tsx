import { useEffect, useState } from 'react'
import { useTrips, usePatchTrip, useTrip } from '@/api/hooks'
import { TRIP_STATUSES, type TripStatus, type TripListDto } from '@/api/types'
import { formatDateAu } from '@/lib/utils'
import { formatRatio, plural } from '@/lib/format'
import { TRIP_STATUS_LABELS, statusClass, statusItems } from '@/lib/tone'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Pencil, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Dropdown } from '@/components/Dropdown'
import { StatusBadge } from '@/components/StatusBadge'
import { CellText, DataTable, RowMenu, type Column } from '@/components/DataTable'
import { SearchInput } from '@/components/SearchInput'
import { TAP_AREA } from '@/components/tapArea'
import { ToggleGroup } from '@/components/ToggleGroup'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/pages/intake/intakeFormat'
import { EditTripModal } from './trip-detail'
import { retryingAfterError } from '@/lib/queryPhase'

type Tab = 'active' | 'completed'
type TripsView = 'table' | 'cards'

const activeStatuses: TripStatus[] = ['Draft', 'Planning', 'OpenForBookings', 'Confirmed', 'InProgress']

const TRIP_STATUS_ITEMS = statusItems(TRIP_STATUSES, TRIP_STATUS_LABELS)

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

  const pageQuery = useTrips(params)
  const { data: allTrips = [], isLoading, isError, refetch } = pageQuery
  // PP-63: the exact data EditTripModal needs — TripsPage already fetched it for the old
  // hand-rolled modal, so this stays even though the modal itself moved to trip-detail/.
  const { data: tripDetail } = useTrip(editingTripId ?? undefined)
  const patchTrip = usePatchTrip()

  const trips = tab === 'active' && !statusFilter
    ? allTrips.filter((t: TripListDto) => activeStatuses.includes(t.status))
    : allTrips

  const statusOptions = tab === 'active'
    ? statusItems(activeStatuses, TRIP_STATUS_LABELS)
    : []

  const switchTab = (newTab: string) => {
    setTab(newTab as Tab)
    setStatusFilter('')
  }

  const handleOpenEdit = (tripId: string, e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
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
  //   Lead shows from md up; "(4d)" from 1792; the trip code from 1536 (it is in the name's tooltip). At 1440 the
  //   table is ~1125 against 1166 of room, so DataTable's opaque pin fill never covers Lead. 1366 lets the
  //   destination grow to 13.5rem (+24). At 1536: 303 + 240 + 198 + 164 + 95 + 124 + 48 = 1172, spare 90;
  //   at 1920 the spare is ~370px and spreads over the columns. Below 1440 the table still scrolls sideways.
  // The caps below bound the two cells that can grow without limit.
  // They are ranges that never overlap: Tailwind emits the arbitrary `min-[…px]` variants BEFORE the
  // named breakpoints, so they could not be trusted to override an `md:` / `2xl:` class on one element.
  const NAME_CAP = 'md:max-[1366px]:max-w-[12rem] min-[1366px]:max-2xl:max-w-[14rem] 2xl:max-[1792px]:max-w-[18rem] min-[1792px]:max-w-[22rem]'
  const DESTINATION_CAP = 'md:max-[1366px]:max-w-[9rem] min-[1366px]:max-[1792px]:max-w-[13.5rem] min-[1792px]:max-w-[22rem]'
  const tripColumns: Column<TripListDto>[] = [
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      mobile: 'primary',
      render: (t) => (
        // One line: name, then the muted code (13px, the floor for secondary table text). A
        // stacked name/code cell is two lines and pushes the row past --row-h. The name is cut at
        // its cap with the code in its tooltip; below 1536px the code itself gives way first (it is derivable: the full code is in the tooltip).
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={`max-md:line-clamp-2 md:truncate font-semibold text-[var(--color-foreground)] ${NAME_CAP}`}
            title={t.tripCode ? `${t.tripName} (${t.tripCode})` : t.tripName}
          >
            {t.tripName}
          </span>
          {t.tripCode && <span className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--color-muted-foreground)] md:max-[1535px]:hidden">{t.tripCode}</span>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'status',
      // "Open For Bookings" is the widest label: 104px of text + 10 left / 24 right padding for the
      // caret in the pill + 24 of cell padding = 162px. Reserved up front so the column doesn't jump
      // when a trip's status changes to it.
      minWidth: '10.25rem',
      render: (t) => canWrite ? (
        <span onClick={e => e.stopPropagation()} className="inline-flex items-center">
          <Dropdown
            variant="pill"
            value={t.status}
            onChange={val => handleStatusChange(t, val as TripStatus)}
            colorClass={`${statusClass(t.status)} h-[var(--control-h-sm)] whitespace-nowrap`}
            items={TRIP_STATUS_ITEMS}
          />
        </span>
      ) : <StatusBadge status={t.status} label={TRIP_STATUS_LABELS[t.status] ?? t.status} />,
    },
    {
      key: 'startDate',
      header: 'Dates',
      sortable: true,
      mobile: 'meta',
      render: (t) => (
        <span className="tabular-nums text-[var(--color-muted-foreground)]">
          {formatDateAu(t.startDate)} – {formatDateAu(t.endDate)} <span className="text-[13px] md:max-[1792px]:hidden">({t.durationDays}d)</span>
        </span>
      ),
    },
    {
      key: 'currentParticipantCount',
      header: 'Pax',
      align: 'center',
      mobile: 'meta',
      render: (t) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {formatRatio(t.currentParticipantCount, t.maxParticipants || '—')}
          {t.waitlistCount > 0 && (
            <StatusBadge tone="warning" label={`${t.waitlistCount} wait`} />
          )}
        </span>
      ),
    },
    {
      key: 'destination',
      header: 'Destination',
      mobile: 'meta',
      sortable: true,
      render: (t) => (
        <CellText className={`text-[var(--color-muted-foreground)] ${DESTINATION_CAP}`}>
          {`${t.destination || 'TBD'}${t.region ? ` · ${t.region}` : ''}`}
        </CellText>
      ),
    },
    {
      key: 'leadCoordinatorName',
      header: 'Lead',
      sortable: true,
      maxWidth: '7rem',
      mobile: 'meta',
      render: (t) => t.leadCoordinatorName || '—',
    },
    {
      key: 'actions',
      header: '',
      hidden: !canWrite,
      overlay: true,
      mobile: 'trail',
      // Revealed on row hover / focus, always shown on touch; below md one ⋯ menu. RowMenu stops the click so it doesn't also open the trip.
      render: (t) => <RowMenu name={t.tripName} items={[{ label: 'Edit trip', icon: <Pencil className="w-4 h-4" />, onSelect: () => handleOpenEdit(t.id) }]} />,
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Plain wrapper keeps PageHeader's title and filter rows in block flow (32 + 8 + 32 = 72px)
          instead of the flex column's section gap opening between them. */}
      <div>
        <PageHeader
          title="Trips"
          subtitle={plural(trips.length, 'trip')}
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
                  <Plus className="h-4 w-4" /> New trip
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
        <Callout tone="error">
          <strong>Couldn't update {statusChangeError.tripName}.</strong> {statusChangeError.message}
        </Callout>
      )}

      {/* Trips list */}
      {isLoading && !retryingAfterError(pageQuery) ? (
        <PageState kind="loading" noun="trips" />
      ) : (isError || retryingAfterError(pageQuery)) && allTrips.length === 0 ? (
        <PageState kind="error" noun="trip list" onRetry={() => refetch()} />
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
            <div key={t.id} className="group rounded-[var(--radius-md)] bg-[var(--color-card)] p-[var(--card-pad)] transition-all hover:shadow-[var(--shadow-lift)]">
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
                  {canWrite ? (
                    <Dropdown
                      variant="pill"
                      value={t.status}
                      onChange={val => handleStatusChange(t, val as TripStatus)}
                      colorClass={statusClass(t.status)}
                      items={TRIP_STATUS_ITEMS}
                    />
                  ) : <StatusBadge status={t.status} label={TRIP_STATUS_LABELS[t.status] ?? t.status} />}
                </div>
                <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                  <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">person</span> {t.currentParticipantCount}/{t.maxParticipants || '—'}</span>
                  {t.waitlistCount > 0 && <StatusBadge tone="warning" label={`${t.waitlistCount} waitlist`} />}
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
