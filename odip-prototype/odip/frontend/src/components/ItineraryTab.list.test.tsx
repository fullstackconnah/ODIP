import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ItineraryTab from './ItineraryTab'
import { itineraryRows } from './ItineraryList'

const act = (o: object) => ({ status: 'Confirmed', category: 'Leisure', ...o })
const days: any[] = [
  {
    dayNumber: 1, date: '2026-11-06', dayTitle: 'Travel and settle in', staffOnDuty: [],
    accommodationEvents: [{ eventType: 'Check-in', propertyName: 'Kings Beach Lodge', address: '1 Beach Rd' }],
    activities: [
      act({ title: 'Brisbane transit', startTime: '08:30', endTime: '11:00', location: 'Transit Centre', accessibilityNotes: 'Step-free entry' }),
      act({ title: 'Free time on the boardwalk' }),
      act({ title: 'Lunch', startTime: '12:00' }),
    ],
  },
  { dayNumber: 2, date: '2026-11-07', staffOnDuty: [], accommodationEvents: [], activities: [act({ title: 'Museum', startTime: '09:00' })] },
]
const itinerary: any = {
  tripName: 'Beach Escape', totalEstimatedCost: 0, participants: [], staff: [], vehicles: [], accommodation: [], days,
}
vi.mock('@/api/hooks', () => ({
  useTripItinerary: () => ({ data: itinerary, isLoading: false, isError: false }),
}))

afterEach(() => localStorage.clear())

const renderTab = () => render(<MemoryRouter><ItineraryTab tripId="t1" /></MemoryRouter>)

describe('itineraryRows', () => {
  it('keeps the day view order: stays first, then server order, no time sort', () => {
    expect(itineraryRows(days).map(r => r.title)).toEqual([
      'Check-in — Kings Beach Lodge', 'Brisbane transit', 'Free time on the boardwalk', 'Lunch', 'Museum',
    ])
  })

  it('merges date and time into When (Sydney-safe)', () => {
    const [, timed, untimed] = itineraryRows(days)
    expect(timed.when).toBe('Fri 06/11 · 8:30am –⁠ 11:00am')
    expect(untimed.when).toBe('Fri 06/11')
  })

  it('reads an accommodation row from the address with no status', () => {
    const [stay] = itineraryRows(days)
    expect(stay).toMatchObject({ place: '1 Beach Rd', status: null, time: null })
  })
})

describe('ItineraryTab — By day | List', () => {
  it('defaults to By day, switches to List and remembers it', () => {
    const { unmount } = renderTab()
    const group = screen.getByRole('radiogroup', { name: 'Schedule view' })
    expect(within(group).getByRole('radio', { name: 'By day' })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Travel and settle in' })).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('radio', { name: 'List' }))
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map(h => h.textContent?.trim())
    expect(headers).toEqual(['When', 'Item', 'Place', 'Status'])
    expect(localStorage.getItem('odip.itinerary.view')).toBe('list')

    unmount()
    renderTab()
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked()
  })

  it('falls back to By day on a garbage stored value', () => {
    localStorage.setItem('odip.itinerary.view', 'x')
    renderTab()
    expect(screen.getByRole('radio', { name: 'By day' })).toBeChecked()
  })

  it('shows the accessibility note in the warning ink, not the warning fill colour', () => {
    localStorage.setItem('odip.itinerary.view', 'list')
    renderTab()
    const line = screen.getAllByText(/Step-free entry/)[0].closest('[class*="on-warning-container"]') as HTMLElement
    expect(line).toBeTruthy()
    expect(line.className).not.toContain('--color-warning)')
  })

  it('hides the toggle and ignores a stored List when there are no days', () => {
    localStorage.setItem('odip.itinerary.view', 'list')
    const saved = itinerary.days
    itinerary.days = []
    try {
      renderTab()
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByText('No activities scheduled')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Activities tab' })).toBeInTheDocument()
    } finally {
      itinerary.days = saved
    }
  })
})
