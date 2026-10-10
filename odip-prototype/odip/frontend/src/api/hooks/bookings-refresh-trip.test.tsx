import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useCreateBooking, useDeleteBooking, useUpdateBooking } from '@/api/hooks/bookings'
import type { CreateBookingDto, UpdateBookingDto } from '@/api/types'

// A booking write changes the trip's server-worked staff figure (RecalculateStaffRequired), and the trip page reads it from ['trip', id]. Create, update and
// delete refreshed ['trips'] (the list) but not ['trip'], so the Staff tab kept the old figure for up to 30 s (patch and cancel already refreshed it). The REAL
// hooks run on a REAL QueryClient; only the transport (the axios adapter) is replaced, as in shift-writes-refresh-tasks.test.tsx.

const originalAdapter = apiClient.defaults.adapter

beforeEach(() => {
  const adapter: AxiosAdapter = async (): Promise<AxiosResponse> =>
    ({ data: { success: true, data: { id: 'booking-1' } }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } }) as AxiosResponse
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('a booking write marks the trip stale', () => {
  it('after a create', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCreateBooking(), { wrapper: wrapperFor(client) })

    result.current.mutate({ tripInstanceId: 'trip-1', participantId: 'participant-1', bookingStatus: 'Confirmed' } as CreateBookingDto)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['trip'] })
  })

  it('after an update', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateBooking(), { wrapper: wrapperFor(client) })

    result.current.mutate({ id: 'booking-1', data: { bookingStatus: 'Confirmed' } as UpdateBookingDto })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['trip'] })
  })

  it('after a delete', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteBooking(), { wrapper: wrapperFor(client) })

    result.current.mutate('booking-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['trip'] })
  })
})
