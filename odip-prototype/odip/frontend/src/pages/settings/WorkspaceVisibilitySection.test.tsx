import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import WorkspaceVisibilitySection from './WorkspaceVisibilitySection'

const { query, mutate } = vi.hoisted(() => ({
  query: { data: undefined as { hiddenAccommodation: boolean; hiddenVehicles: boolean; hiddenTrips: boolean } | undefined, isError: false, isFetching: false, refetch: vi.fn() },
  mutate: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({ useModuleVisibility: () => query, useUpdateModuleVisibility: () => ({ mutate, isPending: false }) }))
const frame = { title: 'Workspace visibility', description: 'Choose the menu.', readOnly: false, focusOnMount: false }
const show = () => render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element: <WorkspaceVisibilitySection {...frame} /> }], { initialEntries: ['/settings?section=workspace-visibility'] })} />)
beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  query.data = { hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false }; query.isError = false; query.isFetching = false; mutate.mockReset(); query.refetch.mockClear()
})
afterEach(() => localStorage.clear())

describe('workspace visibility settings', () => {
  it('explains recovery before save, sends both explicit fields, and can restore them', () => {
    mutate.mockImplementation((data, options) => { query.data = data; options.onSuccess() })
    show()
    expect(screen.getByText(/Hidden workspaces stay available under Other workspaces/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Accommodation' }))
    expect(screen.getByText(/Accommodation will move to Other workspaces/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(mutate.mock.calls[0][0]).toEqual({ hiddenAccommodation: true, hiddenVehicles: false, hiddenTrips: false })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Accommodation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(mutate.mock.calls[1][0]).toEqual({ hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false })
  })
  it('lists the three boxes in order; unticking trips unticks the others, re-ticking restores the saved values, and Save sends all three', () => {
    query.data = { hiddenAccommodation: false, hiddenVehicles: true, hiddenTrips: false }
    mutate.mockImplementation((data, options) => { query.data = data; options.onSuccess() })
    show()
    expect(screen.getAllByRole('checkbox').map(c => (c as HTMLInputElement).labels?.[0]?.textContent?.slice(0, 23))).toEqual(['Show trips and holiday', 'Show Accommodation', 'Show Vehicles'].map(t => expect.stringContaining(t.slice(0, 20))))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show trips and holidays' }))
    expect(screen.getByRole('checkbox', { name: 'Show Accommodation' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Show Vehicles' })).not.toBeChecked()
    expect(screen.getByText(/^After saving/)).toHaveTextContent('After saving, Trips and Bookings, Accommodation and Vehicles will move to Other workspaces. Event templates and Activity library will leave Settings.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show trips and holidays' }))
    expect(screen.getByRole('checkbox', { name: 'Show Accommodation' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Show Vehicles' })).not.toBeChecked()
    expect(screen.getByText(/^After saving/)).toHaveTextContent('After saving, Vehicles will move to Other workspaces.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show trips and holidays' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(mutate.mock.calls[0][0]).toEqual({ hiddenTrips: true, hiddenAccommodation: true, hiddenVehicles: true })
  })
  it('retains the edited choice when the server rejects save', () => {
    mutate.mockImplementation((_data, options) => options.onError(new Error('offline')))
    show(); fireEvent.click(screen.getByRole('checkbox', { name: 'Show Vehicles' })); fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('checkbox', { name: 'Show Vehicles' })).not.toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved.')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })
  it('shows loading and error truthfully without a save, and offers retry', () => {
    query.data = undefined
    const view = show()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    query.isError = true; view.rerender(<RouterProvider router={createMemoryRouter([{ path: '*', element: <WorkspaceVisibilitySection {...frame} /> }])} />)
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }))
    expect(query.refetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})

it('waits for the fresh revisit answer before hydrating a cached visibility draft', () => {
  query.data = { hiddenAccommodation: true, hiddenVehicles: true, hiddenTrips: false }; query.isFetching = true
  const view = show()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  query.data = { hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false }; query.isFetching = false
  view.rerender(<RouterProvider router={createMemoryRouter([{ path: '*', element: <WorkspaceVisibilitySection {...frame} /> }])} />)
  expect(screen.getByRole('checkbox', { name: 'Show Accommodation' })).toBeChecked()
})

