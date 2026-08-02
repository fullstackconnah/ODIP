import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { TripDocumentDto, ItineraryDto } from '../types'

export function useTripDocuments(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-documents', tripId],
    queryFn: () => apiGet<TripDocumentDto[]>(`/trips/${tripId}/documents`),
    enabled: !!tripId,
  })
}

export function useTripItinerary(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-itinerary', tripId],
    queryFn: () => apiGet<ItineraryDto>(`/trips/${tripId}/itinerary`),
    enabled: !!tripId,
  })
}
