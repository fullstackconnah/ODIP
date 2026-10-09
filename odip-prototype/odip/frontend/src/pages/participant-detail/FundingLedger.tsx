import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFundingLedger } from '@/api/hooks'
import type { LedgerBucket, LedgerPeriod, LedgerPool, LedgerRow, ParticipantLedgerDto } from '@/api/types'
import { BUDGET_STATUS_LABELS } from '@/api/types/funding'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { DataTable } from '@/components/DataTable'
import { FactBar } from '@/components/FactBar'
import { ALERT_TYPE_LABELS } from '@/components/alertSeverityStyles'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { chipToneOf, focusPeriodOf, money, poolSentence, quietEstimateLine, rowsByGroup, unpricedShiftSentence, unpricedTripDaySentence } from '@/lib/budgetLedger'
import { formatDateRange, formatDayMonth } from '@/lib/dateRange'
import { writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { plural } from '@/lib/format'
import { NdiaRejectionNote } from './NdiaRejectionNote'

// The budget ledger on the Funding tab (budget feature, phase 2a): for each pool of the current plan, the current period's figures, the one sentence that says what is left and
// where the booked shifts would take it, the strip of periods, the rows of the selected period in their three groups, and the plan's total. Every figure is the server's: this screen
// never adds anything up, and while its own request is waiting or has failed it says so, never a zero and never an "all clear" (DESIGN.md: loading and failure are not zero).

const GROUP_HEADINGS: Record<string, string> = {
  Claimed: 'Claimed',
  Pending: 'Pending',
  BookedAhead: 'Booked ahead',
}

const GROUP_NOTES: Record<string, string> = {
  Claimed: 'Claim lines sent to the NDIA, and paid ones at what was paid.',
  Pending: 'Claims not sent yet, completed shifts nobody has claimed, shifts whose day passed unresolved, and trips that have started with no claim yet.',
  BookedAhead: 'Rostered shifts and confirmed trip bookings still to come in this period.',
}

/** A status pill in the budget's own tone: on track is go, approaching and forecast over ask for attention, over has gone past the limit. */
function BudgetStatusBadge({ status, size }: { status: keyof typeof BUDGET_STATUS_LABELS; size?: 'sm' | 'md' }) {
  return <StatusBadge tone={chipToneOf(status)} label={BUDGET_STATUS_LABELS[status]} size={size} />
}

/**
 * The participant's budget ledger. With no plan that has started it says so in one sentence and shows no figure at all: an absent plan is not a zero balance, and nothing here ever
 * implies a confirmed NDIA balance (these are ODIP's own figures against the recorded plan).
 */
export default function FundingLedger({ participantId, enabled = true, nextPlanStart }: { participantId: string; enabled?: boolean; nextPlanStart?: string }) {
  const query = useFundingLedger(participantId, enabled)

  if (query.isLoading) return <PageState kind="loading" noun="budget ledger" />
  if (!query.data) return <PageState kind="error" noun="budget ledger" onRetry={() => { void query.refetch() }} />

  const data = query.data
  // A background refetch that fails over figures already on screen must not replace them (DESIGN.md): a quiet, retryable line under them is the honest place for that.
  const stale = query.isError

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {stale && (
        <Callout tone="warning">
          <p>These figures could not be refreshed, so what is on screen may be out of date.</p>
          <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => { void query.refetch() }}>Try again</Button></div>
        </Callout>
      )}
      <LedgerBody data={data} nextPlanStart={nextPlanStart} />
    </div>
  )
}

/**
 * The whole ledger for a loaded answer, so the sections can be rendered from a fixture with no query behind it.
 *
 * `nextPlanStart` is the start of the plan the tab leads with when that plan has not started: the ledger is always of the plan that holds today or, with none, the latest that has
 * STARTED, so between a plan that has ended and the next one the ledger would be the ended plan's under the upcoming plan's card. There it says no plan is running instead of showing the ended plan's
 * figures; everywhere else it names the plan the figures are for.
 */
export function LedgerBody({ data, nextPlanStart }: { data: ParticipantLedgerDto; nextPlanStart?: string }) {
  if (data.planId && !data.planIsCurrent && nextPlanStart) {
    return (
      <Card>
        <div className="flex max-w-prose flex-col items-start gap-2">
          <h3 className="text-sm font-semibold">No budget figures today</h3>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No plan is running between {writtenDay(data.planEnd)} and {writtenDay(nextPlanStart)}. There is nothing to spend against yet, and the plan that ended on {writtenDay(data.planEnd)} is under Past plans.
          </p>
        </div>
      </Card>
    )
  }

  const noPlan = !data.planId || data.pools.length === 0
  // Money that fits no recorded pool, or is dated outside the plan, is shown and never dropped (the brief's rule): the server sends both buckets, and each shows only when it holds something.
  const buckets = (
    <>
      <BucketSection
        heading="Not in a recorded pool"
        explanation="The plan records no pool for these supports, so they are not part of any pool's figures above."
        bucket={data.notInARecordedPool}
      />
      <BucketSection
        heading="Outside the plan dates"
        explanation="These are dated after the plan ends, or fall in none of a pool's periods, so they are not part of any pool's figures above."
        bucket={data.outsideThePlanDates}
      />
    </>
  )

  if (noPlan) {
    return (
      <>
        <Card>
          <div className="flex max-w-prose flex-col items-start gap-2">
            <h3 className="text-sm font-semibold">No budget figures yet</h3>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {data.planIsCurrent
                ? 'This plan has no pools recorded, so there is nothing to spend against yet.'
                : 'No plan has started, so there is nothing to spend against yet. The figures come from the plan the participant shares, or their plan manager.'}
            </p>
          </div>
        </Card>
        {buckets}
      </>
    )
  }

  return (
    <>
      {/* The ledger is of one plan: say which, by its dates, so that it can never be read as the plan the card above it shows. */}
      {data.planStart && data.planEnd && (
        <p className="text-[13px] text-[var(--color-muted-foreground)]">
          Figures for the plan {writtenSpan(data.planStart, data.planEnd)}{data.planIsCurrent ? '' : ', which has ended'}.
        </p>
      )}
      {data.pools.map(pool => <PoolLedger key={pool.id} pool={pool} />)}
      {buckets}
      <p className="text-[13px] text-[var(--color-muted-foreground)]">
        {quietEstimateLine} Figures are as of {formatDayMonth(data.asOf)} ({data.timeBasis}). These are ODIP's own figures against the recorded plan, not an NDIA balance.
      </p>
    </>
  )
}

/** One pool: the current period's glance strip, the sentence, the period strip, the selected period's rows, and the plan total. */
function PoolLedger({ pool }: { pool: LedgerPool }) {
  const focus = focusPeriodOf(pool)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const selected = pool.periods.find(period => period.id === selectedPeriodId) ?? focus

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{pool.name}</h3>
        {focus && <BudgetStatusBadge status={focus.status} />}
        {/* ODIP's arithmetic can say On track while the NDIA has just refused a claim for want of funds: its word is beside ODIP's, and its note is the first thing under the title, above the figures. */}
        {pool.ndiaRejection && <StatusBadge tone="danger" label={ALERT_TYPE_LABELS['budget-ndia-exhausted']} />}
      </div>
      {pool.ndiaRejection && <NdiaRejectionNote rejection={pool.ndiaRejection} />}

      {focus ? (
        <>
          <GlanceStrip period={focus} />
          <p className="mt-3 text-sm text-[var(--color-foreground)]">{poolSentence(pool, focus)}</p>
          {focus.pastUnresolvedCount > 0 && (
            <p className="mt-2 text-[13px] text-[var(--color-on-warning-container)]">
              {plural(focus.pastUnresolvedCount, 'past shift')} not completed or cancelled, counted as pending.
            </p>
          )}
          {/* A trip's claim cannot be made until the trip is completed, so a trip that has started counts as pending from its first day: its row says so too. */}
          {focus.startedUnclaimedTripCount > 0 && (
            <p className="mt-2 text-[13px] text-[var(--color-on-warning-container)]">
              {plural(focus.startedUnclaimedTripCount, 'started trip')} not claimed yet, counted as pending.
            </p>
          )}
          {/* A shift the claim cannot price (a sleepover, a passive night, a group shift) is $0 in every figure above, so the figures are low by what it will cost: say how many, and why. */}
          {focus.unpricedShiftCount > 0 && (
            <p className="mt-2 text-[13px] text-[var(--color-on-warning-container)]">
              {unpricedShiftSentence(focus.unpricedShiftCount, focus.unpricedShiftReasons)}
            </p>
          )}
          {/* The gap is stated three times over, in three places a reader actually looks: the sentence above (poolSentence), this
              warning line beside the figures, and the note on each affected booking row. The money figures stay exactly what
              the catalogue can price - no rate is invented for a day the catalogue does not cover. */}
          {focus.unpricedTripDayCount > 0 && (
            <p className="mt-2 text-[13px] text-[var(--color-on-warning-container)]">
              {unpricedTripDaySentence(focus.unpricedTripDayCount)}
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">This pool has no funding periods recorded, so there are no figures for it.</p>
      )}

      {pool.periods.length > 0 && <PeriodStrip pool={pool} selectedId={selected?.id} onSelect={setSelectedPeriodId} />}
      {/* The warnings beside the glance strip are about the period the strip is about; an opened period that is another one says its own where its rows are. */}
      {selected && <PeriodLedger period={selected} warnedAbove={selected.id === focus?.id} />}

      <PlanTotal pool={pool} />
    </Card>
  )
}

/** The current period's figures in the glance strip: available, used, the forecast to the period's end, and the status chip in its own tone. */
function GlanceStrip({ period }: { period: LedgerPeriod }) {
  return (
    <div className="mt-3">
      <FactBar
        variant="glance"
        segments={[
          { label: 'Available', value: <span className="tabular-nums">{money(period.available)}</span> },
          { label: 'Used', value: <span className="tabular-nums">{money(period.used)}</span> },
          {
            label: `Forecast to ${formatDayMonth(period.periodEnd)}`,
            value: <span className="tabular-nums">{money(period.forecast)}</span>,
            attention: period.forecast > period.available ? 'warning' : undefined,
          },
          {
            label: 'Status',
            // The word once: the chip that stood beside it said the same thing again, and the pool's title already wears the status in its tone.
            value: <span className="text-base font-medium">{BUDGET_STATUS_LABELS[period.status]}</span>,
          },
        ]}
      />
    </div>
  )
}

/** One cell per period: its limit and what is available, used and booked, the current one marked, and a carry named as rolled over, not confirmed. */
function PeriodStrip({ pool, selectedId, onSelect }: { pool: LedgerPool; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <div className="mt-4" role="group" aria-label={`Funding periods of ${pool.name}`}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {pool.periods.map(period => {
          const selected = period.id === selectedId
          return (
            <button
              key={period.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(period.id)}
              className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left ${selected ? 'border-[var(--color-primary)] bg-[var(--color-surface)]' : 'border-[var(--color-border)]'}`}
            >
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {formatDateRange(period.periodStart, period.periodEnd)}
                {period.isCurrent && <span className="ml-1 font-medium text-[var(--color-primary)]">· current</span>}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {money(period.used)} used · {money(period.bookedAhead)} booked ahead
              </span>
              {/* F-20: the cell itself says which amount governs, and F-21: the roll-forward is
                  labelled not confirmed here, in the cell it contributes to, as visible text. */}
              <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                {pool.hasSetAside
                  ? `${money(period.limit)} set aside${period.carried > 0 ? `, plus ${money(period.carried)} rolled over, not confirmed` : ''}`
                  : `${money(period.limit)} from the plan${period.carried > 0 ? `, plus ${money(period.carried)} rolled over, not confirmed` : ''}`}
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                {money(period.available)} available
              </span>
              <span className="sr-only">{BUDGET_STATUS_LABELS[period.status]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The rows of one period in their three groups, each row linking to the claim, shift or trip it stands for. `warnedAbove` is true for the period the glance strip is about, whose shifts
 * that cannot be priced are already counted beside the strip; any other period says its own here, because its figures leave those shifts out just the same.
 */
function PeriodLedger({ period, warnedAbove }: { period: LedgerPeriod; warnedAbove: boolean }) {
  const groups = rowsByGroup(period.rows)
  const hidden = Math.max(0, period.rowCount - period.rows.length)

  return (
    <section className="mt-4 flex flex-col gap-3" aria-label={`Ledger rows for ${formatDateRange(period.periodStart, period.periodEnd)}`}>
      <h4 className="text-sm font-medium text-[var(--color-muted-foreground)]">
        {formatDateRange(period.periodStart, period.periodEnd)} · {plural(period.rowCount, 'item')}
      </h4>
      {!warnedAbove && period.unpricedShiftCount > 0 && (
        <p className="text-[13px] text-[var(--color-on-warning-container)]">{unpricedShiftSentence(period.unpricedShiftCount, period.unpricedShiftReasons)}</p>
      )}
      {groups.map(({ group, rows }) => (
        <Group key={group} heading={GROUP_HEADINGS[group]} note={GROUP_NOTES[group]} rows={rows} />
      ))}
      {hidden > 0 && (
        <p className="text-[13px] text-[var(--color-muted-foreground)]">
          {plural(hidden, 'more item')} are not shown here. Open the claim, shift or trip to see them.
        </p>
      )}
    </section>
  )
}

/**
 * Rows that are in no pool, or dated outside the plan: the server's own total and count, the rows grouped the way a period's are (so a claim is told from an estimate), and the plain
 * statement that none of it is part of any pool's figures. Nothing is shown for a bucket with nothing in it. The amount is the server's sum of the whole bucket (claimed, pending and
 * booked ahead together): this screen adds nothing up, and it says how many items the first page leaves out.
 */
function BucketSection({ heading, explanation, bucket }: { heading: string; explanation: string; bucket: LedgerBucket }) {
  if (bucket.count <= 0) return null
  const groups = rowsByGroup(bucket.rows).filter(({ rows }) => rows.length > 0)
  const hidden = Math.max(0, bucket.count - bucket.rows.length)

  return (
    <Card>
      <section aria-label={heading} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{heading}</h3>
          <span className="text-sm font-medium tabular-nums">{money(bucket.amount)}</span>
        </div>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">{plural(bucket.count, 'item')} in all. {explanation}</p>
        {groups.map(({ group, rows }) => <Group key={group} heading={GROUP_HEADINGS[group]} rows={rows} as="h4" />)}
        {hidden > 0 && (
          <p className="text-[13px] text-[var(--color-muted-foreground)]">
            {plural(hidden, 'more item')} {hidden === 1 ? 'is' : 'are'} not shown here. Open the claim, shift or trip to see {hidden === 1 ? 'it' : 'them'}.
          </p>
        )}
      </section>
    </Card>
  )
}

/** One group of a ledger's rows under its heading (a period's groups are fifth-level headings; a bucket's, directly under its own, are fourth-level). The note is a period's explanation of the group. */
function Group({ heading, note, rows, as: Heading = 'h5' }: { heading: string; note?: string; rows: LedgerRow[]; as?: 'h4' | 'h5' }) {
  if (rows.length === 0) {
    return (
      <div>
        <Heading className="text-sm font-medium">{heading}</Heading>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">{note} Nothing here this period.</p>
      </div>
    )
  }
  return (
    <div>
      <Heading className="text-sm font-medium">{heading}</Heading>
      <DataTable
        data={rows.map((row, i) => ({ ...row, _key: `${row.id}-${i}` }))}
        keyField="_key"
        emptyMessage="Nothing here this period."
        columns={[
          { key: 'date', header: 'Date', type: 'date' },
          {
            key: 'description',
            header: 'What',
            render: (row: LedgerRow & { _key: string }) => (
              <span>
                {row.link ? <Link to={row.link} className="hover:text-[var(--color-primary)]">{row.description}</Link> : row.description}
                {row.note && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">{row.note}</span>}
              </span>
            ),
          },
          { key: 'status', header: 'Status', type: 'badge', minWidth: '7rem' },
          { key: 'amount', header: 'Amount', type: 'currency', align: 'right', className: 'tabular-nums font-medium max-md:text-left' },
        ]}
      />
      {note && <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">{note}</p>}
    </div>
  )
}

/** The plan total for the pool: the same sums over the whole plan, against the sum of the limits. Nothing carries between plans, so a total never rolls anything forward. */
function PlanTotal({ pool }: { pool: LedgerPool }) {
  const total = pool.planTotal
  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <p className="text-sm font-medium">Plan total</p>
      <p className="text-[13px] text-[var(--color-muted-foreground)]">
        {money(total.limit)} across the whole plan · {money(total.used)} used · {money(total.bookedAhead)} booked ahead · {money(total.remaining)} left
      </p>
      <div className="mt-1"><BudgetStatusBadge status={total.status} /></div>
      {/* The plan total is the one whole-plan figure: shifts that have no price are $0 in it whichever period they fall in, so it says how many (the periods name the reasons). */}
      {pool.unpricedShiftCount > 0 && (
        <p className="mt-2 text-[13px] text-[var(--color-on-warning-container)]">{unpricedShiftSentence(pool.unpricedShiftCount, [])}</p>
      )}
    </div>
  )
}
