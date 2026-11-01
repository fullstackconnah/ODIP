import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useRunShiftClaims } from '@/api/hooks/claims'

const post = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async orig => ({ ...(await orig<typeof import('@/api/client')>()), apiPost: post }))

describe('useRunShiftClaims', () => {
  it('refreshes the claim lists when the run fails, because part of it may have been saved', async () => {
    post.mockRejectedValue(new Error('network'))
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useRunShiftClaims(), { wrapper })

    await act(async () => { await result.current.mutateAsync({ from: '2026-10-19', to: '2026-11-01' }).catch(() => {}) })

    const keys = invalidate.mock.calls.map(c => (c[0] as { queryKey: string[] }).queryKey[0])
    expect(keys).toEqual(expect.arrayContaining(['claims', 'claim-hub', 'claim-batches']))
  })
})
