import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom'
import OnboardingDetailPage from './OnboardingDetailPage'
import { __testHooks } from '@/hooks/useBackNavigation'

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

// The previous-path tracker is module state: no test may leave its path behind for the next one.
afterEach(() => __testHooks.reset())

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
    const recommendation = screen.getByRole('heading', { name: 'Validate profile data' }).closest('section')!
    expect(recommendation.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Validate profile data' })).toBeInTheDocument()
    expect(within(recommendation).getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/participants/p-1/profile')
  })

  it('collapses the stage / next-action grid to one column on a phone through a min(26rem,100%) track floor, with no max-md override left to maintain', () => {
    renderDetail()

    // jsdom has no layout, so the class is the only observable proof: a bare minmax(26rem,1fr)
    // floor (416px) overflows a 390px viewport.
    const grid = screen.getByText('Onboarding in progress').closest('.rounded-md')!.parentElement!
    expect(grid).toHaveClass('grid', 'items-start', 'grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))]')
    expect(grid).not.toHaveClass('max-md:grid-cols-1')
  })

  it('renders complete, needs-attention and blocked gates via StatusBadge without fabricating reason associations', () => {
    renderDetail()

    expect(screen.getByText('Intake completed').parentElement).toHaveTextContent('Complete')
    expect(screen.getByText('Participant Profile').parentElement).toHaveTextContent('Needs attention')
    expect(screen.getByText('Schedule review').parentElement).toHaveTextContent('Blocked')
    // approving an agreement revision for rostering makes the patterns and shifts, so this gate no longer says that none can be made; it says where they are
    expect(screen.getByText('The schedule is made when the agreement draft is approved for rostering. Nothing is created from this page.')).toBeInTheDocument()
    expect(screen.queryByText(/no shifts are created/)).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Validate profile data' }))
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
    expect(within(recommendation).getByText(/The schedule is made when an agreement revision is approved for rostering, from its draft page/)).toBeInTheDocument()
    expect(within(recommendation).queryByText(/proposal-only|no shifts are created here/)).not.toBeInTheDocument()
  })

  it('preserves readable status but suppresses mutation controls when lifecycle capability is absent', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderDetail()

    expect(screen.getByRole('heading', { level: 1, name: 'Jamie Rivers' })).toBeInTheDocument()
    expect(screen.getByText('Read-only access: lifecycle changes are unavailable for this role.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate profile data' })).not.toBeInTheDocument()
  })

  // An agreement draft carries money, and the API admits only Admin, Coordinator and SuperAdmin to it: a role that can read this page is not sent to a page it would meet a redirect or a 403 on.
  it('offers the agreement draft to the roles the API admits to it, in the gate list and as the next action', () => {
    mockUseQuery.mockReturnValue({ data: { ...incomplete, profileComplete: true, serviceTypeConfirmed: true }, isLoading: false })     // the agreement is the next thing to do
    for (const role of ['SuperAdmin', 'Admin', 'Coordinator']) {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      const { unmount } = renderDetail()
      expect(screen.getByRole('link', { name: 'Open agreement draft' }), role).toHaveAttribute('href', '/participants/p-1/agreement-draft')
      expect(screen.getByRole('link', { name: 'Review agreement evidence' }), role).toHaveAttribute('href', '/participants/p-1/agreement-draft')
      unmount()
    }
  })

  it('does not send a ReadOnly or SupportWorker reader of the page to the agreement draft', () => {
    mockUseQuery.mockReturnValue({ data: { ...incomplete, profileComplete: true, serviceTypeConfirmed: true }, isLoading: false })
    for (const role of ['ReadOnly', 'SupportWorker']) {
      localStorage.setItem('odip_user', JSON.stringify({ role }))
      const { unmount } = renderDetail()
      expect(screen.getByRole('heading', { level: 1, name: 'Jamie Rivers' }), role).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /agreement draft/i }), role).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Review agreement evidence' }), role).not.toBeInTheDocument()
      unmount()
    }
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

    // A real link now (it was a button that called navigate), so it has a destination to open or copy.
    const back = screen.getByRole('link', { name: /Back to/i })
    expect(back).toHaveAccessibleName('Back to onboarding')
    expect(back).toHaveAttribute('href', '/participants?tab=onboarding')

    await userEvent.setup().click(back)
    expect(router.state.location.pathname).toBe('/participants')
    expect(router.state.location.search).toBe('?tab=onboarding')
  })

  // L5-01: history-aware Back keeps ONE previous path, not a stack. Hub > Onboarding > Open > "Complete intake" > wizard Back lands here with the
  // wizard as the previous path, so Back on THIS page went back into the wizard, whose Back came back here, forever: the Onboarding table
  // was unreachable with Back. This page is a hub child like every other detail page: its Back is always the hub tab.
  it('always goes to the hub Onboarding tab, never back into the wizard the user has just left', async () => {
    __testHooks.reset()
    __testHooks.recordCurrentPath('/participants/p-1/intake')
    __testHooks.recordCurrentPath('/onboarding/p-1')
    const router = createMemoryRouter(
      [
        { path: '/participants', element: <div>Hub placeholder</div> },
        { path: '/onboarding/:id', element: <OnboardingDetailPage /> },
      ],
      { initialEntries: ['/onboarding/p-1'] },
    )
    render(<RouterProvider router={router} />)

    const back = screen.getByRole('link', { name: /Back to|Go back/i })
    expect(back).toHaveAttribute('href', '/participants?tab=onboarding')
    expect(back).toHaveAccessibleName('Back to onboarding')

    await userEvent.setup().click(back)
    expect(router.state.location.pathname).toBe('/participants')
  })
})


// Finishing onboarding is the Profile wizard's Complete Profile: it finalises the participant, and when the organisation's readiness rule allows it
// they become active and move to Active participants. The checklist used to offer the wizard (as "Edit profile") only while the profile gate was open,
// so a coordinator who had validated the profile data and confirmed the service needs found the participant stuck on Onboarding with nothing that ends it.
describe('OnboardingDetailPage — finishing onboarding', () => {
  const draft = (overrides: Record<string, unknown> = {}) => ({ firstName: 'Jamie', lastName: 'Rivers', preferredName: null, isDraft: true, ...overrides })
  const explanation = () => screen.getByText(/finishes onboarding/i)

  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseQuery.mockReturnValue({ data: incomplete, isLoading: false })
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), error: null, isPending: false })
    mockUseParticipant.mockReturnValue({ data: draft(), isLoading: false })
  })

  it('offers Complete profile beside the explanation, as a link to the Profile wizard, for a draft whose intake is complete', () => {
    renderDetail()

    const complete = within(explanation().parentElement as HTMLElement).getByRole('link', { name: 'Complete profile' })
    expect(complete).toHaveAttribute('href', '/participants/p-1/profile')
  })

  it('still offers it once the profile data is validated and every later gate has moved on: the case where nothing else on the page finished onboarding', () => {
    mockUseQuery.mockReturnValue({ data: readyForSchedule, isLoading: false })
    renderDetail()

    expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument()
    expect(within(explanation().parentElement as HTMLElement).getByRole('link', { name: 'Complete profile' })).toHaveAttribute('href', '/participants/p-1/profile')
  })

  it('is not offered once the participant is finalised: there is no onboarding left to finish', () => {
    mockUseParticipant.mockReturnValue({ data: draft({ isDraft: false }), isLoading: false })
    renderDetail()

    expect(screen.queryByRole('link', { name: 'Complete profile' })).not.toBeInTheDocument()
  })

  it('is not offered before the intake is complete: the next step is the intake', () => {
    mockUseQuery.mockReturnValue({ data: { ...incomplete, intakeComplete: false }, isLoading: false })
    renderDetail()

    expect(screen.queryByRole('link', { name: 'Complete profile' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Complete intake' })).toBeInTheDocument()
  })

  it('is not offered while the participant is still loading, or to a role without the lifecycle capability', () => {
    mockUseParticipant.mockReturnValue({ data: undefined, isLoading: true })
    const loading = renderDetail()
    expect(screen.queryByRole('link', { name: 'Complete profile' })).not.toBeInTheDocument()
    loading.unmount()

    mockUseParticipant.mockReturnValue({ data: draft(), isLoading: false })
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderDetail()
    expect(screen.queryByRole('link', { name: 'Complete profile' })).not.toBeInTheDocument()
  })

  it('calls the gate action "Validate profile data", so it is not mistaken for the Profile wizard\'s Complete Profile', () => {
    renderDetail()

    expect(screen.getByRole('heading', { name: 'Validate profile data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validate profile data' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /validate saved profile/i })).not.toBeInTheDocument()
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
    expect(screen.getByText('Loading onboarding record\u2026')).toBeInTheDocument()

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
    expect(screen.queryByText('Loading onboarding record\u2026')).not.toBeInTheDocument()
    expect(screen.getByText('Participant Profile')).toBeInTheDocument()
    expect(orderWarning()).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('OnboardingDetailPage — failed request vs. missing record (PageState)', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), error: null, isPending: false })
    mockUseParticipant.mockReturnValue({ data: { firstName: 'Jamie', lastName: 'Rivers', preferredName: null }, isLoading: false })
  })

  it('names a failed request as a failure, with a retry, not "Onboarding record not found"', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderDetail()

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this onboarding record")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Onboarding record not found')).not.toBeInTheDocument()
  })

  it('shows "Onboarding record not found" with a Back link to the hub for a 404', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderDetail()

    expect(screen.getByText('Onboarding record not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to onboarding' })).toHaveAttribute('href', '/participants?tab=onboarding')
  })
})
