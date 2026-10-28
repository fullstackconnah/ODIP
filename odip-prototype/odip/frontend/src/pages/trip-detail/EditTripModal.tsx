import { useState, useEffect, useRef } from 'react'
import { useUpdateTrip, useEventTemplates, useStaff } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { Modal } from '@/components/Modal'
import type { TripDetailDto, UpdateTripDto } from '@/api/types/trips'
import { TRIP_STATUSES, type TripStatus } from '@/api/types/enums'
import { TRIP_STATUS_LABELS, statusItems } from '@/lib/tone'
import type { EventTemplateDto } from '@/api/types/events'
import type { StaffListDto } from '@/api/types/staff'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { extractErrorMessage } from '@/lib/utils'
import { FormField, textareaClass } from '@/components/FormField'
import { modalGrid, modalSpan } from '@/lib/formGrid'

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
            {updateTrip.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {tripEditForm ? (
        <div className="space-y-5">
          {/* Basic Info */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Basic info</p>
            <div className={modalGrid}>
              <FormField label="Trip Name" required className={modalSpan.full}><input value={tripEditForm.tripName} onChange={e => setTripEditForm({ ...tripEditForm, tripName: e.target.value })} placeholder="e.g. Beach Getaway 2026" /></FormField>
              <FormField label="Trip Code"><input value={tripEditForm.tripCode} onChange={e => setTripEditForm({ ...tripEditForm, tripCode: e.target.value })} placeholder="e.g. BG-2026-01" /></FormField>
              <FormField label="Event Template"><Dropdown
                  variant="form"
                  value={tripEditForm.eventTemplateId}
                  onChange={val => setTripEditForm({ ...tripEditForm, eventTemplateId: val })}
                  label="None"
                  items={[
                    { value: '', label: 'None' },
                    ...templates.map((t: EventTemplateDto) => ({ value: String(t.id), label: t.eventName })),
                  ]}
                /></FormField>
              <FormField label="Destination"><input value={tripEditForm.destination} onChange={e => setTripEditForm({ ...tripEditForm, destination: e.target.value })} placeholder="e.g. Gold Coast" /></FormField>
              <FormField label="Region"><input value={tripEditForm.region} onChange={e => setTripEditForm({ ...tripEditForm, region: e.target.value })} placeholder="e.g. QLD" /></FormField>
            </div>
          </div>

          {/* Dates & Status */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Dates & status</p>
            <div className={modalGrid}>
              <FormField label="Start Date" required error={errors.startDate}><input id="editTripStartDate" type="date" value={tripEditForm.startDate} onChange={e => { setTripEditForm({ ...tripEditForm, startDate: e.target.value }); setErrors(er => ({ ...er, startDate: undefined })) }} /></FormField>
              <FormField label="Duration (Days)" error={errors.durationDays}><input id="editTripDuration" type="number" min={1} value={tripEditForm.durationDays} onChange={e => { setTripEditForm({ ...tripEditForm, durationDays: Number(e.target.value) }); setErrors(er => ({ ...er, durationDays: undefined })) }} /></FormField>
              <FormField label="Booking Cutoff"><input type="date" value={tripEditForm.bookingCutoffDate} onChange={e => setTripEditForm({ ...tripEditForm, bookingCutoffDate: e.target.value })} /></FormField>
              <FormField label="Status"><Dropdown
                  variant="form"
                  value={tripEditForm.status}
                  onChange={val => setTripEditForm({ ...tripEditForm, status: val as TripStatus })}
                  items={statusItems(TRIP_STATUSES.filter(s => s !== 'WaitlistOnly'), TRIP_STATUS_LABELS)}
                /></FormField>
              <FormField label="Lead Coordinator" className={modalSpan.full}><Dropdown
                  variant="form"
                  value={tripEditForm.leadCoordinatorId}
                  onChange={val => setTripEditForm({ ...tripEditForm, leadCoordinatorId: val })}
                  label="None"
                  items={[
                    { value: '', label: 'None' },
                    ...allStaff.map((s: StaffListDto) => ({ value: String(s.id), label: s.fullName })),
                  ]}
                /></FormField>
            </div>
          </div>

          {/* Capacity */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Capacity & requirements</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-[var(--field-gap-x)] gap-y-[var(--field-gap-y)]">
              <FormField label="Min Participants"><input type="number" min={0} value={tripEditForm.minParticipants} onChange={e => setTripEditForm({ ...tripEditForm, minParticipants: e.target.value })} /></FormField>
              <FormField label="Max Participants"><input type="number" min={0} value={tripEditForm.maxParticipants} onChange={e => setTripEditForm({ ...tripEditForm, maxParticipants: e.target.value })} /></FormField>
              <FormField label="Wheelchair Capacity"><input type="number" min={0} value={tripEditForm.requiredWheelchairCapacity} onChange={e => setTripEditForm({ ...tripEditForm, requiredWheelchairCapacity: e.target.value })} /></FormField>
              <FormField label="Required Beds"><input type="number" min={0} value={tripEditForm.requiredBeds} onChange={e => setTripEditForm({ ...tripEditForm, requiredBeds: e.target.value })} /></FormField>
              <FormField label="Required Bedrooms"><input type="number" min={0} value={tripEditForm.requiredBedrooms} onChange={e => setTripEditForm({ ...tripEditForm, requiredBedrooms: e.target.value })} /></FormField>
              <FormField label="Min Staff Required"><input type="number" min={0} value={tripEditForm.minStaffRequired} onChange={e => setTripEditForm({ ...tripEditForm, minStaffRequired: e.target.value })} /></FormField>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <p id="editTripNotesLabel" className="text-sm font-medium">Notes</p>
            <textarea aria-labelledby="editTripNotesLabel" value={tripEditForm.notes} onChange={e => setTripEditForm({ ...tripEditForm, notes: e.target.value })}
              rows={3} className={textareaClass} placeholder="Any additional notes..." />
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
