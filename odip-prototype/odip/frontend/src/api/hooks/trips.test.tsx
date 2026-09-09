import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTrips } from './trips'

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

// UX-audit-round-2: TripsController clamps pageSize to a ceiling of 200 and defaults to 50 when
// the caller omits it. useTrips must request the ceiling explicitly rather than silently accepting
// the server's smaller default (which used to cap the list at 50 rows with no signal that more
// trips existed). The resolved array also carries totalCount/isTruncated (see pagedList.ts).
describe('useTrips', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })

  it('requests the server pageSize ceiling (200) rather than the default', async () => {
    mockApiGet.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 200, totalPages: 0, hasNext: false, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useTrips({ status: 'Completed' }), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/trips', { pageSize: '200', status: 'Completed' })
  })

  it('resolves to the flat items array so existing call sites keep destructuring an array', async () => {
    const items = [{ id: 't1' }, { id: 't2' }]
    mockApiGet.mockResolvedValue({ items, totalCount: 2, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useTrips(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect([...(result.current.data ?? [])]).toEqual(items)
  })

  it('marks the array isTruncated when the tenant has more trips than the returned page', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}` }))
    mockApiGet.mockResolvedValue({ items, totalCount: 250, page: 1, pageSize: 200, totalPages: 2, hasNext: true, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useTrips(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(true)
    expect(result.current.data?.totalCount).toBe(250)
  })
})
