import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw, apiDeleteRaw } from '../client'
import type {
  ActivityDto,
  EventTemplateDto,
  CreateEventTemplateDto,
  UpdateEventTemplateDto,
  TripDayDto,
  CreateScheduledActivityDto,
  UpdateScheduledActivityDto,
  ScheduledActivityDto,
} from '../types'

export function useActivities() {
  return useQuery({
    queryKey: ['activities'],
    queryFn: () => apiGet<ActivityDto[]>('/activities'),
  })
}

export function useEventTemplates() {
  return useQuery({
    queryKey: ['event-templates'],
    queryFn: () => apiGet<EventTemplateDto[]>('/event-templates'),
  })
}

export function useTripSchedule(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-schedule', tripId],
    queryFn: () => apiGet<TripDayDto[]>(`/trips/${tripId}/schedule`),
    enabled: !!tripId,
  })
}

export function useCreateScheduledActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tripDayId, data }: { tripDayId: string; data: CreateScheduledActivityDto }) =>
      apiPostRaw<ScheduledActivityDto>(`/trip-days/${tripDayId}/activities`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-schedule'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useUpdateScheduledActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateScheduledActivityDto }) =>
      apiPutRaw<ScheduledActivityDto>(`/scheduled-activities/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-schedule'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useDeleteScheduledActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/scheduled-activities/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-schedule'] })
      qc.invalidateQueries({ queryKey: ['trip-itinerary'] })
    },
  })
}

export function useCreateEventTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateEventTemplateDto) =>
      apiPostRaw<EventTemplateDto>('/event-templates', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-templates'] })
    },
  })
}

export function useUpdateEventTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEventTemplateDto }) =>
      apiPutRaw<EventTemplateDto>(`/event-templates/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-templates'] })
    },
  })
}

export function useDeactivateEventTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDeleteRaw<boolean>(`/event-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-templates'] })
    },
  })
}
