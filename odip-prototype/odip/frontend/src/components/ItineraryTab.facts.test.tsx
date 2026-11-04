import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ItineraryTab from './ItineraryTab'

const itinerary = {
  tripName: 'Beach Escape', tripCode: 'BE-01', destination: 'Caloundra QLD', startDate: '2026-11-01', endDate: '2026-11-02', durationDays: 2,
  participantCount: 2, staffCount: 3, totalEstimatedCost: 0, region: null, leadCoordinatorName: null,
  participants: [], staff: [], vehicles: [], accommodation: [],
  days: [{ dayNumber: 1, date: '2026-11-01', accommodationEvents: [], staffOnDuty: [], activities: [{ title: 'Beach walk', status: 'Confirmed', category: 'Leisure', estimatedCost: 12.5 }] }],
}
vi.mock('@/api/hooks', () => ({
  useTripItinerary: () => ({ data: itinerary, isLoading: false, isError: false }),
}))

// V3: the header and the glance strip already say the title, dates, days and head counts; the overview said them again.
describe('ItineraryTab — no repeat of the header or the trip facts', () => {
  it('has no second title and no count tiles', () => {
    render(<ItineraryTab tripId="t1" />)

    expect(screen.queryByText('Trip Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Beach Escape')).not.toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Participants')).not.toBeInTheDocument()
    // The trip facts moved to the Overview side card.
    for (const label of ['Trip details', 'Requirements', 'Event template', 'Booking cutoff']) expect(screen.queryByText(label), label).not.toBeInTheDocument()
  })
})

// Q4/V-A follow-up: a dollar icon beside "$12.50" read as "$ $12.50".
describe('ItineraryTab — activity cost', () => {
  it('prints one dollar sign', () => {
    render(<ItineraryTab tripId="t1" />)

    const cost = screen.getByText('$12.50')
    expect(cost.querySelector('svg')).toBeNull()
    expect(cost.closest('span')?.querySelector('svg')).toBeNull()
  })
})

// V-D1 follow-up: the headings are sentence case like the rest of the app, and the empty schedule's hint is a link to the tab it names.
describe('ItineraryTab — headings and the empty schedule', () => {
  it('heads the schedule in sentence case', () => {
    render(<ItineraryTab tripId="t1" />)
    expect(screen.getByRole('heading', { name: 'Schedule' })).toBeInTheDocument()
  })

  it('links the empty schedule to the Activities tab', () => {
    const days = itinerary.days
    itinerary.days = []
    try {
      render(<MemoryRouter><ItineraryTab tripId="t1" /></MemoryRouter>)
      const hint = screen.getByText(/to generate the day-by-day schedule first/)
      expect(within(hint).getByRole('link', { name: 'Activities tab' })).toHaveAttribute('href', '/?tab=activities')
    } finally {
      itinerary.days = days
    }
  })
})
