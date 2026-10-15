import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDeleteContactRole, useUpdateContactRole } from '@/api/hooks/contact-roles'
import { useDeleteStaff, useUpdateStaff } from '@/api/hooks/staff'
import type { UpdateParticipantContactRoleDto, UpdateStaffDto } from '@/api/types'

// Two screens read data that a write changes but the write's hook did not refresh, so they kept the old figure for up to 30 s (the default staleTime):
//  - the participant record carries the server-worked "no active Plan Manager" warning, which depends on the contact roles; creating a role refreshed it, updating or deleting one did not;
//  - the staff page reads ['staff-overview', id], which the ['staff'] refresh does not reach (a different first key part), so it showed the old qualification date.
// The REAL hooks run on a REAL QueryClient; only the transport (the axios adapter) is replaced, as in shift-writes-refresh-tasks.test.tsx.

const originalAdapter = apiClient.defaults.adapter

beforeEach(() => {
  const adapter: AxiosAdapter = async (): Promise<AxiosResponse> =>
    ({ data: { success: true, data: { id: 'role-1', participantId: 'participant-1' } }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } }) as AxiosResponse
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('a contact role write refreshes the participant record', () => {
  it('after an update', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateContactRole(), { wrapper: wrapperFor(client) })

    result.current.mutate({ id: 'role-1', data: {} as UpdateParticipantContactRoleDto })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant', 'participant-1'] })
  })

  it('after a delete', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteContactRole(), { wrapper: wrapperFor(client) })

    result.current.mutate({ id: 'role-1', participantId: 'participant-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant', 'participant-1'] })
  })
})

describe('a staff write refreshes the staff overview', () => {
  it('after an update', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateStaff(), { wrapper: wrapperFor(client) })

    result.current.mutate({ id: 'staff-1', data: {} as UpdateStaffDto })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['staff-overview', 'staff-1'] })
  })

  it('after a delete', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteStaff(), { wrapper: wrapperFor(client) })

    result.current.mutate('staff-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['staff-overview', 'staff-1'] })
  })
})
