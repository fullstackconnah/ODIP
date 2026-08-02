import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'

export interface AuditChange {
  field: string
  old: string | null
  new: string | null
}

export interface AuditEntry {
  id: string
  action: string
  changedAt: string
  changedByName: string | null
  changes: AuditChange[]
}

interface AuditHistoryResponse {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function useAuditHistory(entityType: string, entityId: string) {
  return useQuery<AuditHistoryResponse>({
    queryKey: ['audit', entityType, entityId],
    queryFn: async () => {
      const res = await apiClient.get<AuditHistoryResponse>(
        `/audit/${entityType}/${entityId}`
      )
      return res.data
    },
    enabled: Boolean(entityType && entityId),
  })
}
