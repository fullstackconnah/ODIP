import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiGet, mockApiPostRaw, mockApiPutRaw, mockApiDeleteRaw } = vi.hoisted(() => ({
  mockApiGet: vi.fn(async () => []),
  mockApiPostRaw: vi.fn(async () => ({ success: true, data: { id: 'inc-1' } })),
  mockApiPutRaw: vi.fn(async () => ({ success: true, data: { id: 'inc-1' } })),
  mockApiDeleteRaw: vi.fn(async () => ({ success: true, data: true })),
}))

vi.mock('../client', () => ({
  apiGet: mockApiGet,
  apiPostRaw: mockApiPostRaw,
  apiPutRaw: mockApiPutRaw,
  apiDeleteRaw: mockApiDeleteRaw,
}))

import { useCreateIncident, useUpdateIncident, useDeleteIncident } from './incidents'
import type { CreateIncidentDto, UpdateIncidentDto } from '../types'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockApiGet.mockClear()
  mockApiPostRaw.mockClear()
  mockApiPutRaw.mockClear()
  mockApiDeleteRaw.mockClear()
})

const minimalCreateDto = {} as CreateIncidentDto
const minimalUpdateDto = {} as UpdateIncidentDto

// Connection map seam follow-up: filing an incident is a hand-off target from the flagged-notes
// queue (IncidentsPage) AND from MAR/administration-history "File incident" actions (MarTab,
// participant-detail/MedicationsTab) — a successful create must refresh all three surfaces'
// "already filed" state without a manual page refresh.
describe('useCreateIncident — connection map cache invalidation', () => {
  it('invalidates incidents, dashboard, flagged-shift-notes, mar and participant-administrations on success', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateIncident(), { wrapper: wrapper(qc) })

    result.current.mutate(minimalCreateDto)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const invalidatedKeys = spy.mock.calls.map((call) => call[0]?.queryKey?.[0])
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining(['incidents', 'dashboard', 'flagged-shift-notes', 'mar', 'participant-administrations']),
    )
  })
})

describe('useUpdateIncident / useDeleteIncident — unaffected by the connection-map follow-up', () => {
  it('useUpdateIncident still invalidates incidents/incident/dashboard only', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateIncident(), { wrapper: wrapper(qc) })

    result.current.mutate({ id: 'inc-1', data: minimalUpdateDto })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const invalidatedKeys = spy.mock.calls.map((call) => call[0]?.queryKey?.[0])
    expect(invalidatedKeys).toEqual(['incidents', 'incident', 'dashboard'])
  })

  it('useDeleteIncident still invalidates incidents/dashboard only', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteIncident(), { wrapper: wrapper(qc) })

    result.current.mutate('inc-1')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const invalidatedKeys = spy.mock.calls.map((call) => call[0]?.queryKey?.[0])
    expect(invalidatedKeys).toEqual(['incidents', 'dashboard'])
  })
})
