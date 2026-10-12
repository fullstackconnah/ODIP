import { useState, useEffect, useRef } from 'react'
import { useUpdateTrip, useEventTemplates, useStaff } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { Modal } from '@/components/Modal'
import type { TripDetailDto, UpdateTripDto } from '@/api/types/trips'
import type { TripStatus } from '@/api/types/enums'
import type { EventTemplateDto } from '@/api/types/events'
import type { StaffListDto } from '@/api/types/staff'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { extractErrorMessage } from '@/lib/utils'

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
  const [errors, setErrors] = useState<{ startDate?: string; durationDays?: string }>({})

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
    const found = {
      startDate: tripEditForm.startDate ? undefined : 'Start date is required.',
      durationDays: tripEditForm.durationDays >= 1 ? undefined : 'Duration must be at least 1 day.',
    }
    setErrors(found)
    // Focus the first field in error; its message is a role="alert", so it is also announced.
    if (found.startDate || found.durationDays) { document.getElementById(found.startDate ? 'editTripStartDate' : 'editTripDuration')?.focus(); return }
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

  // A form, so a stray backdrop click must not throw the typing away; the sticky footer keeps Save in view while the body scrolls.
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Trip"
      size="lg"
      closeOnBackdrop={false}
      stickyFooter
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!tripEditForm || !tripEditForm.tripName.trim() || updateTrip.isPending}>
            {updateTrip.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </>
      }
    >
      {tripEditForm ? (
        <div className="space-y-5">
          {/* Basic Info */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">Basic Info</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Trip Name *</label>
                <input value={tripEditForm.tripName} onChange={e => setTripEditForm({ ...tripEditForm, tripName: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" placeholder="e.g. Beach Getaway 2026" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Trip Code</label>
                <input value={tripEditForm.tripCode} onChange={e => setTripEditForm({ ...tripEditForm, tripCode: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" placeholder="e.g. BG-2026-01" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Event Template</label>
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
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Destination</label>
                <input value={tripEditForm.destination} onChange={e => setTripEditForm({ ...tripEditForm, destination: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" placeholder="e.g. Gold Coast" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Region</label>
                <input value={tripEditForm.region} onChange={e => setTripEditForm({ ...tripEditForm, region: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" placeholder="e.g. QLD" />
              </div>
            </div>
          </div>

          {/* Dates & Status */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">Dates & Status</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="editTripStartDate" className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Start Date *</label>
                <input id="editTripStartDate" type="date" aria-invalid={!!errors.startDate} aria-describedby={errors.startDate ? 'editTripStartDateError' : undefined} value={tripEditForm.startDate} onChange={e => { setTripEditForm({ ...tripEditForm, startDate: e.target.value }); setErrors(er => ({ ...er, startDate: undefined })) }}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                {errors.startDate && <p id="editTripStartDateError" role="alert" className="text-xs text-[var(--color-destructive)] mt-1">{errors.startDate}</p>}
              </div>
              <div>
                <label htmlFor="editTripDuration" className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Duration (Days)</label>
                <input id="editTripDuration" type="number" aria-invalid={!!errors.durationDays} aria-describedby={errors.durationDays ? 'editTripDurationError' : undefined} min={1} value={tripEditForm.durationDays} onChange={e => { setTripEditForm({ ...tripEditForm, durationDays: Number(e.target.value) }); setErrors(er => ({ ...er, durationDays: undefined })) }}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                {errors.durationDays && <p id="editTripDurationError" role="alert" className="text-xs text-[var(--color-destructive)] mt-1">{errors.durationDays}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Booking Cutoff</label>
                <input type="date" value={tripEditForm.bookingCutoffDate} onChange={e => setTripEditForm({ ...tripEditForm, bookingCutoffDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Status</label>
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
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Lead Coordinator</label>
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
            <p className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">Capacity & Requirements</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Min Participants</label>
                <input type="number" min={0} value={tripEditForm.minParticipants} onChange={e => setTripEditForm({ ...tripEditForm, minParticipants: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Max Participants</label>
                <input type="number" min={0} value={tripEditForm.maxParticipants} onChange={e => setTripEditForm({ ...tripEditForm, maxParticipants: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Wheelchair Capacity</label>
                <input type="number" min={0} value={tripEditForm.requiredWheelchairCapacity} onChange={e => setTripEditForm({ ...tripEditForm, requiredWheelchairCapacity: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Required Beds</label>
                <input type="number" min={0} value={tripEditForm.requiredBeds} onChange={e => setTripEditForm({ ...tripEditForm, requiredBeds: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Required Bedrooms</label>
                <input type="number" min={0} value={tripEditForm.requiredBedrooms} onChange={e => setTripEditForm({ ...tripEditForm, requiredBedrooms: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Min Staff Required</label>
                <input type="number" min={0} value={tripEditForm.minStaffRequired} onChange={e => setTripEditForm({ ...tripEditForm, minStaffRequired: e.target.value })}
                  className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">Notes</p>
            <textarea value={tripEditForm.notes} onChange={e => setTripEditForm({ ...tripEditForm, notes: e.target.value })}
              rows={3} className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all" placeholder="Any additional notes..." />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-12 text-[var(--color-muted-foreground)] text-sm">
          Loading trip details…
        </div>
      )}

      {updateTrip.isError && (
        <Callout tone="error" className="mt-4">{extractErrorMessage(updateTrip.error, 'Failed to save the trip.')}</Callout>
      )}
    </Modal>
  )
}
