import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiPatchRaw, apiDeleteRaw } from '../client'
import { fetchPagedList } from './pagedList'
import type {
  BookingListDto,
  BookingDetailDto,
  CreateBookingDto,
  UpdateBookingDto,
  PatchBookingDto,
} from '../types'

/**
 * BookingsController.GetAll now returns PagedResult<BookingListDto> (real server-side paging —
 * see PAGINATION-PLAN-V2 §wave 2). `fetchPagedList` flattens that to a `TruncatableList` whose
 * `totalCount` drives `DataTable`'s `pagination` prop in `BookingsPage`; callers drive
 * `page`/`pageSize` themselves via `params`, same pattern as `useIncidents`/`useMedicationRegister`.
 */
export function useBookings(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['bookings', params],
    queryFn: () => fetchPagedList<BookingListDto>('/bookings', params),
  })
}

export function useTripBookings(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-bookings', tripId],
    queryFn: () => apiGet<BookingListDto[]>(`/trips/${tripId}/bookings`),
    enabled: !!tripId,
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBookingDto) => apiPostRaw<BookingDetailDto>('/bookings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['trip-bookings'] })
      qc.invalidateQueries({ queryKey: ['trips'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useUpdateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBookingDto }) =>
      apiPutRaw<BookingDetailDto>(`/bookings/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['trip-bookings'] })
      qc.invalidateQueries({ queryKey: ['trips'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
      qc.invalidateQueries({ queryKey: ['participant-bookings'] })
    },
  })
}

export function usePatchBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PatchBookingDto }) =>
      apiPatchRaw<BookingDetailDto>(`/bookings/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-bookings'] })
      qc.invalidateQueries({ queryKey: ['trip'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useDeleteBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/bookings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['trip-bookings'] })
      qc.invalidateQueries({ queryKey: ['trips'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBookingDto }) =>
      apiPutRaw<BookingListDto>(`/bookings/${id}`, { ...data, bookingStatus: 'Cancelled' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['trip-bookings'] })
      qc.invalidateQueries({ queryKey: ['trip'] })
    },
  })
}
