import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFundingLedger } from '@/api/hooks'
import type { LedgerPeriod, LedgerPool, LedgerRow, ParticipantLedgerDto } from '@/api/types'
import { BUDGET_STATUS_LABELS } from '@/api/types/funding'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { DataTable } from '@/components/DataTable'
import { FactBar, FactChip } from '@/components/FactBar'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { chipToneOf, focusPeriodOf, money, poolSentence, quietEstimateLine, rowsByGroup, unpricedTripDaySentence } from '@/lib/budgetLedger'
import { formatDateRange, formatDayMonth } from '@/lib/dateRange'
import { plural } from '@/lib/format'

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
export default function FundingLedger({ participantId, enabled = true }: { participantId: string; enabled?: boolean }) {
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
      <LedgerBody data={data} />
    </div>
  )
}

/** The whole ledger for a loaded answer, so the sections can be rendered from a fixture with no query behind it. */
export function LedgerBody({ data }: { data: ParticipantLedgerDto }) {
  const noPlan = !data.planId || data.pools.length === 0
  if (noPlan) {
    return (
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
    )
  }

  return (
    <>
      {data.pools.map(pool => <PoolLedger key={pool.id} pool={pool} />)}
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
      </div>

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
      {selected && <PeriodLedger period={selected} />}

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
            value: <span className="text-base font-medium">{BUDGET_STATUS_LABELS[period.status]}</span>,
            badge: <FactChip tone={chipToneOf(period.status)}>{BUDGET_STATUS_LABELS[period.status]}</FactChip>,
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

/** The rows of one period in their three groups, each row linking to the claim, shift or trip it stands for. */
function PeriodLedger({ period }: { period: LedgerPeriod }) {
  const groups = rowsByGroup(period.rows)
  const hidden = Math.max(0, period.rowCount - period.rows.length)

  return (
    <section className="mt-4 flex flex-col gap-3" aria-label={`Ledger rows for ${formatDateRange(period.periodStart, period.periodEnd)}`}>
      <h4 className="text-sm font-medium text-[var(--color-muted-foreground)]">
        {formatDateRange(period.periodStart, period.periodEnd)} · {plural(period.rowCount, 'item')}
      </h4>
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

function Group({ heading, note, rows }: { heading: string; note: string; rows: LedgerRow[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <h5 className="text-sm font-medium">{heading}</h5>
        <p className="text-[13px] text-[var(--color-muted-foreground)]">{note} Nothing here this period.</p>
      </div>
    )
  }
  return (
    <div>
      <h5 className="text-sm font-medium">{heading}</h5>
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
      <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">{note}</p>
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
    </div>
  )
}
