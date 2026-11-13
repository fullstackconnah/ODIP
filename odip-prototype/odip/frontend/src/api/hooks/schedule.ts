import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { ScheduleOverviewDto } from '../types'
import { QK } from '@/api/queryKeys'

export function useScheduleOverview(params?: Record<string, string>) {
  return useQuery({
    queryKey: [QK.scheduleOverview, params],
    queryFn: () => apiGet<ScheduleOverviewDto>('/schedule', params),
  })
}
