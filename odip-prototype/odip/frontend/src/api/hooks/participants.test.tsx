import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { usePatchParticipant } from './participants'
import type { PatchParticipantDto } from '../types'

// CORE-02: usePatchParticipant is a thin TanStack Query mutation wrapper around apiPatchRaw — only
// that named export needs mocking (the rest of the module, e.g. apiPutRaw used by
// useUpdateParticipant, stays real).
const { mockApiPatchRaw } = vi.hoisted(() => ({
  mockApiPatchRaw: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiPatchRaw: mockApiPatchRaw }
})

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('usePatchParticipant', () => {
  beforeEach(() => {
    mockApiPatchRaw.mockReset()
  })

  it('PATCHes /participants/{id} with exactly the caller-supplied PatchParticipantDto', async () => {
    mockApiPatchRaw.mockResolvedValue({ success: true, data: { id: 'p1' }, message: null, errors: null })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => usePatchParticipant(), { wrapper: createWrapper(queryClient) })

    const data: PatchParticipantDto = { personalDetails: { firstName: 'Sophie', lastName: 'Brown' } }
    result.current.mutate({ id: 'p1', data })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPatchRaw).toHaveBeenCalledWith('/participants/p1', data)
    expect(mockApiPatchRaw).toHaveBeenCalledTimes(1)
  })

  it('invalidates both the participants list query and the single participant query on success', async () => {
    mockApiPatchRaw.mockResolvedValue({ success: true, data: { id: 'p42' }, message: null, errors: null })
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePatchParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ id: 'p42', data: { keyIdentifiers: { weightKg: 60 } } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participants'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participant', 'p42'] })
  })

  it('does not invalidate any query when the PATCH fails', async () => {
    mockApiPatchRaw.mockRejectedValue(new Error('network error'))
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePatchParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ id: 'p1', data: {} })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
