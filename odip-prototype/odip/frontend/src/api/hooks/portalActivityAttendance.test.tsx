import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useSetActivityAttendance } from '@/api/hooks/portal'

// The worker's attendance mark must refresh every screen that shows the activity, on a refusal as well as on success.
// The REAL hook runs on a REAL QueryClient; only the transport (the axios adapter) is replaced.

const originalAdapter = apiClient.defaults.adapter
let sent: { method?: string; url?: string; data?: string }[] = []
let status = 200

beforeEach(() => {
  sent = []
  status = 200
  const adapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
    sent.push({ method: config.method, url: config.url, data: config.data })
    const response = { data: status === 200 ? { success: true, data: { id: 'row-1' } } : { success: false, data: null, errors: ['Nope.'] }, status, statusText: '', headers: {}, config } as AxiosResponse
    if (status !== 200) throw Object.assign(new Error('refused'), { isAxiosError: true, response, config })
    return response
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

const KEYS = [['portal-my-shifts'], ['group-activity'], ['group-activities'], ['roster-board'], ['rostering-group-staff-reviews']]

async function markAndCollectKeys() {
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useSetActivityAttendance(), { wrapper })
  result.current.mutate({ id: 'row-1', participantId: 'p-1', attended: false })
  await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
  return spy.mock.calls.map(([filters]) => filters?.queryKey)
}

describe('useSetActivityAttendance', () => {
  it('posts the participant and the attended flag to the row, then refreshes the five lists', async () => {
    const keys = await markAndCollectKeys()
    expect(sent).toHaveLength(1)
    expect(sent[0].method).toBe('post')
    expect(sent[0].url).toBe('/portal/activity-staff/row-1/attendance')
    expect(JSON.parse(sent[0].data!)).toEqual({ participantId: 'p-1', attended: false })
    expect(keys).toEqual(KEYS)
  })

  it('refreshes the same five lists when the server refuses with a 409', async () => {
    status = 409
    expect(await markAndCollectKeys()).toEqual(KEYS)
  })
})
