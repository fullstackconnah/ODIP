import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw } from '../client'
import type { PortalShiftsResponseDto, PortalShiftDetailDto, PortalWitnessRequestDto } from '../types'

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
