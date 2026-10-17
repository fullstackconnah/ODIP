import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '../client'
import type { EarlyAccessSignupDto, PagedResult } from '../types'

export const EARLY_ACCESS_PAGE_SIZE = 50

/** Settings › Alpha sign-ups (SuperAdmin): one page of the landing page's sign-ups, latest sent first (the server's order). */
export function useEarlyAccessSignups(page: number) {
  return useQuery({
    queryKey: ['admin-early-access', page],
    queryFn: () => apiGet<PagedResult<EarlyAccessSignupDto>>('/admin/early-access', { page, pageSize: EARLY_ACCESS_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })
}

/**
 * Marks a sign-up's over-limit repeats followed up. `overLimitCount` is the count the SuperAdmin was looking at: the server answers 409 and
 * changes nothing if more have arrived since, so a repeat nobody has read is never marked as handled.
 */
export function useMarkEarlyAccessFollowedUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, overLimitCount }: { id: string; overLimitCount: number }) =>
      apiPost<boolean>(`/admin/early-access/${id}/followed-up`, { overLimitCount }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-early-access'] }),
  })
}

/** Deletes one sign-up for good. The server writes an audit row without the person's details. */
export function useDeleteEarlyAccessSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/early-access/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-early-access'] }),
  })
}
