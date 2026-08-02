import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import {
  useCreateEventTemplate,
  useUpdateEventTemplate,
  useDeactivateEventTemplate,
  useTrips,
} from '@/api/hooks'
import type { EventTemplateDto, TripListDto } from '@/api/types'

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

const schema = z.object({
  eventName: z.string().min(1, 'Required'),
  eventCode: z.string().min(1, 'Required'),
  defaultDestination: z.string().optional(),
  defaultRegion: z.string().optional(),
  standardDurationDays: z.coerce.number().int().positive().optional().or(z.literal('')),
  preferredTimeOfYear: z.string().optional(),
  typicalActivities: z.string().optional(),
  accessibilityNotes: z.string().optional(),
  fullyModifiedAccommodationNotes: z.string().optional(),
  semiModifiedAccommodationNotes: z.string().optional(),
  wheelchairAccessNotes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ---------------------------------------------------------------------------
// Field mapping helper
// ---------------------------------------------------------------------------

function mapTripToTemplate(trip: TripListDto): Partial<FormValues> {
  return {
    eventName: trip.tripName,
    eventCode: trip.tripCode ?? '',
    defaultDestination: trip.destination ?? '',
    defaultRegion: trip.region ?? '',
    standardDurationDays: trip.durationDays,
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateFormPanelProps {
  isOpen: boolean
  onClose: () => void
  /** Present → edit mode. Absent → create mode. */
  template?: EventTemplateDto
  /** Pre-seeds the form fields (from "Save as Template" on trip screen). */
  initialTrip?: TripListDto
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplateFormPanel({
  isOpen,
  onClose,
  template,
  initialTrip,
}: TemplateFormPanelProps) {
  const isEdit = !!template
  const createMutation = useCreateEventTemplate()
  const updateMutation = useUpdateEventTemplate()
  const deactivateMutation = useDeactivateEventTemplate()
  const { data: trips = [] } = useTrips()

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [selectedTripId, setSelectedTripId] = useState('')
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)
  const [accessibilityExpanded, setAccessibilityExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // Populate form when panel opens
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccessMessage(null)
    setShowDeactivateConfirm(false)
    setAccessibilityExpanded(false)

    if (template) {
      reset({
        eventName: template.eventName,
        eventCode: template.eventCode,
        defaultDestination: template.defaultDestination ?? '',
        defaultRegion: template.defaultRegion ?? '',
        standardDurationDays: template.standardDurationDays ?? '',
        preferredTimeOfYear: template.preferredTimeOfYear ?? '',
        typicalActivities: template.typicalActivities ?? '',
        accessibilityNotes: template.accessibilityNotes ?? '',
        fullyModifiedAccommodationNotes: template.fullyModifiedAccommodationNotes ?? '',
        semiModifiedAccommodationNotes: template.semiModifiedAccommodationNotes ?? '',
        wheelchairAccessNotes: template.wheelchairAccessNotes ?? '',
      })
    } else if (initialTrip) {
      reset(mapTripToTemplate(initialTrip))
      setSelectedTripId(initialTrip.id)
    } else {
      reset({})
      setSelectedTripId('')
    }
  }, [isOpen, template, initialTrip, reset])

  // Clear the auto-close timer on unmount to prevent state updates on an
  // unmounted component (e.g. user closes the panel before the 1500 ms elapses).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function handleTripSelect(tripId: string) {
    setSelectedTripId(tripId)
    if (!tripId) return
    const trip = trips.find(t => t.id === tripId)
    if (!trip) return
    const mapped = mapTripToTemplate(trip)
    reset({ ...getValues(), ...mapped })
  }

  async function onSubmit(values: FormValues) {
    setError(null)
    const payload = {
      ...values,
      standardDurationDays:
        values.standardDurationDays === '' ? undefined : Number(values.standardDurationDays),
      isActive: true,
    }
    try {
      if (isEdit && template) {
        await updateMutation.mutateAsync({ id: template.id, data: payload as any })
        setSuccessMessage('Template updated')
      } else {
        await createMutation.mutateAsync(payload as any)
        setSuccessMessage('Template created')
      }
      timerRef.current = setTimeout(() => {
        setSuccessMessage(null)
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(
        err?.response?.data?.errors?.[0] ||
          err?.response?.data?.message ||
          'Failed to save template.',
      )
    }
  }

  async function handleDeactivate() {
    if (!template) return
    setError(null)
    try {
      await deactivateMutation.mutateAsync(template.id)
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.errors?.[0] || 'Failed to deactivate template.')
    }
  }

  const inputClass =
    'w-full px-3 py-2 rounded-xl bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all'
  const labelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  const isBusy =
    isSubmitting || createMutation.isPending || updateMutation.isPending || deactivateMutation.isPending

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--color-card)] border-l border-[var(--color-border)] z-50 flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-foreground)]">
            {isEdit ? 'Edit Template' : 'New Template'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--color-muted-foreground)]" />
          </button>
        </div>

        {/* Scrollable form body */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
        >
          {/* Fill from trip — create mode only */}
          {!isEdit && (
            <div>
              <label htmlFor="fillFromTrip" className={labelClass}>Fill from trip</label>
              <select
                id="fillFromTrip"
                value={selectedTripId}
                onChange={e => handleTripSelect(e.target.value)}
                className={inputClass}
              >
                <option value="">— select a trip —</option>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.tripName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                Fills name, code, destination, region, and duration from the selected trip.
              </p>
            </div>
          )}

          {/* Event Name */}
          <div>
            <label htmlFor="eventName" className={labelClass}>Event Name *</label>
            <input
              id="eventName"
              {...register('eventName')}
              className={inputClass}
              placeholder="e.g. Gold Coast Beach Break"
            />
            {errors.eventName && (
              <p className="text-xs text-red-500 mt-1">{errors.eventName.message}</p>
            )}
          </div>

          {/* Event Code */}
          <div>
            <label htmlFor="eventCode" className={labelClass}>Event Code *</label>
            <input
              id="eventCode"
              {...register('eventCode')}
              className={`${inputClass} font-mono uppercase`}
              placeholder="e.g. GOLD-01"
            />
            {errors.eventCode && (
              <p className="text-xs text-red-500 mt-1">{errors.eventCode.message}</p>
            )}
          </div>

          {/* Destination + Region */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="defaultDestination" className={labelClass}>Default Destination</label>
              <input
                id="defaultDestination"
                {...register('defaultDestination')}
                className={inputClass}
                placeholder="e.g. Gold Coast"
              />
            </div>
            <div>
              <label htmlFor="defaultRegion" className={labelClass}>Default Region</label>
              <input
                id="defaultRegion"
                {...register('defaultRegion')}
                className={inputClass}
                placeholder="e.g. QLD"
              />
            </div>
          </div>

          {/* Duration + Preferred Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="standardDurationDays" className={labelClass}>Duration (days)</label>
              <input
                id="standardDurationDays"
                {...register('standardDurationDays')}
                type="number"
                min={1}
                className={inputClass}
                placeholder="e.g. 7"
              />
            </div>
            <div>
              <label htmlFor="preferredTimeOfYear" className={labelClass}>Preferred Time of Year</label>
              <input
                id="preferredTimeOfYear"
                {...register('preferredTimeOfYear')}
                className={inputClass}
                placeholder="e.g. Winter"
              />
            </div>
          </div>

          {/* Typical Activities */}
          <div>
            <label htmlFor="typicalActivities" className={labelClass}>Typical Activities</label>
            <textarea
              id="typicalActivities"
              {...register('typicalActivities')}
              rows={3}
              className={inputClass}
              placeholder="Describe typical activities…"
            />
          </div>

          {/* Accessibility Notes */}
          <div>
            <label htmlFor="accessibilityNotes" className={labelClass}>Accessibility Notes</label>
            <textarea
              id="accessibilityNotes"
              {...register('accessibilityNotes')}
              rows={3}
              className={inputClass}
              placeholder="General accessibility notes…"
            />
          </div>

          {/* Collapsible accommodation notes */}
          <div>
            <button
              type="button"
              onClick={() => setAccessibilityExpanded(p => !p)}
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
            >
              {accessibilityExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Accommodation Notes
            </button>

            {accessibilityExpanded && (
              <div className="mt-3 space-y-3 pl-5 border-l border-[var(--color-border)]">
                <div>
                  <label htmlFor="fullyModifiedAccommodationNotes" className={labelClass}>Fully Modified Accommodation</label>
                  <textarea
                    id="fullyModifiedAccommodationNotes"
                    {...register('fullyModifiedAccommodationNotes')}
                    rows={2}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="semiModifiedAccommodationNotes" className={labelClass}>Semi Modified Accommodation</label>
                  <textarea
                    id="semiModifiedAccommodationNotes"
                    {...register('semiModifiedAccommodationNotes')}
                    rows={2}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="wheelchairAccessNotes" className={labelClass}>Wheelchair Access Notes</label>
                  <textarea
                    id="wheelchairAccessNotes"
                    {...register('wheelchairAccessNotes')}
                    rows={2}
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Success message */}
          {successMessage && (
            <div className="bg-[#bff285] border border-[#8fc950] rounded-xl px-4 py-3 text-sm text-[#294800] font-medium">
              {successMessage}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </form>

        {/* Footer — sticky at bottom, outside scroll area */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] space-y-3 shrink-0">
          {/* Deactivate (edit mode only) */}
          {isEdit && (
            <div>
              {showDeactivateConfirm ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--color-muted-foreground)]">
                    Deactivate this template?
                  </span>
                  <button
                    type="button"
                    onClick={handleDeactivate}
                    disabled={deactivateMutation.isPending}
                    className="text-red-600 font-medium hover:underline disabled:opacity-50"
                  >
                    {deactivateMutation.isPending ? 'Deactivating…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeactivateConfirm(false)}
                    className="text-[var(--color-muted-foreground)] hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeactivateConfirm(true)}
                  className="text-sm text-red-500 hover:text-red-700 hover:underline transition-colors"
                >
                  Deactivate template
                </button>
              )}
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit(onSubmit)}
              disabled={isBusy}
              className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {isBusy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
