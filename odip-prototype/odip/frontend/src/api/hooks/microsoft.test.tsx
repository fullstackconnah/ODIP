import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTurnOffMicrosoft } from './microsoft'

// Turning the organisation's Microsoft sign-in off also changes what Profile offers (Link or Unlink), so both cached answers must be refetched.

vi.mock('../client', async () => ({ ...(await vi.importActual<object>('../client')), apiDelete: vi.fn().mockResolvedValue(undefined) }))

describe('useTurnOffMicrosoft', () => {
  it('refreshes the organisation link and the signed-in person\'s own account', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useTurnOffMicrosoft(), { wrapper })

    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const keys = invalidate.mock.calls.map(c => c[0]?.queryKey)
    expect(keys).toContainEqual(['microsoft-link'])
    expect(keys).toContainEqual(['microsoft-account'])
  })
})
