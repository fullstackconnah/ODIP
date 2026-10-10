import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SaveFundingPlanDto } from '../types'
import { plan } from '@/test/fixtures/funding'
import {
  useApplyPlanDatesToProfile, useBudgetSettings, useCreateFundingPlan, useFundingPlans, usePaceCategories, useUpdateBudgetSettings, useUpdateFundingPlan,
} from './funding'

// The budget hooks send exact bodies to the funding endpoints (never the participant's patch groups), and a plan write refreshes ['participant-funding', participantId]; applying a plan's
// dates to the profile also refreshes the participant, which carries those dates.

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet, apiPost, apiPut }
})

const wrapper = (client: QueryClient) => function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const body: SaveFundingPlanDto = {
  planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3, evidence: 'PlanCopy',
  pools: [{ kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', periods: [{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 8000 }] }],
}

beforeEach(() => { apiGet.mockReset(); apiPost.mockReset(); apiPut.mockReset() })

/** A plan write changes what the onboarding checklist's 'Funding recorded' gate and the worklist say, so both are refreshed with it (they would otherwise stay stale for their 30 s). */
function expectOnboardingRefreshed(invalidate: { mock: { calls: unknown[][] } }) {
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['onboarding', 'participant-1'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant-onboarding-worklist'] })
}

describe('reading', () => {
  it('lists a participant’s plans from the funding endpoint, and does not ask while disabled or with no participant', async () => {
    apiGet.mockResolvedValue({ plans: [plan()], profilePlanDates: {} })
    const { result } = renderHook(() => useFundingPlans('participant-1'), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiGet).toHaveBeenCalledWith('/participants/participant-1/funding/plans')

    apiGet.mockClear()
    renderHook(() => useFundingPlans('participant-1', false), { wrapper: wrapper(new QueryClient()) })
    renderHook(() => useFundingPlans(undefined), { wrapper: wrapper(new QueryClient()) })
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('reads the support categories and the settings from their own endpoints', async () => {
    apiGet.mockResolvedValue([])
    const client = new QueryClient()
    renderHook(() => usePaceCategories(), { wrapper: wrapper(client) })
    renderHook(() => useBudgetSettings(), { wrapper: wrapper(client) })

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    expect(apiGet.mock.calls.map(call => call[0]).sort()).toEqual([
      '/funding/pace-categories', '/funding/settings',
    ])
  })
})

describe('saving a plan', () => {
  it('posts the body exactly as given to the participant’s funding endpoint, then refreshes that participant’s funding', async () => {
    apiPost.mockResolvedValue(plan())
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateFundingPlan('participant-1'), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync(body) })

    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/participants/participant-1/funding/plans', body)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant-funding', 'participant-1'] })
    expectOnboardingRefreshed(invalidate)
  })

  it('puts the replacement, with its revision, to the plan’s own URL, then refreshes that participant’s funding', async () => {
    apiPut.mockResolvedValue(plan({ revision: 5 }))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateFundingPlan('participant-1'), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync({ planId: 'plan-1', body: { ...body, revision: 4 } }) })

    expect(apiPut).toHaveBeenCalledWith('/participants/participant-1/funding/plans/plan-1', { ...body, revision: 4 })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant-funding', 'participant-1'] })
    expectOnboardingRefreshed(invalidate)
  })

  it('does not refresh anything when the save is refused', async () => {
    apiPut.mockRejectedValue(Object.assign(new Error('409'), { response: { status: 409 } }))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateFundingPlan('participant-1'), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync({ planId: 'plan-1', body }).catch(() => undefined) })

    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('applying a plan’s dates to the profile', () => {
  it('posts to the plan’s apply-dates URL with no body, then refreshes the participant’s funding AND the participant, who carries the dates', async () => {
    apiPost.mockResolvedValue({ start: '2026-07-01', end: '2027-06-30', changed: true })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useApplyPlanDatesToProfile('participant-1'), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync('plan-1') })

    expect(apiPost).toHaveBeenCalledWith('/participants/participant-1/funding/plans/plan-1/apply-dates-to-profile')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant-funding', 'participant-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant', 'participant-1'] })
    expectOnboardingRefreshed(invalidate)
  })
})

describe('the budget settings', () => {
  it('puts only what is given, and keeps the answer as the settings', async () => {
    apiPut.mockResolvedValue({ mode: 'HardLimit', approachingPercent: 80, isDefault: false })
    const client = new QueryClient()
    const { result } = renderHook(() => useUpdateBudgetSettings(), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync({ mode: 'HardLimit' }) })

    expect(apiPut).toHaveBeenCalledWith('/funding/settings', { mode: 'HardLimit' })
    expect(client.getQueryData(['budget-settings'])).toEqual({ mode: 'HardLimit', approachingPercent: 80, isDefault: false })
  })
})
