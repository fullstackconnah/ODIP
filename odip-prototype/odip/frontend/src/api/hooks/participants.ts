import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  ParticipantListDto,
  ParticipantDetailDto,
  CreateParticipantDto,
  UpdateParticipantDto,
  SupportProfileDto,
  BookingListDto,
  PagedResult,
} from '../types'

export function useParticipants(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['participants', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<ParticipantListDto>>('/participants', params)
      return result.items
    },
  })
}

export function useParticipant(id: string | undefined) {
  return useQuery({
    queryKey: ['participant', id],
    queryFn: () => apiGet<ParticipantDetailDto>(`/participants/${id}`),
    enabled: !!id,
  })
}

export function useParticipantBookings(id: string | undefined) {
  return useQuery({
    queryKey: ['participant-bookings', id],
    queryFn: () => apiGet<BookingListDto[]>(`/participants/${id}/bookings`),
    enabled: !!id,
  })
}

export function useSupportProfile(id: string | undefined) {
  return useQuery({
    queryKey: ['support-profile', id],
    queryFn: () => apiGet<SupportProfileDto>(`/participants/${id}/support-profile`),
    enabled: !!id,
  })
}

export function useCreateParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateParticipantDto) => apiPostRaw<ParticipantDetailDto>('/participants', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants'] }),
  })
}

export function useUpdateParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateParticipantDto }) =>
      apiPutRaw<ParticipantDetailDto>(`/participants/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['participants'] })
      qc.invalidateQueries({ queryKey: ['participant', vars.id] })
    },
  })
}

export function useDeleteParticipant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/participants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants'] }),
  })
}
