import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePlanPeriodQuote } from '@/api/hooks'
import { Button } from '@/components/Button'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { PERIOD_KINDS, offeredKinds, periodAt, periodCount, type PeriodKind } from '@/lib/agreementPeriods'
import { formatDateRange } from '@/lib/dateRange'
import { formGrid, span } from '@/lib/formGrid'
import { formatHours } from '@/lib/planBlocks'
import { NO_FIGURE, asSentence, describeQuoteError, isPricingDate, pricedNothing, totalsCaption } from '@/lib/planQuote'
import { formatCurrency } from '@/lib/utils'
import type { useAgreementPricing } from './useAgreementPricing'

type Choice = PeriodKind | 'custom'
type Dates = { from: string; to: string }
type View = 'idle' | 'pricing' | 'updating' | 'busy' | 'ready' | 'nothing' | 'failed'

const LABEL = 'text-xs text-[var(--color-muted-foreground)]'
const MUTED = 'text-[13px] text-[var(--color-muted-foreground)]'
const HEADLINE = 'text-xl font-bold tabular-nums leading-tight'
// Every figure state renders in a box this tall (the headline line, or a coarse small button), so a state change never moves what is below.
const FIGURE_SLOT = 'flex min-h-[max(1.5625rem,var(--control-h-sm))] items-center gap-x-3'
const STEP_BUTTON = 'w-[var(--control-h)] px-0! aria-disabled:cursor-not-allowed aria-disabled:opacity-50'
const SUFFIX: Partial<Record<View, string>> = { pricing: ' · pricing…', updating: ' · updating…', busy: ' · the pricing service is busy, trying again…' }

type Props = { pricing: Pick<ReturnType<typeof useAgreementPricing>, 'from' | 'to' | 'settled' | 'settling' | 'quoteReady' | 'fromStore'> }

/**
 * Check step: what the agreement costs over one period of it, priced on the real calendar (public holidays, weekends, month lengths) and never as a multiple of the ordinary week. Periods
 * start at the agreement start; the first shows, and a stepper moves along them. Only the chosen period is quoted, and a figure is shown only while it is the answer for the blocks and the dates
 * on screen: in every other moment the slot says it is updating.
 */
export function CostByPeriod({ pricing }: Props) {
  const { from: start, to: end, fromStore } = pricing
  const kinds = offeredKinds(start, end)
  const [choice, setChoice] = useState<Choice>('month')
  const [stepIndex, setStepIndex] = useState(0)
  const [custom, setCustom] = useState<Dates | null>(null)
  const [armed, setArmed] = useState(false)
  const [spoken, setSpoken] = useState('')
  const [answered, setAnswered] = useState(false)
  const [lastNotes, setLastNotes] = useState('')

  const kind: Choice | null = choice === 'custom' ? 'custom' : kinds.includes(choice) ? choice : kinds.includes('month') ? 'month' : kinds[0] ?? null
  const count = kind && kind !== 'custom' ? periodCount(kind, start, end) : 0
  const index = Math.min(stepIndex, Math.max(count - 1, 0))

  // The dates chosen, clamped to the agreement; `errors` says what is wrong with a Custom box, and then nothing is priced.
  let range: (Dates & { part: boolean; clampedFrom: boolean; clampedTo: boolean }) | null = null
  const errors: { from?: string; to?: string } = {}
  const typed = custom ?? { from: start, to: end }
  if (kind === 'custom') {
    if (!isPricingDate(typed.from)) errors.from = 'Enter a date.'
    if (!isPricingDate(typed.to)) errors.to = 'Enter a date.'
    if (!errors.from && !errors.to) {
      const from = typed.from < start ? start : typed.from, to = typed.to > end ? end : typed.to
      if (typed.to < typed.from) errors.to = 'This is before the From date.'
      else if (from > to) errors.to = 'This is outside the agreement dates.'
      else range = { from, to, part: false, clampedFrom: from !== typed.from, clampedTo: to !== typed.to }
    }
  } else if (kind) {
    range = { ...periodAt(kind, start, end, index), clampedFrom: false, clampedTo: false }
  }

  // The quote waits for the choice to settle (arrowing through the kinds or stepping fast sends one request); the line and the notes under it do not.
  const wanted: Dates | null = range && { from: range.from, to: range.to }
  const asked = useDebouncedValue(wanted, 300)
  const query = usePlanPeriodQuote(pricing.settled, asked?.from ?? '', asked?.to ?? '', !fromStore && pricing.quoteReady && asked !== null)
  const current = !!wanted && asked?.from === wanted.from && asked.to === wanted.to && pricing.quoteReady && !pricing.settling && !fromStore
  const retrying = query.isError && query.isFetching
  const data = query.data
  const view: View = !wanted ? 'idle'
    : !current ? (answered ? 'updating' : 'pricing')
    : query.isError ? 'failed'
    : data && !query.isFetching ? (pricedNothing(data) ? 'nothing' : 'ready')
    : query.failureCount > 0 && query.isFetching ? 'busy'
    : answered ? 'updating' : 'pricing'
  const settled = view === 'idle' || view === 'ready' || view === 'nothing' || view === 'failed'

  const dates = range ? formatDateRange(range.from, range.to) : ''
  const where = kind === 'custom' ? 'Custom range' : kind ? `${PERIOD_KINDS[kind].label} ${index + 1} of ${count}` : ''
  const part = !!range && kind !== 'custom' && range.part
  const clamps = range ? [range.clampedFrom && `from ${formatDateRange(start, start)}, when the agreement starts`, range.clampedTo && `to ${formatDateRange(end, end)}, when the agreement ends`].filter(Boolean) : []
  const dateNote = part ? `Part period: it ends with the agreement on ${formatDateRange(end, end)}.` : clamps.length > 0 ? `Priced ${clamps.join(', and ')}.` : ''

  // What the quote adds under the figure. While a new answer is awaited the last notes keep their box, hidden, so the section does not shrink and grow back.
  const notes: string | null = view === 'ready' && data ? (totalsCaption(data).text ? `${asSentence(totalsCaption(data).text)}.` : '')
    : view === 'nothing' ? 'Nothing in this period is priced.'
    : view === 'failed' ? (retrying ? '' : describeQuoteError(query.error).detail ?? '')
    : view === 'idle' ? '' : null
  if (notes !== null && notes !== lastNotes) setLastNotes(notes)
  if ((view === 'ready' || view === 'nothing') && !answered) setAnswered(true)

  // The live region speaks once, when something the person did in this section settles; a re-price caused by a block change is the footer's to announce.
  if (armed && settled) {
    if (view === 'ready' || view === 'nothing') setSpoken(`${where}, ${dates}: ${view === 'ready' && data ? formatCurrency(data.totals.amount) : 'nothing is priced'}.${part ? ' Part period.' : ''}`)
    else if (view === 'failed' && !retrying) setSpoken(kind === 'custom' ? "Couldn't price this range." : `Couldn't price ${PERIOD_KINDS[kind as PeriodKind].unit} ${index + 1}.`)
    if (view !== 'failed' || !retrying) setArmed(false)
  }

  const pick = (key: string) => {
    if (key === kind) return
    if (key === 'custom') setCustom(existing => existing ?? (range ? { from: range.from, to: range.to } : { from: start, to: end }))
    else setStepIndex(0)
    setChoice(key as Choice)
    setArmed(true)
  }
  const step = (by: number) => {
    if (index + by < 0 || index + by >= count) return
    setStepIndex(index + by)
    setArmed(true)
  }
  const edit = (change: Partial<Dates>) => { setCustom({ ...typed, ...change }); setArmed(true) }

  const heading = <h3 id="check-by-period" className="text-sm font-semibold">Cost by period</h3>
  if (fromStore) return <section aria-labelledby="check-by-period" className="flex flex-col gap-2">{heading}<p className="text-sm text-[var(--color-muted-foreground)]">Not shown for a saved agreement.</p></section>
  if (!kind) return <section aria-labelledby="check-by-period" className="flex flex-col gap-2">{heading}<p className={MUTED}>The agreement is a fortnight or shorter, so its whole cost above is the only period.</p></section>

  const line = range && (
    <p className={`${LABEL} tabular-nums`}><span className="whitespace-nowrap">{where}</span>{' · '}<span className="whitespace-nowrap">{dates}</span>{SUFFIX[view]}</p>
  )
  const unit = kind === 'custom' ? '' : PERIOD_KINDS[kind].unit
  const shownNotes = notes ?? lastNotes

  return (
    <section aria-labelledby="check-by-period" aria-busy={!settled} className="flex flex-col gap-2">
      {heading}
      <ToggleGroup
        ariaLabel="Period" className="flex-wrap" value={kind} onChange={pick}
        options={[...kinds.map(key => ({ key, label: PERIOD_KINDS[key].label })), { key: 'custom', label: 'Custom' }]}
      />
      {kind === 'custom' ? (
        <>
          <div className={formGrid}>
            <FormField label="From" className={span.date} error={errors.from} keepHint>
              <input type="date" min={start} max={end} value={typed.from} onChange={event => edit({ from: event.target.value })} />
            </FormField>
            <FormField label="To" className={span.date} error={errors.to} keepHint>
              <input type="date" min={start} max={end} value={typed.to} onChange={event => edit({ to: event.target.value })} />
            </FormField>
          </div>
          {line}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex gap-1">
            <Button variant="secondary" size="md" aria-label={`Previous ${unit}`} aria-disabled={index === 0 || undefined} onClick={() => step(-1)} className={STEP_BUTTON}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="secondary" size="md" aria-label={`Next ${unit}`} aria-disabled={index >= count - 1 || undefined} onClick={() => step(1)} className={STEP_BUTTON}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          {line}
        </div>
      )}
      <div className={FIGURE_SLOT}>
        {view === 'ready' && data ? (
          <p className={HEADLINE}>{formatCurrency(data.totals.amount)} <span className="text-[13px] font-normal text-[var(--color-muted-foreground)]">{formatHours(data.totals.supportHours)} h of support</span></p>
        ) : (
          <p className={`${HEADLINE} text-[var(--color-muted-foreground)]`}>{NO_FIGURE}</p>
        )}
        {view === 'failed' && (
          <>
            <p className="text-sm text-[var(--color-muted-foreground)]">{retrying ? 'Trying again…' : "Couldn't price this period."}</p>
            <Button
              variant="secondary" size="sm" aria-disabled={retrying || undefined} aria-busy={retrying || undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => { if (retrying) return; setArmed(true); void query.refetch() }}
            >Try again</Button>
          </>
        )}
      </div>
      {dateNote && <p className={MUTED}>{dateNote}</p>}
      {shownNotes && <p className={`${MUTED}${notes === null ? ' invisible' : ''}`}>{shownNotes}</p>}
      <p role="status" aria-atomic="true" className="sr-only">{spoken}</p>
    </section>
  )
}
