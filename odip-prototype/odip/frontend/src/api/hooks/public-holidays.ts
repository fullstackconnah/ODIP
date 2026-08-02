import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDeleteRaw } from '../client'
import type { PublicHolidayDto, CreatePublicHolidayDto, SyncHolidaysDto, SyncResultDto } from '../types'

export function usePublicHolidays(year?: number, state?: string) {
  return useQuery({
    queryKey: ['public-holidays', year, state],
    queryFn: () => {
      const params: Record<string, any> = {}
      if (year) params.year = year
      if (state) params.state = state
      return apiGet<PublicHolidayDto[]>('/public-holidays', params)
    },
  })
}

export function useCreatePublicHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePublicHolidayDto) =>
      apiPost<PublicHolidayDto>('/public-holidays', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-holidays'] })
    },
  })
}

export function useDeletePublicHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/public-holidays/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-holidays'] })
    },
  })
}

export function useSyncHolidays() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SyncHolidaysDto = {}) =>
      apiPost<SyncResultDto>('/public-holidays/sync', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['public-holidays'] })
    },
  })
}
