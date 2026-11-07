import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from '@/api/client'
import { useMyLeave, useCancelMyLeave, useCancelMyUnavailability } from '@/api/hooks/leave'

// A withdraw the server refuses (409: already decided) must still refetch the Portal list, or the row keeps a live Withdraw button until reload.
// The REAL hooks run on a REAL QueryClient; only the transport (the axios adapter) is replaced, as in activities-refresh.test.tsx.

const originalAdapter = apiClient.defaults.adapter
let listFetches = 0

beforeEach(() => {
  listFetches = 0
  const adapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
    if (config.method === 'get') {
      listFetches++
      return { data: { success: true, data: { leave: [], unavailability: [] } }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
    }
    const response = { data: { success: false, message: 'Only pending requests can be withdrawn.' }, status: 409, statusText: 'Conflict', headers: {}, config } as AxiosResponse
    throw Object.assign(new Error('Request failed with status code 409'), { isAxiosError: true, config, response })
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('a refused withdraw still refetches the Portal leave list', () => {
  it('for a leave request', async () => {
    const { result } = renderHook(() => ({ list: useMyLeave(), cancel: useCancelMyLeave() }), { wrapper: wrapperFor(new QueryClient()) })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    expect(listFetches).toBe(1)

    result.current.cancel.mutate('leave-1')

    await waitFor(() => expect(result.current.cancel.isError).toBe(true))
    await waitFor(() => expect(listFetches).toBe(2))
  })

  it('for a regular unavailability rule', async () => {
    const { result } = renderHook(() => ({ list: useMyLeave(), cancel: useCancelMyUnavailability() }), { wrapper: wrapperFor(new QueryClient()) })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    expect(listFetches).toBe(1)

    result.current.cancel.mutate('rule-1')

    await waitFor(() => expect(result.current.cancel.isError).toBe(true))
    await waitFor(() => expect(listFetches).toBe(2))
  })
})
