import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useApplyPlanDatesToProfile, useFundingPlans } from '@/api/hooks'
import type { FundingPlanDto } from '@/api/types'
import type { PlanType } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { localIsoDate } from '@/lib/dateOnly'
import { currentPlanOf, planStatus, writtenSpan, type PlanStatus } from '@/lib/fundingPlan'
import { PlanRecord } from '@/pages/funding/PlanRecord'
import { FundingPlanEditor } from '@/pages/funding/FundingPlanEditor'

type Editing = { plan?: FundingPlanDto; previousPlan?: FundingPlanDto }

const STATUS_TONE: Record<PlanStatus, 'success' | 'info' | 'neutral'> = { Current: 'success', Upcoming: 'info', Ended: 'neutral' }

/** What the profile's plan dates say, against the plan's: null when they are the plan's own dates, else the sentence that asks whether to use the plan's. */
function profileMismatch(profile: { start?: string; end?: string }, plan: FundingPlanDto): string | null {
  if (profile.start === plan.planStart && profile.end === plan.planEnd) return null
  const tail = " Use this plan's dates on the profile?"
  if (!profile.start && !profile.end) return `The profile has no plan dates.${tail}`
  if (!profile.start || !profile.end) return `The profile has only one plan date.${tail}`
  return `The profile says the plan runs ${writtenSpan(profile.start, profile.end)}.${tail}`
}

/**
 * The participant hub's Funding tab (SuperAdmin, Admin and Coordinator: the money behind it is never shown to any other role). With nothing recorded it says so and where the figures
 * come from (a provider cannot see a participant's budget in the NDIA portal: the plan the participant shares, or their plan manager). With a plan it leads with the one running today:
 * its facts, its pools and their periods, an offer to copy its dates onto the profile when they differ (never done on its own), and Edit and "Record a new plan". Earlier plans are in a
 * collapsed read-only section. Phase 1 holds the record only: spending, forecasts and warnings arrive later, and the tab says so in one muted line rather than showing a figure it has not got.
 */
export default function FundingTab({ participantId, planType }: { participantId: string; planType: PlanType }) {
  const plansQuery = useFundingPlans(participantId)
  const applyDates = useApplyPlanDatesToProfile(participantId)
  const [editing, setEditing] = useState<Editing | null>(null)
  const today = useMemo(() => localIsoDate(), [])

  const data = plansQuery.data
  if (plansQuery.isLoading) return <PageState kind="loading" noun="budget" />
  if (!data) return <PageState kind="error" noun="budget" onRetry={() => { void plansQuery.refetch() }} />

  const plans = data.plans ?? []
  const current = currentPlanOf(plans, today)
  const others = plans.filter(plan => plan.id !== current?.id)
  const past = others.filter(plan => planStatus(plan, today) === 'Ended')
  const upcoming = others.filter(plan => planStatus(plan, today) === 'Upcoming')
  const mismatch = current ? profileMismatch(data.profilePlanDates ?? {}, current) : null
  const editor = (
    <FundingPlanEditor
      key={editing?.plan?.id ?? 'new'}
      open={editing !== null}
      onClose={() => setEditing(null)}
      participantId={participantId}
      plan={editing?.plan}
      previousPlan={editing?.previousPlan}
      defaultManagement={planType}
    />
  )

  if (!current) {
    return (
      <Card>
        <div className="flex max-w-prose flex-col items-start gap-3">
          <h3 className="text-sm font-semibold">No budget recorded</h3>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            The figures come from the plan the participant shares, or their plan manager. The NDIA does not show providers a participant's budget.
          </p>
          <Button onClick={() => setEditing({})}>Record plan budget</Button>
        </div>
        {editor}
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {mismatch && (
        <Callout
          tone="info"
          actions={<Button variant="secondary" size="sm" disabled={applyDates.isPending} onClick={() => applyDates.mutate(current.id)}>Use this plan's dates</Button>}
        >
          {mismatch}
        </Callout>
      )}
      {applyDates.isError && <Callout tone="danger">The profile's plan dates were not changed. Check your connection and try again.</Callout>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Plan budget</h3>
            <StatusBadge tone={STATUS_TONE[planStatus(current, today)]} label={planStatus(current, today)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing({ plan: current })}>Edit</Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing({ previousPlan: current })}>Record a new plan</Button>
          </div>
        </div>
        <PlanRecord plan={current} />
      </Card>

      <p className="text-[13px] text-[var(--color-muted-foreground)]">Spending and forecasts will appear here once budget tracking is switched on.</p>

      <PlanGroup title="Upcoming plans" plans={upcoming} today={today} />
      <PlanGroup title="Past plans" plans={past} today={today} />

      {editor}
    </div>
  )
}

/** A collapsed, read-only list of other plans of the participant (the ones that have ended, or have not started): each as its own record, with no way to change it from here. */
function PlanGroup({ title, plans, today }: { title: string; plans: FundingPlanDto[]; today: string }) {
  const [open, setOpen] = useState(false)
  if (plans.length === 0) return null
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="inline-flex min-h-[var(--tap-min)] w-fit items-center gap-1 text-sm font-medium text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
        {title} ({plans.length})
      </button>
      {open && plans.map(plan => (
        <Card key={plan.id}>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Plan budget</h3>
            <StatusBadge tone={STATUS_TONE[planStatus(plan, today)]} label={planStatus(plan, today)} />
          </div>
          <PlanRecord plan={plan} poolsLabel={`Pools of the plan ${writtenSpan(plan.planStart, plan.planEnd)}`} />
        </Card>
      ))}
    </section>
  )
}
