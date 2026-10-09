import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useCreateShift, useUpdateShift } from '@/api/hooks/rostering'
import type { CreateShiftDto } from '@/api/types'

// The phase 3 review, C9: a shift saved as an emergency raises the Admin's review task in the same save, but the Tasks list (staleTime 30 s) was never marked stale by a shift write, so an Admin who opened
// Tasks within half a minute saw a list without it. The REAL hooks run on a REAL QueryClient; only the transport (the axios adapter) is replaced, as in ledger-refresh.test.tsx.

const originalAdapter = apiClient.defaults.adapter

beforeEach(() => {
  const adapter: AxiosAdapter = async (): Promise<AxiosResponse> =>
    ({ data: { data: { id: 'shift-1' } }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } }) as AxiosResponse
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const shiftBody: CreateShiftDto = {
  participantId: 'participant-1', staffId: null, serviceDate: '2026-10-09', startTime: '09:00', endTime: '13:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None', status: 'Draft',
  overrideReason: null, acknowledgedFindingCodes: [],
}

describe('a shift write marks the Tasks list stale', () => {
  it('after a create, so the emergency review task raised with the shift is in the list at once', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateShift(), { wrapper: wrapperFor(client) })

    result.current.mutate({ ...shiftBody })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
  })

  it('after an update, which can raise one too', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateShift(), { wrapper: wrapperFor(client) })

    result.current.mutate({ id: 'shift-1', data: { ...shiftBody } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
  })
})
