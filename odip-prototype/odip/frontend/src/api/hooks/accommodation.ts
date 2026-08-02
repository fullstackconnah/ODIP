import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  AccommodationListDto,
  AccommodationDetailDto,
  CreateAccommodationDto,
  UpdateAccommodationDto,
  ReservationDto,
  CreateReservationDto,
  UpdateReservationDto,
} from '../types'

export function useAccommodation(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['accommodation', params],
    queryFn: () => apiGet<AccommodationListDto[]>('/accommodation', params),
  })
}

export function useAccommodationDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['accommodation-detail', id],
    queryFn: () => apiGet<AccommodationDetailDto>(`/accommodation/${id}`),
    enabled: !!id,
  })
}

export function useTripAccommodation(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-accommodation', tripId],
    queryFn: () => apiGet<ReservationDto[]>(`/trips/${tripId}/accommodation`),
    enabled: !!tripId,
  })
}

export function useCreateAccommodation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAccommodationDto) =>
      apiPostRaw<AccommodationDetailDto>('/accommodation', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accommodation'] }),
  })
}

export function useUpdateAccommodation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAccommodationDto }) =>
      apiPutRaw<AccommodationDetailDto>(`/accommodation/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['accommodation'] })
      qc.invalidateQueries({ queryKey: ['accommodation-detail', vars.id] })
    },
  })
}

export function useDeleteAccommodation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/accommodation/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accommodation'] }),
  })
}

export function useCreateReservation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateReservationDto) =>
      apiPostRaw<ReservationDto>('/reservations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-accommodation'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useUpdateReservation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReservationDto }) =>
      apiPutRaw<ReservationDto>(`/reservations/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-accommodation'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useDeleteReservation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/reservations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-accommodation'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useCancelReservation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReservationDto }) =>
      apiPutRaw<ReservationDto>(`/reservations/${id}`, { ...data, reservationStatus: 'Cancelled' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-accommodation'] }),
  })
}
