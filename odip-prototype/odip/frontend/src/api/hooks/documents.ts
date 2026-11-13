import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { ItineraryDto } from '../types'
import { QK } from '@/api/queryKeys'

export function useTripItinerary(tripId: string | undefined) {
  return useQuery({
    queryKey: [QK.tripItinerary, tripId],
    queryFn: () => apiGet<ItineraryDto>(`/trips/${tripId}/itinerary`),
    enabled: !!tripId,
  })
}
