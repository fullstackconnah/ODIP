import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPostRaw, apiPut } from '../client'
import type { PortalShiftsResponseDto, PortalShiftDetailDto, PortalWitnessRequestDto, ShiftNoteDto } from '../types'

export function useMyShifts(from?: string, to?: string) {
  return useQuery({
    queryKey: ['portal-my-shifts', from, to],
    queryFn: () => apiGet<PortalShiftsResponseDto>('/portal/my-shifts', { from, to }),
  })
}

export function usePortalShiftDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['portal-shift-detail', id],
    queryFn: () => apiGet<PortalShiftDetailDto>(`/portal/shifts/${id}`),
    enabled: !!id,
  })
}

// ══════════════════════════════════════════════════════════════
// SHIFT NOTES (NOTES-01)
// ══════════════════════════════════════════════════════════════

export function useShiftNotes(shiftId: string | undefined) {
  return useQuery({
    queryKey: ['portal-shift-notes', shiftId],
    queryFn: () => apiGet<ShiftNoteDto[]>(`/portal/shifts/${shiftId}/notes`),
    enabled: !!shiftId,
  })
}

export function useCreateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => apiPost<ShiftNoteDto>(`/portal/shifts/${shiftId}/notes`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

export function useUpdateShiftNote(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => apiPut<ShiftNoteDto>(`/portal/notes/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

/** NOTES-02: dismisses the "file an incident report?" prompt on one flagged note — persisted server-side. */
export function useAcknowledgeShiftNoteFlags(shiftId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<ShiftNoteDto>(`/portal/notes/${id}/acknowledge-flags`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-shift-notes', shiftId] }),
  })
}

// Shared by the sidebar nav badge and the witness approvals page — same queryKey means both
// read from (and refresh) the same cached list rather than issuing separate requests.
// A 60s poll keeps the badge from going stale while someone's on another page.
export function usePendingWitnessRequests() {
  return useQuery({
    queryKey: ['portal-witness-requests'],
    queryFn: () => apiGet<PortalWitnessRequestDto[]>('/portal/witness-requests'),
    refetchInterval: 60_000,
  })
}

export function useApproveWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<PortalWitnessRequestDto>(`/portal/witness-requests/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}

export function useDeclineWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<PortalWitnessRequestDto>(`/portal/witness-requests/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}

// IN-7: incident-side counterparts — a different table, and an optional witness statement the
// medication flow has no equivalent for.
export function useApproveIncidentWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statementText }: { id: string; statementText?: string }) =>
      apiPostRaw<PortalWitnessRequestDto>(`/portal/incident-witness-requests/${id}/approve`, { statementText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}

export function useDeclineIncidentWitnessRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statementText }: { id: string; statementText?: string }) =>
      apiPostRaw<PortalWitnessRequestDto>(`/portal/incident-witness-requests/${id}/decline`, { statementText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-witness-requests'] }),
  })
}
