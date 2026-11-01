import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import StaffDetailPage from './StaffDetailPage'
import type { StaffDetailDto, StaffOverviewDto } from '@/api/types/staff'

// Reset two-step verification on the staff page: who sees the button, the confirm, and what each server answer says.

const { mockUseStaffOverview, mockReset, outcome } = vi.hoisted(() => ({
  mockUseStaffOverview: vi.fn(),
  mockReset: vi.fn(),
  outcome: { fail: null as unknown },
}))

vi.mock('@/api/hooks', () => ({
  useStaffOverview: mockUseStaffOverview,
  useSettings: () => ({ data: { qualificationWarningDays: 30 } }),
  useModuleVisibility: () => ({ data: { employmentHeroConnected: false } }),
  useStaffLeaveBalances: () => ({ data: undefined, isLoading: false, isError: false, refetch: () => undefined }),
  useEnsureStaffSignInAccount: () => ({ mutateAsync: vi.fn() }),
  useRecordInvitesSent: () => ({ mutate: vi.fn() }),
  useConfirmStaffAddress: () => ({ mutateAsync: vi.fn() }),
  useResetStaffTwoStep: () => ({
    mutateAsync: async (id: string) => {
      mockReset(id)
      if (outcome.fail) throw outcome.fail
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
      id: 'staff-1', firstName: 'Una', lastName: 'Odd', fullName: 'Una Odd', username: 'una', role: 'Coordinator', position: 'SupportWorker',
      email: 'una@other.org', mobile: null, region: 'North', isActive: true, hasExpiredQualifications: false, notes: null,
      hasSignedIn: true, signInAddressUnconfirmed: false, ...staff,
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

const button = () => screen.queryByRole('button', { name: 'Reset two-step verification' })

beforeEach(() => {
  mockReset.mockReset()
  outcome.fail = null
})

describe('StaffDetailPage: reset two-step verification', () => {
  it.each([
    ['Admin', 'Coordinator', true],
    ['Admin', 'Admin', false],
    ['Admin', 'SuperAdmin', false],
    ['SuperAdmin', 'Admin', true],
    ['SuperAdmin', 'SuperAdmin', false],
    ['Coordinator', 'SupportWorker', false],
  ])('%s viewing a %s: button shown = %s', (viewer, target, shown) => {
    renderPage({ role: target } as Partial<StaffDetailDto>, viewer)

    expect(button() !== null).toBe(shown)
  })

  it('is not offered for someone who has never signed in', () => {
    renderPage({ hasSignedIn: false })

    expect(button()).toBeNull()
  })

  it('confirms first, then resets and says so', async () => {
    const u = renderPage()
    await u.click(button()!)

    expect(screen.getByText('Reset two-step verification for Una Odd?')).toBeInTheDocument()
    expect(screen.getByText("They'll set it up again with their authenticator app next time they sign in with a password. They'll be signed out within 30 minutes.")).toBeInTheDocument()
    expect(mockReset).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => expect(mockReset).toHaveBeenCalledWith('staff-1'))
    expect(await screen.findByText("Una Odd's two-step verification is reset. They'll set it up again next time they sign in.")).toBeInTheDocument()
  })

  it.each([
    [400, "Una Odd doesn't have a sign-in yet, so there's nothing to reset."],
    [403, "You can't reset two-step verification for this person."],
    [502, "We couldn't reach the sign-in service. Try again."],
    [undefined, "We couldn't reach the sign-in service. Try again."],
  ])('says what happened on %s, inside the dialog', async (status, sentence) => {
    outcome.fail = status ? { response: { status } } : new Error('Network Error')
    const u = renderPage()
    await u.click(button()!)
    await u.click(screen.getByRole('button', { name: 'Reset' }))

    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.getByText('Reset two-step verification for Una Odd?')).toBeInTheDocument()
  })
})
