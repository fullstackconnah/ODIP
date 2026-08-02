import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { ScheduleOverviewDto } from '../types'

export function useScheduleOverview(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['schedule-overview', params],
    queryFn: () => apiGet<ScheduleOverviewDto>('/schedule', params),
  })
}
