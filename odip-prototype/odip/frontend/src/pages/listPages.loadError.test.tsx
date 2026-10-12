import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { apiClient } from '@/api/client'
import StaffPage from './StaffPage'
import TasksPage from './TasksPage'
import VehiclesPage from './VehiclesPage'
import AccommodationPage from './AccommodationPage'
import TripsPage from './TripsPage'
import IncidentsPage from './IncidentsPage'
import QualificationsPage from './QualificationsPage'
import SchedulePage from './SchedulePage'
import UsersTab from './settings/UsersTab'
import TenantsTab from './settings/TenantsTab'
import RegisterTab from './medications/RegisterTab'
import MarTab from './medications/MarTab'
import ReportTab from './medications/ReportTab'

// UI-SURVEY standard 1: a list whose load FAILED says so and offers a retry; the "nothing here yet" empty state is only for a successful empty
// answer. The REAL hooks on a real query client, with every GET failing as it does when the API is down.

// The hooks index re-exports the sign-in hooks, which read Firebase env at import; none of it is used here.
vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))

const { apiGet, apiGetWithDefault } = vi.hoisted(() => ({ apiGet: vi.fn(), apiGetWithDefault: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiGetWithDefault }))

const noop = () => {}
const pages: [string, ComponentType, RegExp][] = [
  ['StaffPage', StaffPage, /No staff members yet/],
  ['TasksPage', TasksPage, /No tasks yet/],
  ['VehiclesPage', VehiclesPage, /No vehicles found/],
  ['AccommodationPage', AccommodationPage, /No properties yet/],
  ['TripsPage', TripsPage, /No trips yet/],
  ['IncidentsPage', IncidentsPage, /No incidents reported/],
  ['QualificationsPage', QualificationsPage, /No staff members yet/],
  ['SchedulePage', SchedulePage, /No trips scheduled/],
  ['UsersTab', () => <UsersTab onAddUser={noop} onEditUser={noop} />, /No users found/],
  ['TenantsTab', () => <TenantsTab onAddTenant={noop} onEditTenant={noop} onViewTenantDetail={noop} />, /No tenants yet/],
  ['RegisterTab', RegisterTab, /No medications in the register yet/],
  ['MarTab', MarTab, /No medications are scheduled/],
  ['ReportTab', ReportTab, /No administrations found/],
]

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', fullName: 'Sarah Mitchell' }))
  apiGet.mockRejectedValue(new Error('Network Error'))
  apiGetWithDefault.mockRejectedValue(new Error('Network Error'))
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Network Error'))
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe.each(pages)('%s when its list fails to load', (_name, Page, emptyText) => {
  it('shows an error with a retry, not the empty state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect((await screen.findAllByText(/couldn't load/i)).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument()
  })
})
