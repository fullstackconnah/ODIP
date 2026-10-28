import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from '@/api/client'
import { useDeleteRestrictivePractice, useUpdateRestrictivePractice } from '@/api/hooks/restrictive-practices'
import type { RestrictivePracticeDto } from '@/api/types'

// A reopen right after a save must send the version the server just wrote, so the saved row goes into the cached list before any refetch.
// The REAL hook runs on a REAL QueryClient; only the transport is replaced, as in activities-refresh.test.tsx.

const originalAdapter = apiClient.defaults.adapter
const row = (updatedAt: string) => ({ id: 'rp-1', participantId: 'p1', description: 'Original', updatedAt }) as RestrictivePracticeDto

beforeEach(() => {
  apiClient.defaults.adapter = (async (config): Promise<AxiosResponse> =>
    ({ data: { success: true, data: row('2026-02-02T00:00:00.123456Z') }, status: 200, statusText: 'OK', headers: {}, config })) as AxiosAdapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

describe('a restrictive practice save updates the cached list', () => {
  it('with the row the server returned, before any refetch', async () => {
    const client = new QueryClient()
    client.setQueryData(['restrictive-practices', 'p1', false], [row('2026-01-01T00:00:00Z')])
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useUpdateRestrictivePractice(), { wrapper })

    result.current.mutate({ id: 'rp-1', data: { description: 'Edited', isActive: true } as never })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = client.getQueryData<RestrictivePracticeDto[]>(['restrictive-practices', 'p1', false])!
    expect(cached[0].updatedAt).toBe('2026-02-02T00:00:00.123456Z')
  })
})

describe('a restrictive practice delete', () => {
  it('sends the version the user saw, encoded, in the query string', async () => {
    const urls: (string | undefined)[] = []
    apiClient.defaults.adapter = (async (config): Promise<AxiosResponse> => {
      urls.push(config.url)
      return { data: { success: true, data: true }, status: 200, statusText: 'OK', headers: {}, config }
    }) as AxiosAdapter
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useDeleteRestrictivePractice(), { wrapper })

    result.current.mutate({ id: 'rp-1', participantId: 'p1', expectedUpdatedAt: '2026-02-02T00:00:00.123456+00:00' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(urls).toEqual(['/participants/restrictive-practices/rp-1?expectedUpdatedAt=2026-02-02T00%3A00%3A00.123456%2B00%3A00'])
  })
})
