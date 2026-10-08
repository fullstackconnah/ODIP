import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { PlanBlock } from '@/api/types'
import { agreementCheck, budgetList } from '@/test/fixtures/budgets'
import { useAgreementCheck, useBudgetList, BUDGET_LIST_KEY } from './funding-warnings'
import { refreshBudgetFigures, refreshBudgetWarnings } from './funding-ledger'
import {
  useDeleteClaim, useGenerateClaim, useGenerateShiftClaim, useUpdateClaim, useUpdateClaimLineItem,
} from './claims'
import { useCreateFundingPlan, useUpdateBudgetSettings, useUpdateFundingPlan } from './funding'
import { useCancelBooking, useCreateBooking, useDeleteBooking, usePatchBooking, useUpdateBooking } from './bookings'
import { usePatchTrip, useUpdateTrip } from './trips'
import { useApproveServiceAgreementDraft } from './service-agreement-drafts'
import {
  useApproveCompletion, useApproveCompletionsBatch, useAssignShift, useCreateShift, useDeleteShift, useGeneratePattern, useReturnCompletion, useUpdateShift,
} from './rostering'

// The hooks behind the budget warnings (budget phase 2b), run for real on a real QueryClient with only the transport boundary (the axios adapter of the real client) replaced:
//   - what they ask the server for, with exactly which body, and when they do not ask at all;
//   - that anything which moves a participant's money - a claim, a shift, a plan record, the "approaching" percentage - marks the alerts, the Budgets list and any agreement check as stale.

interface Call { method: string; url: string; body: unknown }
const calls: Call[] = []
let answer: (call: Call) => unknown = () => ({ id: 'written' })

function axiosPayload(data: unknown): AxiosResponse {
  return { data: { data }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } } as AxiosResponse
}

beforeEach(() => {
  calls.length = 0
  answer = () => ({ id: 'written' })
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const call: Call = { method: String(config.method ?? 'get').toLowerCase(), url: String(config.url ?? ''), body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }
    calls.push(call)
    return axiosPayload(answer(call))
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = undefined
  vi.restoreAllMocks()
})

const wrapper = (client: QueryClient) => function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

const block = (id: string): PlanBlock => ({ id, supportType: 'CommunityAccess', days: ['Monday'], start: '09:00', end: '13:00', location: { state: 'NSW' } }) as unknown as PlanBlock

describe('useBudgetList', () => {
  it('reads the list from the funding endpoint, once, and not while disabled', async () => {
    answer = () => budgetList()
    const { result } = renderHook(() => useBudgetList(), { wrapper: wrapper(newClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toEqual([{ method: 'get', url: '/funding/budgets', body: undefined }])
    expect(result.current.data?.rows).toHaveLength(4)

    calls.length = 0
    renderHook(() => useBudgetList(false), { wrapper: wrapper(newClient()) })
    expect(calls).toEqual([])
  })
})

describe('useAgreementCheck', () => {
  const blocks = [block('mon')]

  it('posts exactly the blocks and the agreement dates to the participant’s agreement-check endpoint', async () => {
    answer = () => agreementCheck()
    const { result } = renderHook(() => useAgreementCheck('p-1', blocks, '2026-10-12', '2026-12-20'), { wrapper: wrapper(newClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ method: 'post', url: '/participants/p-1/funding/agreement-check', body: { blocks, periodFrom: '2026-10-12', periodTo: '2026-12-20' } })
    expect(result.current.data?.hasBudget).toBe(true)
  })

  it('does not ask while it is held back, with no blocks, with no participant, or with dates that cannot be priced', () => {
    const client = newClient()
    renderHook(() => useAgreementCheck('p-1', blocks, '2026-10-12', '2026-12-20', false), { wrapper: wrapper(client) })   // held back until the running budget's quotes have finished
    renderHook(() => useAgreementCheck('p-1', [], '2026-10-12', '2026-12-20'), { wrapper: wrapper(client) })
    renderHook(() => useAgreementCheck(undefined, blocks, '2026-10-12', '2026-12-20'), { wrapper: wrapper(client) })
    renderHook(() => useAgreementCheck('p-1', blocks, '2026-12-20', '2026-10-12'), { wrapper: wrapper(client) })   // ends before it starts
    renderHook(() => useAgreementCheck('p-1', blocks, '', ''), { wrapper: wrapper(client) })

    expect(calls).toEqual([])
  })

  it('asks again when the blocks change, and not when they are the same blocks again', async () => {
    answer = () => agreementCheck()
    const client = newClient()
    const { result, rerender } = renderHook(({ list }: { list: PlanBlock[] }) => useAgreementCheck('p-1', list, '2026-10-12', '2026-12-20'), { wrapper: wrapper(client), initialProps: { list: blocks } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ list: [block('mon')] })   // a different array holding the same plan
    expect(calls).toHaveLength(1)

    rerender({ list: [block('mon'), block('wed')] })
    await waitFor(() => expect(calls).toHaveLength(2))
    expect((calls[1].body as { blocks: unknown[] }).blocks).toHaveLength(2)
  })

  it('keeps showing the last answer while a newer one is on its way', async () => {
    answer = () => agreementCheck()
    const { result, rerender } = renderHook(({ list }: { list: PlanBlock[] }) => useAgreementCheck('p-1', list, '2026-10-12', '2026-12-20'), { wrapper: wrapper(newClient()), initialProps: { list: blocks } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const first = result.current.data

    let release: (value: unknown) => void = () => {}
    const gate = new Promise(resolve => { release = resolve })
    apiClient.defaults.adapter = async () => { await gate; return axiosPayload(agreementCheck({ agreementCost: 999 })) }
    rerender({ list: [block('mon'), block('wed')] })

    await waitFor(() => expect(result.current.isFetching).toBe(true))
    expect(result.current.data).toBe(first)   // the previous answer stays on screen
    release(null)
    await waitFor(() => expect(result.current.data?.agreementCost).toBe(999))
  })
})

describe('refreshBudgetWarnings', () => {
  it('marks the alerts the dashboard and the participant banners read, the Budgets list and any agreement check stale', () => {
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    refreshBudgetWarnings(client)

    expect(invalidate.mock.calls.map(call => call[0])).toEqual([
      { queryKey: ['participant-alerts-aggregate'] },
      { queryKey: ['participant-alerts'] },
      { queryKey: BUDGET_LIST_KEY },
      { queryKey: ['agreement-check'] },
    ])
    expect(BUDGET_LIST_KEY).toEqual(['budget-list'])
  })
})

describe('refreshBudgetFigures', () => {
  // The ledger's own helper (funding-ledger.ts) refreshes the warnings too: they are worked out from the same figures, so a write that refreshes the one has refreshed the other.
  it('marks the warnings stale with the ledgers and the claim pages', () => {
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    refreshBudgetFigures(client, ['p-1'])

    const keys = invalidate.mock.calls.map(call => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(keys).toEqual(expect.arrayContaining([['participant-funding', 'p-1', 'ledger'], ['claim'], ['participant-alerts-aggregate'], ['participant-alerts'], ['budget-list'], ['agreement-check']]))
  })
})

// ── Everything that moves a participant's money refreshes them ───────────────

describe('the writes that move a participant’s money', () => {
  function expectRefreshed(invalidate: { mock: { calls: unknown[][] } }) {
    for (const key of [['participant-alerts-aggregate'], ['participant-alerts'], ['budget-list'], ['agreement-check']]) {
      expect(invalidate, key.join()).toHaveBeenCalledWith({ queryKey: key })
    }
  }

  const planBody = { planStart: '2026-07-01', planEnd: '2027-06-30', evidence: 'PlanCopy', pools: [] } as never

  // [what it is, how it is run]. Each hook runs for real: the transport answers success, and what is under test is what the hook does with it.
  const writes: Array<[string, (client: QueryClient) => Promise<unknown>]> = [
    ['marking a claim Rejected with the NDIA’s code', client => run(client, useUpdateClaim, { claimId: 'c-1', data: { status: 'Rejected', rejectionCode: 'V27' } })],
    ['editing a claim', client => run(client, useUpdateClaim, { claimId: 'c-1', data: { notes: 'Chased' } })],
    ['changing a claim line', client => run(client, useUpdateClaimLineItem, { claimId: 'c-1', itemId: 'l-1', data: { hours: 4 } })],
    ['deleting a claim', client => run(client, useDeleteClaim, 'c-1')],
    ['generating a trip claim', client => run(client, useGenerateClaim, { tripId: 't-1' })],
    ['generating a shift claim', client => run(client, useGenerateShiftClaim, { participantId: 'p-1', data: { from: '2026-10-01', to: '2026-10-31' } })],
    ['recording a plan', client => run(client, () => useCreateFundingPlan('p-1'), planBody)],
    ['changing a plan', client => run(client, () => useUpdateFundingPlan('p-1'), { planId: 'plan-1', body: planBody })],
    ['saving the budget settings', client => run(client, useUpdateBudgetSettings, { approachingPercent: 90 })],
    ['making a shift', client => run(client, useCreateShift, { participantId: 'p-1' } as never)],
    ['changing a shift', client => run(client, useUpdateShift, { id: 's-1', data: {} as never })],
    ['removing a shift', client => run(client, useDeleteShift, 's-1')],
    ['approving a shift completion', client => run(client, useApproveCompletion, 's-1')],
    ['approving shift completions in a batch', client => run(client, useApproveCompletionsBatch, ['s-1', 's-2'])],
    ['generating shifts from a pattern', client => run(client, useGeneratePattern, { id: 'pat-1', from: '2026-10-01', to: '2026-10-31' })],
    ['making a trip booking', client => run(client, useCreateBooking, { tripInstanceId: 't-1', participantId: 'p-1' } as never)],
    ['changing a trip booking', client => run(client, useUpdateBooking, { id: 'b-1', data: {} } as never)],
    ['patching a trip booking', client => run(client, usePatchBooking, { id: 'b-1', data: { bookingStatus: 'Confirmed' } } as never)],
    ['cancelling a trip booking', client => run(client, useCancelBooking, { id: 'b-1', data: {} } as never)],
    ['removing a trip booking', client => run(client, useDeleteBooking, 'b-1')],
    ['changing a trip (its status or dates)', client => run(client, useUpdateTrip, { id: 't-1', data: { status: 'Completed' } } as never)],
    ['patching a trip (its status)', client => run(client, usePatchTrip, { id: 't-1', data: { status: 'InProgress' } } as never)],
    ['approving an agreement revision for rostering', client => run(client, useApproveServiceAgreementDraft, { participantId: 'p-1', draftId: 'd-1', acknowledgeOverlaps: false } as never)],
  ]

  async function run<TVars>(client: QueryClient, useHook: () => { mutateAsync: (vars: TVars) => Promise<unknown> }, vars: TVars) {
    const { result } = renderHook(useHook, { wrapper: wrapper(client) })
    await act(async () => { await result.current.mutateAsync(vars) })
  }

  it.each(writes)('%s', async (_name, write) => {
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await write(client)

    expectRefreshed(invalidate)
  })

  // Assigning a worker, and returning a completion for the times to be added (it takes the shift from review back to Published, and the ledger counts both the same way), move no money.
  it.each([
    ['assigning a worker to a shift', (client: QueryClient) => run(client, useAssignShift, { id: 's-1', data: { staffId: 'st-1' } as never })],
    ['returning a shift completion', (client: QueryClient) => run(client, useReturnCompletion, { shiftId: 's-1', data: { reason: 'Add the times' } as never })],
  ])('does not, for a write that moves no money: %s', async (_name, write) => {
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await write(client)

    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['budget-list'] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['participant-alerts-aggregate'] })
  })

  it('sends the NDIA’s code with the Rejected status, exactly as given, to the claim', async () => {
    await run(newClient(), useUpdateClaim, { claimId: 'c-1', data: { status: 'Rejected', rejectionCode: 'V27' } })

    expect(calls).toContainEqual({ method: 'put', url: '/claims/c-1', body: { status: 'Rejected', rejectionCode: 'V27' } })
  })

  it('leaves the code out of a status change that is not a rejection, so the server’s “only with a rejected claim” rule never trips', async () => {
    await run(newClient(), useUpdateClaim, { claimId: 'c-1', data: { status: 'Submitted' } })

    expect(calls).toContainEqual({ method: 'put', url: '/claims/c-1', body: { status: 'Submitted' } })
  })
})
