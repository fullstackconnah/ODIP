import { useEffect, useRef, useState } from 'react'
import { CalendarX } from 'lucide-react'
import { useMakeCancellationClaim, usePreviewCancellationClaim } from '@/api/hooks/claimHub'
import type { CancellationCandidateDto, CancellationCandidatesDto, CancellationLeftOutDto, ShiftClaimPreviewLineItemDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ClaimBudgetBlock } from '@/components/ClaimBudgetBlock'
import { DataTable } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { LeftOutCallout } from '@/components/LeftOutCallout'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { CANCELLATION_REASONS } from '@/lib/cancellationReasons'
import { formatDateTimeAu, formatServiceDate, plural } from '@/lib/format'
import { extractErrorMessage, formatCurrency, formatShiftTime } from '@/lib/utils'

const SHIFT_FIELD_ID = 'cancellation-claim-shift'
const PREVIEW_FAILED = "Couldn't load the preview. Check your connection and try again."
const MAKE_FAILED = "Couldn't make the claim. Check your connection and try again."
const WORD_JOINER = '⁠'   // after an en dash, so a time range never breaks right after it

/** The same two sentences as the shift claim's "left out" list, for a cancelled shift: it stays cancelled and nothing is billed for it. */
const LEFT_OUT_FOOTER = 'They stay cancelled and unclaimed. Nothing here is billed for them.'

const timeRange = (s: CancellationCandidateDto) => `${formatShiftTime(s.startTime)}–${WORD_JOINER}${formatShiftTime(s.endTime)}`

/** A reason that already starts with the participant's name ("Anna Lee: NDIS number missing.") keeps its own wording; the name is not said twice. */
const leftOutItems = (items: CancellationLeftOutDto[]) =>
  items.map(l => ({
    key: l.shiftId,
    lead: <span className="tabular-nums">{formatServiceDate(l.serviceDate)}</span>,
    description: `${l.participantName} · ${l.description}`,
    reason: l.reason.startsWith(`${l.participantName}: `) ? l.reason.slice(l.participantName.length + 2) : l.reason,
  }))

/**
 * The two steps of "A cancellation": choose the cancelled shift and why the participant cancelled, then check the claim and make it. A child of the "New claim" chooser, which owns
 * the first step back (`onBack`) and the list query; making the claim hands its id to `onMade`, and the page opens it.
 */
export function CancellationClaimSteps({ candidates, onBack, onClose, onMade }: {
  candidates: { data: CancellationCandidatesDto | undefined; isLoading: boolean; isError: boolean; refetch: () => unknown }
  onBack: () => void
  onClose: () => void
  onMade: (claimId: string) => void
}) {
  const [step, setStep] = useState<'pick' | 'check'>('pick')
  const [shiftId, setShiftId] = useState('')
  const [reason, setReason] = useState('')
  const preview = usePreviewCancellationClaim()
  const make = useMakeCancellationClaim()
  const makeButton = useRef<HTMLButtonElement>(null)

  const shifts = candidates.data?.shifts ?? []
  const leftOut = candidates.data?.leftOut ?? []
  const none = !candidates.isLoading && !candidates.isError && shifts.length === 0
  const previewed = preview.data
  const making = make.isPending
  const previewing = preview.isPending

  // Focus follows a step change (the first render is the Modal's own initial focus): the shift field on step 1, the Make claim button once the preview is in.
  useEffect(() => {
    if (step === 'pick') document.getElementById(SHIFT_FIELD_ID)?.focus()
  }, [step])
  useEffect(() => {
    if (step === 'check' && previewed) makeButton.current?.focus()
  }, [step, previewed])

  const runPreview = () => {
    if (!shiftId || !reason) return
    setStep('check')
    make.reset()
    preview.mutate(shiftId)
  }
  const makeClaim = () => {
    if (making || !previewed) return
    make.mutate({ shiftId, cancellationReason: reason }, { onSuccess: created => onMade(created.id) })
  }

  const leftOutBlock = leftOut.length > 0 && (
    <div className="mt-[var(--section-gap)]">
      <LeftOutCallout items={leftOutItems(leftOut)} heading={`${plural(leftOut.length, 'cancelled shift')} not offered`} footer={LEFT_OUT_FOOTER} />
    </div>
  )

  if (step === 'pick') {
    return (
      <Modal
        open
        onClose={onClose}
        title="Choose a cancelled shift"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={onBack}>Back</Button>
            {!none && !candidates.isError && <Button size="md" onClick={runPreview} disabled={!shiftId || !reason}>Preview</Button>}
          </>
        }
      >
        {candidates.isError ? (
          <PageState kind="error" noun="cancelled shifts" onRetry={() => candidates.refetch()} />
        ) : none ? (
          <EmptyState size="inline" icon={CalendarX} title="No short-notice cancellations to claim" description="A shift shows here when it was cancelled less than 7 days before it started." />
        ) : (
          <div className="flex flex-col gap-4">
            <FormField label="Cancelled shift">
              <Dropdown
                id={SHIFT_FIELD_ID}
                variant="form"
                searchable
                truncateLabel
                loading={candidates.isLoading}
                label="Choose a cancelled shift"
                value={shiftId}
                onChange={setShiftId}
                items={shifts.map(s => ({
                  value: s.shiftId,
                  label: `${s.participantName} · ${formatServiceDate(s.serviceDate)}`,
                  description: `${timeRange(s)} · cancelled ${formatDateTimeAu(s.cancelledAt)}`,
                }))}
              />
            </FormField>
            <FormField label="Why did the participant cancel?" hint="Only claim when the participant cancelled.">
              <Dropdown variant="form" label="Choose a reason" items={CANCELLATION_REASONS} value={reason} onChange={setReason} />
            </FormField>
          </div>
        )}
        {leftOutBlock}
      </Modal>
    )
  }

  const chosen = shifts.find(s => s.shiftId === shiftId)
  const lineFailed = preview.isError
  return (
    <Modal
      open
      onClose={making ? () => undefined : onClose}
      hideClose={making}
      title="Check the claim"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => setStep('pick')} disabled={making}>Back</Button>
          {lineFailed
            ? <Button size="md" onClick={() => preview.mutate(shiftId)}>Try again</Button>
            : <Button ref={makeButton} size="md" onClick={makeClaim} disabled={!previewed || previewing} aria-busy={making || undefined}>{making ? 'Making claim…' : 'Make claim'}</Button>}
        </>
      }
    >
      {make.isError && <Callout tone="danger" className="mb-3">{extractErrorMessage(make.error, MAKE_FAILED)}</Callout>}
      {previewing && <PageState kind="loading" noun="claim preview" />}
      {lineFailed && <Callout tone="danger">{extractErrorMessage(preview.error, PREVIEW_FAILED)}</Callout>}
      {previewed && (
        <div className="flex flex-col gap-[var(--section-gap)]">
          {chosen && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {chosen.participantName} · {formatServiceDate(chosen.serviceDate)} · {timeRange(chosen)} · {CANCELLATION_REASONS.find(r => r.value === reason)?.label}
            </p>
          )}
          <div className="flex items-baseline justify-between rounded-xl bg-[var(--color-surface)] p-4">
            <span className="text-sm text-[var(--color-muted-foreground)]">Total</span>
            <span className="tabular-nums text-xl font-semibold">{formatCurrency(previewed.totalAmount)}</span>
          </div>
          <DataTable
            data={previewed.lineItems.map((l, i) => ({ ...l, _idx: i }))}
            keyField="_idx"
            columns={[
              { key: 'supportItemCode', header: 'Item', className: 'font-mono text-xs' },
              { key: 'dayTypeLabel', header: 'Day type' },
              { key: 'hours', header: 'Hours', align: 'right', className: 'tabular-nums' },
              { key: 'unitPrice', header: 'Rate', type: 'currency', align: 'right', className: 'tabular-nums' },
              {
                key: 'totalAmount',
                header: 'Total',
                type: 'currency',
                align: 'right',
                className: 'tabular-nums font-medium',
                render: (l: ShiftClaimPreviewLineItemDto & { _idx: number }) => formatCurrency(l.totalAmount),
              },
            ]}
          />
          <ClaimBudgetBlock budget={previewed.budget} />
        </div>
      )}
    </Modal>
  )
}
