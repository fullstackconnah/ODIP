import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDeleteRaw, apiGet, apiPostRaw, apiPutRaw } from '../client'
import type { ComplianceItemDto, SaveComplianceItemDto } from '../types/compliance'

const KEY = ['compliance-items']

/** The organisation's compliance dates, soonest first. Admin, Coordinator and SuperAdmin may read them. */
export function useComplianceItems(enabled = true) {
  return useQuery({ queryKey: KEY, enabled, queryFn: () => apiGet<ComplianceItemDto[]>('/compliance-items') })
}

/** A save or delete also opens, retitles or closes the date's Admin task, so the task lists reload too. */
function useRefresh() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['tasks'] })])
}

export function useCreateComplianceItem() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (data: SaveComplianceItemDto) => apiPostRaw<ComplianceItemDto>('/compliance-items', data),
    onSuccess: refresh,
  })
}

export function useUpdateComplianceItem() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SaveComplianceItemDto }) => apiPutRaw<ComplianceItemDto>(`/compliance-items/${id}`, data),
    onSuccess: refresh,
  })
}

/** A real delete: the row goes, and so does its open task. */
export function useDeleteComplianceItem() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/compliance-items/${id}`),
    onSuccess: refresh,
  })
}
