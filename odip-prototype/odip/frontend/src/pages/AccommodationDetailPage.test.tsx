import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AccommodationDetailPage from './AccommodationDetailPage'

const { mockUseAccommodationDetail } = vi.hoisted(() => ({
  mockUseAccommodationDetail: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodationDetail: mockUseAccommodationDetail,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accommodation/acc-1']}>
      <Routes>
        <Route path="/accommodation/:id" element={<AccommodationDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockUseAccommodationDetail.mockReset()
})

describe('AccommodationDetailPage — fetch failure vs. not-found (PP-66)', () => {
  it('shows a distinct, retryable error when the request fails (isError), not "Property not found"', () => {
    const mockRefetch = vi.fn()
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch })
    renderPage()

    expect(screen.queryByText(/property not found/i)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load this property/i)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('calls refetch when "Try again" is clicked', async () => {
    const user = userEvent.setup()
    const mockRefetch = vi.fn()
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch })
    renderPage()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('still shows "Property not found" when the fetch succeeds but returns nothing', () => {
    mockUseAccommodationDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText(/property not found/i)).toBeInTheDocument()
  })
})

describe('AccommodationDetailPage — section grid', () => {
  it('collapses to one column on a phone through a min(26rem,100%) track floor, with short cards aligned to the top', () => {
    mockUseAccommodationDetail.mockReturnValue({
      data: { id: 'acc-1', propertyName: 'Sunrise House', isActive: true, location: 'Gold Coast', maxCapacity: 4 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    // jsdom has no layout, so the class is the only observable proof: a bare minmax(26rem,1fr)
    // floor (416px) overflows a 390px viewport.
    const grid = screen.getByRole('heading', { name: 'Property Details' }).closest('.rounded-md')!.parentElement!
    expect(grid).toHaveClass('grid', 'items-start', 'grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))]')
  })
})

// Density verdict (mobile) — an email address or URL in a FactList value stretched the bare `1fr`
// value track past the card (scrollWidth 432 at 390, 433 at 360). Each list now overrides the track to
// minmax(0,1fr) and lets the value break. jsdom has no layout, so the classes are the observable proof.
describe('AccommodationDetailPage — long unbreakable values', () => {
  it('lets every fact list shrink to its card and wrap an email or URL instead of scrolling the page sideways', () => {
    mockUseAccommodationDetail.mockReturnValue({
      data: {
        id: 'acc-1', propertyName: 'Sunrise House', isActive: true, location: 'Gold Coast',
        providerOwner: 'Sunrise House Accommodation Pty Ltd', maxCapacity: 4,
        email: 'bookings-and-reservations@sunrise-house-accommodation.example.com.au',
        website: 'https://www.sunrise-house-accommodation.example.com.au/accessible-stays',
        accessibilityNotes: 'Step-free throughout.',
      },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    const lists = ['Property Details', 'Contact & Address', 'Notes'].map(
      name => screen.getByRole('heading', { name }).closest('.rounded-md')!.querySelector('dl')!,
    )
    for (const dl of lists) {
      expect(dl).toHaveClass('grid-cols-[10rem_minmax(0,1fr)]!', '[&_dd]:break-words')
    }
  })
})

describe('AccommodationDetailPage — Back', () => {
  it('is a real link to the accommodation list: the text says "Back", the accessible name says where it goes', () => {
    mockUseAccommodationDetail.mockReturnValue({
      data: { id: 'acc-1', propertyName: 'Sunrise House', isActive: true, location: 'Gold Coast', maxCapacity: 4 },
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()
    const back = screen.getByRole('link', { name: 'Back to accommodation' })
    expect(back).toHaveAttribute('href', '/accommodation')
    expect(back).toHaveTextContent(/^Back$/)
  })
})
