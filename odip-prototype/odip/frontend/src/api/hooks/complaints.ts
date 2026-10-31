import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw } from '../client'
import { fetchPagedList } from './pagedList'
import type { ComplaintListDto, ComplaintDto, SaveComplaintDto } from '../types'

/** ComplaintsController.List: `status`, `longOpen`, `search`, `isActive`, `page`, `pageSize`. */
export function useComplaints(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['complaints', params],
    queryFn: () => fetchPagedList<ComplaintListDto>('/complaints', params),
  })
}

export function useComplaint(id: string | undefined) {
  return useQuery({
    queryKey: ['complaint', id],
    queryFn: () => apiGet<ComplaintDto>(`/complaints/${id}`),
    enabled: !!id,
  })
}

function useInvalidateComplaints() {
  const qc = useQueryClient()
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['complaints'] })
    if (id) qc.invalidateQueries({ queryKey: ['complaint', id] })
  }
}

export function useCreateComplaint() {
  const invalidate = useInvalidateComplaints()
  return useMutation({
    mutationFn: (data: SaveComplaintDto) => apiPostRaw<ComplaintDto>('/complaints', data),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateComplaint() {
  const invalidate = useInvalidateComplaints()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SaveComplaintDto }) => apiPutRaw<ComplaintDto>(`/complaints/${id}`, data),
    onSuccess: (_, vars) => invalidate(vars.id),
  })
}

/** The `deleteMutation` shape useArchiveRestore takes: `mutate(id)`. */
export function useArchiveComplaint() {
  const invalidate = useInvalidateComplaints()
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<ComplaintDto>(`/complaints/${id}/archive`),
    onSuccess: (_, id) => invalidate(id),
  })
}

/** The `restoreMutation` shape useArchiveRestore takes: `mutate({ id, data })`; the route needs no body. */
export function useRestoreComplaint() {
  const invalidate = useInvalidateComplaints()
  return useMutation({
    mutationFn: ({ id }: { id: string; data?: unknown }) => apiPostRaw<ComplaintDto>(`/complaints/${id}/restore`),
    onSuccess: (_, vars) => invalidate(vars.id),
  })
}
