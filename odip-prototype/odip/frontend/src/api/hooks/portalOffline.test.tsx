import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PortalShiftDetailDto } from '../types'

const { mockApiGet, mockApiPost, mockRequest } = vi.hoisted(() => ({
  mockApiGet: vi.fn(async (): Promise<unknown> => ({})),
  mockApiPost: vi.fn(async (): Promise<unknown> => ({})),
  mockRequest: vi.fn(async (): Promise<unknown> => ({ data: { data: {} } })),
}))

vi.mock('../client', () => ({
  apiClient: { request: mockRequest, get: vi.fn() },
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: vi.fn(),
  apiPostRaw: vi.fn(),
  apiDeleteRaw: vi.fn(),
  apiDelete: vi.fn(),
  apiGetWithDefault: vi.fn(),
  apiPatch: vi.fn(),
}))

import { useCreateShiftNote, useMyShifts, usePortalShiftDetail, useRecordShiftDose, useStartShift } from './portal'
import { offlineQueue } from '@/lib/offline/queue'
import { readSaved, writeSaved } from '@/lib/offline/store'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const detail = { id: 's1', status: 'Published', serviceDate: '2026-10-28', startTime: '09:00:00', endTime: '13:00:00', timeZoneId: 'Australia/Sydney', participant: { fullName: 'Jordan Smith' }, shiftRoutines: [], breaks: [], finishBlockers: [], handover: null } as unknown as PortalShiftDetailDto
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

let online: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
  mockApiGet.mockReset()
  mockApiPost.mockReset()
  mockRequest.mockReset().mockResolvedValue({ data: { data: detail } })
  online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => online.mockRestore())

describe('offline-aware portal hooks', () => {
  it('online: reads the server and saves a copy on this phone', async () => {
    mockApiGet.mockResolvedValue(detail)
    const { result } = renderHook(() => usePortalShiftDetail('s1'), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(mockApiGet).toHaveBeenCalledWith('/portal/shifts/s1')
    expect(readSaved('u1', 'detail:s1')?.data).toEqual(detail)
  })

  it('offline with a saved copy: renders it without asking the server', async () => {
    writeSaved('u1', 'detail:s1', detail)
    online.mockReturnValue(false)
    const { result } = renderHook(() => usePortalShiftDetail('s1'), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(result.current.data?.id).toBe('s1'))
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it('cold start with no signal: My shifts renders the week saved on the phone and never asks the server', async () => {
    const week = { shifts: [{ id: 's1', participantName: 'Jordan Smith', serviceDate: '2026-10-28', startTime: '09:00:00', endTime: '13:00:00', status: 'Published' }], tripAssignments: [], timeZoneId: 'Australia/Sydney' }
    writeSaved('u1', 'shifts:2026-10-26:2026-11-01', week)
    online.mockReturnValue(false)
    const { result } = renderHook(() => useMyShifts('2026-10-26', '2026-11-01'), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(result.current.data?.shifts[0].id).toBe('s1'))
    // Today's details are prefetched (and fail quietly offline); the week itself is never asked for.
    expect(mockApiGet).not.toHaveBeenCalledWith('/portal/my-shifts', expect.anything())
  })

  it('a dropped connection (no response) falls back to the saved copy; a server refusal does not', async () => {
    writeSaved('u1', 'detail:s1', detail)
    mockApiGet.mockRejectedValue(new Error('Network Error'))
    const a = renderHook(() => usePortalShiftDetail('s1'), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(a.result.current.isFetching).toBe(false))
    expect(a.result.current.data?.id).toBe('s1')
    expect(a.result.current.isError).toBe(false)

    mockApiGet.mockRejectedValue({ response: { status: 404 } })
    const b = renderHook(() => usePortalShiftDetail('s1'), { wrapper: wrapper(newClient()) })
    await waitFor(() => expect(b.result.current.isError).toBe(true))
  })

  it('offline Start is queued with the full body, not sent, and does not refresh anything', async () => {
    online.mockReturnValue(false)
    const qc = newClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useStartShift(), { wrapper: wrapper(qc) })
    const out = await result.current.mutateAsync({ id: 's1', data: { geolocationDeclined: true } })
    expect(out).toBeUndefined()
    expect(mockRequest).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
    expect(offlineQueue.getSnapshot()).toMatchObject([{ kind: 'start', shiftId: 's1', path: '/portal/shifts/s1/start', method: 'POST', body: { geolocationDeclined: true }, clientTimeField: 'startedAt', status: 'waiting' }])
  })

  it('the queued Start reads as In progress on the shift detail', async () => {
    writeSaved('u1', 'detail:s1', detail)
    online.mockReturnValue(false)
    const qc = newClient()
    const view = renderHook(() => usePortalShiftDetail('s1'), { wrapper: wrapper(qc) })
    const start = renderHook(() => useStartShift(), { wrapper: wrapper(qc) })
    await waitFor(() => expect(view.result.current.data?.status).toBe('Published'))
    await start.result.current.mutateAsync({ id: 's1', data: { geolocationDeclined: false } })
    await waitFor(() => expect(view.result.current.data?.status).toBe('InProgress'))
  })

  it('a queued note carries its id and createdAt on the record, and the label survives', async () => {
    online.mockReturnValue(false)
    const qc = newClient()
    qc.setQueryData(['portal-shift-detail', 's1'], detail)
    const { result } = renderHook(() => useCreateShiftNote('s1'), { wrapper: wrapper(qc) })
    await result.current.mutateAsync('Settled well')
    const [rec] = offlineQueue.getSnapshot()
    expect(rec.body).toEqual({ id: rec.id, createdAt: expect.any(String), body: 'Settled well' })
    expect(rec.label).toEqual({ participant: 'Jordan Smith', serviceDate: '2026-10-28', rostered: '9:00 am – 1:00 pm' })
  })

  it('recording a dose with no connection fails and is not queued', async () => {
    online.mockReturnValue(false)
    mockApiPost.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(() => useRecordShiftDose(), { wrapper: wrapper(newClient()) })
    await expect(result.current.mutateAsync({ shiftId: 's1', medicationId: 'm1', data: { status: 'Administered' } as never })).rejects.toThrow('Network Error')
    expect(offlineQueue.getSnapshot()).toEqual([])
  })
})
