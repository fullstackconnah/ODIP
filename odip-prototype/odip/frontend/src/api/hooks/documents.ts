import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { ItineraryDto } from '../types'

export function useTripItinerary(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-itinerary', tripId],
    queryFn: () => apiGet<ItineraryDto>(`/trips/${tripId}/itinerary`),
    enabled: !!tripId,
  })
}
