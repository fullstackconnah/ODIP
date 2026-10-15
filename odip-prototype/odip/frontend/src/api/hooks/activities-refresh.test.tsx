import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from '@/api/client'
import { useActivities, useCreateActivity, useUpdateActivity } from '@/api/hooks/activities'

// The Activity Library list must refetch after a save, or it shows the old row until the cache goes stale.
// The REAL hooks run on a REAL QueryClient; only the transport (the axios adapter) is replaced, as in contact-staff-refresh.test.tsx.

const originalAdapter = apiClient.defaults.adapter
let listFetches = 0

beforeEach(() => {
  listFetches = 0
  const adapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
    if (config.method === 'get' && config.url?.endsWith('/activities')) listFetches++
    return { data: { success: true, data: config.method === 'get' ? [] : { id: 'a1' } }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('an activity save refetches the Activity Library list', () => {
  it('after an update', async () => {
    const { result } = renderHook(() => ({ list: useActivities(), save: useUpdateActivity() }), { wrapper: wrapperFor(new QueryClient()) })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    expect(listFetches).toBe(1)

    result.current.save.mutate({ id: 'a1', data: { activityName: 'Kayak', category: 'Sport' } })

    await waitFor(() => expect(result.current.save.isSuccess).toBe(true))
    await waitFor(() => expect(listFetches).toBe(2))
  })

  it('after a create', async () => {
    const { result } = renderHook(() => ({ list: useActivities(), save: useCreateActivity() }), { wrapper: wrapperFor(new QueryClient()) })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    expect(listFetches).toBe(1)

    result.current.save.mutate({ activityName: 'Kayak', category: 'Sport' })

    await waitFor(() => expect(result.current.save.isSuccess).toBe(true))
    await waitFor(() => expect(listFetches).toBe(2))
  })
})
