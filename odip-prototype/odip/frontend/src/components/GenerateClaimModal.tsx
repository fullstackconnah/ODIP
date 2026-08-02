import { useState } from 'react'
import { usePreviewClaim, useGenerateClaim } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { DataTable } from '@/components/DataTable'
import type { TripDetailDto, ClaimPreviewResponseDto, ClaimPreviewLineItemDto } from '@/api/types'
import type { AxiosError } from 'axios'

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

  const inputClass = "w-full px-3 py-2 rounded-xl border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 bg-[var(--color-surface)]"
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
              className="px-4 py-2 text-sm rounded-full border border-[var(--color-border)] text-[var(--color-muted-foreground)] font-medium hover:bg-[var(--color-accent)] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handlePreview}
              disabled={previewClaim.isPending}
              className="px-4 py-2 text-sm rounded-full bg-[#396200] text-white font-medium hover:bg-[#294800] transition-all disabled:opacity-50"
            >
              {previewClaim.isPending ? 'Loading...' : 'Preview Claim \u2192'}
            </button>
          </>
        ) : (
          <div className="flex justify-between w-full">
            <button
              onClick={() => { setStep('input'); setError(null) }}
              className="px-4 py-2 text-sm rounded-full border border-[var(--color-border)] text-[var(--color-muted-foreground)] font-medium hover:bg-[var(--color-accent)] transition-all"
            >
              &larr; Back
            </button>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-full border border-[var(--color-border)] text-[var(--color-muted-foreground)] font-medium hover:bg-[var(--color-accent)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generateClaim.isPending}
                className="px-4 py-2 text-sm rounded-full bg-[#396200] text-white font-medium hover:bg-[#294800] transition-all disabled:opacity-50"
              >
                {generateClaim.isPending ? 'Generating...' : 'Confirm & Generate'}
              </button>
            </div>
          </div>
        )
      }
    >
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-start gap-2 mb-4">
            <span className="mt-0.5">&#9888;</span>
            <span>{error}</span>
          </div>
        )}

        {step === 'input' && (
          <>
            {/* Trip summary */}
            <div className="mb-5">
              <p className="font-medium text-[var(--color-foreground)]">{trip.tripName}</p>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {startDate} &ndash; {endDate} ({durationDays} day{durationDays !== 1 ? 's' : ''})
              </p>
            </div>

            {/* Confirm Trip Times */}
            <div className="mb-5">
              <h4 className="text-sm font-medium text-[var(--color-muted-foreground)] mb-3">Confirm Trip Times</h4>
              <div className="grid grid-cols-3 gap-3">
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
            <div className="mb-5">
              <h4 className="text-sm font-medium text-[var(--color-muted-foreground)] mb-3">Trip Info</h4>
              <div className="bg-[var(--color-surface)] rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
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
            <div className="bg-[var(--color-surface)] rounded-xl p-4 mb-5">
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
            <div className="mb-5">
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

          </>
        )}
    </Modal>
  )
}
