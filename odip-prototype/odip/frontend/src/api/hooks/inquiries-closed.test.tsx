import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))

vi.mock('../client', () => ({ apiGet: mockApiGet }))

import { useParticipantInquiries } from './inquiries'

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('useParticipantInquiries', () => {
  it('the closed view reads the bounded /inquiries/closed PagedResult and flattens it to items plus the cut and the total', async () => {
    mockApiGet.mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }], totalCount: 205, page: 1, pageSize: 200 })

    const { result } = renderHook(() => useParticipantInquiries('closed'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/inquiries/closed', undefined)
    expect([...result.current.data!]).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(result.current.data).toMatchObject({ isTruncated: true, totalCount: 205 })
  })

  it('the open view is still the plain /inquiries array', async () => {
    mockApiGet.mockClear()
    mockApiGet.mockResolvedValue([{ id: 'o' }])

    const { result } = renderHook(() => useParticipantInquiries(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/inquiries')
    expect(result.current.data).toEqual([{ id: 'o' }])
  })
})
