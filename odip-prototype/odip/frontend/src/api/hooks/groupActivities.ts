import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost, apiPut } from '../client'
import type { AddGroupStaffDto, GroupActivityDto, GroupActivityFormDto, GroupActivityScope, PagedResult, ShiftStatus, SupportRatio } from '../types'

const BASE = '/rostering/group-activities'

/** One activity, for the modal. Every write below refetches the board and this activity, so the card and the modal show the server's truth (no optimistic writes). */
export function useGroupActivity(id: string | null) {
  return useQuery({ queryKey: ['group-activity', id], queryFn: () => apiGet<GroupActivityDto>(`${BASE}/${id}`), enabled: Boolean(id) })
}

/** One page of the list page: activities dated in [from, to] (at most 93 days), every status unless one is given. Cancelled ones are in it. */
export function useGroupActivities(filters: { from: string; to: string; status?: ShiftStatus }, page: number, pageSize: number, enabled = true) {
  return useQuery({ queryKey: ['group-activities', filters, page, pageSize], queryFn: () => apiGet<PagedResult<GroupActivityDto>>(BASE, { ...filters, page, pageSize }), enabled })
}

function useActivityWrite<V, R = unknown>(send: (v: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: send,
    // onSettled: a refused write refetches too, so the board never keeps a stale card.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['roster-board'] }), qc.invalidateQueries({ queryKey: ['group-activity'] }), qc.invalidateQueries({ queryKey: ['group-activities'] })]),
  })
}

export const useCreateGroupActivity = () => useActivityWrite((data: GroupActivityFormDto) => apiPost<GroupActivityDto>(BASE, data))
export const useCreateActivityFromShift = () => useActivityWrite(({ shiftId, title }: { shiftId: string; title?: string }) => apiPost<GroupActivityDto>(`${BASE}/from-shift/${shiftId}`, { title }))
export const useUpdateGroupActivity = () => useActivityWrite(({ id, data, status, scope }: { id: string; data: GroupActivityFormDto; status: ShiftStatus; scope?: GroupActivityScope }) => apiPut<GroupActivityDto>(`${BASE}/${id}`, { ...data, status, ...(scope && { scope }) }))
export const useCancelGroupActivity = () => useActivityWrite(({ id, scope }: { id: string; scope?: GroupActivityScope }) => apiPost<GroupActivityDto>(`${BASE}/${id}/cancel`, scope ? { scope } : {}))
export const useAttachShifts = () => useActivityWrite(({ id, shiftIds }: { id: string; shiftIds: string[] }) => apiPost<GroupActivityDto>(`${BASE}/${id}/shifts`, { shiftIds }))
export const useDetachShift = () => useActivityWrite(({ id, shiftId }: { id: string; shiftId: string }) => apiDelete(`${BASE}/${id}/shifts/${shiftId}`))
export const useAddGroupParticipant = () => useActivityWrite(({ id, participantId, ratio }: { id: string; participantId: string; ratio: SupportRatio }) => apiPost<GroupActivityDto>(`${BASE}/${id}/participants`, { participantId, ratio }))
export const useSetGroupRatio = () => useActivityWrite(({ id, participantId, ratio }: { id: string; participantId: string; ratio: SupportRatio }) => apiPut<GroupActivityDto>(`${BASE}/${id}/participants/${participantId}/ratio`, { ratio }))
export const useAddGroupStaff = () => useActivityWrite(({ id, data }: { id: string; data: AddGroupStaffDto }) => apiPost<GroupActivityDto>(`${BASE}/${id}/staff`, data))
export const useRemoveGroupStaff = () => useActivityWrite(({ id, rowId }: { id: string; rowId: string }) => apiDelete(`${BASE}/${id}/staff/${rowId}`))
/** Marks a participant as not coming (`attended: false`, which cancels their shift) or undoes it. Only while the activity is in progress. */
export const useSetGroupAttendance = () => useActivityWrite(({ id, participantId, attended }: { id: string; participantId: string; attended: boolean }) => apiPost<GroupActivityDto>(`${BASE}/${id}/participants/${participantId}/attendance`, { attended }))
