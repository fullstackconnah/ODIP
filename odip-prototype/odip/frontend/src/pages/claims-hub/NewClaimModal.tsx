import { useEffect, useRef, useState } from 'react'
import { ChevronRight, MapPin } from 'lucide-react'
import { useUnclaimedShifts } from '@/api/hooks/claimHub'
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

const TRIP_FIELD_ID = 'new-claim-trip'

type ChoiceId = 'shifts' | 'trip'

/** One row of the chooser. A later claim kind (a cancellation, a one-off) is one more entry here and one more handler. */
const CHOICES: { id: ChoiceId; title: string; hint: string }[] = [
  { id: 'shifts', title: 'Shifts', hint: 'Completed shifts in a date range' },
  { id: 'trip', title: 'A trip', hint: 'A completed trip with no claim' },
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
export function NewClaimModal({ onClose, onShifts, onTrip }: {
  onClose: () => void
  onShifts: () => void
  onTrip: (trip: TripDetailDto) => void
}) {
  const [step, setStep] = useState<'choose' | 'trip'>('choose')
  const shiftsRow = useRef<HTMLButtonElement>(null)
  const tripRow = useRef<HTMLButtonElement>(null)
  const [chosen, setChosen] = useState('')
  const [opening, setOpening] = useState<string | undefined>()

  const waiting = useUnclaimedShifts(true)
  // shortcut: the list shows the first 200 completed, unclaimed trips (useTrips' ceiling); add server search if a tenant reaches it.
  const trips = useTrips({ status: 'Completed', unclaimed: 'true' })
  const opened = useTrip(opening)

  useEffect(() => {
    if (opening && opened.data) onTrip(opened.data)
  }, [opening, opened.data, onTrip])

  // Focus follows a step change (the first render is the Modal's own initial focus).
  const shown = useRef(step)
  useEffect(() => {
    if (shown.current === step) return
    shown.current = step
    if (step === 'trip') document.getElementById(TRIP_FIELD_ID)?.focus()
    else tripRow.current?.focus()
  }, [step])

  const tripCount = trips.data?.length
  const noTrips = !trips.isLoading && !trips.isError && tripCount === 0
  const count = (c: ChoiceId) => {
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
      <Modal open onClose={onClose} title="New claim" initialFocusRef={shiftsRow} footer={<Button variant="secondary" size="md" onClick={onClose}>Close</Button>}>
        <p className="mb-3 text-[13px] text-[var(--color-muted-foreground)]">What are you claiming for?</p>
        <ul className="flex flex-col gap-2">
          {CHOICES.map(c => c.id === 'shifts' ? (
            <ChoiceRow key={c.id} title={c.title} hint={c.hint} count={count('shifts')} onClick={onShifts} rowRef={shiftsRow} />
          ) : (
            <ChoiceRow key={c.id} title={c.title} hint={noTrips ? 'No completed trips are waiting' : c.hint} count={count('trip')} disabled={noTrips} onClick={() => setStep('trip')} rowRef={tripRow} />
          ))}
        </ul>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
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
