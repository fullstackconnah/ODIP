import type { UseQueryResult } from '@tanstack/react-query'
import type { StaffListDto } from '@/api/types/staff'
import type { DecisionGates } from './decisionGates'
import type { GroupModel } from './quickGroup'
import { useCompletionsGroup } from './groups/useCompletionsGroup'
import { useLeaveGroup } from './groups/useLeaveGroup'
import { useIncidentsGroup } from './groups/useIncidentsGroup'
import { useTasksGroup } from './groups/useTasksGroup'
import { useComplianceGroup } from './groups/useComplianceGroup'

/**
 * The viewer's decision groups, in SHAPE §5's fixed order, so a position always means the same group. Every group hook runs on every render (the rules
 * of hooks); its gate decides whether its requests are made and whether it is listed. PR C slots Unfilled shifts after Incidents, and Agreements to
 * approve after Tasks due.
 */
export function useDecisionGroups(gates: DecisionGates, ctx: {
  viewerId: string | null
  today: string
  warningDays: number
  mayCloseBudgetReview: boolean
  staff: UseQueryResult<StaffListDto[]>
}): GroupModel[] {
  const completions = useCompletionsGroup(gates.completions)
  const leave = useLeaveGroup(gates.leave, ctx.viewerId)
  const incidents = useIncidentsGroup(gates.incidents)
  const tasks = useTasksGroup(gates.tasks, { today: ctx.today, mayCloseBudgetReview: ctx.mayCloseBudgetReview })
  const compliance = useComplianceGroup(gates.compliance, { staff: ctx.staff, today: ctx.today, warningDays: ctx.warningDays })
  const ordered: Array<[boolean, GroupModel]> = [
    [gates.completions, completions], [gates.leave, leave], [gates.incidents, incidents], [gates.tasks, tasks], [gates.compliance, compliance],
  ]
  return ordered.filter(([shown]) => shown).map(([, group]) => group)
}
