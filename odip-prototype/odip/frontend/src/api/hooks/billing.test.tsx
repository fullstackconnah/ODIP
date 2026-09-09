import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useFundingSources, useServiceBookings, useBillableEvents, useClaimBatches } from './billing'

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet: mockApiGet }
})

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const emptyPage = { items: [], totalCount: 0, page: 1, pageSize: 200, totalPages: 0, hasNext: false, hasPrevious: false }

// UX-audit-round-2: BillingController clamps pageSize to a ceiling of 200 on every list endpoint
// and defaults to 50 when the caller omits it. Each list hook below must request the ceiling
// explicitly rather than silently accepting the server's smaller default, which used to cap these
// lists at 50 rows with no signal that more existed. The resolved array also carries
// totalCount/isTruncated (see pagedList.ts).
describe('billing list hooks — pageSize ceiling', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiGet.mockResolvedValue(emptyPage)
  })

  it('useFundingSources requests pageSize=200', async () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useFundingSources({ participantId: 'p1' }), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/billing/funding-sources', { pageSize: '200', participantId: 'p1' })
  })

  it('useServiceBookings requests pageSize=200', async () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useServiceBookings({ participantId: 'p1' }), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/billing/service-bookings', { pageSize: '200', participantId: 'p1' })
  })

  it('useBillableEvents requests pageSize=200', async () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useBillableEvents({ participantId: 'p1' }), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/billing/billable-events', { pageSize: '200', participantId: 'p1' })
  })

  it('useClaimBatches requests pageSize=200', async () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useClaimBatches(), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/billing/claim-batches', { pageSize: '200' })
  })
})

describe('billing list hooks — truncation signal', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })

  it('useFundingSources marks the array isTruncated when totalCount exceeds the returned page', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}` }))
    mockApiGet.mockResolvedValue({ ...emptyPage, items, totalCount: 210, hasNext: true })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useFundingSources(), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(true)
    expect(result.current.data?.totalCount).toBe(210)
  })

  it('useServiceBookings marks the array not truncated when everything fits on one page', async () => {
    mockApiGet.mockResolvedValue({ ...emptyPage, items: [{ id: 's1' }], totalCount: 1 })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useServiceBookings(), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(false)
  })

  it('useBillableEvents marks the array isTruncated when totalCount exceeds the returned page', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `b${i}` }))
    mockApiGet.mockResolvedValue({ ...emptyPage, items, totalCount: 500, hasNext: true })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useBillableEvents(), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(true)
    expect(result.current.data?.totalCount).toBe(500)
  })

  it('useClaimBatches marks the array isTruncated when totalCount exceeds the returned page', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}` }))
    mockApiGet.mockResolvedValue({ ...emptyPage, items, totalCount: 201, hasNext: true })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useClaimBatches(), { wrapper: createWrapper(queryClient) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(true)
    expect(result.current.data?.totalCount).toBe(201)
  })
})
