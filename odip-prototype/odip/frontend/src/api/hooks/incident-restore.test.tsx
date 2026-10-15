import type { AxiosAdapter, AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from '@/api/client'
import { useRestoreIncident } from '@/api/hooks/incidents'

// Restoring an archived incident is an update, and UpdateIncident replaces the whole record. The list row it used to send has no Description (the server requires
// one, so the restore was refused), and had it passed, no injuries or witnesses either. The REAL hook runs; only the transport (the axios adapter) is replaced.

const originalAdapter = apiClient.defaults.adapter
let sent: Array<{ method?: string; url?: string; body?: unknown }>

const stored = {
  id: 'inc-1', serviceType: 'None', incidentType: 'Injury', severity: 'Low', status: 'Closed', title: 'Slip in kitchen', incidentDateTime: '2026-08-01T09:30:00',
  reportedByStaffId: 'staff-1', description: 'Slipped on a wet floor.', wereEmergencyServicesCalled: false, qscReportingStatus: 'NotRequired', familyNotified: false, supportCoordinatorNotified: false,
  injuries: [{ id: 'inj-1', region: 'Knee', injuryType: 'Bruise', description: 'Bruised knee' }],
  witnesses: [{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Pat Lee', witnessStatus: 'Approved' }],
}

beforeEach(() => {
  sent = []
  const adapter: AxiosAdapter = async (config): Promise<AxiosResponse> => {
    sent.push({ method: config.method, url: config.url, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data })
    return { data: { success: true, data: stored }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useRestoreIncident', () => {
  it('reads the stored incident and puts it back with only the status changed, keeping the description, injuries and witnesses', async () => {
    const { result } = renderHook(() => useRestoreIncident(), { wrapper: wrapperFor(new QueryClient()) })

    result.current.mutate({ id: 'inc-1', data: { status: 'Draft' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sent.map(r => `${r.method} ${r.url}`)).toEqual(['get /incidents/inc-1', 'put /incidents/inc-1'])
    expect(sent[1].body).toMatchObject({
      status: 'Draft', description: 'Slipped on a wet floor.', title: 'Slip in kitchen', reportedByStaffId: 'staff-1',
      injuries: [{ region: 'Knee', injuryType: 'Bruise', description: 'Bruised knee' }],
      witnesses: [{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Pat Lee' }],
    })
  })

  it('refreshes the incident lists, the incident and the dashboard', async () => {
    const client = new QueryClient()
    const invalidated: unknown[] = []
    client.invalidateQueries = (async (filters?: { queryKey?: unknown }) => { invalidated.push(filters?.queryKey) }) as typeof client.invalidateQueries
    const { result } = renderHook(() => useRestoreIncident(), { wrapper: wrapperFor(client) })

    result.current.mutate({ id: 'inc-1', data: { status: 'Draft' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidated).toEqual(expect.arrayContaining([['incidents'], ['incident', 'inc-1'], ['dashboard']]))
  })
})
