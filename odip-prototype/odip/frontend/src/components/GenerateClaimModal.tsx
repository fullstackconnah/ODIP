import { useState } from 'react'
import { usePreviewClaim, useGenerateClaim } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { DataTable } from '@/components/DataTable'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import { LeftOutCallout } from '@/components/LeftOutCallout'
import type { TripDetailDto, ClaimPreviewResponseDto, ClaimPreviewLineItemDto } from '@/api/types'
import { plural } from '@/lib/format'
import { extractErrorMessage, formatCurrency, formatDateAu } from '@/lib/utils'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'

interface GenerateClaimModalProps {
  tripId: string
  trip: TripDetailDto
  onClose: () => void
  onSuccess: () => void
}

export const dayTypeLabel = (dt: string) => {
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

  const startDate = formatDateAu(trip.startDate)
  const endDate = formatDateAu(trip.endDate)
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
        onError: (err: unknown) => setError(extractErrorMessage(err, 'Failed to generate preview. Check provider settings and confirm the trip has confirmed bookings.')),
      },
    )
  }

  function handleGenerate() {
    setError(null)
    generateClaim.mutate(
      { tripId, data: { departureTime, returnTime, activeHoursPerDay } },
      {
        onSuccess: () => onSuccess(),
        onError: (err: unknown) => setError(extractErrorMessage(err, 'Failed to generate claim.')),
      },
    )
  }


  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'input' ? 'Generate NDIS Claim' : 'Claim Preview'}
      size="lg"
      footer={
        step === 'input' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handlePreview} disabled={previewClaim.isPending}>
              {previewClaim.isPending ? 'Loading...' : 'Preview Claim \u2192'}
            </Button>
          </>
        ) : (
          <div className="flex justify-between w-full">
            <Button variant="secondary" onClick={() => { setStep('input'); setError(null) }}>
              &larr; Back
            </Button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={generateClaim.isPending}>
                {generateClaim.isPending ? 'Generating...' : 'Confirm & Generate'}
              </Button>
            </div>
          </div>
        )
      }
    >
        {error && (
          <Callout tone="error" className="mb-4">{error}</Callout>
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
                <FormField label="Departure Time"><input
                    type="time"
                    value={departureTime}
                    onChange={e => setDepartureTime(e.target.value)}
                  /></FormField>
                <FormField label="Return Time"><input
                    type="time"
                    value={returnTime}
                    onChange={e => setReturnTime(e.target.value)}
                  /></FormField>
                <FormField label="Active Hours/Day"><input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={activeHoursPerDay}
                    onChange={e => setActiveHoursPerDay(parseFloat(e.target.value) || 0)}
                  /></FormField>
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
                <span className="text-xl font-semibold">{formatCurrency(previewData.totalAmount)}</span>
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
                      const from = formatDateAu(item.supportsDeliveredFrom)
                      const to = item.supportsDeliveredTo && item.supportsDeliveredTo !== item.supportsDeliveredFrom
                        ? ` – ${formatDateAu(item.supportsDeliveredTo)}`
                        : ''
                      return from + to
                    },
                  },
                  { key: 'hours', header: 'Hours' },
                  { key: 'totalAmount', header: 'Amount', type: 'currency' as const, className: 'font-medium' },
                ]}
              />
            </div>

            {/* Confirmed participants the claim skips (no NDIS number): never dropped silently. */}
            {(previewData.leftOut?.length ?? 0) > 0 && (
              <div className="mt-[var(--section-gap)]">
                <LeftOutCallout
                  items={(previewData.leftOut ?? []).map(p => ({ key: p.participantId, description: p.description, reason: p.reason }))}
                  heading={`${plural(previewData.leftOut?.length ?? 0, 'participant')} will be left out of this claim`}
                  footer="Their bookings stay confirmed. Nothing here is billed for them."
                />
              </div>
            )}

            {/* What this claim would use of each participant's recorded plan: a warning, never a block. Absent when none of them has a plan that has started. */}
            <div className="mt-[var(--section-gap)]">
              <ClaimBudgetBlock budget={previewData.budget} />
            </div>

          </>
        )}
    </Modal>
  )
}
