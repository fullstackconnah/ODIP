import { useState } from 'react'
import { usePreviewClaim, useGenerateClaim } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { DataTable } from '@/components/DataTable'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import type { TripDetailDto, ClaimPreviewResponseDto, ClaimPreviewLineItemDto } from '@/api/types'
import type { AxiosError } from 'axios'
import { plural } from '@/lib/format'

interface GenerateClaimModalProps {
  tripId: string
  trip: TripDetailDto
  onClose: () => void
  onSuccess: () => void
}

const dayTypeLabel = (dt: string) => {
  switch (dt) {
    case 'Weekday': return 'Weekday'
    case 'WeekdayEvening': return 'Weekday Evening'
    case 'WeekdayNight': return 'Weekday Night'
    case 'Saturday': return 'Saturday'
    case 'Sunday': return 'Sunday'
    case 'PublicHoliday': return 'Public Holiday'
    default: return dt
  }
}

export default function GenerateClaimModal({ tripId, trip, onClose, onSuccess }: GenerateClaimModalProps) {
  const [step, setStep] = useState<'input' | 'preview'>('input')
  const [departureTime, setDepartureTime] = useState(trip.departureTime || '08:00')
  const [returnTime, setReturnTime] = useState(trip.returnTime || '18:00')
  const [activeHoursPerDay, setActiveHoursPerDay] = useState(trip.activeHoursPerDay || 8)
  const [previewData, setPreviewData] = useState<ClaimPreviewResponseDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewClaim = usePreviewClaim()
  const generateClaim = useGenerateClaim()

  const startDate = trip.startDate ? new Date(trip.startDate).toLocaleDateString('en-AU') : '—'
  const endDate = trip.endDate ? new Date(trip.endDate).toLocaleDateString('en-AU') : '—'
  const durationDays = trip.startDate && trip.endDate
    ? Math.ceil((new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0

  function handlePreview() {
    setError(null)
    previewClaim.mutate(
      { tripId, data: { departureTime, returnTime, activeHoursPerDay } },
      {
        onSuccess: (data) => {
          setPreviewData(data)
          setStep('preview')
        },
        onError: (err: unknown) => {
          const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
          setError(axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || 'Failed to generate preview. Check provider settings and confirm the trip has confirmed bookings.')
        },
      },
    )
  }

  function handleGenerate() {
    setError(null)
    generateClaim.mutate(
      { tripId, data: { departureTime, returnTime, activeHoursPerDay } },
      {
        onSuccess: () => onSuccess(),
        onError: (err: unknown) => {
          const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
          setError(axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || 'Failed to generate claim.')
        },
      },
    )
  }

  const inputClass = "w-full px-3 h-[var(--control-h)] rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] bg-[var(--color-surface)]"
  const labelClass = "block text-sm text-[var(--color-muted-foreground)] mb-1"

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'input' ? 'Generate NDIS Claim' : 'Claim Preview'}
      size="lg"
      footer={
        step === 'input' ? (
          <>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] font-medium hover:bg-[var(--color-accent)] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handlePreview}
              disabled={previewClaim.isPending}
              className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white font-medium hover:opacity-90 transition-all disabled:opacity-50"
            >
              {previewClaim.isPending ? 'Loading...' : 'Preview Claim \u2192'}
            </button>
          </>
        ) : (
          <div className="flex justify-between w-full">
            <button
              onClick={() => { setStep('input'); setError(null) }}
              className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] font-medium hover:bg-[var(--color-accent)] transition-all"
            >
              &larr; Back
            </button>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] font-medium hover:bg-[var(--color-accent)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generateClaim.isPending}
                className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white font-medium hover:opacity-90 transition-all disabled:opacity-50"
              >
                {generateClaim.isPending ? 'Generating...' : 'Confirm & Generate'}
              </button>
            </div>
          </div>
        )
      }
    >
        {error && (
          <div className="bg-[var(--color-error-container)] border border-[var(--color-error-container)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-error-container)] flex items-start gap-2 mb-4">
            <span className="mt-0.5">&#9888;</span>
            <span>{error}</span>
          </div>
        )}

        {step === 'input' && (
          <>
            {/* Trip summary */}
            <div className="mb-[var(--section-gap)]">
              <p className="font-medium text-[var(--color-foreground)]">{trip.tripName}</p>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {startDate} &ndash; {endDate} ({plural(durationDays, 'day')})
              </p>
            </div>

            {/* Confirm Trip Times */}
            <div className="mb-[var(--section-gap)]">
              <h4 className="text-sm font-medium text-[var(--color-muted-foreground)] mb-3">Confirm Trip Times</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-[var(--field-gap-x)] gap-y-[var(--field-gap-y)]">
                <div>
                  <label className={labelClass}>Departure Time</label>
                  <input
                    type="time"
                    value={departureTime}
                    onChange={e => setDepartureTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Return Time</label>
                  <input
                    type="time"
                    value={returnTime}
                    onChange={e => setReturnTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Active Hours/Day</label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={activeHoursPerDay}
                    onChange={e => setActiveHoursPerDay(parseFloat(e.target.value) || 0)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Trip Info (read-only) */}
            <div className="mb-[var(--section-gap)]">
              <h4 className="text-sm font-medium text-[var(--color-muted-foreground)] mb-3">Trip Info</h4>
              <div className="bg-[var(--color-surface)] rounded-[var(--radius-md)] p-[var(--card-pad)] grid grid-cols-1 sm:grid-cols-2 gap-[var(--field-gap-y)] text-sm">
                <div>
                  <span className="text-[var(--color-muted-foreground)]">Staff Assigned</span>
                  <p className="font-medium">{trip.staffAssignedCount ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[var(--color-muted-foreground)]">Confirmed Bookings</span>
                  <p className="font-medium">{trip.currentParticipantCount ?? '—'}</p>
                </div>
              </div>
            </div>

          </>
        )}

        {step === 'preview' && previewData && (
          <>
            {/* Summary card */}
            <div className="bg-[var(--color-surface)] rounded-[var(--radius-md)] p-4 mb-[var(--section-gap)]">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm text-[var(--color-muted-foreground)]">Total Estimate</span>
                <span className="text-xl font-semibold">${previewData.totalAmount?.toFixed(2)}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-muted-foreground)]">
                <span>Participants: {previewData.confirmedParticipantCount ?? '—'}</span>
                <span>Staff: {previewData.staffCount ?? '—'}</span>
                {previewData.state && <span>{previewData.state}</span>}
                <span>Departure: {departureTime}</span>
                <span>Return: {returnTime}</span>
                <span>Hours/Day: {activeHoursPerDay}</span>
              </div>
            </div>

            {/* Line items table */}
            <div className="mb-[var(--section-gap)]">
              <h4 className="text-sm font-medium text-[var(--color-muted-foreground)] mb-3">Line Items</h4>
              <DataTable
                data={(previewData.lineItems ?? []).map((item: ClaimPreviewLineItemDto, i: number) => ({ ...item, _idx: i }))}
                keyField="_idx"
                columns={[
                  { key: 'participantName', header: 'Participant' },
                  {
                    key: 'dayType',
                    header: 'Day Type',
                    render: (item: ClaimPreviewLineItemDto & { _idx: number }) => item.dayTypeLabel || dayTypeLabel(item.dayType),
                  },
                  {
                    key: 'supportsDeliveredFrom',
                    header: 'Dates',
                    render: (item: ClaimPreviewLineItemDto & { _idx: number }) => {
                      const from = item.supportsDeliveredFrom ? new Date(item.supportsDeliveredFrom).toLocaleDateString('en-AU') : '—'
                      const to = item.supportsDeliveredTo && item.supportsDeliveredTo !== item.supportsDeliveredFrom
                        ? ` – ${new Date(item.supportsDeliveredTo).toLocaleDateString('en-AU')}`
                        : ''
                      return from + to
                    },
                  },
                  { key: 'hours', header: 'Hours' },
                  { key: 'totalAmount', header: 'Amount', type: 'currency' as const, className: 'font-medium' },
                ]}
              />
            </div>

            {/* What this claim would use of each participant's recorded plan: a warning, never a block. Absent when none of them has a plan that has started. */}
            <div className="mt-[var(--section-gap)]">
              <ClaimBudgetBlock budget={previewData.budget} />
            </div>

          </>
        )}
    </Modal>
  )
}
