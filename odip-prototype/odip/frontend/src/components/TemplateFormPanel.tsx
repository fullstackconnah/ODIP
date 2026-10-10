import { modalGrid, modalSpan } from '@/lib/formGrid'
import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  useCreateEventTemplate,
  useUpdateEventTemplate,
  useDeactivateEventTemplate,
  useTrips,
} from '@/api/hooks'
import type { EventTemplateDto, TripListDto } from '@/api/types'
import { SearchableSelect } from '@/components/SearchableSelect'
import { SlideOver } from '@/components/SlideOver'
import { extractErrorMessage } from '@/lib/utils'

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
    formState: { errors, isSubmitting, isDirty },
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
      setError(extractErrorMessage(err, 'Failed to save template.'))
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
    'w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all'
  const labelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  const isBusy =
    isSubmitting || createMutation.isPending || updateMutation.isPending || deactivateMutation.isPending

  // Unsaved edits. Choosing a trip in "Fill from trip" re-seeds the form with reset(), which would otherwise read as clean, so
  // a changed selection counts too. Once the save has gone through (the "Template created" notice, up to the auto-close) there is
  // nothing left to lose.
  const dirty = (isDirty || selectedTripId !== (initialTrip?.id ?? '')) && !successMessage

  if (!isOpen) return null

  return (
    <SlideOver
      open
      onClose={onClose}
      title={isEdit ? 'Edit Template' : 'New Template'}
      dirty={dirty}
      footerClassName="py-3 space-y-3"
      footer={
        <>
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
                    className="text-[var(--color-destructive)] font-medium hover:underline disabled:opacity-50"
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
                  className="text-sm text-[var(--color-destructive)] hover:opacity-80 hover:underline transition-colors"
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
              className="inline-flex items-center justify-center h-[var(--control-h)] px-5 bg-[var(--color-primary)] text-white rounded-[var(--radius-md)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {isBusy ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className={modalGrid}>
        {/* Fill from trip — create mode only */}
        {!isEdit && (
          <div>
            <label id="fillFromTripLabel" className={labelClass}>Fill from trip</label>
            <SearchableSelect
              id="fillFromTrip"
              aria-labelledby="fillFromTripLabel"
              value={selectedTripId}
              onChange={handleTripSelect}
              placeholder="— select a trip —"
              items={trips.map(t => ({ value: t.id, label: t.tripName }))}
            />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Fills name, code, destination, region, and duration from the selected trip.
            </p>
          </div>
        )}

        {/* Event Name */}
        <div className={modalSpan.full}>
          <label htmlFor="eventName" className={labelClass}>Event Name *</label>
          <input
            id="eventName"
            {...register('eventName')}
            className={inputClass}
            placeholder="e.g. Gold Coast Beach Break"
          />
          {errors.eventName && (
            <p className="text-xs text-[var(--color-destructive)] mt-1">{errors.eventName.message}</p>
          )}
        </div>

        {/* Event Code */}
        <div className={modalSpan.half}>
          <label htmlFor="eventCode" className={labelClass}>Event Code *</label>
          <input
            id="eventCode"
            {...register('eventCode')}
            className={`${inputClass} font-mono uppercase`}
            placeholder="e.g. GOLD-01"
          />
          {errors.eventCode && (
            <p className="text-xs text-[var(--color-destructive)] mt-1">{errors.eventCode.message}</p>
          )}
        </div>

        {/* Destination + Region */}
        <div className="contents">
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
        <div className="contents">
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
        <div className={modalSpan.full}>
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
        <div className={modalSpan.full}>
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
        <div className={modalSpan.full}>
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
            <div className="mt-3 flex flex-col gap-[var(--field-gap-y)] pl-5 border-l border-[var(--color-border)]">
              <div>
                <label htmlFor="fullyModifiedAccommodationNotes" className={labelClass}>Fully Modified Accommodation</label>
                <textarea
                  id="fullyModifiedAccommodationNotes"
                  {...register('fullyModifiedAccommodationNotes')}
                  rows={3}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="semiModifiedAccommodationNotes" className={labelClass}>Semi Modified Accommodation</label>
                <textarea
                  id="semiModifiedAccommodationNotes"
                  {...register('semiModifiedAccommodationNotes')}
                  rows={3}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="wheelchairAccessNotes" className={labelClass}>Wheelchair Access Notes</label>
                <textarea
                  id="wheelchairAccessNotes"
                  {...register('wheelchairAccessNotes')}
                  rows={3}
                  className={inputClass}
                />
              </div>
            </div>
          )}
        </div>

        {/* Success message */}
        {successMessage && (
          <div className="sm:col-span-2 bg-[var(--color-primary-fixed)] border border-[var(--color-primary-container)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-primary-fixed)] font-medium">
            {successMessage}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="sm:col-span-2 bg-[var(--color-error-container)] border border-[var(--color-error-container)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-error-container)]">
            {error}
          </div>
        )}
      </form>
    </SlideOver>
  )
}
