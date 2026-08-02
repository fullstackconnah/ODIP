import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useUpdateTrip, useEventTemplates, useStaff } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import type { TripDetailDto, UpdateTripDto } from '@/api/types/trips'
import type { TripStatus } from '@/api/types/enums'
import type { EventTemplateDto } from '@/api/types/events'
import type { StaffListDto } from '@/api/types/staff'

interface TripEditFormState {
  tripName: string
  tripCode: string
  eventTemplateId: string
  destination: string
  region: string
  startDate: string
  durationDays: number
  bookingCutoffDate: string
  status: TripStatus
  leadCoordinatorId: string
  minParticipants: number | string
  maxParticipants: number | string
  requiredWheelchairCapacity: number | string
  requiredBeds: number | string
  requiredBedrooms: number | string
  minStaffRequired: number | string
  notes: string
}

interface EditTripModalProps {
  trip: TripDetailDto
  onClose: () => void
}

export default function EditTripModal({ trip, onClose }: EditTripModalProps) {
  const updateTrip = useUpdateTrip()
  const { data: templates = [] } = useEventTemplates()
  const { data: allStaff = [] } = useStaff()
  const [tripEditForm, setTripEditForm] = useState<TripEditFormState | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (!trip || initialized.current) return
    initialized.current = true
    setTripEditForm({
      tripName: trip.tripName || '',
      tripCode: trip.tripCode || '',
      eventTemplateId: trip.eventTemplateId || '',
      destination: trip.destination || '',
      region: trip.region || '',
      startDate: trip.startDate?.split('T')[0] || '',
      durationDays: trip.durationDays ?? 1,
      bookingCutoffDate: trip.bookingCutoffDate?.split('T')[0] || '',
      status: trip.status || 'Draft',
      leadCoordinatorId: trip.leadCoordinatorId || '',
      minParticipants: trip.minParticipants ?? '',
      maxParticipants: trip.maxParticipants ?? '',
      requiredWheelchairCapacity: trip.requiredWheelchairCapacity ?? '',
      requiredBeds: trip.requiredBeds ?? '',
      requiredBedrooms: trip.requiredBedrooms ?? '',
      minStaffRequired: trip.minStaffRequired ?? '',
      notes: trip.notes || '',
    })
  }, [trip])

  const handleSave = () => {
    if (!trip?.id || !tripEditForm) return
    const toOptionalString = (v: string) => v || undefined
    const toOptionalNumber = (v: number | string) => (v === '' || v === null) ? undefined : Number(v) || undefined
    const data: UpdateTripDto = {
      tripName: tripEditForm.tripName,
      tripCode: toOptionalString(tripEditForm.tripCode),
      eventTemplateId: toOptionalString(tripEditForm.eventTemplateId),
      destination: toOptionalString(tripEditForm.destination),
      region: toOptionalString(tripEditForm.region),
      startDate: tripEditForm.startDate,
      durationDays: tripEditForm.durationDays,
      bookingCutoffDate: toOptionalString(tripEditForm.bookingCutoffDate),
      status: tripEditForm.status,
      leadCoordinatorId: toOptionalString(tripEditForm.leadCoordinatorId),
      minParticipants: toOptionalNumber(tripEditForm.minParticipants),
      maxParticipants: toOptionalNumber(tripEditForm.maxParticipants),
      requiredWheelchairCapacity: toOptionalNumber(tripEditForm.requiredWheelchairCapacity),
      requiredBeds: toOptionalNumber(tripEditForm.requiredBeds),
      requiredBedrooms: toOptionalNumber(tripEditForm.requiredBedrooms),
      minStaffRequired: toOptionalNumber(tripEditForm.minStaffRequired),
      notes: toOptionalString(tripEditForm.notes),
    }
    updateTrip.mutate({ id: trip.id, data }, { onSuccess: onClose })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-[0_32px_64px_-16px_rgba(27,28,26,0.2)]" onClick={e => e.stopPropagation()}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[rgba(195,201,181,0.2)]">
          <div>
            <h2 className="text-lg font-bold text-[#1b1c1a]">Edit Trip</h2>
            {!tripEditForm && <p className="text-xs text-[#43493a] mt-0.5">Loading trip details…</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#f5f3ef] transition-colors">
            <X className="w-4 h-4 text-[#43493a]" />
          </button>
        </div>

        {/* Modal body */}
        {tripEditForm ? (
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
            {/* Basic Info */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-[#396200] uppercase tracking-wider">Basic Info</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Trip Name *</label>
                  <input value={tripEditForm.tripName} onChange={e => setTripEditForm({ ...tripEditForm, tripName: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" placeholder="e.g. Beach Getaway 2026" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Trip Code</label>
                  <input value={tripEditForm.tripCode} onChange={e => setTripEditForm({ ...tripEditForm, tripCode: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" placeholder="e.g. BG-2026-01" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Event Template</label>
                  <Dropdown
                    variant="form"
                    value={tripEditForm.eventTemplateId}
                    onChange={val => setTripEditForm({ ...tripEditForm, eventTemplateId: val })}
                    label="None"
                    items={[
                      { value: '', label: 'None' },
                      ...templates.map((t: EventTemplateDto) => ({ value: String(t.id), label: t.eventName })),
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Destination</label>
                  <input value={tripEditForm.destination} onChange={e => setTripEditForm({ ...tripEditForm, destination: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" placeholder="e.g. Gold Coast" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Region</label>
                  <input value={tripEditForm.region} onChange={e => setTripEditForm({ ...tripEditForm, region: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" placeholder="e.g. QLD" />
                </div>
              </div>
            </div>

            {/* Dates & Status */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-[#396200] uppercase tracking-wider">Dates & Status</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Start Date *</label>
                  <input type="date" value={tripEditForm.startDate} onChange={e => setTripEditForm({ ...tripEditForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Duration (Days)</label>
                  <input type="number" min={1} value={tripEditForm.durationDays} onChange={e => setTripEditForm({ ...tripEditForm, durationDays: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Booking Cutoff</label>
                  <input type="date" value={tripEditForm.bookingCutoffDate} onChange={e => setTripEditForm({ ...tripEditForm, bookingCutoffDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Status</label>
                  <Dropdown
                    variant="form"
                    value={tripEditForm.status}
                    onChange={val => setTripEditForm({ ...tripEditForm, status: val as TripStatus })}
                    items={[
                      { value: 'Draft', label: 'Draft' },
                      { value: 'Planning', label: 'Planning' },
                      { value: 'OpenForBookings', label: 'Open For Bookings' },
                      { value: 'Confirmed', label: 'Confirmed' },
                      { value: 'InProgress', label: 'In Progress' },
                      { value: 'Completed', label: 'Completed' },
                      { value: 'Cancelled', label: 'Cancelled' },
                      { value: 'Archived', label: 'Archived' },
                    ]}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Lead Coordinator</label>
                  <Dropdown
                    variant="form"
                    value={tripEditForm.leadCoordinatorId}
                    onChange={val => setTripEditForm({ ...tripEditForm, leadCoordinatorId: val })}
                    label="None"
                    items={[
                      { value: '', label: 'None' },
                      ...allStaff.map((s: StaffListDto) => ({ value: String(s.id), label: s.fullName })),
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Capacity */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-[#396200] uppercase tracking-wider">Capacity & Requirements</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Min Participants</label>
                  <input type="number" min={0} value={tripEditForm.minParticipants} onChange={e => setTripEditForm({ ...tripEditForm, minParticipants: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Max Participants</label>
                  <input type="number" min={0} value={tripEditForm.maxParticipants} onChange={e => setTripEditForm({ ...tripEditForm, maxParticipants: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Wheelchair Capacity</label>
                  <input type="number" min={0} value={tripEditForm.requiredWheelchairCapacity} onChange={e => setTripEditForm({ ...tripEditForm, requiredWheelchairCapacity: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Required Beds</label>
                  <input type="number" min={0} value={tripEditForm.requiredBeds} onChange={e => setTripEditForm({ ...tripEditForm, requiredBeds: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Required Bedrooms</label>
                  <input type="number" min={0} value={tripEditForm.requiredBedrooms} onChange={e => setTripEditForm({ ...tripEditForm, requiredBedrooms: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Min Staff Required</label>
                  <input type="number" min={0} value={tripEditForm.minStaffRequired} onChange={e => setTripEditForm({ ...tripEditForm, minStaffRequired: e.target.value })}
                    className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#396200] uppercase tracking-wider">Notes</p>
              <textarea value={tripEditForm.notes} onChange={e => setTripEditForm({ ...tripEditForm, notes: e.target.value })}
                rows={3} className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" placeholder="Any additional notes..." />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-12 text-[#43493a] text-sm">
            Loading trip details…
          </div>
        )}

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[rgba(195,201,181,0.2)]">
          <button onClick={onClose}
            className="px-5 py-2.5 rounded-full text-sm font-medium text-[#43493a] hover:bg-[#f5f3ef] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!tripEditForm || updateTrip.isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold bg-gradient-to-br from-[#396200] to-[#4d7c0f] text-white shadow-lg shadow-[#396200]/20 hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {updateTrip.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
