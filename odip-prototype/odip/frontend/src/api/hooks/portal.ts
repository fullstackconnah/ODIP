import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { PortalShiftsResponseDto, PortalShiftDetailDto } from '../types'

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
