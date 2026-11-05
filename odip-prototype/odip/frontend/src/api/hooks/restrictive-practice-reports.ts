import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiDeleteRaw } from '../client'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import type { RpReportLine, LodgeRpReportDto } from '../types'

/** `participantId` narrows to one participant (the register's chips); without it, every month the organisation owes. */
export function useRpMonthlyReportLines(participantId: string | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['rp-report-lines', participantId ?? 'all'],
    queryFn: () => apiGet<RpReportLine[]>('/restrictive-practice-reports', participantId ? { participantId } : undefined),
    enabled,
  })
}

/** A lodge or an undo changes the worklist, the dashboard's overdue figure and the participants' alerts. */
function useInvalidateRpReports() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['rp-report-lines'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['participant-alerts'] })
    qc.invalidateQueries({ queryKey: ['participant-alerts-aggregate'] })
  }
}

export function useLodgeRpReport() {
  const invalidate = useInvalidateRpReports()
  return useMutation({
    mutationFn: (data: LodgeRpReportDto) => apiPostRaw<RpReportLine>('/restrictive-practice-reports', data),
    onSuccess: invalidate,
  })
}

export function useUndoRpReport() {
  const invalidate = useInvalidateRpReports()
  return useMutation({
    mutationFn: (reportId: string) => apiDeleteRaw<boolean>(`/restrictive-practice-reports/${reportId}`),
    onSuccess: invalidate,
    // 404: someone else already undid it, so the worklist still showing Lodged is stale.
    onError: err => { if (apiErrorStatus(err) === 404) invalidate() },
  })
}
