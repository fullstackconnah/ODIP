import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { DashboardSummaryDto, StaffDashboardDto } from '../types'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardSummaryDto>('/dashboard/summary'),
  })
}

export function useMyDashboard() {
  return useQuery({
    queryKey: ['my-dashboard'],
    queryFn: () => apiGet<StaffDashboardDto>('/staff/me/dashboard'),
  })
}
