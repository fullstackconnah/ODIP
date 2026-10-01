import { useState, useMemo } from 'react'
import { Plus, X, AlertTriangle, Pencil, ExternalLink, Trash2, Building2 } from 'lucide-react'
import {
  useAccommodation,
  useCreateAccommodation,
  useCreateReservation,
  useUpdateReservation,
  useDeleteReservation,
  useCancelReservation,
} from '@/api/hooks'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TONE } from '@/lib/tone'
import { formatRatio, plural } from '@/lib/format'
import { eachDay, formatDayNumber, parseDateOnly } from '@/lib/dateOnly'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { reservationCountsLabel } from './reservationCounts'
import { RESERVATION_STATUSES } from '@/api/types/enums'
import type { TripDetailDto } from '@/api/types/trips'
import type { ReservationDto } from '@/api/types/reservations'
import type { AccommodationListDto } from '@/api/types/accommodation'

/** "Sat, 3 Oct": the weekday and date of a calendar day ("2026-10-03"), the same in every viewer zone (it is never a local midnight). */
const dayLabel = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const RESERVATION_STATUS_ITEMS: DropdownItem[] = RESERVATION_STATUSES.map(s => ({ value: s, label: s }))

interface AccommFormState {
  accommodationPropertyId: string
  checkInDate: string
  checkOutDate: string
  bedroomsReserved: string
  bedsReserved: string
  cost: string
  reservationStatus: string
  comments: string
}

interface EditReservationFormState {
  tripInstanceId: string
  accommodationPropertyId: string
  checkInDate: string
  checkOutDate: string
  bedroomsReserved: string
  bedsReserved: string
  cost: string
  reservationStatus: string
  comments: string
  confirmationReference: string
  dateBooked: string
  dateConfirmed: string
  cancellationReason: string
}

interface AccommodationTabProps {
  tripId: string
  trip: TripDetailDto
  accommodation: ReservationDto[]
  canWrite: boolean
}

export default function AccommodationTab({ tripId, trip, accommodation, canWrite }: AccommodationTabProps) {
  const { data: allAccommodation = [] } = useAccommodation()
  const createReservation = useCreateReservation()
  const createAccommodation = useCreateAccommodation()
  const deleteReservation = useDeleteReservation()
  const cancelReservation = useCancelReservation()
  const updateReservation = useUpdateReservation()
  const [showAddAccommodation, setShowAddAccommodation] = useState(false)
  const [deletingReservation, setDeletingReservation] = useState<ReservationDto | null>(null)
  const [editingReservation, setEditingReservation] = useState<ReservationDto | null>(null)
  const [editReservationForm, setEditReservationForm] = useState<EditReservationFormState>({} as EditReservationFormState)
  const [accommForm, setAccommForm] = useState<AccommFormState>({} as AccommFormState)
  const [creatingNewProperty, setCreatingNewProperty] = useState(false)
  const [newPropertyForm, setNewPropertyForm] = useState({ propertyName: '', location: '', region: '', bedroomCount: '', bedCount: '', maxCapacity: '' })

  const resetAccommForm = () => {
    setAccommForm({
      accommodationPropertyId: '',
      checkInDate: trip?.startDate?.split('T')[0] ?? '',
      checkOutDate: trip?.endDate?.split('T')[0] ?? '',
      bedroomsReserved: '',
      bedsReserved: '',
      cost: '',
      reservationStatus: 'Researching',
      comments: '',
    })
    setCreatingNewProperty(false)
    setNewPropertyForm({ propertyName: '', location: '', region: '', bedroomCount: '', bedCount: '', maxCapacity: '' })
  }

  const openEditReservation = (r: ReservationDto) => {
    setEditingReservation(r)
    setEditReservationForm({
      tripInstanceId: r.tripInstanceId,
      accommodationPropertyId: r.accommodationPropertyId,
      checkInDate: r.checkInDate ?? '',
      checkOutDate: r.checkOutDate ?? '',
      bedroomsReserved: r.bedroomsReserved != null ? String(r.bedroomsReserved) : '',
      bedsReserved: r.bedsReserved != null ? String(r.bedsReserved) : '',
      cost: r.cost != null ? String(r.cost) : '',
      reservationStatus: r.reservationStatus ?? 'Researching',
      comments: r.comments ?? '',
      confirmationReference: r.confirmationReference ?? '',
      dateBooked: r.dateBooked ?? '',
      dateConfirmed: r.dateConfirmed ?? '',
      cancellationReason: r.cancellationReason ?? '',
    })
  }

  const handleUpdateReservation = () => {
    if (!editingReservation) return
    const data: import('@/api/types/reservations').UpdateReservationDto = {
      tripInstanceId: editReservationForm.tripInstanceId,
      accommodationPropertyId: editReservationForm.accommodationPropertyId,
      checkInDate: editReservationForm.checkInDate,
      checkOutDate: editReservationForm.checkOutDate,
      bedroomsReserved: editReservationForm.bedroomsReserved ? parseInt(editReservationForm.bedroomsReserved) : undefined,
      bedsReserved: editReservationForm.bedsReserved ? parseInt(editReservationForm.bedsReserved) : undefined,
      cost: editReservationForm.cost ? parseFloat(editReservationForm.cost) : undefined,
      reservationStatus: editReservationForm.reservationStatus as import('@/api/types/enums').ReservationStatus,
      confirmationReference: editReservationForm.confirmationReference || undefined,
      dateBooked: editReservationForm.dateBooked || undefined,
      dateConfirmed: editReservationForm.dateConfirmed || undefined,
      cancellationReason: editReservationForm.cancellationReason || undefined,
      comments: editReservationForm.comments || undefined,
    }
    updateReservation.mutate({ id: editingReservation.id, data }, {
      onSuccess: () => setEditingReservation(null),
    })
  }

  const submitReservation = (propertyId: string) => {
    if (!tripId) return
    createReservation.mutate({
      tripInstanceId: tripId,
      accommodationPropertyId: propertyId,
      checkInDate: accommForm.checkInDate,
      checkOutDate: accommForm.checkOutDate,
      bedroomsReserved: accommForm.bedroomsReserved ? parseInt(accommForm.bedroomsReserved) : undefined,
      bedsReserved: accommForm.bedsReserved ? parseInt(accommForm.bedsReserved) : undefined,
      cost: accommForm.cost ? parseFloat(accommForm.cost) : undefined,
      reservationStatus: accommForm.reservationStatus as import('@/api/types/enums').ReservationStatus,
      comments: accommForm.comments || undefined,
    }, {
      onSuccess: () => {
        setShowAddAccommodation(false)
        resetAccommForm()
      },
    })
  }

  const handleCreateReservation = () => {
    if (!tripId) return
    if (creatingNewProperty) {
      if (!newPropertyForm.propertyName) return
      createAccommodation.mutate({
        propertyName: newPropertyForm.propertyName,
        location: newPropertyForm.location || undefined,
        region: newPropertyForm.region || undefined,
        bedroomCount: newPropertyForm.bedroomCount ? parseInt(newPropertyForm.bedroomCount) : undefined,
        bedCount: newPropertyForm.bedCount ? parseInt(newPropertyForm.bedCount) : undefined,
        maxCapacity: newPropertyForm.maxCapacity ? parseInt(newPropertyForm.maxCapacity) : undefined,
        isFullyModified: false,
        isSemiModified: false,
        isWheelchairAccessible: false,
        isActive: true,
      }, {
        onSuccess: (res) => {
          const newId = (res as { data?: { id?: string } })?.data?.id
          if (newId) submitReservation(newId)
        },
      })
    } else {
      if (!accommForm.accommodationPropertyId) return
      submitReservation(accommForm.accommodationPropertyId)
    }
  }

  // Accommodation coverage check. Trip and stay dates are DateOnly ("2026-10-01"), so this is whole-calendar-day maths (lib/dateOnly): a night is
  // the day a guest checks in, up to but not including the day they check out. It stepped with setDate (local) and keyed with toISOString (the
  // UTC date), which put every night after Sydney's clock change (Sun 4 Oct 2026) one day early: the trip's last night was never tested.
  const accommodationCoverage = useMemo(() => {
    const tripNights = eachDay(trip?.startDate, trip?.endDate)
    const totalNights = tripNights.length
    if (totalNights <= 0) return null

    const activeReservations = accommodation.filter((r: ReservationDto) =>
      !['Cancelled', 'Unavailable'].includes(r.reservationStatus)
    )

    // Track which nights are covered (night = day you check in)
    const coveredNights = new Set<string>()
    for (const r of activeReservations) {
      for (const night of eachDay(r.checkInDate, r.checkOutDate)) coveredNights.add(night)
    }

    // Check each night of the trip (not including last day — that's checkout)
    const uncoveredNights = tripNights.filter(night => !coveredNights.has(night))

    return { totalNights, coveredNights: totalNights - uncoveredNights.length, uncoveredNights, allCovered: uncoveredNights.length === 0 }
  }, [accommodation, trip?.startDate, trip?.endDate])

  const property = (r: ReservationDto) => allAccommodation.find((a: AccommodationListDto) => a.id === r.accommodationPropertyId)
  const nightsOf = (r: ReservationDto) => {
    const checkIn = parseDateOnly(r.checkInDate)
    const checkOut = parseDateOnly(r.checkOutDate)
    return checkIn !== null && checkOut !== null ? checkOut - checkIn : null
  }

  // Column budget (density §4): the Property cell (name, address, badges, comments) is the one column that holds free text of any
  // length, and unwrapped it made the table 1275px wide with a one-line address and ~2000px with a two-sentence comment, pushing Ref and
  // the row actions off-screen. It wraps (`wrap`, capped at 26rem) so it absorbs whatever room the other columns leave, with the address
  // on one truncated line. Nights and Ref stay (they were deleted below 1536, L3-04): the table scrolls in its box with the property and the
  // actions pinned. Rows are taller than --row-h here, as they always were (stacked lines).
  const columns: Column<ReservationDto>[] = [
    {
      key: 'propertyName',
      header: 'Property',
      wrap: true,
      render: (r) => {
        const prop = property(r)
        return (
          <div className="min-w-0 py-0.5 md:max-w-[26rem]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{r.propertyName}</span>
              {r.hasOverlapConflict && <span className={`${TONE.danger.solid} text-xs px-2 py-0.5 rounded-full`}>Conflict</span>}
            </div>
            {prop?.location && (
              // w-0 + min-w-full: a truncated line still reports its whole text as the cell's minimum width, which pinned the Property
              // column at its 26rem cap; this contributes nothing to the width and then fills whatever the column is given.
              <p className="text-xs text-[var(--color-muted-foreground)] truncate md:w-0 md:min-w-full">
                {[prop.location, prop.region, prop.address || prop.suburb ? [prop.address, prop.suburb, prop.state, prop.postcode].filter(Boolean).join(', ') : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {prop && (prop.isWheelchairAccessible || prop.isFullyModified || prop.isSemiModified) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {prop.isWheelchairAccessible && <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]">Wheelchair Accessible</span>}
                {prop.isFullyModified && <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-secondary-container)] text-[var(--color-info)]">Fully Modified</span>}
                {prop.isSemiModified && <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]">Semi Modified</span>}
              </div>
            )}
            {r.comments && <p className="text-xs text-[var(--color-muted-foreground)] italic mt-1">{r.comments}</p>}
          </div>
        )
      },
    },
    { key: 'reservationStatus', header: 'Status', render: (r) => <StatusBadge status={r.reservationStatus} /> },
    { key: 'checkInDate', header: 'Check-in', type: 'date' },
    { key: 'checkOutDate', header: 'Check-out', type: 'date' },
    { key: 'nights', header: 'Nights', render: (r) => nightsOf(r) ?? '—' },
    {
      key: 'cost',
      header: 'Cost',
      render: (r) => {
        const nights = nightsOf(r)
        const costPerNight = nights && r.cost ? (r.cost / nights).toFixed(2) : null
        return <>{r.cost ? `$${r.cost}` : '—'}{costPerNight ? ` ($${costPerNight}/night)` : ''}</>
      },
    },
    {
      key: 'bedroomsReserved',
      header: 'Bedrooms / Beds',
      // Reserved of the property's total ("2 of 4 / 4 of 8 (max 10)"), never the property's own counts standing in for what was reserved.
      render: (r) => reservationCountsLabel(r, property(r)),
    },
    { key: 'confirmationReference', header: 'Ref', maxWidth: '8rem', render: (r) => r.confirmationReference || '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canWrite && (
            <Button variant="ghost" size="sm" iconOnly onClick={() => openEditReservation(r)} title="Edit reservation" aria-label="Edit reservation">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" iconOnly to={`/accommodation/${r.accommodationPropertyId}`} title="View property details" aria-label="View property details">
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          {canWrite && (
            <Button variant="ghost-danger" size="sm" iconOnly onClick={() => setDeletingReservation(r)} title="Remove reservation" aria-label="Remove reservation">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-muted-foreground)]">{plural(accommodation.length, 'reservation')}</p>
        {canWrite && (
          <Button variant="primary" size="md" onClick={() => { resetAccommForm(); setShowAddAccommodation(true) }}>
            <Plus className="w-4 h-4" /> Add Accommodation
          </Button>
        )}
      </div>

      {/* Stay Timeline */}
      {trip?.startDate && trip?.endDate && (() => {
        const tripStartDay = parseDateOnly(trip.startDate)
        const tripEndDay = parseDateOnly(trip.endDate)
        if (tripStartDay === null || tripEndDay === null) return null
        const totalDays = Math.max(1, tripEndDay - tripStartDay)
        const coverage = accommodationCoverage
        const activeRes = accommodation.filter((r: ReservationDto) => !['Cancelled', 'Unavailable'].includes(r.reservationStatus))

        // Build day labels: each is a calendar day, labelled with its own weekday whatever zone the viewer is in.
        const days: { key: string; label: string }[] = []
        for (let i = 0; i <= totalDays; i++) {
          const key = formatDayNumber(tripStartDay + i)
          days.push({ key, label: dayLabel(key) })
        }

        return (
          <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Stay Timeline</h3>
              {coverage && (
                <span className={`text-xs font-medium ${coverage.allCovered ? 'text-[var(--color-success)]' : 'text-[var(--color-destructive)]'}`}>
                  {coverage.allCovered ? `All ${coverage.totalNights} nights covered` : `${formatRatio(coverage.coveredNights, coverage.totalNights)} nights covered`}
                </span>
              )}
            </div>

            {/* Day headers */}
            <div className="flex gap-0">
              {days.map((day, i) => (
                <div key={i} className="flex-1 text-center">
                  <p className="text-xs text-[var(--color-muted-foreground)] truncate">{day.label}</p>
                </div>
              ))}
            </div>

            {/* Night cells row */}
            <div className="flex gap-0.5 mt-1 mb-2">
              {days.slice(0, -1).map((day, i) => {
                const isMissing = coverage?.uncoveredNights.includes(day.key)
                return (
                  <div key={i} className={`flex-1 h-2 rounded-sm ${isMissing ? 'bg-[var(--color-error-container)]/70' : 'bg-[var(--color-primary-fixed)]/50'}`}
                    title={`${day.label}: ${isMissing ? 'No accommodation' : 'Covered'}`} />
                )
              })}
            </div>

            {/* Reservation bars */}
            {activeRes.map((r: ReservationDto) => {
              const checkIn = parseDateOnly(r.checkInDate)
              const checkOut = parseDateOnly(r.checkOutDate)
              if (checkIn === null || checkOut === null) return null
              const startOffset = Math.max(0, checkIn - tripStartDay)
              const endOffset = Math.min(totalDays, checkOut - tripStartDay)
              const leftPct = (startOffset / totalDays) * 100
              const widthPct = ((endOffset - startOffset) / totalDays) * 100
              if (widthPct <= 0) return null
              return (
                <div key={r.id} className="relative h-6 mt-1">
                  <div className="absolute h-full rounded bg-[var(--color-primary)]/20 border border-[var(--color-primary)]/40 flex items-center px-2 overflow-hidden"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                    <span className="text-xs font-medium text-[var(--color-primary)] truncate">{r.propertyName}</span>
                  </div>
                </div>
              )
            })}

            {/* Missing nights warning */}
            {coverage && !coverage.allCovered && (
              <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-[rgba(195,201,181,0.15)]">
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-destructive)] shrink-0" />
                <p className="text-xs text-[var(--color-destructive)]">
                  Missing: {coverage.uncoveredNights.map(dayLabel).join(', ')}
                </p>
              </div>
            )}
          </div>
        )
      })()}

      {/* Reservations */}
      {accommodation.length === 0 ? (
        <EmptyState size="inline" icon={Building2} title="No accommodation reservations" />
      ) : (
        <DataTable data={accommodation} columns={columns} keyField="id" />
      )}

      {/* Add Accommodation Modal */}
      {showAddAccommodation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddAccommodation(false)}>
          <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Accommodation</h3>
              <button onClick={() => setShowAddAccommodation(false)} className="p-1 rounded hover:bg-[var(--color-surface-container)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Property Select or Create */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label id="addAccommPropertyLabel" className="block text-sm font-medium">Property</label>
                  <button type="button" onClick={() => { setCreatingNewProperty(!creatingNewProperty); setAccommForm({ ...accommForm, accommodationPropertyId: '' }) }}
                    className="text-xs text-[var(--color-primary)] hover:underline">
                    {creatingNewProperty ? 'Select existing' : '+ Create new'}
                  </button>
                </div>
                {creatingNewProperty ? (
                  <div className="space-y-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container)]/30">
                    <div>
                      <label className="block text-xs font-medium mb-1">Property Name *</label>
                      <input type="text" value={newPropertyForm.propertyName} onChange={e => setNewPropertyForm({ ...newPropertyForm, propertyName: e.target.value })}
                        className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                        placeholder="e.g. Beach House Resort" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Location</label>
                        <input type="text" value={newPropertyForm.location} onChange={e => setNewPropertyForm({ ...newPropertyForm, location: e.target.value })}
                          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                          placeholder="e.g. Gold Coast, QLD" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Region</label>
                        <input type="text" value={newPropertyForm.region} onChange={e => setNewPropertyForm({ ...newPropertyForm, region: e.target.value })}
                          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                          placeholder="e.g. South East QLD" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Bedrooms</label>
                        <input type="number" min="0" value={newPropertyForm.bedroomCount} onChange={e => setNewPropertyForm({ ...newPropertyForm, bedroomCount: e.target.value })}
                          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Beds</label>
                        <input type="number" min="0" value={newPropertyForm.bedCount} onChange={e => setNewPropertyForm({ ...newPropertyForm, bedCount: e.target.value })}
                          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Max Capacity</label>
                        <input type="number" min="0" value={newPropertyForm.maxCapacity} onChange={e => setNewPropertyForm({ ...newPropertyForm, maxCapacity: e.target.value })}
                          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <SearchableSelect
                    aria-labelledby="addAccommPropertyLabel"
                    value={accommForm.accommodationPropertyId}
                    onChange={val => setAccommForm({ ...accommForm, accommodationPropertyId: val })}
                    placeholder="Select property..."
                    items={allAccommodation.map((a: AccommodationListDto) => ({ value: a.id, label: `${a.propertyName} — ${a.location || 'No location'}` }))}
                  />
                )}
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Check-in</label>
                  <input type="date" value={accommForm.checkInDate} onChange={e => setAccommForm({ ...accommForm, checkInDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Check-out</label>
                  <input type="date" value={accommForm.checkOutDate} onChange={e => setAccommForm({ ...accommForm, checkOutDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>

              {/* Bedrooms / Beds */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Bedrooms</label>
                  <input type="number" min="0" value={accommForm.bedroomsReserved} onChange={e => setAccommForm({ ...accommForm, bedroomsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Beds</label>
                  <input type="number" min="0" value={accommForm.bedsReserved} onChange={e => setAccommForm({ ...accommForm, bedsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm" placeholder="Optional" />
                </div>
              </div>

              {/* Cost */}
              <div>
                <label className="block text-sm font-medium mb-1">Cost</label>
                <input type="number" min="0" step="0.01" value={accommForm.cost} onChange={e => setAccommForm({ ...accommForm, cost: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm" placeholder="Optional" />
              </div>

              {/* Status */}
              <div>
                <label id="addAccommStatusLabel" className="block text-sm font-medium mb-1">Status</label>
                <Dropdown
                  variant="form"
                  aria-labelledby="addAccommStatusLabel"
                  value={accommForm.reservationStatus}
                  onChange={val => setAccommForm({ ...accommForm, reservationStatus: val })}
                  items={RESERVATION_STATUS_ITEMS}
                />
              </div>

              {/* Comments */}
              <div>
                <label className="block text-sm font-medium mb-1">Comments</label>
                <textarea value={accommForm.comments} onChange={e => setAccommForm({ ...accommForm, comments: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Error */}
              {(createReservation.isError || createAccommodation.isError) && (
                <p className="text-sm text-[var(--color-destructive)]">Failed to add reservation. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddAccommodation(false)}
                  className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm hover:bg-[var(--color-surface-container)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreateReservation}
                  disabled={creatingNewProperty ? !newPropertyForm.propertyName || createAccommodation.isPending || createReservation.isPending : !accommForm.accommodationPropertyId || createReservation.isPending}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {createAccommodation.isPending || createReservation.isPending ? 'Adding...' : 'Add Reservation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Reservation Modal */}
      {editingReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingReservation(null)}>
          <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Reservation — {editingReservation.propertyName}</h3>
              <button onClick={() => setEditingReservation(null)} className="p-1 rounded hover:bg-[var(--color-surface-container)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Property */}
              <div>
                <label id="editReservationPropertyLabel" className="block text-sm font-medium mb-1">Property</label>
                <SearchableSelect
                  aria-labelledby="editReservationPropertyLabel"
                  value={editReservationForm.accommodationPropertyId}
                  onChange={val => setEditReservationForm({ ...editReservationForm, accommodationPropertyId: val })}
                  items={allAccommodation.map((a: AccommodationListDto) => ({ value: a.id, label: `${a.propertyName} — ${a.location || 'No location'}` }))}
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Check-in</label>
                  <input type="date" value={editReservationForm.checkInDate} onChange={e => setEditReservationForm({ ...editReservationForm, checkInDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Check-out</label>
                  <input type="date" value={editReservationForm.checkOutDate} onChange={e => setEditReservationForm({ ...editReservationForm, checkOutDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>

              {/* Bedrooms / Beds / Cost */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Bedrooms</label>
                  <input type="number" min="0" value={editReservationForm.bedroomsReserved} onChange={e => setEditReservationForm({ ...editReservationForm, bedroomsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Beds</label>
                  <input type="number" min="0" value={editReservationForm.bedsReserved} onChange={e => setEditReservationForm({ ...editReservationForm, bedsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cost</label>
                  <input type="number" min="0" step="0.01" value={editReservationForm.cost} onChange={e => setEditReservationForm({ ...editReservationForm, cost: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>

              {/* Status */}
              <div>
                <label id="editReservationStatusLabel" className="block text-sm font-medium mb-1">Status</label>
                <Dropdown
                  variant="form"
                  aria-labelledby="editReservationStatusLabel"
                  value={editReservationForm.reservationStatus}
                  onChange={val => setEditReservationForm({ ...editReservationForm, reservationStatus: val })}
                  items={RESERVATION_STATUS_ITEMS}
                />
              </div>

              {/* Confirmation Reference */}
              <div>
                <label className="block text-sm font-medium mb-1">Confirmation Reference</label>
                <input type="text" value={editReservationForm.confirmationReference} onChange={e => setEditReservationForm({ ...editReservationForm, confirmationReference: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                  placeholder="e.g. booking ref number" />
              </div>

              {/* Date Booked / Date Confirmed */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Date Booked</label>
                  <input type="date" value={editReservationForm.dateBooked} onChange={e => setEditReservationForm({ ...editReservationForm, dateBooked: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Date Confirmed</label>
                  <input type="date" value={editReservationForm.dateConfirmed} onChange={e => setEditReservationForm({ ...editReservationForm, dateConfirmed: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
              </div>

              {/* Comments */}
              <div>
                <label className="block text-sm font-medium mb-1">Comments</label>
                <textarea value={editReservationForm.comments} onChange={e => setEditReservationForm({ ...editReservationForm, comments: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm resize-none focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Cancellation Reason (only show if cancelled) */}
              {editReservationForm.reservationStatus === 'Cancelled' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Cancellation Reason</label>
                  <input type="text" value={editReservationForm.cancellationReason} onChange={e => setEditReservationForm({ ...editReservationForm, cancellationReason: e.target.value })}
                    className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm"
                    placeholder="Reason for cancellation..." />
                </div>
              )}

              {/* Error */}
              {updateReservation.isError && (
                <p className="text-sm text-[var(--color-destructive)]">Failed to update reservation. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingReservation(null)}
                  className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm hover:bg-[var(--color-surface-container)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateReservation} disabled={updateReservation.isPending}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateReservation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete/Cancel Reservation Confirmation */}
      <ConfirmDialog
        open={deletingReservation !== null}
        onCancel={() => setDeletingReservation(null)}
        title="Remove Reservation"
        message={
          <>
            <p>
              What would you like to do with the reservation at{' '}
              <span className="font-medium text-[var(--color-foreground)]">{deletingReservation?.propertyName}</span>?
            </p>
            {(deleteReservation.isError || cancelReservation.isError) && (
              <p className="text-[var(--color-destructive)]">Something went wrong. Please try again.</p>
            )}
          </>
        }
        footer={
          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={() => {
                if (!deletingReservation) return
                const data: import('@/api/types/reservations').UpdateReservationDto = {
                  tripInstanceId: deletingReservation.tripInstanceId,
                  accommodationPropertyId: deletingReservation.accommodationPropertyId,
                  checkInDate: deletingReservation.checkInDate,
                  checkOutDate: deletingReservation.checkOutDate,
                  bedroomsReserved: deletingReservation.bedroomsReserved ?? undefined,
                  bedsReserved: deletingReservation.bedsReserved ?? undefined,
                  cost: deletingReservation.cost ?? undefined,
                  reservationStatus: 'Cancelled',
                  comments: deletingReservation.comments ?? undefined,
                  confirmationReference: deletingReservation.confirmationReference ?? undefined,
                }
                cancelReservation.mutate({ id: deletingReservation.id, data }, { onSuccess: () => setDeletingReservation(null) })
              }}
              disabled={cancelReservation.isPending || deleteReservation.isPending}
              className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-warning-container)]/60 text-sm font-medium hover:bg-[var(--color-warning-container)] transition-colors disabled:opacity-50 text-left">
              <span className="font-semibold">Cancel reservation</span>
              <span className="block text-xs text-[var(--color-muted-foreground)] mt-0.5">Mark as cancelled — keeps the record for history</span>
            </button>
            <button
              onClick={() => deletingReservation && deleteReservation.mutate(deletingReservation.id, { onSuccess: () => setDeletingReservation(null) })}
              disabled={deleteReservation.isPending || cancelReservation.isPending}
              className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm font-medium hover:bg-[var(--color-destructive)]/20 transition-colors disabled:opacity-50 text-left">
              <span className="font-semibold">Delete permanently</span>
              <span className="block text-xs mt-0.5 opacity-80">Remove completely — cannot be undone</span>
            </button>
          </div>
        }
      />
    </div>
  )
}
