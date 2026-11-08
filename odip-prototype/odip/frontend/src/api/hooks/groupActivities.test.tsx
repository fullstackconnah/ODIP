import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiPost, mockApiPut, mockApiDelete } = vi.hoisted(() => ({ mockApiPost: vi.fn(), mockApiPut: vi.fn(), mockApiDelete: vi.fn() }))

vi.mock('../client', () => ({ apiGet: vi.fn(), apiPost: mockApiPost, apiPut: mockApiPut, apiDelete: mockApiDelete }))

import { useAddGroupParticipant, useAddGroupStaff, useCancelGroupActivity, useCreateGroupActivity, useDetachShift, useRemoveGroupStaff, useSetGroupRatio, useUpdateGroupActivity } from './groupActivities'

const wrapper = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
const keysInvalidated = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(c => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey)

const form = { serviceDate: '2026-08-17', startTime: '10:00', endTime: '14:00', endsNextDay: false, title: 'Bowling', activityId: null, location: null, serviceLocationId: null, notes: null, minStaffRequired: null }

beforeEach(() => { mockApiPost.mockReset().mockResolvedValue({}); mockApiPut.mockReset().mockResolvedValue({}); mockApiDelete.mockReset().mockResolvedValue(undefined) })

describe('group activity writes (PR2): each one refetches the board and the activity', () => {
  const cases: [string, () => { mutateAsync: (v: never) => Promise<unknown> }, unknown, () => void][] = [
    ['create', () => useCreateGroupActivity(), form, () => expect(mockApiPost).toHaveBeenCalledWith('/rostering/group-activities', form)],
    ['update sends the status with the form', () => useUpdateGroupActivity(), { id: 'a1', data: form, status: 'Published' }, () => expect(mockApiPut).toHaveBeenCalledWith('/rostering/group-activities/a1', { ...form, status: 'Published' })],
    ['cancel', () => useCancelGroupActivity(), 'a1', () => expect(mockApiPost).toHaveBeenCalledWith('/rostering/group-activities/a1/cancel', {})],
    ['detach a shift', () => useDetachShift(), { id: 'a1', shiftId: 's1' }, () => expect(mockApiDelete).toHaveBeenCalledWith('/rostering/group-activities/a1/shifts/s1')],
    ['add a participant', () => useAddGroupParticipant(), { id: 'a1', participantId: 'p1', ratio: 'OneToOne' }, () => expect(mockApiPost).toHaveBeenCalledWith('/rostering/group-activities/a1/participants', { participantId: 'p1', ratio: 'OneToOne' })],
    ['set a ratio', () => useSetGroupRatio(), { id: 'a1', participantId: 'p1', ratio: 'TwoToOne' }, () => expect(mockApiPut).toHaveBeenCalledWith('/rostering/group-activities/a1/participants/p1/ratio', { ratio: 'TwoToOne' })],
    ['add staff', () => useAddGroupStaff(), { id: 'a1', data: { staffId: 'st1' } }, () => expect(mockApiPost).toHaveBeenCalledWith('/rostering/group-activities/a1/staff', { staffId: 'st1' })],
    ['remove staff', () => useRemoveGroupStaff(), { id: 'a1', rowId: 'r1' }, () => expect(mockApiDelete).toHaveBeenCalledWith('/rostering/group-activities/a1/staff/r1')],
  ]
  it.each(cases)('%s', async (_name, useHook, vars, expectCall) => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(useHook, { wrapper: wrapper(qc) })
    await result.current.mutateAsync(vars as never)
    expectCall()
    expect(keysInvalidated(spy)).toEqual(expect.arrayContaining([['roster-board'], ['group-activity']]))
  })

  it('refetches after a refusal too, so the board never keeps a stale card', async () => {
    mockApiPost.mockRejectedValue({ response: { status: 409 } })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useAddGroupStaff(), { wrapper: wrapper(qc) })
    await expect(result.current.mutateAsync({ id: 'a1', data: { staffId: 'st1' } })).rejects.toBeTruthy()
    expect(keysInvalidated(spy)).toContainEqual(['roster-board'])
  })
})
