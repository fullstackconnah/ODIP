import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import TripDetailPage from './TripDetailPage'

// A REAL QueryClient and useQuery behind useTrip, on a screen that tests isLoading first (the pattern most record pages use). TanStack resets a
// failed no-data query to status 'pending' the moment its retry starts, so a gate that tests isLoading swapped the banner for a spinner.
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn<() => Promise<unknown>>() }))
vi.mock('@/api/hooks', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  const none = () => ({ data: [] })
  return {
    useTrip: () => useQuery({ queryKey: ['trip'], queryFn: () => fetcher(), retry: false }),
    useTripBookings: none, useTripAccommodation: none, useTripVehicles: none, useTripStaff: none, useTripTasks: none,
    useTripSchedule: none, useTripClaims: none, useTripIncidents: none, useParticipants: none,
  }
})
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true, isAdmin: false, isSuperAdmin: false, canAccessPage: () => true }) }))
vi.mock('./trip-detail', () => ({
  OverviewTab: () => null, BookingsTab: () => null, AccommodationTab: () => null, VehiclesTab: () => null, StaffTab: () => null, TasksTab: () => null,
  ActivitiesTab: () => null, ClaimsTab: () => null, IncidentsTab: () => null, EditTripModal: () => null,
}))
vi.mock('@/components/AuditHistoryTab', () => ({ default: () => null }))

it('a record page that tests isLoading first keeps the same focused Try again button through a real failing retry', async () => {
  fetcher.mockRejectedValueOnce(new Error('offline'))
  const router = createMemoryRouter([{ path: '/trips/:id', element: <TripDetailPage /> }], { initialEntries: ['/trips/trip-1'] })
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
  const retry = await screen.findByRole('button', { name: 'Try again' })
  retry.focus()

  let failAgain!: (error: Error) => void
  fetcher.mockReturnValueOnce(new Promise((_yes, no) => { failAgain = no }))
  fireEvent.click(retry)
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry)
  expect(retry).toHaveFocus()
  expect(retry).toHaveAttribute('aria-disabled', 'true')

  await act(async () => { failAgain(new Error('still offline')) })
  await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'))
  expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry)
  expect(retry).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent("Couldn't load it again.")
})
