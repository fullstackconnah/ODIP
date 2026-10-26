import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { DashboardSummaryDto, SetupStatusDto } from '../types'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardSummaryDto>('/dashboard/summary'),
  })
}

/** The setup card's figures. The app default stale time is 30 s and the card's own actions invalidate nothing under ['dashboard'], so it refetches on every mount. */
export function useSetupStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'setup'],
    queryFn: () => apiGet<SetupStatusDto>('/dashboard/setup'),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}
