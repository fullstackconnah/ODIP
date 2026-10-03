import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFundingPlans } from '@/api/hooks'
import type { PlanType } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { StatusBadge } from '@/components/StatusBadge'
import { localIsoDate } from '@/lib/dateOnly'
import { currentPlanOf, periodLengthLabel, planStatus, planTotal, writtenSpan } from '@/lib/fundingPlan'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { formatCurrency } from '@/lib/utils'
import { FundingPlanEditor } from './FundingPlanEditor'

/**
 * The "Plan budget" card on Intake's NDIS & Funding step and the Profile wizard (budget phase 1). It shows the participant's current plan record in one line, or "Not recorded", and opens the
 * same editor the Funding tab uses. "Plan not shared yet" is the explicit skip: the editor's close button says it when nothing is recorded to change, and it simply closes (a participant who
 * has not shared their plan is no error, and the budget can be recorded later on their Funding tab). The budget is saved through the funding endpoints and never through the participant's
 * patch groups, which are atomic and would wipe it; and it needs a participant to exist, so on a brand-new intake it says to save a draft first. The card is for the roles that may see
 * money: for any other it is not there at all.
 *
 * A plan that has ENDED is shown as ended, and the card offers a NEW plan after it rather than Edit: to record the next plan by editing the old one would overwrite the history the plan
 * record keeps (and the readiness item already says the budget has ended). The editor is drawn in a portal on the page: these wizards are forms, and a SlideOver inside one would put the
 * editor's fields in the wizard's form, where Enter in one of them is a submit of the wizard.
 */
export function PlanBudgetCard(props: { participantId?: string; planType: PlanType }) {
  const { canManageFunding } = usePermissions()
  // The body is what asks the server for money, so it is not even mounted for a role that may not see it.
  return canManageFunding ? <PlanBudgetCardBody {...props} /> : null
}

function PlanBudgetCardBody({ participantId, planType }: { participantId?: string; planType: PlanType }) {
  const plansQuery = useFundingPlans(participantId)
  const [editing, setEditing] = useState(false)
  const today = useMemo(() => localIsoDate(), [])

  const current = plansQuery.data ? currentPlanOf(plansQuery.data.plans ?? [], today) : undefined
  const ended = current !== undefined && planStatus(current, today) === 'Ended'

  let body
  if (!participantId) {
    body = <p className="text-sm text-[var(--color-muted-foreground)]">Save as draft first, then record the plan budget on the participant&rsquo;s Funding tab.</p>
  } else if (plansQuery.isLoading) {
    body = <p className="text-sm text-[var(--color-muted-foreground)]" aria-busy="true">–</p>
  } else if (!plansQuery.data) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">Couldn&rsquo;t load</p>
        <Button variant="ghost" size="sm" onClick={() => { void plansQuery.refetch() }}>Try again</Button>
      </div>
    )
  } else if (!current) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">Not recorded</p>
        <p className="max-w-prose text-[13px] text-[var(--color-muted-foreground)]">
          The figures come from the plan the participant shares, or their plan manager. If the plan has not been shared yet, leave this and record it later on the participant&rsquo;s Funding tab.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Record plan budget</Button>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Two groups that wrap as wholes (never mid-way, which left a separator dot at the start of a line): which plan, then what is in it. */}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex flex-wrap items-center gap-2">
            {ended && <StatusBadge tone="neutral" label="Ended" />}
            <span className="font-medium tabular-nums">{writtenSpan(current.planStart, current.planEnd)}</span>
          </span>
          <span className="text-[var(--color-muted-foreground)]">{periodLengthLabel(current.periodLengthMonths)} · {plural(current.pools.length, 'pool')} · <span className="tabular-nums">{formatCurrency(planTotal(current))} in total</span></span>
        </p>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>{ended ? 'Record a new plan' : 'Edit'}</Button>
      </div>
    )
  }

  return (
    <Card title="Plan budget">
      {body}
      {participantId && createPortal(
        <FundingPlanEditor
          open={editing}
          onClose={() => setEditing(false)}
          participantId={participantId}
          plan={ended ? undefined : current}
          previousPlan={ended ? current : undefined}
          defaultManagement={planType}
          skipLabel={current && !ended ? undefined : 'Plan not shared yet'}
        />,
        document.body,
      )}
    </Card>
  )
}
