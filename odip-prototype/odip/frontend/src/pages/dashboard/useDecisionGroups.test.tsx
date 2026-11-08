import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDecisionGroups } from './useDecisionGroups'

const { settings } = vi.hoisted(() => ({ settings: { data: undefined as { groupActivitiesEnabled?: boolean } | undefined } }))
vi.mock('@/api/hooks', () => ({ useSettings: () => settings }))
const model = (key: string) => ({ key })
vi.mock('./groups/useCompletionsGroup', () => ({ useCompletionsGroup: () => model('completions') }))
vi.mock('./groups/useLeaveGroup', () => ({ useLeaveGroup: () => model('leave') }))
vi.mock('./groups/useIncidentsGroup', () => ({ useIncidentsGroup: () => model('incidents') }))
vi.mock('./groups/useTasksGroup', () => ({ useTasksGroup: () => model('tasks') }))
vi.mock('./groups/useComplianceGroup', () => ({ useComplianceGroup: () => model('compliance') }))
const useGroupStaffGroup = vi.hoisted(() => vi.fn((enabled: boolean) => ({ key: 'groupStaff', enabled })))
vi.mock('./groups/useGroupStaffGroup', () => ({ useGroupStaffGroup }))

const gates = { completions: true, leave: true, incidents: true, tasks: true, compliance: true }
const ctx = { viewerId: 'v', today: '2026-10-21', warningDays: 30, mayCloseBudgetReview: true, staff: {} as never }
const keys = () => renderHook(() => useDecisionGroups(gates as never, ctx)).result.current.map((g) => g.key)

describe('useDecisionGroups: group activities', () => {
  it('has no group activities tab while the organisation flag is off or unread', () => {
    settings.data = undefined
    expect(keys()).toEqual(['completions', 'leave', 'incidents', 'compliance', 'tasks'])
    settings.data = { groupActivitiesEnabled: false }
    expect(keys()).not.toContain('groupStaff')
  })

  it('puts the group activities tab last when the flag is on', () => {
    settings.data = { groupActivitiesEnabled: true }
    expect(keys()).toEqual(['completions', 'leave', 'incidents', 'compliance', 'tasks', 'groupStaff'])
  })

  it('hides it from a viewer who does not decide completions, and does not fetch for them', () => {
    settings.data = { groupActivitiesEnabled: true }
    useGroupStaffGroup.mockClear()
    const result = renderHook(() => useDecisionGroups({ ...gates, completions: false } as never, ctx)).result.current
    expect(result.map((g) => g.key)).not.toContain('groupStaff')
    expect(useGroupStaffGroup).toHaveBeenCalledWith(false)
  })
})
