import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { HoursByWorkerRowDto, LeaveTakenRowDto, ReportRange, ShiftFulfilmentWeekDto } from '../types/reports'

/** One report for a date range. The previous range's rows stay on screen while the next range loads. `enabled` is false for a bad range or no organisation. */
function useReport<T>(name: string, { from, to }: ReportRange, enabled: boolean) {
  return useQuery({
    queryKey: ['reports', name, from, to],
    queryFn: () => apiGet<T[]>(`/reports/${name}?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export const useHoursByWorkerReport = (range: ReportRange, enabled: boolean) => useReport<HoursByWorkerRowDto>('hours-by-worker', range, enabled)
export const useShiftFulfilmentReport = (range: ReportRange, enabled: boolean) => useReport<ShiftFulfilmentWeekDto>('shift-fulfilment', range, enabled)
export const useLeaveTakenReport = (range: ReportRange, enabled: boolean) => useReport<LeaveTakenRowDto>('leave-taken', range, enabled)
