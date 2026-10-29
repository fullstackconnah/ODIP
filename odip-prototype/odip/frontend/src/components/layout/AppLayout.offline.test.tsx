import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './AppLayout'
import { UiPreferencesProvider } from '@/hooks/useUiPreferences'
import { offlineQueue } from '@/lib/offline/queue'
import { writeSaved } from '@/lib/offline/store'
import { PrivateRoute } from '@/App'
import PortalShiftsPage from '@/pages/portal/PortalShiftsPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Sign out with changes still waiting on the phone asks first (it deletes them); with none it signs out at once.

const { mockEndSession, mockApi } = vi.hoisted(() => ({ mockEndSession: vi.fn(), mockApi: vi.fn(async (): Promise<unknown> => { throw new Error('Network Error') }) }))

vi.mock('@/api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks')>()
  return {
    ...actual,
    useModuleVisibility: () => ({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false }),
    usePendingWitnessRequests: () => ({ data: [], isLoading: false }),
    usePendingLeaveCount: () => 0,
    usePendingCompletionCount: () => 0,
    useInbox: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
    useMarkInboxRead: () => ({ mutate: vi.fn() }),
    useMarkAllInboxRead: () => ({ mutate: vi.fn(), reset: vi.fn(), isError: false }),
    useWhatsNew: () => ({ data: { entries: [], unreadCount: 0, popup: [] }, isError: false, refetch: vi.fn() }),
    useMarkWhatsNewSeen: () => ({ mutate: vi.fn() }),
    useMarkWhatsNewPopupSeen: () => ({ mutate: vi.fn() }),
  }
})
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), endSession: mockEndSession,
  apiGet: mockApi, apiPost: mockApi, apiPut: mockApi, apiPatch: mockApi, apiDelete: mockApi, apiGetWithDefault: mockApi, apiPostRaw: mockApi, apiDeleteRaw: mockApi,
  apiClient: { request: mockApi, get: mockApi, post: mockApi },
}))
vi.mock('@/components/layout/TenantSwitcher', () => ({ default: () => null }))
vi.mock('@/components/layout/UserSwitcher', () => ({ default: () => null }))

const record = (id: string) => ({
  id, userId: 'u1', viewAsTenant: null, viewAsUser: null, shiftId: 's1', kind: 'note', path: '/portal/shifts/s1/notes', method: 'POST',
  body: { id, createdAt: '2026-10-28T02:00:00Z', body: 'x' }, clientTime: '2026-10-28T02:00:00Z', createdAt: '2026-10-28T02:00:00Z', status: 'waiting',
  label: { participant: 'Jordan Smith', serviceDate: '2026-10-28', rostered: '9:00 am – 1:00 pm' },
})

function renderLayout() {
  return render(
    <UiPreferencesProvider>
      <MemoryRouter initialEntries={['/portal/shifts']}>
        <Routes><Route path="*" element={<AppLayout />} /></Routes>
      </MemoryRouter>
    </UiPreferencesProvider>,
  )
}
const signOutButton = () => within(document.querySelector('aside')!).getByRole('button', { name: /Sign out$/ })

beforeEach(() => {
  localStorage.clear()
  mockEndSession.mockReset()
  localStorage.setItem('odip_user', JSON.stringify({ id: 'u1', role: 'SupportWorker', fullName: 'Sam Worker' }))
})
afterEach(() => offlineQueue.wipeAll())

describe('Sign out with unsent changes', () => {
  it('with 2 unsent opens the dialog; Stay signed in does nothing, Sign out and delete wipes the queue and signs out', () => {
    localStorage.setItem('odip_offline:u1:queue', JSON.stringify([record('r1'), record('r2')]))
    renderLayout()
    fireEvent.click(signOutButton())
    const dialog = screen.getByRole('alertdialog', { name: 'Sign out and delete unsent changes?' })
    expect(within(dialog).getByText(/2 changes on this phone haven’t been sent yet\. Signing out deletes them from this phone\./)).toBeTruthy()
    expect(mockEndSession).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay signed in' }))
    expect(mockEndSession).not.toHaveBeenCalled()
    expect(localStorage.getItem('odip_offline:u1:queue')).not.toBeNull()

    fireEvent.click(signOutButton())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out and delete' }))
    expect(localStorage.getItem('odip_offline:u1:queue')).toBeNull()
    expect(mockEndSession).toHaveBeenCalledTimes(1)
  })

  it('with 0 unsent signs out at once, no dialog', () => {
    renderLayout()
    fireEvent.click(signOutButton())
    expect(screen.queryByRole('alertdialog', { name: 'Sign out and delete unsent changes?' })).toBeNull()
    expect(mockEndSession).toHaveBeenCalledTimes(1)
  })
})

describe('Cold offline start', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('cold offline start renders the saved shifts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T02:00:00Z'))
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    localStorage.setItem('odip_token', 'tok')
    const week = { shifts: [{ id: 's1', participantName: 'Jordan Smith', serviceDate: '2026-10-28', startTime: '09:00:00', endTime: '13:00:00', status: 'Published' }], tripAssignments: [], timeZoneId: 'Australia/Sydney' }
    writeSaved('u1', 'shifts:2026-10-25:2026-11-02', week)
    const path = window.location.pathname

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UiPreferencesProvider>
          <MemoryRouter initialEntries={['/portal/shifts']}>
            <Routes>
              <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
                <Route path="/portal/shifts" element={<PortalShiftsPage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </UiPreferencesProvider>
      </QueryClientProvider>,
    )

    expect((await screen.findAllByText('Jordan Smith')).length).toBeGreaterThan(0)
    expect(screen.getByText(/as saved at/)).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).toBeNull()
    expect(mockEndSession).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe(path)
  })
})
