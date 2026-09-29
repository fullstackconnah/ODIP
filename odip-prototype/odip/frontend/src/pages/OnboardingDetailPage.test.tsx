import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom'
import OnboardingDetailPage from './OnboardingDetailPage'

const { mockUseQuery, mockUseMutation, mockInvalidate, mockUseParticipant } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(), mockUseMutation: vi.fn(), mockInvalidate: vi.fn(), mockUseParticipant: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
  useMutation: mockUseMutation,
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}))
vi.mock('@/api/client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useParticipant: mockUseParticipant }))

const incomplete = {
  participantId: 'p-1', intakeComplete: true, profileComplete: false,
  serviceTypeConfirmed: false, serviceAgreementSigned: false, isReady: false,
  reasons: ['Profile requires date of birth.', 'A current draft is required.'],
}

const readyForSchedule = {
  participantId: 'p-1', intakeComplete: true, profileComplete: true,
  serviceTypeConfirmed: true, serviceAgreementSigned: true, isReady: false,
  reasons: [],
}

function renderDetail() {
  return render(<MemoryRouter initialEntries={['/onboarding/p-1']}><Routes><Route path="/onboarding/:id" element={<OnboardingDetailPage />} /></Routes></MemoryRouter>)
}

describe('OnboardingDetailPage', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseQuery.mockReturnValue({ data: incomplete, isLoading: false })
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), error: null, isPending: false })
    mockUseParticipant.mockReturnValue({ data: { firstName: 'Jamie', lastName: 'Rivers', preferredName: null }, isLoading: false })
  })

  it('shows the participant\'s name in the heading, never the raw participantId GUID', () => {
    renderDetail()

    expect(screen.getByRole('heading', { level: 1, name: 'Jamie Rivers' })).toBeInTheDocument()
    expect(screen.queryByText('Participant p-1')).not.toBeInTheDocument()
    expect(screen.queryByText(/^p-1$/)).not.toBeInTheDocument()
  })

  it('shows a Loading… placeholder in the heading while the participant is still loading, never the GUID', () => {
    mockUseParticipant.mockReturnValue({ data: undefined, isLoading: true })
    renderDetail()

    expect(screen.getByRole('heading', { level: 1, name: 'Loading…' })).toBeInTheDocument()
    expect(screen.queryByText('Participant p-1')).not.toBeInTheDocument()
  })

  it('leads with identity, current stage, compact progress and exactly one recommended primary action plus its edit link', () => {
    renderDetail()

    expect(screen.getByText('Onboarding in progress')).toBeInTheDocument()
    expect(screen.getByText('Progress: 1 of 5 gates complete')).toBeInTheDocument()
    const recommendation = screen.getByRole('heading', { name: 'Validate saved profile' }).closest('section')!
    expect(recommendation.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Validate saved profile' })).toBeInTheDocument()
    expect(within(recommendation).getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/participants/p-1/profile')
  })

  it('renders complete, needs-attention and blocked gates via StatusBadge without fabricating reason associations', () => {
    renderDetail()

    expect(screen.getByText('Intake completed').parentElement).toHaveTextContent('Complete')
    expect(screen.getByText('Participant Profile').parentElement).toHaveTextContent('Needs attention')
    expect(screen.getByText('Schedule review').parentElement).toHaveTextContent('Blocked')
    expect(screen.getByText("What's still missing")).toBeInTheDocument()
    expect(screen.getByText('Profile requires date of birth.')).toBeInTheDocument()
  })

  it('gives a Needs-attention profile gate row an Edit profile link', () => {
    renderDetail()

    const profileGate = screen.getByText('Participant Profile').closest('article')!
    const editLink = within(profileGate).getByRole('link', { name: 'Edit profile' })
    expect(editLink).toHaveAttribute('href', '/participants/p-1/profile')
  })

  it('uses the existing validation endpoint only when the lifecycle capability is present, and gives a remediation hint on failure', async () => {
    const profileMutate = vi.fn()
    mockUseMutation.mockReturnValueOnce({ mutate: profileMutate, error: new Error('validation failed'), isPending: false }).mockReturnValueOnce({ mutate: vi.fn(), error: null, isPending: false })
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Validate saved profile' }))
    expect(profileMutate).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent(/edit the profile, then validate again/i)
  })

  it('gives a secondary "Edit service needs" link alongside the confirm button once the profile gate is complete', () => {
    mockUseQuery.mockReturnValue({ data: { ...incomplete, profileComplete: true }, isLoading: false })
    renderDetail()

    const recommendation = screen.getByRole('heading', { name: 'Confirm saved service needs' }).closest('section')!
    expect(within(recommendation).getByRole('button', { name: 'Confirm saved service needs' })).toBeInTheDocument()
    expect(within(recommendation).getByRole('link', { name: 'Edit service needs' })).toHaveAttribute('href', '/participants/p-1?tab=support')
  })

  it('gives the final "Review schedule proposal" gate a link into rostering instead of a dead end', () => {
    mockUseQuery.mockReturnValue({ data: readyForSchedule, isLoading: false })
    renderDetail()

    const recommendation = screen.getByRole('heading', { name: 'Review schedule proposal' }).closest('section')!
    expect(within(recommendation).getByRole('link', { name: 'Open shift patterns' })).toHaveAttribute('href', '/rostering/patterns')
  })

  it('preserves readable status but suppresses mutation controls when lifecycle capability is absent', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderDetail()

    expect(screen.getByRole('heading', { level: 1, name: 'Jamie Rivers' })).toBeInTheDocument()
    expect(screen.getByText('Read-only access: lifecycle changes are unavailable for this role.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate saved profile' })).not.toBeInTheDocument()
  })

  it('routes the Back control to the Participants hub Onboarding tab on direct deep-link', async () => {
    // Deep-link entry — no prior history. The Back control must fall back to the hub's
    // Onboarding tab (a real, current route) rather than the removed /onboarding list screen.
    const router = createMemoryRouter(
      [
        { path: '/participants', element: <div>Hub placeholder</div> },
        { path: '/onboarding/:id', element: <OnboardingDetailPage /> },
      ],
      { initialEntries: ['/onboarding/p-1'] },
    )
    render(<RouterProvider router={router} />)

    const back = screen.getByRole('button', { name: /Back to/i })
    expect(back).toHaveAccessibleName('Back to Onboarding')

    await userEvent.setup().click(back)
    expect(router.state.location.pathname).toBe('/participants')
    expect(router.state.location.search).toBe('?tab=onboarding')
  })
})


// Regression (2026-09-29, found in live QA after the hub-back change): the page's
// useBackTarget hook originally sat AFTER the `if (detail.isLoading) return` early return.
// Every other test here renders with isLoading:false, so that path was never exercised and the
// whole suite stayed green while the deployed page crashed with React error #310
// ("rendered fewer hooks than expected") the moment the async detail query resolved in the real
// app. This test drives the loading -> loaded transition, which is what the real app does.
describe('OnboardingDetailPage — hook ordering across the loading transition', () => {
  it('survives the loading -> loaded transition without a hooks-order crash', async () => {
    // React only *warns* on a hooks-order change, so a bare render would still "pass" while the
    // deployed app crashes with error #310. Fail loudly on that specific console.error instead.
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      void args
    })
    const orderWarning = () =>
      consoleError.mock.calls.some(c => String(c[0]).includes('order of Hooks'))
    try {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), error: null, isPending: false })
    mockUseParticipant.mockReturnValue({ data: { firstName: 'Jamie', lastName: 'Rivers', preferredName: null }, isLoading: false })

    // First render: the query is still in flight, so the page takes its early return.
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true })
    const { rerender } = renderDetail()
    expect(screen.getByText('Loading onboarding\u2026')).toBeInTheDocument()

    // Then the real transition: the query resolves and the full page renders.
    mockUseQuery.mockReturnValue({ data: incomplete, isLoading: false })
    rerender(
      <MemoryRouter initialEntries={['/onboarding/p-1']}>
        <Routes><Route path="/onboarding/:id" element={<OnboardingDetailPage />} /></Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Jamie Rivers' })).toBeInTheDocument()
    })
    expect(screen.queryByText('Loading onboarding\u2026')).not.toBeInTheDocument()
    expect(screen.getByText('Participant Profile')).toBeInTheDocument()
    expect(orderWarning()).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })
})
