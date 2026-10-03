import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FundingPlanDto, FundingPoolDto, FundingPeriodDto } from '@/api/types'
import { BUDGET_EVIDENCE_LABELS } from '@/api/types'
import { DataTable } from '@/components/DataTable'
import { FactList } from '@/components/FactList'
import { categoriesLabel, confirmedLabel, managementLabel, periodLengthLabel, writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'

/** The money cell of a card or table: the figure, or an en dash when there is none (never $0, which would say "nothing set aside"). */
const amountOrDash = (amount: number | undefined): string => (amount === undefined ? '–' : formatCurrency(amount))

/**
 * One recorded plan, read-only: its facts (dates, funding periods, reassessment, source, who confirmed it), then its pools, each a card that opens out to ITS periods directly beneath it.
 * (A single table of pools put every opened pool's periods below all of them, so on a phone a tap seemed to do nothing: the result was a screen away.) The Funding tab uses it for the
 * current plan and, inside "Past plans", for each earlier one. It draws no buttons of its own: the caller puts Edit and "Record a new plan" in its header.
 */
export function PlanRecord({ plan, poolsLabel = 'Pools' }: { plan: FundingPlanDto; poolsLabel?: string }) {
  const baseId = useId()
  const anyDash = plan.pools.some(pool => pool.setAsideTotal === undefined)

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <FactList
        items={[
          { label: 'Plan dates', value: writtenSpan(plan.planStart, plan.planEnd) },
          { label: 'Funding periods', value: periodLengthLabel(plan.periodLengthMonths) },
          { label: 'Reassessment', value: plan.reassessmentDate ? writtenDay(plan.reassessmentDate) : null },
          { label: 'Source', value: BUDGET_EVIDENCE_LABELS[plan.evidence] ?? plan.evidence },
          { label: 'Figures', value: confirmedLabel(plan, writtenDay) },
          { label: 'Notes', value: plan.notes ? <span className="whitespace-pre-line">{plan.notes}</span> : null },
        ]}
      />

      <section aria-labelledby={`${baseId}-pools`} className="flex flex-col gap-2">
        <h4 id={`${baseId}-pools`} className="text-[13px] font-semibold text-[var(--color-muted-foreground)]">{poolsLabel}</h4>
        {plan.pools.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No pools recorded</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.pools.map(pool => <li key={pool.id}><PoolRecord pool={pool} /></li>)}
          </ul>
        )}
        {anyDash && <p className="text-[13px] text-[var(--color-muted-foreground)]">A dash means no set-aside is recorded.</p>}
      </section>
    </div>
  )
}

/** One pool: who it is for, its two figures, and a control that opens its periods in place. */
function PoolRecord({ pool }: { pool: FundingPoolDto }) {
  const baseId = useId()
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  const periodsId = `${baseId}-periods`

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 p-3">
        <div className="min-w-0">
          <h5 className="text-sm font-medium">{pool.name}</h5>
          <p className="text-[13px] text-[var(--color-muted-foreground)]"><span className="tabular-nums">{categoriesLabel(pool)}</span> · {managementLabel(pool.managementType)}</p>
        </div>
        <dl className="flex gap-8 text-left md:text-right">
          <div>
            <dt className="text-[13px] text-[var(--color-muted-foreground)]">Plan amount</dt>
            <dd className="text-sm font-medium tabular-nums">{formatCurrency(pool.planTotal)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-[var(--color-muted-foreground)]">Set-aside</dt>
            <dd className="text-sm tabular-nums">{amountOrDash(pool.setAsideTotal)}</dd>
          </div>
        </dl>
      </div>
      <div className="border-t border-[var(--color-border)] px-3">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          aria-controls={periodsId}
          aria-label={`${plural(pool.periods.length, 'period')} of ${pool.name}`}
          className="inline-flex min-h-[var(--tap-min)] items-center gap-1 rounded-[var(--radius-sm)] text-sm text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <Chevron className="h-4 w-4" aria-hidden="true" />
          {plural(pool.periods.length, 'period')}
        </button>
      </div>
      {/* Always in the page, so the control never points at nothing; its content is there only while it is open. */}
      <div id={periodsId} hidden={!open} className="px-3 pb-3">
        {open && <PeriodsTable pool={pool} />}
      </div>
    </div>
  )
}

function PeriodsTable({ pool }: { pool: FundingPoolDto }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h6 id={headingId} className="text-[13px] font-semibold text-[var(--color-muted-foreground)]">Periods of {pool.name}</h6>
      <DataTable<FundingPeriodDto>
        data={pool.periods}
        keyField="id"
        compact
        columns={[
          { key: 'periodStart', header: 'Period', pin: false, render: period => <span className="tabular-nums">{writtenSpan(period.periodStart, period.periodEnd)}</span> },
          // Right-aligned beside a wide table; on a phone a row is a card with each figure under its label, where a right-aligned amount floats away from it.
          { key: 'planAmount', header: 'Plan amount', align: 'right', className: 'max-md:text-left', render: period => <span className="tabular-nums">{formatCurrency(period.planAmount)}</span> },
          { key: 'setAside', header: 'Set-aside', align: 'right', className: 'max-md:text-left', render: period => <span className="tabular-nums">{amountOrDash(period.setAside)}</span> },
        ]}
      />
    </section>
  )
}
