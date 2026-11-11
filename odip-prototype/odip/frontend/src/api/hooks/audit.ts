import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiClient, apiGet } from '../client'
import type { PagedResult } from '../types'

export interface AuditChange {
  field: string | null // the server sends null for a change with no property name
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

export interface DeletedRecord {
  id: string
  entityType: string
  entityId: string
  deletedAt: string
  deletedByName: string | null
  /** The values the record held when it was deleted. */
  fields: AuditChange[]
}

export const DELETED_RECORDS_PAGE_SIZE = 25

/** Settings › Deleted records (Admin): one page of the organisation's deletions, newest first (the server's order), optionally of one type. */
export function useDeletedRecords(entityType: string, page: number) {
  return useQuery({
    queryKey: ['audit', 'deleted', entityType || 'all', page],
    queryFn: () => apiGet<PagedResult<DeletedRecord>>('/audit/deleted', { entityType: entityType || undefined, page, pageSize: DELETED_RECORDS_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
}
