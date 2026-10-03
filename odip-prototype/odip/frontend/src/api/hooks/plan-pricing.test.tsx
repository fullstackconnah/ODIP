import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PlanBlock, PlanQuote } from '../types'
import { emptyBlock } from '@/lib/planBlocks'
import { usePlanBlockQuote, usePlanBudget, usePlanPricingSettings, useUpdatePlanPricingSettings } from './plan-pricing'

const { post, apiGet, apiPut } = vi.hoisted(() => ({ post: vi.fn(), apiGet: vi.fn(), apiPut: vi.fn() }))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiClient: { post }, apiGet, apiPut }
})

const wrapper = (client: QueryClient) => function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const quote = (changes: Partial<PlanQuote> = {}): PlanQuote => ({
  periodFrom: '2026-10-01', periodTo: '2026-12-31', lines: [], issues: [], notices: [], holidayOccurrences: [], openQuestions: [], timeBasis: 'tz-database', needsReview: false,
  totals: { amount: 0, supportHours: 0, lineCount: 0, unpricedLines: 0, reviewLines: 0, provisionalLines: 0, holidayOccurrences: 0, holidayUplift: 0, byCategory: [], byBlock: [] }, ...changes,
})

const reply = (data: PlanQuote) => ({ data: { success: true, data } })
const block: PlanBlock = { ...emptyBlock('b1', 'NSW'), days: ['Monday', 'Wednesday'] }

beforeEach(() => { post.mockReset(); apiGet.mockReset(); apiPut.mockReset() })

describe('usePlanBudget', () => {
  it('asks for the whole agreement without its lines, then for one ordinary week that avoids the holidays the first answer named', async () => {
    post.mockResolvedValueOnce(reply(quote({ holidayOccurrences: [{ blockId: 'b1', date: '2026-10-05', holidayName: 'Labour Day', decision: 'Review', skipped: false }] })))
    post.mockResolvedValueOnce(reply(quote({ periodFrom: '2026-10-08', periodTo: '2026-10-14' })))
    const { result } = renderHook(() => usePlanBudget([block], '2026-10-01', '2026-12-31'), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0][0]).toBe('/plan-pricing/quote')
    // The client sends blocks, a period and whether it wants lines: no price, no policy, no settings.
    expect(post.mock.calls[0][1]).toEqual({ blocks: [block], periodFrom: '2026-10-01', periodTo: '2026-12-31', includeLines: false })
    expect(post.mock.calls[1][1]).toEqual({ blocks: [block], periodFrom: '2026-10-08', periodTo: '2026-10-14', includeLines: false })
    expect(post.mock.calls[0][2]).toEqual({ signal: expect.any(AbortSignal) })   // a stale quote is cancelled with the query
    expect(result.current.data?.week).toEqual({ from: '2026-10-08', to: '2026-10-14' })
    expect(result.current.data?.weekly?.periodFrom).toBe('2026-10-08')
  })

  it('has no ordinary week to ask about for an agreement shorter than a week', async () => {
    post.mockResolvedValueOnce(reply(quote({ periodFrom: '2026-10-01', periodTo: '2026-10-04' })))
    const { result } = renderHook(() => usePlanBudget([block], '2026-10-01', '2026-10-04'), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(post).toHaveBeenCalledTimes(1)
    expect(result.current.data).toMatchObject({ weekly: null, week: null })
  })

  it('asks nothing while there is nothing to price: no blocks, no dates, a backwards period or a switched-off query', () => {
    const client = new QueryClient()
    renderHook(() => usePlanBudget([], '2026-10-01', '2026-12-31'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBudget([block], '', '2026-12-31'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBudget([block], '2026-12-31', '2026-10-01'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBudget([block], '2026-10-01', '2026-12-31', false), { wrapper: wrapper(client) })

    expect(post).not.toHaveBeenCalled()
  })

  // Review F1: the date box lets a person type a year with five digits, which compares as a later string than the end date and used to go to the server as a 400 nobody could read.
  it('asks nothing for a date the engine would refuse: a five digit year, a day that is not on the calendar, a year it does not price', () => {
    const client = new QueryClient()
    renderHook(() => usePlanBudget([block], '20261-10-01', '2026-12-31'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBudget([block], '2026-10-01', '20271-06-30'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBudget([block], '2026-10-01', '2027-02-30'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBudget([block], '1999-10-01', '2026-12-31'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBlockQuote(block, '2026-10-01', '20271-06-30'), { wrapper: wrapper(client) })
    renderHook(() => usePlanBlockQuote(block, '2026-10-01', '2101-06-30'), { wrapper: wrapper(client) })

    expect(post).not.toHaveBeenCalled()
  })

  it('reports a refusal as an error and does not retry it', async () => {
    post.mockRejectedValue({ response: { status: 429, data: {} } })
    const { result } = renderHook(() => usePlanBudget([block], '2026-10-01', '2026-12-31'), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('usePlanBlockQuote', () => {
  it('prices one block alone over the agreement and asks for its lines', async () => {
    post.mockResolvedValueOnce(reply(quote()))
    const { result } = renderHook(() => usePlanBlockQuote(block, '2026-10-01', '2026-12-31'), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(post.mock.calls[0][1]).toEqual({ blocks: [block], periodFrom: '2026-10-01', periodTo: '2026-12-31', includeLines: true })
  })

  it('waits for a block and a period', () => {
    renderHook(() => usePlanBlockQuote(null, '2026-10-01', '2026-12-31'), { wrapper: wrapper(new QueryClient()) })
    renderHook(() => usePlanBlockQuote(block, '', ''), { wrapper: wrapper(new QueryClient()) })
    expect(post).not.toHaveBeenCalled()
  })
})

describe('the pricing settings', () => {
  it('reads them from the settings route', async () => {
    apiGet.mockResolvedValue({ registrationGroupsHeld: ['0125'], isDefault: false })
    const { result } = renderHook(() => usePlanPricingSettings(), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(apiGet).toHaveBeenCalledWith('/plan-pricing/settings')
  })

  it('sends only the fields it is given, keeps the answer as the settings and throws away every price worked out with the old ones', async () => {
    apiPut.mockResolvedValue({ registrationGroupsHeld: ['0125'], registrationGroupsConfirmed: true, isDefault: false })
    const client = new QueryClient()
    client.setQueryData(['plan-budget', 'k'], { stale: true })
    client.setQueryData(['plan-block-quote', 'k'], { stale: true })
    const { result } = renderHook(() => useUpdatePlanPricingSettings(), { wrapper: wrapper(client) })

    result.current.mutate({ registrationGroupsHeld: ['0125'], registrationGroupsConfirmed: true })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiPut).toHaveBeenCalledWith('/plan-pricing/settings', { registrationGroupsHeld: ['0125'], registrationGroupsConfirmed: true })
    expect(client.getQueryData(['plan-pricing-settings'])).toMatchObject({ registrationGroupsConfirmed: true })
    expect(client.getQueryState(['plan-budget', 'k'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['plan-block-quote', 'k'])?.isInvalidated).toBe(true)
  })
})
