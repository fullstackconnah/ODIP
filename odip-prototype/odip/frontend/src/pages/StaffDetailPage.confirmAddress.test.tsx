import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import StaffDetailPage from './StaffDetailPage'
import type { StaffOverviewDto, StaffDetailDto } from '@/api/types/staff'

// An address the Employment Hero sync brought and the server holds (signInAddressUnconfirmed) waits for an Admin, Coordinator or SuperAdmin to confirm it
// on the staff page: the Confirm address button takes the place of Send set-password email until they do.

// `outcome` is what the confirm answers with. The spy is separate from it: vitest reports a rejection that comes back through a vi.fn as unhandled, even when the caller catches it.
const { mockUseStaffOverview, mockConfirm, confirmOutcome } = vi.hoisted(() => ({
  mockUseStaffOverview: vi.fn(),
  mockConfirm: vi.fn(),
  confirmOutcome: { fail: null as unknown },
}))

vi.mock('@/api/hooks', () => ({
  useStaffOverview: mockUseStaffOverview,
  useSettings: () => ({ data: { qualificationWarningDays: 30 } }),
  useModuleVisibility: () => ({ data: { employmentHeroConnected: false } }),
  useStaffLeaveBalances: () => ({ data: undefined, isLoading: false, isError: false, refetch: () => undefined }),
  useEnsureStaffSignInAccount: () => ({ mutateAsync: vi.fn() }),
  useRecordInvitesSent: () => ({ mutate: vi.fn() }),
  useConfirmStaffAddress: () => ({
    mutateAsync: async (id: string) => {
      mockConfirm(id)
      if (confirmOutcome.fail) throw confirmOutcome.fail
      return true
    },
  }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ auth: { name: 'auth-stub' } }))

function renderPage(staff: Partial<StaffDetailDto> = {}, role = 'Admin') {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  const overview = {
    staff: {
      id: 'staff-1', firstName: 'Una', lastName: 'Odd', fullName: 'Una Odd', username: 'una', role: 'SupportWorker', position: 'SupportWorker',
      email: 'una@other.org', mobile: null, region: 'North', isActive: true, hasExpiredQualifications: false, notes: null,
      signInAddressUnconfirmed: true, ...staff,
    },
    availability: [], upcomingShifts: [], upcomingTripAssignments: [], recentIncidents: [], recentCompletions: [],
  } as unknown as StaffOverviewDto
  mockUseStaffOverview.mockReturnValue({ data: overview, isLoading: false })
  render(
    <MemoryRouter initialEntries={['/staff/staff-1']}>
      <Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mockConfirm.mockReset()
  confirmOutcome.fail = null
})

describe('StaffDetailPage: a held sign-in address', () => {
  it('offers Confirm address instead of the set-password email, with a warning that says why', () => {
    renderPage()

    expect(screen.getByRole('button', { name: 'Confirm address' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send set-password email' })).not.toBeInTheDocument()
    expect(screen.getByText(/una@other\.org came from Employment Hero/)).toBeInTheDocument()
  })

  it('asks the admin to check the address, and confirms only on Use this address', async () => {
    const user = renderPage({}, 'Coordinator')

    await user.click(screen.getByRole('button', { name: 'Confirm address' }))
    expect(screen.getByText('Check this address')).toBeInTheDocument()
    expect(screen.getByText(/The sign-in link goes to whoever owns it/)).toBeInTheDocument()
    expect(mockConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(mockConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm address' }))
    await user.click(screen.getByRole('button', { name: 'Use this address' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('staff-1'))
  })

  it('says so when the confirm fails and keeps the warning', async () => {
    confirmOutcome.fail = { response: { data: { errors: ['Nope, not allowed.'] } } }
    const user = renderPage()

    await user.click(screen.getByRole('button', { name: 'Confirm address' }))
    await user.click(screen.getByRole('button', { name: 'Use this address' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nope, not allowed.'))
    expect(screen.getByText(/una@other\.org came from Employment Hero/)).toBeInTheDocument()
  })

  it('shows the usual button when the address is not held', () => {
    renderPage({ signInAddressUnconfirmed: false })

    expect(screen.getByRole('button', { name: 'Send set-password email' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm address' })).not.toBeInTheDocument()
  })

  it('shows nothing about it to a role that cannot confirm', () => {
    renderPage({ signInAddressUnconfirmed: null }, 'SupportWorker')

    expect(screen.queryByRole('button', { name: 'Confirm address' })).not.toBeInTheDocument()
    expect(screen.queryByText(/came from Employment Hero/)).not.toBeInTheDocument()
  })

  it('offers nothing for an inactive person', () => {
    renderPage({ isActive: false })

    expect(screen.queryByRole('button', { name: 'Confirm address' })).not.toBeInTheDocument()
  })
})
