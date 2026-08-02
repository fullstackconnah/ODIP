import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X, AlertTriangle, Pencil, ExternalLink, Trash2 } from 'lucide-react'
import {
  useAccommodation,
  useCreateAccommodation,
  useCreateReservation,
  useUpdateReservation,
  useDeleteReservation,
  useCancelReservation,
} from '@/api/hooks'
import { formatDateAu, getStatusColor } from '@/lib/utils'
import type { TripDetailDto } from '@/api/types/trips'
import type { ReservationDto } from '@/api/types/reservations'
import type { AccommodationListDto } from '@/api/types/accommodation'

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

  // Accommodation coverage check
  const accommodationCoverage = useMemo(() => {
    if (!trip?.startDate || !trip?.endDate) return null
    const start = new Date(trip.startDate)
    const end = new Date(trip.endDate)
    const totalNights = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    if (totalNights <= 0) return null

    const activeReservations = accommodation.filter((r: ReservationDto) =>
      !['Cancelled', 'Unavailable'].includes(r.reservationStatus)
    )

    // Track which nights are covered (night = day you check in)
    const coveredNights = new Set<string>()
    for (const r of activeReservations) {
      const ci = new Date(r.checkInDate)
      const co = new Date(r.checkOutDate)
      const d = new Date(ci)
      while (d < co) {
        coveredNights.add(d.toISOString().split('T')[0])
        d.setDate(d.getDate() + 1)
      }
    }

    // Check each night of the trip (not including last day — that's checkout)
    const uncoveredNights: string[] = []
    const d = new Date(start)
    for (let i = 0; i < totalNights; i++) {
      const key = d.toISOString().split('T')[0]
      if (!coveredNights.has(key)) uncoveredNights.push(key)
      d.setDate(d.getDate() + 1)
    }

    return { totalNights, coveredNights: totalNights - uncoveredNights.length, uncoveredNights, allCovered: uncoveredNights.length === 0 }
  }, [accommodation, trip?.startDate, trip?.endDate])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#43493a]">{accommodation.length} reservation{accommodation.length !== 1 ? 's' : ''}</p>
        {canWrite && (
          <button onClick={() => { resetAccommForm(); setShowAddAccommodation(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" /> Add Accommodation
          </button>
        )}
      </div>

      {/* Stay Timeline */}
      {trip?.startDate && trip?.endDate && (() => {
        const tripStart = new Date(trip.startDate)
        const tripEnd = new Date(trip.endDate)
        const totalDays = Math.max(1, Math.round((tripEnd.getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24)))
        const coverage = accommodationCoverage
        const activeRes = accommodation.filter((r: ReservationDto) => !['Cancelled', 'Unavailable'].includes(r.reservationStatus))

        // Build day labels
        const days: { date: Date; label: string; covered: boolean }[] = []
        for (let i = 0; i <= totalDays; i++) {
          const d = new Date(tripStart)
          d.setDate(d.getDate() + i)
          const key = d.toISOString().split('T')[0]
          const isCovered = i < totalDays ? !coverage?.uncoveredNights.includes(key) : true // last day is checkout
          days.push({ date: d, label: d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }), covered: isCovered })
        }

        return (
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Stay Timeline</h3>
              {coverage && (
                <span className={`text-xs font-medium ${coverage.allCovered ? 'text-[#396200]' : 'text-[#ba1a1a]'}`}>
                  {coverage.allCovered ? `All ${coverage.totalNights} nights covered` : `${coverage.coveredNights}/${coverage.totalNights} nights covered`}
                </span>
              )}
            </div>

            {/* Day headers */}
            <div className="flex gap-0">
              {days.map((day, i) => (
                <div key={i} className="flex-1 text-center">
                  <p className="text-[10px] text-[#43493a] truncate">{day.label}</p>
                </div>
              ))}
            </div>

            {/* Night cells row */}
            <div className="flex gap-0.5 mt-1 mb-2">
              {days.slice(0, -1).map((day, i) => {
                const key = day.date.toISOString().split('T')[0]
                const isMissing = coverage?.uncoveredNights.includes(key)
                return (
                  <div key={i} className={`flex-1 h-2 rounded-sm ${isMissing ? 'bg-[#ffdad6]/70' : 'bg-[#bbf37c]/50'}`}
                    title={`${day.label}: ${isMissing ? 'No accommodation' : 'Covered'}`} />
                )
              })}
            </div>

            {/* Reservation bars */}
            {activeRes.map((r: ReservationDto) => {
              const ci = new Date(r.checkInDate)
              const co = new Date(r.checkOutDate)
              const startOffset = Math.max(0, (ci.getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24))
              const endOffset = Math.min(totalDays, (co.getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24))
              const leftPct = (startOffset / totalDays) * 100
              const widthPct = ((endOffset - startOffset) / totalDays) * 100
              if (widthPct <= 0) return null
              return (
                <div key={r.id} className="relative h-6 mt-1">
                  <div className="absolute h-full rounded bg-[#396200]/20 border border-[#396200]/40 flex items-center px-2 overflow-hidden"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                    <span className="text-[10px] font-medium text-[#396200] truncate">{r.propertyName}</span>
                  </div>
                </div>
              )
            })}

            {/* Missing nights warning */}
            {coverage && !coverage.allCovered && (
              <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-[rgba(195,201,181,0.15)]">
                <AlertTriangle className="w-3.5 h-3.5 text-[#ba1a1a] shrink-0" />
                <p className="text-xs text-[#ba1a1a]">
                  Missing: {coverage.uncoveredNights.map((d: string) => {
                    const dt = new Date(d)
                    return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
                  }).join(', ')}
                </p>
              </div>
            )}
          </div>
        )
      })()}

      {/* Reservation Cards */}
      {accommodation.length === 0 ? (
        <p className="text-[#43493a]">No accommodation reservations</p>
      ) : (
        <div className="space-y-3">
          {accommodation.map((r: ReservationDto) => {
            const property = allAccommodation.find((a: AccommodationListDto) => a.id === r.accommodationPropertyId)
            const nights = r.checkInDate && r.checkOutDate
              ? Math.round((new Date(r.checkOutDate).getTime() - new Date(r.checkInDate).getTime()) / (1000 * 60 * 60 * 24))
              : null
            const costPerNight = nights && r.cost ? (r.cost / nights).toFixed(2) : null

            return (
              <div key={r.id} className="bg-white rounded-2xl p-5">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold">{r.propertyName}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(r.reservationStatus)}`}>{r.reservationStatus}</span>
                      {r.hasOverlapConflict && <span className="badge-conflict text-xs px-2 py-0.5 rounded-full">Conflict</span>}
                    </div>
                    {property?.location && (
                      <p className="text-sm text-[#43493a] mt-0.5">{property.location}{property.region ? ` · ${property.region}` : ''}</p>
                    )}
                    {property && (property.address || property.suburb) && (
                      <p className="text-xs text-[#43493a]">{[property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canWrite && (
                      <button onClick={() => openEditReservation(r)} className="p-1.5 rounded hover:bg-[#efeeea] transition-colors" title="Edit reservation">
                        <Pencil className="w-3.5 h-3.5 text-[#43493a]" />
                      </button>
                    )}
                    <Link to={`/accommodation/${r.accommodationPropertyId}`} className="p-1.5 rounded hover:bg-[#efeeea] transition-colors" title="View property details">
                      <ExternalLink className="w-3.5 h-3.5 text-[#43493a]" />
                    </Link>
                    {canWrite && (
                      <button onClick={() => setDeletingReservation(r)} className="p-1.5 rounded hover:bg-[#ffdad6]/60 transition-colors" title="Remove reservation">
                        <Trash2 className="w-3.5 h-3.5 text-[#43493a] hover:text-[#ba1a1a]" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 mt-4 text-sm">
                  <div>
                    <p className="text-xs text-[#43493a]">Check-in</p>
                    <p className="font-medium">{formatDateAu(r.checkInDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#43493a]">Check-out</p>
                    <p className="font-medium">{formatDateAu(r.checkOutDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#43493a]">Nights</p>
                    <p className="font-medium">{nights ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#43493a]">Cost</p>
                    <p className="font-medium">{r.cost ? `$${r.cost}` : '—'}{costPerNight ? ` ($${costPerNight}/night)` : ''}</p>
                  </div>
                  {(r.bedroomsReserved || property?.bedroomCount) && (
                    <div>
                      <p className="text-xs text-[#43493a]">Bedrooms</p>
                      <p className="font-medium">{r.bedroomsReserved ?? '—'}{property?.bedroomCount ? ` / ${property.bedroomCount} available` : ''}</p>
                    </div>
                  )}
                  {(r.bedsReserved || property?.bedCount) && (
                    <div>
                      <p className="text-xs text-[#43493a]">Beds</p>
                      <p className="font-medium">{r.bedsReserved ?? '—'}{property?.bedCount ? ` / ${property.bedCount} available` : ''}</p>
                    </div>
                  )}
                  {property?.maxCapacity && (
                    <div>
                      <p className="text-xs text-[#43493a]">Max Capacity</p>
                      <p className="font-medium">{property.maxCapacity}</p>
                    </div>
                  )}
                  {r.confirmationReference && (
                    <div>
                      <p className="text-xs text-[#43493a]">Confirmation Ref</p>
                      <p className="font-medium">{r.confirmationReference}</p>
                    </div>
                  )}
                </div>

                {/* Property tags */}
                {property && (property.isWheelchairAccessible || property.isFullyModified || property.isSemiModified) && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {property.isWheelchairAccessible && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">Wheelchair Accessible</span>}
                    {property.isFullyModified && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">Fully Modified</span>}
                    {property.isSemiModified && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">Semi Modified</span>}
                  </div>
                )}

                {/* Notes */}
                {r.comments && (
                  <p className="text-sm text-[#43493a] mt-3 pt-3 border-t border-[rgba(195,201,181,0.15)]">{r.comments}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Accommodation Modal */}
      {showAddAccommodation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddAccommodation(false)}>
          <div className="bg-white rounded-2xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Accommodation</h3>
              <button onClick={() => setShowAddAccommodation(false)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Property Select or Create */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">Property</label>
                  <button type="button" onClick={() => { setCreatingNewProperty(!creatingNewProperty); setAccommForm({ ...accommForm, accommodationPropertyId: '' }) }}
                    className="text-xs text-[#396200] hover:underline">
                    {creatingNewProperty ? 'Select existing' : '+ Create new'}
                  </button>
                </div>
                {creatingNewProperty ? (
                  <div className="space-y-3 p-3 rounded-2xl bg-[#efeeea]/30">
                    <div>
                      <label className="block text-xs font-medium mb-1">Property Name *</label>
                      <input type="text" value={newPropertyForm.propertyName} onChange={e => setNewPropertyForm({ ...newPropertyForm, propertyName: e.target.value })}
                        className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                        placeholder="e.g. Beach House Resort" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Location</label>
                        <input type="text" value={newPropertyForm.location} onChange={e => setNewPropertyForm({ ...newPropertyForm, location: e.target.value })}
                          className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                          placeholder="e.g. Gold Coast, QLD" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Region</label>
                        <input type="text" value={newPropertyForm.region} onChange={e => setNewPropertyForm({ ...newPropertyForm, region: e.target.value })}
                          className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                          placeholder="e.g. South East QLD" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Bedrooms</label>
                        <input type="number" min="0" value={newPropertyForm.bedroomCount} onChange={e => setNewPropertyForm({ ...newPropertyForm, bedroomCount: e.target.value })}
                          className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Beds</label>
                        <input type="number" min="0" value={newPropertyForm.bedCount} onChange={e => setNewPropertyForm({ ...newPropertyForm, bedCount: e.target.value })}
                          className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Max Capacity</label>
                        <input type="number" min="0" value={newPropertyForm.maxCapacity} onChange={e => setNewPropertyForm({ ...newPropertyForm, maxCapacity: e.target.value })}
                          className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <select value={accommForm.accommodationPropertyId} onChange={e => setAccommForm({ ...accommForm, accommodationPropertyId: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                    <option value="">Select property...</option>
                    {allAccommodation.map((a: AccommodationListDto) => (
                      <option key={a.id} value={a.id}>{a.propertyName} — {a.location || 'No location'}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Check-in</label>
                  <input type="date" value={accommForm.checkInDate} onChange={e => setAccommForm({ ...accommForm, checkInDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Check-out</label>
                  <input type="date" value={accommForm.checkOutDate} onChange={e => setAccommForm({ ...accommForm, checkOutDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
              </div>

              {/* Bedrooms / Beds */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Bedrooms</label>
                  <input type="number" min="0" value={accommForm.bedroomsReserved} onChange={e => setAccommForm({ ...accommForm, bedroomsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Beds</label>
                  <input type="number" min="0" value={accommForm.bedsReserved} onChange={e => setAccommForm({ ...accommForm, bedsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm" placeholder="Optional" />
                </div>
              </div>

              {/* Cost */}
              <div>
                <label className="block text-sm font-medium mb-1">Cost</label>
                <input type="number" min="0" step="0.01" value={accommForm.cost} onChange={e => setAccommForm({ ...accommForm, cost: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm" placeholder="Optional" />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select value={accommForm.reservationStatus} onChange={e => setAccommForm({ ...accommForm, reservationStatus: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  {['Researching', 'Requested', 'Booked', 'Confirmed', 'Cancelled', 'Unavailable'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Comments */}
              <div>
                <label className="block text-sm font-medium mb-1">Comments</label>
                <textarea value={accommForm.comments} onChange={e => setAccommForm({ ...accommForm, comments: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Error */}
              {(createReservation.isError || createAccommodation.isError) && (
                <p className="text-sm text-[#ba1a1a]">Failed to add reservation. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowAddAccommodation(false)}
                  className="px-4 py-2 rounded-2xl bg-[#f5f3ef] text-sm hover:bg-[#efeeea] transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreateReservation}
                  disabled={creatingNewProperty ? !newPropertyForm.propertyName || createAccommodation.isPending || createReservation.isPending : !accommForm.accommodationPropertyId || createReservation.isPending}
                  className="px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
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
          <div className="bg-white rounded-2xl p-4 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)] mx-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Reservation — {editingReservation.propertyName}</h3>
              <button onClick={() => setEditingReservation(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Property */}
              <div>
                <label className="block text-sm font-medium mb-1">Property</label>
                <select value={editReservationForm.accommodationPropertyId} onChange={e => setEditReservationForm({ ...editReservationForm, accommodationPropertyId: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  {allAccommodation.map((a: AccommodationListDto) => (
                    <option key={a.id} value={a.id}>{a.propertyName} — {a.location || 'No location'}</option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Check-in</label>
                  <input type="date" value={editReservationForm.checkInDate} onChange={e => setEditReservationForm({ ...editReservationForm, checkInDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Check-out</label>
                  <input type="date" value={editReservationForm.checkOutDate} onChange={e => setEditReservationForm({ ...editReservationForm, checkOutDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
              </div>

              {/* Bedrooms / Beds / Cost */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Bedrooms</label>
                  <input type="number" min="0" value={editReservationForm.bedroomsReserved} onChange={e => setEditReservationForm({ ...editReservationForm, bedroomsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Beds</label>
                  <input type="number" min="0" value={editReservationForm.bedsReserved} onChange={e => setEditReservationForm({ ...editReservationForm, bedsReserved: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cost</label>
                  <input type="number" min="0" step="0.01" value={editReservationForm.cost} onChange={e => setEditReservationForm({ ...editReservationForm, cost: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select value={editReservationForm.reservationStatus} onChange={e => setEditReservationForm({ ...editReservationForm, reservationStatus: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all">
                  {['Researching', 'Requested', 'Booked', 'Confirmed', 'Cancelled', 'Unavailable'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Confirmation Reference */}
              <div>
                <label className="block text-sm font-medium mb-1">Confirmation Reference</label>
                <input type="text" value={editReservationForm.confirmationReference} onChange={e => setEditReservationForm({ ...editReservationForm, confirmationReference: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                  placeholder="e.g. booking ref number" />
              </div>

              {/* Date Booked / Date Confirmed */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Date Booked</label>
                  <input type="date" value={editReservationForm.dateBooked} onChange={e => setEditReservationForm({ ...editReservationForm, dateBooked: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Date Confirmed</label>
                  <input type="date" value={editReservationForm.dateConfirmed} onChange={e => setEditReservationForm({ ...editReservationForm, dateConfirmed: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
              </div>

              {/* Comments */}
              <div>
                <label className="block text-sm font-medium mb-1">Comments</label>
                <textarea value={editReservationForm.comments} onChange={e => setEditReservationForm({ ...editReservationForm, comments: e.target.value })} rows={3}
                  className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm resize-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
                  placeholder="Optional notes..." />
              </div>

              {/* Cancellation Reason (only show if cancelled) */}
              {editReservationForm.reservationStatus === 'Cancelled' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Cancellation Reason</label>
                  <input type="text" value={editReservationForm.cancellationReason} onChange={e => setEditReservationForm({ ...editReservationForm, cancellationReason: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm"
                    placeholder="Reason for cancellation..." />
                </div>
              )}

              {/* Error */}
              {updateReservation.isError && (
                <p className="text-sm text-[#ba1a1a]">Failed to update reservation. Please try again.</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditingReservation(null)}
                  className="px-4 py-2 rounded-2xl bg-[#f5f3ef] text-sm hover:bg-[#efeeea] transition-colors">
                  Cancel
                </button>
                <button onClick={handleUpdateReservation} disabled={updateReservation.isPending}
                  className="px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                  {updateReservation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete/Cancel Reservation Confirmation */}
      {deletingReservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletingReservation(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-[0_24px_32px_-12px_rgba(27,28,26,0.12)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Remove Reservation</h3>
              <button onClick={() => setDeletingReservation(null)} className="p-1 rounded hover:bg-[#efeeea] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[#43493a]">
              What would you like to do with the reservation at <span className="font-medium text-[#1b1c1a]">{deletingReservation.propertyName}</span>?
            </p>
            {(deleteReservation.isError || cancelReservation.isError) && (
              <p className="text-sm text-[#ba1a1a] mt-3">Something went wrong. Please try again.</p>
            )}
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={() => {
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
                className="w-full px-4 py-2 rounded-2xl bg-[#fef3c7]/60 text-sm font-medium hover:bg-[#fef3c7] transition-colors disabled:opacity-50 text-left">
                <span className="font-semibold">Cancel reservation</span>
                <span className="block text-xs text-[#43493a] mt-0.5">Mark as cancelled — keeps the record for history</span>
              </button>
              <button
                onClick={() => deleteReservation.mutate(deletingReservation.id, { onSuccess: () => setDeletingReservation(null) })}
                disabled={deleteReservation.isPending || cancelReservation.isPending}
                className="w-full px-4 py-2 rounded-2xl bg-[#ffdad6]/60 text-sm font-medium hover:bg-[#ffdad6] transition-colors disabled:opacity-50 text-left">
                <span className="font-semibold">Delete permanently</span>
                <span className="block text-xs text-[#43493a] mt-0.5">Remove completely — cannot be undone</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
