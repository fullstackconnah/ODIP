import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronRight, MapPin } from 'lucide-react'
import { useCancellationCandidates, useUnclaimedShifts } from '@/api/hooks/claimHub'
import { useTrip, useTrips } from '@/api/hooks/trips'
import type { TripDetailDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { FormField } from '@/components/FormField'
import { Modal } from '@/components/Modal'
import { PageState } from '@/components/PageState'
import { formatDateRange } from '@/lib/dateRange'
import { plural } from '@/lib/format'
import { CancellationClaimSteps } from './CancellationClaimSteps'
import { ManualClaimSteps } from './ManualClaimSteps'

const TRIP_FIELD_ID = 'new-claim-trip'

type ChoiceId = 'shifts' | 'trip' | 'cancellation' | 'manual'

/** One row of the chooser. A later claim kind is one more entry here and one more handler. */
const CHOICES: { id: ChoiceId; title: string; hint: string }[] = [
  { id: 'shifts', title: 'Shifts', hint: 'Completed shifts in a date range' },
  { id: 'trip', title: 'A trip', hint: 'A completed trip with no claim' },
  { id: 'cancellation', title: 'A cancellation', hint: 'A cancelled shift at short notice' },
  { id: 'manual', title: 'A one-off claim', hint: 'Any catalogue item and amount' },
]

/** `count` undefined draws nothing; null draws the loading pulse. A disabled row keeps its focus but does nothing. */
function ChoiceRow({ title, hint, count, disabled, onClick, rowRef }: {
  title: string
  hint: string
  count?: string | null
  disabled?: boolean
  onClick: () => void
  rowRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        className={`flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
          disabled
            ? 'cursor-not-allowed bg-[var(--color-card)] text-[var(--color-muted-foreground)]'
            : 'bg-[var(--color-card)] hover:bg-[var(--color-muted)] motion-safe:transition-transform motion-safe:active:scale-[0.99]'
        }`}
      >
        {/* Title, hint, then count in the page order a screen reader reads; the grid puts the count at the right end of the title line. */}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2">
          <span className={`text-sm font-semibold ${disabled ? '' : 'text-[var(--color-foreground)]'}`}>{title}</span>{' '}
          <span className="col-span-2 row-start-2 truncate text-[13px] text-[var(--color-muted-foreground)]">{hint}</span>{' '}
          {count === null && <span aria-hidden="true" className="col-start-2 row-start-1 h-3.5 w-12 rounded bg-[var(--color-muted)] motion-safe:animate-pulse" />}
          {count && <span className="col-start-2 row-start-1 whitespace-nowrap text-[13px] tabular-nums text-[var(--color-muted-foreground)]">{count}</span>}
        </span>
        {!disabled && <ChevronRight className="size-4 shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />}
      </button>
    </li>
  )
}

/**
 * The launcher for "New claim": pick what is being claimed. Shifts and a trip each open their own existing modal (the caller does that once this has closed, so
 * the opener of the next modal is the page's button, not a row that is gone); a trip is picked on a second step here.
 */
export function NewClaimModal({ onClose, onShifts, onTrip, onCancellationMade, onManualMade }: {
  onClose: () => void
  onShifts: () => void
  onTrip: (trip: TripDetailDto) => void
  /** A cancellation claim was made on its second step: the page closes the chooser and opens the claim. */
  onCancellationMade: (claimId: string) => void
  /** A one-off claim was made on its second step: the same. */
  onManualMade: (claimId: string) => void
}) {
  const [step, setStep] = useState<'choose' | 'trip' | 'cancellation' | 'manual'>('choose')
  const shiftsRow = useRef<HTMLButtonElement>(null)
  const tripRow = useRef<HTMLButtonElement>(null)
  const cancellationRow = useRef<HTMLButtonElement>(null)
  const manualRow = useRef<HTMLButtonElement>(null)
  const lastRow = useRef<RefObject<HTMLButtonElement | null> | null>(null)   // the row that opened the step being left, so Back lands on it
  const [chosen, setChosen] = useState('')
  const [opening, setOpening] = useState<string | undefined>()

  const waiting = useUnclaimedShifts(true)
  // shortcut: the list shows the first 200 completed, unclaimed trips (useTrips' ceiling); add server search if a tenant reaches it.
  const trips = useTrips({ status: 'Completed', unclaimed: 'true' })
  const opened = useTrip(opening)
  const cancellations = useCancellationCandidates(true)
  // The cancellation steps are a Modal of their own, and the chooser comes back as a new one after Back: each would take the row or Back button that opened it as its opener, which is gone by
  // the time it closes. The button that opened the chooser is what gets focus back.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  const close = () => { onClose(); opener?.focus() }

  useEffect(() => {
    if (opening && opened.data) onTrip(opened.data)
  }, [opening, opened.data, onTrip])

  // Focus follows a step change (the first render is the Modal's own initial focus).
  const shown = useRef(step)
  useEffect(() => {
    if (shown.current === step) return
    shown.current = step
    if (step === 'trip') document.getElementById(TRIP_FIELD_ID)?.focus()
    else if (step === 'choose') lastRow.current?.current?.focus()
  }, [step])

  const tripCount = trips.data?.length
  const noTrips = !trips.isLoading && !trips.isError && tripCount === 0
  const cancellationCount = cancellations.data?.shifts.length
  const noCancellations = !cancellations.isLoading && !cancellations.isError && cancellationCount === 0
  const count = (c: ChoiceId) => {
    if (c === 'cancellation') return cancellations.isLoading ? null : cancellations.isError || !cancellationCount ? undefined : `${cancellationCount} waiting`
    if (c === 'manual') return undefined   // any participant can have one, so there is nothing to count
    if (c === 'shifts') return waiting.loading ? null : waiting.error ? undefined : waiting.count === 0 ? 'None waiting' : `${waiting.count} waiting`
    return trips.isLoading ? null : trips.isError || tripCount === undefined || tripCount === 0 ? undefined : `${tripCount} waiting`
  }

  const chosenTrip = trips.data?.find(t => t.id === chosen)
  const busy = !!opening && !opened.isError && !opened.data
  const failed = !!opening && opened.isError
  const goOn = () => {
    if (!chosen) return
    if (failed) void opened.refetch()
    else setOpening(chosen)
  }

  if (step === 'choose') {
    return (
      <Modal open onClose={close} title="New claim" initialFocusRef={shiftsRow} footer={<Button variant="secondary" size="md" onClick={close}>Close</Button>}>
        <p className="mb-3 text-[13px] text-[var(--color-muted-foreground)]">What are you claiming for?</p>
        <ul className="flex flex-col gap-2">
          {CHOICES.map(c => c.id === 'shifts' ? (
            <ChoiceRow key={c.id} title={c.title} hint={c.hint} count={count('shifts')} onClick={onShifts} rowRef={shiftsRow} />
          ) : c.id === 'trip' ? (
            <ChoiceRow key={c.id} title={c.title} hint={noTrips ? 'No completed trips are waiting' : c.hint} count={count('trip')} disabled={noTrips} onClick={() => { lastRow.current = tripRow; setStep('trip') }} rowRef={tripRow} />
          ) : c.id === 'manual' ? (
            <ChoiceRow key={c.id} title={c.title} hint={c.hint} onClick={() => { lastRow.current = manualRow; setStep('manual') }} rowRef={manualRow} />
          ) : (
            <ChoiceRow key={c.id} title={c.title} hint={noCancellations ? 'No short-notice cancellations to claim' : c.hint} count={count('cancellation')} disabled={noCancellations} onClick={() => { lastRow.current = cancellationRow; setStep('cancellation') }} rowRef={cancellationRow} />
          ))}
        </ul>
      </Modal>
    )
  }

  if (step === 'cancellation') {
    return <CancellationClaimSteps candidates={cancellations} onBack={() => setStep('choose')} onClose={close} onMade={onCancellationMade} />
  }

  if (step === 'manual') {
    return <ManualClaimSteps onBack={() => setStep('choose')} onClose={close} onMade={onManualMade} />
  }

  return (
    <Modal
      open
      onClose={close}
      title="Choose a trip"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => setStep('choose')}>Back</Button>
          {!noTrips && <Button size="md" onClick={goOn} disabled={!chosen || busy} aria-busy={busy || undefined}>{busy ? 'Opening…' : 'Continue'}</Button>}
        </>
      }
    >
      {failed && <Callout tone="danger" className="mb-3">{`Couldn't open ${chosenTrip?.tripName ?? 'that trip'}. Try again.`}</Callout>}
      {trips.isError ? (
        <PageState kind="error" noun="trip list" onRetry={() => trips.refetch()} />
      ) : noTrips ? (
        <EmptyState size="inline" icon={MapPin} title="No completed trips are waiting" description="A trip shows here once it is Completed and has no claim." />
      ) : (
        <FormField label="Trip">
          <Dropdown
            id={TRIP_FIELD_ID}
            variant="form"
            searchable
            truncateLabel
            loading={trips.isLoading}
            label="Choose a trip"
            value={chosen}
            onChange={v => { setChosen(v); setOpening(undefined) }}
            items={(trips.data ?? []).map(t => ({
              value: t.id,
              label: t.tripName,
              description: `${formatDateRange(t.startDate, t.endDate)} · ${plural(t.currentParticipantCount, 'participant')}`,
            }))}
          />
        </FormField>
      )}
    </Modal>
  )
}
