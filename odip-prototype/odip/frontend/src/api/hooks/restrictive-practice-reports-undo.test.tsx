import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useUndoRpReport } from '@/api/hooks/restrictive-practice-reports'

// Undoing a report someone else already undid answers 404; the worklist must refetch so the line stops showing Lodged.
// The REAL hook runs on a REAL QueryClient; only the transport is replaced, as in activities-refresh.test.tsx.

const originalAdapter = apiClient.defaults.adapter
let failure: { status: number } | null = null

beforeEach(() => {
  failure = null
  const adapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
    if (failure) throw Object.assign(new Error('failed'), { response: { status: failure.status, data: { success: false, errors: ['Monthly report not found'] } }, config })
    return { data: { success: true, data: true }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => { apiClient.defaults.adapter = originalAdapter })

function run() {
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useUndoRpReport(), { wrapper })
  return { result, keys: () => spy.mock.calls.map(c => (c[0] as { queryKey: string[] }).queryKey[0]) }
}

describe('useUndoRpReport', () => {
  it('refetches the worklist when the report was already gone (404)', async () => {
    failure = { status: 404 }
    const { result, keys } = run()
    await expect(result.current.mutateAsync('rep-1')).rejects.toBeTruthy()
    await waitFor(() => expect(keys()).toEqual(['rp-report-lines', 'dashboard', 'participant-alerts', 'participant-alerts-aggregate']))
  })

  it('leaves the cache alone on other failures', async () => {
    failure = { status: 500 }
    const { result, keys } = run()
    await expect(result.current.mutateAsync('rep-1')).rejects.toBeTruthy()
    expect(keys()).toEqual([])
  })
})
