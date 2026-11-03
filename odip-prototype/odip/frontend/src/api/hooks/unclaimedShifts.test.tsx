import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { apiClient } from '@/api/client'
import { UNCLAIMED_SHIFTS_KEY, useUnclaimedShifts } from '@/api/hooks/claimHub'
import { useDeleteClaim, useGenerateShiftClaim, useRunShiftClaims, useUpdateClaim, useUpdateClaimLineItem } from '@/api/hooks/claims'
import { useApproveCompletion, useApproveCompletionsBatch } from '@/api/hooks/rostering'

// The dashboard's count of shifts waiting to be claimed: what it reads, and every write that moves it.

const urls: string[] = []
const reply = (data: unknown) => ({ data: { success: true, data }, status: 200, statusText: '', headers: {}, config: { headers: {} } }) as AxiosResponse
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  urls.length = 0
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    urls.push(`${String(config.method).toUpperCase()} ${config.url}`)
    return reply(config.method === 'get' ? { from: '2026-10-19', to: '2026-11-01', shiftCount: 6, participantCount: 2 } : { participants: [] })
  }
})
afterEach(() => vi.restoreAllMocks())

describe('useUnclaimedShifts', () => {
  it('reads the waiting endpoint and returns the two counts', async () => {
    const { result } = renderHook(() => useUnclaimedShifts(true), { wrapper })
    expect(result.current).toMatchObject({ count: 0, loading: true, error: false })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(urls).toEqual(['GET /claims/from-shifts/waiting'])
    expect(result.current).toMatchObject({ count: 6, participants: 2, error: false })
  })

  it('returns the older, overdue and oldest-date figures', async () => {
    apiClient.defaults.adapter = async () => reply({ shiftCount: 6, participantCount: 2, olderShiftCount: 3, overdueShiftCount: 1, oldestDate: '2026-07-21' })
    const { result } = renderHook(() => useUnclaimedShifts(true), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ count: 6, older: 3, overdue: 1, oldestDate: '2026-07-21' })
  })

  it('makes no request when disabled', () => {
    const { result } = renderHook(() => useUnclaimedShifts(false), { wrapper })
    expect(urls).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('reports a failed request as an error, not as zero waiting', async () => {
    apiClient.defaults.adapter = async () => { throw Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 500, data: {} } }) }
    const { result } = renderHook(() => useUnclaimedShifts(true), { wrapper })
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.loading).toBe(false)
  })
})

describe('what moves the count refreshes it', () => {
  it.each([
    ['making the claim run', () => useRunShiftClaims(), (m: ReturnType<typeof useRunShiftClaims>) => m.mutateAsync({})],
    ['claiming one participant\'s shifts', () => useGenerateShiftClaim(), (m: ReturnType<typeof useGenerateShiftClaim>) => m.mutateAsync({ participantId: 'p1', data: { from: '2026-10-19', to: '2026-11-01' } })],
    ['deleting a claim', () => useDeleteClaim(), (m: ReturnType<typeof useDeleteClaim>) => m.mutateAsync('c1')],
    ['rejecting or cancelling a claim', () => useUpdateClaim(), (m: ReturnType<typeof useUpdateClaim>) => m.mutateAsync({ claimId: 'c1', data: {} })],
    ['rejecting a claim line', () => useUpdateClaimLineItem(), (m: ReturnType<typeof useUpdateClaimLineItem>) => m.mutateAsync({ claimId: 'c1', itemId: 'i1', data: {} })],
    ['approving a completion', () => useApproveCompletion(), (m: ReturnType<typeof useApproveCompletion>) => m.mutateAsync('s1')],
    ['approving completions in a batch', () => useApproveCompletionsBatch(), (m: ReturnType<typeof useApproveCompletionsBatch>) => m.mutateAsync(['s1'])],
  ] as const)('%s', async (_name, hook, fire) => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const { result } = renderHook(hook as () => never, { wrapper })

    await act(() => (fire as (m: never) => Promise<unknown>)(result.current))

    // A prefix that covers the key counts: the claim run invalidates all of 'claim-hub'.
    const covers = spy.mock.calls.some(([filter]) => {
      const key = (filter as { queryKey?: readonly unknown[] } | undefined)?.queryKey
      return !!key && key.every((part, i) => UNCLAIMED_SHIFTS_KEY[i] === part)
    })
    expect(covers).toBe(true)
  })
})
