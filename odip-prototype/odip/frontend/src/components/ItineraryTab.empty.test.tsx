import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ItineraryTab from './ItineraryTab'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useTripItinerary: query }))

describe('ItineraryTab — no itinerary', () => {
  it('says there is no itinerary yet, not that it failed to load', () => {
    query.mockReturnValue({ data: undefined, isLoading: false, isError: false })
    render(<ItineraryTab tripId="t1" trip={{}} />)

    expect(screen.getByText('No itinerary yet')).toBeInTheDocument()
    expect(screen.getByText('The itinerary appears once the trip has dates and a schedule.')).toBeInTheDocument()
    expect(screen.queryByText(/Unable to load/)).not.toBeInTheDocument()
  })

  it('offers Try again when the request failed', () => {
    query.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })
    render(<ItineraryTab tripId="t1" trip={{}} />)

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
