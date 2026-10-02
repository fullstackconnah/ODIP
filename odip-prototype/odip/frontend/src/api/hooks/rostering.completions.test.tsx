import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))

vi.mock('../client', () => ({
  apiGet: mockApiGet,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

import { usePendingCompletionCount, usePendingCompletionQueue } from './rostering'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// The review queue's page 1 of 1 (what the nav badge asks for): the server's totalCount is the count, whatever the slice holds.
const queue = (totalCount: number) => ({ items: [], totalCount, page: 1, pageSize: 1, totalPages: totalCount, hasNext: totalCount > 1, hasPrevious: false })

beforeEach(() => {
  mockApiGet.mockReset()
})

describe('usePendingCompletionQueue: the shifts awaiting review, and whether that count can be trusted', () => {
  it('is loading, with a count of 0, until the request answers, then reports the server total and settles', async () => {
    mockApiGet.mockResolvedValue(queue(4))
    const qc = new QueryClient()
    const { result } = renderHook(() => usePendingCompletionQueue(), { wrapper: wrapper(qc) })

    expect(result.current).toEqual({ count: 0, loading: true, error: false })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toEqual({ count: 4, loading: false, error: false })
  })

  it('reports an error, not a settled zero, when the request fails', async () => {
    mockApiGet.mockRejectedValue(new Error('boom'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => usePendingCompletionQueue(), { wrapper: wrapper(qc) })

    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current).toEqual({ count: 0, loading: false, error: true })
  })

  it('asks for nothing and says nothing is loading when the caller is not enabled', () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => usePendingCompletionQueue(false), { wrapper: wrapper(qc) })

    expect(result.current).toEqual({ count: 0, loading: false, error: false })
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it('reads the request the nav badge reads: PendingReview, page 1, a page of one', async () => {
    mockApiGet.mockResolvedValue(queue(1))
    const qc = new QueryClient()
    const { result } = renderHook(() => usePendingCompletionQueue(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockApiGet).toHaveBeenCalledWith('/rostering/completions', { status: 'PendingReview', page: 1, pageSize: 1 })
  })
})

describe('usePendingCompletionCount (the sidebar badge) behaves as it did', () => {
  it('is the queue\'s count: 0 while loading, then the server total, from the same single request', async () => {
    mockApiGet.mockResolvedValue(queue(2))
    const qc = new QueryClient()
    const { result } = renderHook(() => ({ badge: usePendingCompletionCount(), queue: usePendingCompletionQueue() }), { wrapper: wrapper(qc) })

    expect(result.current.badge).toBe(0)
    await waitFor(() => expect(result.current.badge).toBe(2))
    expect(result.current.queue).toEqual({ count: 2, loading: false, error: false })
    // Both read ONE cache entry, so the badge and the dashboard never disagree and never double the traffic.
    expect(mockApiGet).toHaveBeenCalledTimes(1)
  })

  it('stays 0 for a caller that is not enabled, and 0 after a failure (a badge has no way to say "unknown")', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const off = renderHook(() => usePendingCompletionCount(false), { wrapper: wrapper(qc) })
    expect(off.result.current).toBe(0)
    expect(mockApiGet).not.toHaveBeenCalled()

    mockApiGet.mockRejectedValue(new Error('boom'))
    const failing = renderHook(() => usePendingCompletionCount(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled())
    expect(failing.result.current).toBe(0)
  })
})
