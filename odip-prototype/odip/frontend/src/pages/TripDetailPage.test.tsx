import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TripDetailPage from './TripDetailPage'
import type { TripDetailDto } from '@/api/types/trips'

const trip: TripDetailDto = {
  id: 'trip-1', tripName: 'Beach Getaway 2026', status: 'Confirmed', startDate: '2026-10-01', endDate: '2026-10-05', durationDays: 5,
} as unknown as TripDetailDto

const { mockUseTripSchedule, mockUseTripClaims } = vi.hoisted(() => ({
  mockUseTripSchedule: vi.fn(() => ({ data: [] })),
  mockUseTripClaims: vi.fn(() => ({ data: [] })),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

vi.mock('@/api/hooks', () => ({
  useTrip: () => ({ data: trip, isLoading: false }),
  useTripBookings: () => ({ data: [] }),
  useTripAccommodation: () => ({ data: [] }),
  useTripVehicles: () => ({ data: [] }),
  useTripStaff: () => ({ data: [] }),
  useTripTasks: () => ({ data: [] }),
  useTripSchedule: mockUseTripSchedule,
  useTripClaims: mockUseTripClaims,
  useParticipants: () => ({ data: [] }),
}))

vi.mock('./trip-detail', () => ({
  OverviewTab: () => <div>Overview panel</div>,
  BookingsTab: () => <div>Bookings panel</div>,
  AccommodationTab: () => <div>Accommodation panel</div>,
  VehiclesTab: () => <div>Vehicles panel</div>,
  StaffTab: () => <div>Staff panel</div>,
  TasksTab: () => <div>Tasks panel</div>,
  ActivitiesTab: () => <div>Activities panel</div>,
  ClaimsTab: () => <div>Claims panel</div>,
  EditTripModal: () => null,
}))

function renderPage(initialEntry = '/trips/trip-1') {
  const router = createMemoryRouter(
    [{ path: '/trips/:id', element: <TripDetailPage /> }],
    { initialEntries: [initialEntry] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

beforeEach(() => {
  localStorage.clear()
  mockUseTripSchedule.mockClear()
  mockUseTripClaims.mockClear()
})

describe('TripDetailPage — PP-60 URL-synced tabs', () => {
  it('writes the clicked tab into the ?tab= query param', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()

    expect(screen.getByText('Overview panel')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /claims/i }))

    expect(screen.getByText('Claims panel')).toBeInTheDocument()
    expect(router.state.location.search).toContain('tab=claims')
  })

  it('reads the initial tab from the URL on load', () => {
    renderPage('/trips/trip-1?tab=vehicles')

    expect(screen.getByText('Vehicles panel')).toBeInTheDocument()
  })
})

describe('TripDetailPage — PP-61 sub-resource fetches', () => {
  // Follow-up to the initial PP-61 fix: schedule/claims are NOT gated by activeTab, because
  // schedule.reduce(...) and claims.length feed the tab-label count badges, which render
  // outside their own tabpanel (visible before that tab is ever opened). Gating them made those
  // badges misleadingly read 0 until visited, so both fetch unconditionally like every other
  // sub-resource on this page.
  it('fetches schedule and claims unconditionally, not gated by the active tab', () => {
    renderPage()

    expect(mockUseTripSchedule).toHaveBeenCalledWith('trip-1')
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1')
  })

  it('still fetches schedule and claims the same way after switching tabs', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /claims/i }))

    expect(mockUseTripSchedule).toHaveBeenCalledWith('trip-1')
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1')
  })
})
