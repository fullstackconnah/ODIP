import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet } from '../client'
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

/** Deletes one sign-up for good. The server writes an audit row without the person's details. */
export function useDeleteEarlyAccessSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/early-access/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-early-access'] }),
  })
}
