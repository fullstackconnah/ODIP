import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PortalShiftDetailDto } from '../types'

const { mockApiGet, mockApiPost, mockApiPut, mockApiPostRaw, mockApiDeleteRaw } = vi.hoisted(() => ({
  mockApiGet: vi.fn(async (): Promise<unknown> => ({})),
  mockApiPost: vi.fn(async (): Promise<unknown> => ({})),
  mockApiPut: vi.fn(async (): Promise<unknown> => ({})),
  mockApiPostRaw: vi.fn(async () => ({ success: true, data: {} })),
  mockApiDeleteRaw: vi.fn(async (): Promise<unknown> => ({ success: true, data: {} })),
}))

vi.mock('../client', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
  apiPostRaw: mockApiPostRaw,
  apiDeleteRaw: mockApiDeleteRaw,
  apiDelete: vi.fn(),
  apiGetWithDefault: vi.fn(),
  apiPatch: vi.fn(),
}))

import {
  useStartBreak, useEndBreak, useEditBreak, useDeleteBreak, useAcknowledgeHandover, useRecordShiftDose, useFinishShift,
} from './portal'
import { useShiftCompletionReview, useApproveCompletion, useReturnCompletion, useApproveCompletionsBatch } from './rostering'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const detail = { id: 'shift-1', status: 'InProgress' } as unknown as PortalShiftDetailDto

beforeEach(() => {
  mockApiGet.mockClear().mockResolvedValue({})
  mockApiPost.mockClear().mockResolvedValue(detail)
  mockApiPut.mockClear().mockResolvedValue(detail)
  mockApiDeleteRaw.mockClear().mockResolvedValue({ success: true, data: detail })
})

describe('shift package hooks — breaks', () => {
  it('useStartBreak posts to /portal/shifts/{id}/breaks/start with no body, and replaces the cached shift detail', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['portal-shift-detail', 'shift-1'], { id: 'shift-1', status: 'InProgress', breaks: [] })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useStartBreak(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1' })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/breaks/start')
    // The cached shift is replaced by the response (structural sharing means equal, not necessarily identical).
    expect(qc.getQueryData(['portal-shift-detail', 'shift-1'])).toEqual(detail)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-shift-detail', 'shift-1'] })
  })

  it('useEndBreak posts to /portal/shifts/{id}/breaks/{breakId}/end', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useEndBreak(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1', breakId: 'brk-1' })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/breaks/brk-1/end')
    expect(qc.getQueryData(['portal-shift-detail', 'shift-1'])).toBe(detail)
  })

  it('useEditBreak puts the FULL body (both UTC instants) to /portal/shifts/{id}/breaks/{breakId}', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useEditBreak(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1', breakId: 'brk-1', data: { startedAt: '2026-09-13T01:00:00Z', endedAt: '2026-09-13T01:30:00Z' } })

    expect(mockApiPut).toHaveBeenCalledWith('/portal/shifts/shift-1/breaks/brk-1', { startedAt: '2026-09-13T01:00:00Z', endedAt: '2026-09-13T01:30:00Z' })
  })

  it('useEditBreak can keep a running break running with endedAt: null', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useEditBreak(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1', breakId: 'brk-1', data: { startedAt: '2026-09-13T01:00:00Z', endedAt: null } })

    expect(mockApiPut).toHaveBeenCalledWith('/portal/shifts/shift-1/breaks/brk-1', { startedAt: '2026-09-13T01:00:00Z', endedAt: null })
  })

  it('useDeleteBreak deletes /portal/shifts/{id}/breaks/{breakId} and caches the returned shift detail', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useDeleteBreak(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1', breakId: 'brk-1' })

    expect(mockApiDeleteRaw).toHaveBeenCalledWith('/portal/shifts/shift-1/breaks/brk-1')
    expect(qc.getQueryData(['portal-shift-detail', 'shift-1'])).toBe(detail)
  })

  it('a failed break call rejects and leaves the cached shift untouched', async () => {
    const qc = new QueryClient()
    const cached = { id: 'shift-1', breaks: [] }
    qc.setQueryData(['portal-shift-detail', 'shift-1'], cached)
    mockApiPost.mockRejectedValueOnce({ response: { status: 409, data: { success: false, code: 'SHIFT_BREAK_ALREADY_RUNNING' } } })
    const { result } = renderHook(() => useStartBreak(), { wrapper: wrapper(qc) })

    await expect(result.current.mutateAsync({ id: 'shift-1' })).rejects.toMatchObject({ response: { status: 409 } })

    expect(qc.getQueryData(['portal-shift-detail', 'shift-1'])).toBe(cached)
  })
})

describe('shift package hooks — handover', () => {
  it('useAcknowledgeHandover posts the completionId the worker saw to /portal/shifts/{id}/handover/ack', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useAcknowledgeHandover(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1', data: { completionId: 'sc-prev-1' } })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/handover/ack', { completionId: 'sc-prev-1' })
    expect(qc.getQueryData(['portal-shift-detail', 'shift-1'])).toBe(detail)
  })

  it('useAcknowledgeHandover sends an empty body when no completionId is given (acknowledge the latest)', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useAcknowledgeHandover(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ id: 'shift-1' })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/handover/ack', {})
  })
})

describe('shift package hooks — recording a dose from the shift', () => {
  it('useRecordShiftDose posts the FULL body to /portal/shifts/{id}/medications/{medicationId}/administrations and refreshes the caches', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    mockApiPost.mockResolvedValueOnce({ id: 'adm-1' })
    const { result } = renderHook(() => useRecordShiftDose(), { wrapper: wrapper(qc) })

    const body = {
      status: 'Administered' as const,
      scheduledAt: '2026-09-13T09:00:00',
      administeredAt: '2026-09-12T23:04:00.000Z',
      administeredAtTimeZone: 'Australia/Brisbane',
      doseGiven: '1 tablet',
      witnessStaffId: 'staff-2',
      acknowledgeLimitBreach: false,
      idempotencyKey: 'a2c6f1d0-0000-4000-8000-000000000001',
    }
    await result.current.mutateAsync({ shiftId: 'shift-1', medicationId: 'med-1', data: body })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/medications/med-1/administrations', body)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['portal-shift-detail', 'shift-1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['mar'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['participant-administrations'] })
  })

  it('"not given this shift" is a Missed record with its reason', async () => {
    const qc = new QueryClient()
    mockApiPost.mockResolvedValueOnce({ id: 'adm-2' })
    const { result } = renderHook(() => useRecordShiftDose(), { wrapper: wrapper(qc) })

    const body = { status: 'Missed' as const, scheduledAt: '2026-09-13T12:30:00', reason: 'Finished early; handed to the evening worker', acknowledgeLimitBreach: false, idempotencyKey: 'k-2' }
    await result.current.mutateAsync({ shiftId: 'shift-1', medicationId: 'med-2', data: body })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/medications/med-2/administrations', body)
  })

  it('a PRN dose omits scheduledAt', async () => {
    const qc = new QueryClient()
    mockApiPost.mockResolvedValueOnce({ id: 'adm-3' })
    const { result } = renderHook(() => useRecordShiftDose(), { wrapper: wrapper(qc) })

    const body = { status: 'Administered' as const, prnReason: 'Headache', acknowledgeLimitBreach: false, idempotencyKey: 'k-3' }
    await result.current.mutateAsync({ shiftId: 'shift-1', medicationId: 'med-3', data: body })

    const sent = (mockApiPost.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>
    expect('scheduledAt' in sent).toBe(false)
    expect(sent).toEqual(body)
  })
})

describe('shift package hooks — Finish carries the handover and the confirmations', () => {
  it('useFinishShift posts the handover text, nothingToHandOver and nothingToNote to /portal/shifts/{id}/finish', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useFinishShift(), { wrapper: wrapper(qc) })

    const data = { geolocationDeclined: false, handoverText: 'Check the left heel.', nothingToHandOver: false, nothingToNote: true }
    await result.current.mutateAsync({ id: 'shift-1', data })

    expect(mockApiPost).toHaveBeenCalledWith('/portal/shifts/shift-1/finish', data)
  })
})

describe('coordinator completion review', () => {
  it('useShiftCompletionReview reads GET /rostering/shifts/{id}/completion/review', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useShiftCompletionReview('shift-1'), { wrapper: wrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockApiGet).toHaveBeenCalledWith('/rostering/shifts/shift-1/completion/review')
  })

  it('useShiftCompletionReview does not fetch without a shift id', () => {
    const qc = new QueryClient()
    renderHook(() => useShiftCompletionReview(undefined), { wrapper: wrapper(qc) })

    expect(mockApiGet).not.toHaveBeenCalled()
  })

  // The review has its own cache key, which ['rostering-completion', id] does NOT prefix-match: without these the review page would keep
  // showing the pre-decision completion after Approve / Return.
  it('Approve refreshes the open review for that shift', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApproveCompletion(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync('shift-1')

    expect(mockApiPost).toHaveBeenCalledWith('/rostering/shifts/shift-1/completion/approve')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['rostering-completion-review', 'shift-1'] })
  })

  it('Return posts the reason and refreshes the open review for that shift', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useReturnCompletion(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync({ shiftId: 'shift-1', data: { reason: 'Please add the 12:30 dose.' } })

    expect(mockApiPost).toHaveBeenCalledWith('/rostering/shifts/shift-1/completion/return', { reason: 'Please add the 12:30 dose.' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['rostering-completion-review', 'shift-1'] })
  })

  it('Approve-batch refreshes every open review', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useApproveCompletionsBatch(), { wrapper: wrapper(qc) })

    await result.current.mutateAsync(['shift-1', 'shift-2'])

    expect(mockApiPost).toHaveBeenCalledWith('/rostering/completions/approve-batch', { shiftIds: ['shift-1', 'shift-2'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['rostering-completion-review'] })
  })
})
