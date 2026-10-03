import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FundingPlanDto, FundingPoolDto, FundingPeriodDto } from '@/api/types'
import { BUDGET_EVIDENCE_LABELS } from '@/api/types'
import { DataTable } from '@/components/DataTable'
import { FactList } from '@/components/FactList'
import { categoriesLabel, confirmedLabel, managementLabel, periodLengthLabel, writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'

/** The money cell of a table: the figure, or an en dash when there is none (never $0, which would say "nothing set aside"). */
const amountOrDash = (amount: number | undefined): string => (amount === undefined ? '–' : formatCurrency(amount))

/**
 * One recorded plan, read-only: its facts (dates, funding periods, reassessment, source, who confirmed it), then its pools as a table whose pools open out to their periods. The Funding
 * tab uses it for the current plan and, inside "Past plans", for each earlier one. It draws no buttons of its own: the caller puts Edit and "Record a new plan" in its header.
 */
export function PlanRecord({ plan, poolsLabel = 'Pools' }: { plan: FundingPlanDto; poolsLabel?: string }) {
  const baseId = useId()
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (poolId: string) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(poolId)) next.add(poolId)
    return next
  })
  const expanded = plan.pools.filter(pool => open.has(pool.id))

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
        <DataTable<FundingPoolDto>
          data={plan.pools}
          keyField="id"
          emptyMessage="No pools recorded"
          columns={[
            { key: 'name', header: 'Pool', render: pool => <span className="font-medium">{pool.name}</span> },
            { key: 'paceCategory', header: 'Categories', render: pool => <span className="tabular-nums">{categoriesLabel(pool)}</span> },
            { key: 'managementType', header: 'Management', render: pool => managementLabel(pool.managementType) },
            { key: 'planTotal', header: 'Plan amount', align: 'right', render: pool => <span className="font-medium tabular-nums">{formatCurrency(pool.planTotal)}</span> },
            { key: 'setAsideTotal', header: "Oassist's set-aside", align: 'right', render: pool => <span className="tabular-nums">{amountOrDash(pool.setAsideTotal)}</span> },
            {
              key: 'periods', header: 'Periods',
              render: pool => {
                const Chevron = open.has(pool.id) ? ChevronDown : ChevronRight
                return (
                  <button
                    type="button"
                    onClick={() => toggle(pool.id)}
                    aria-expanded={open.has(pool.id)}
                    aria-controls={`${baseId}-periods-${pool.id}`}
                    aria-label={`${plural(pool.periods.length, 'period')} of ${pool.name}`}
                    className="inline-flex min-h-[var(--tap-min)] items-center gap-1 rounded-[var(--radius-sm)] text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                  >
                    <Chevron className="h-4 w-4" aria-hidden="true" />
                    {plural(pool.periods.length, 'period')}
                  </button>
                )
              },
            },
          ]}
        />
      </section>

      {expanded.map(pool => <PeriodsTable key={pool.id} id={`${baseId}-periods-${pool.id}`} pool={pool} />)}
    </div>
  )
}

function PeriodsTable({ id, pool }: { id: string; pool: FundingPoolDto }): ReactNode {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <h4 id={`${id}-heading`} className="text-[13px] font-semibold text-[var(--color-muted-foreground)]">Periods of {pool.name}</h4>
      <DataTable<FundingPeriodDto>
        data={pool.periods}
        keyField="id"
        compact
        columns={[
          { key: 'periodStart', header: 'Period', pin: false, render: period => <span className="tabular-nums">{writtenSpan(period.periodStart, period.periodEnd)}</span> },
          { key: 'planAmount', header: 'Plan amount', align: 'right', render: period => <span className="tabular-nums">{formatCurrency(period.planAmount)}</span> },
          { key: 'setAside', header: "Oassist's set-aside", align: 'right', render: period => <span className="tabular-nums">{amountOrDash(period.setAside)}</span> },
        ]}
      />
    </section>
  )
}
