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

// Platform review VISUAL-1 (Trip detail, phone): the facts stacked label over value below sm, so seven mostly empty facts took ~450px.
describe('ItineraryTab — Trip details and Requirements facts', () => {
  it('keep label and value side by side at every width', () => {
    render(<ItineraryTab tripId="t1" trip={{ eventTemplateName: 'Coastal', requiredBeds: 4 }} />)

    for (const label of ['Event template', 'Required beds']) {
      const grid = screen.getByText(label).parentElement as HTMLElement
      expect(grid, label).toHaveClass('grid', 'grid-cols-2')
      expect(grid.className, label).not.toMatch(/grid-cols-1/)
    }
  })

  // V3: the overview printed eleven of thirteen facts as an em dash. Only what is recorded shows; a group with nothing recorded goes.
  it('shows only the facts that are set, and drops a group with none', () => {
    render(<ItineraryTab tripId="t1" trip={{ eventTemplateName: 'Coastal', minParticipants: null, requiredBeds: null }} />)

    expect(screen.getByText('Event template')).toBeInTheDocument()
    for (const label of ['Region', 'Lead coordinator', 'Min participants', 'OOP due date']) expect(screen.queryByText(label), label).not.toBeInTheDocument()
    expect(screen.queryByText('Requirements')).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})

// V3: the header and the glance strip already say the title, dates, days and head counts; the overview said them again.
describe('ItineraryTab — no repeat of the header', () => {
  it('has no second title and no count tiles', () => {
    render(<ItineraryTab tripId="t1" trip={{}} />)

    expect(screen.queryByText('Trip Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Beach Escape')).not.toBeInTheDocument()
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Participants')).not.toBeInTheDocument()
  })
})

// Q4/V-A follow-up: a dollar icon beside "$12.50" read as "$ $12.50".
describe('ItineraryTab — activity cost', () => {
  it('prints one dollar sign', () => {
    render(<ItineraryTab tripId="t1" trip={{}} />)

    const cost = screen.getByText('$12.50')
    expect(cost.querySelector('svg')).toBeNull()
    expect(cost.closest('span')?.querySelector('svg')).toBeNull()
  })
})

// V-D1 follow-up: the headings are sentence case like the rest of the app, and the empty schedule's hint is a link to the tab it names.
describe('ItineraryTab — headings and the empty schedule', () => {
  it('heads the facts and the schedule in sentence case', () => {
    render(<ItineraryTab tripId="t1" trip={{ eventTemplateName: 'Coastal' }} />)
    expect(screen.getByText('Trip details')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Day-by-day schedule' })).toBeInTheDocument()
  })

  it('links the empty schedule to the Activities tab', () => {
    const days = itinerary.days
    itinerary.days = []
    try {
      render(<MemoryRouter><ItineraryTab tripId="t1" trip={{}} /></MemoryRouter>)
      const hint = screen.getByText(/to generate the day-by-day schedule first/)
      expect(within(hint).getByRole('link', { name: 'Activities tab' })).toHaveAttribute('href', '/?tab=activities')
    } finally {
      itinerary.days = days
    }
  })
})
