import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSetupStatus } from './dashboard'

const apiGet = vi.hoisted(() => vi.fn())
vi.mock('../client', () => ({ apiGet }))

describe('useSetupStatus', () => {
  it('refetches on every mount, even inside the app default 30 s stale time', async () => {
    apiGet.mockResolvedValue({ staffCount: 0 })
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const first = renderHook(() => useSetupStatus(true), { wrapper })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    first.unmount()
    renderHook(() => useSetupStatus(true), { wrapper })
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
    expect(apiGet).toHaveBeenCalledWith('/dashboard/setup')
  })

  it('does not query when disabled', () => {
    apiGet.mockClear()
    const qc = new QueryClient()
    renderHook(() => useSetupStatus(false), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> })
    expect(apiGet).not.toHaveBeenCalled()
  })
})
