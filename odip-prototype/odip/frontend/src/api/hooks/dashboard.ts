import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { DashboardSummaryDto } from '../types'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardSummaryDto>('/dashboard/summary'),
  })
}
