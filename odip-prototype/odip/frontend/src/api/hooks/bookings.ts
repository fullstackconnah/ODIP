import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiPatchRaw, apiDeleteRaw } from '../client'
import { refreshBudgetFigures } from './funding-ledger'
import { fetchPagedList } from './pagedList'
import type {
  BookingListDto,
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
    mutationFn: (data: CreateBookingDto) => apiPostRaw<BookingListDto>('/bookings', data),
    onSuccess: (_, data) => {
      refreshBudgetFigures(qc, [data.participantId])   // a confirmed booking is booked ahead in its participant's budget
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
      apiPutRaw<BookingListDto>(`/bookings/${id}`, data),
    onSuccess: () => {
      refreshBudgetFigures(qc)   // its status (confirmed or not) decides whether it is in the budget at all
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
      apiPatchRaw<BookingListDto>(`/bookings/${id}`, data),
    onSuccess: () => {
      refreshBudgetFigures(qc)   // a patch can confirm or cancel the booking
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
      refreshBudgetFigures(qc)   // a removed booking costs nothing
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
      refreshBudgetFigures(qc)   // a cancelled booking costs nothing
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['trip-bookings'] })
      qc.invalidateQueries({ queryKey: ['trip'] })
    },
  })
}
