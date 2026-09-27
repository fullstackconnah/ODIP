import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OnboardingDetailPage from './OnboardingDetailPage'

const { mockUseQuery, mockUseMutation, mockInvalidate } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(), mockUseMutation: vi.fn(), mockInvalidate: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
  useMutation: mockUseMutation,
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}))
vi.mock('@/api/client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

const incomplete = {
  participantId: 'p-1', intakeComplete: true, profileComplete: false,
  serviceTypeConfirmed: false, serviceAgreementSigned: false, isReady: false,
  reasons: ['Profile requires date of birth.', 'A current draft is required.'],
}

function renderDetail() {
  return render(<MemoryRouter initialEntries={['/onboarding/p-1']}><Routes><Route path="/onboarding/:id" element={<OnboardingDetailPage />} /></Routes></MemoryRouter>)
}

describe('OnboardingDetailPage', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    mockUseQuery.mockReturnValue({ data: incomplete, isLoading: false })
    mockUseMutation.mockReturnValue({ mutate: vi.fn(), error: null, isPending: false })
  })

  it('leads with identity, current stage, compact progress and exactly one recommended primary action', () => {
    renderDetail()

    expect(screen.getByText('Participant p-1')).toBeInTheDocument()
    expect(screen.getByText('Onboarding in progress')).toBeInTheDocument()
    expect(screen.getByText('Progress: 1 of 5 gates complete')).toBeInTheDocument()
    const recommendation = screen.getByRole('heading', { name: 'Validate saved profile' }).closest('section')!
    expect(recommendation.querySelectorAll('button, a')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Validate saved profile' })).toBeInTheDocument()
  })

  it('renders complete, needs-attention and blocked gates without fabricating server reason associations', () => {
    renderDetail()

    expect(screen.getByText('Intake PDF').parentElement).toHaveTextContent('Complete')
    expect(screen.getByText('Profile essentials').parentElement).toHaveTextContent('Needs attention')
    expect(screen.getByText('Schedule review').parentElement).toHaveTextContent('Blocked')
    expect(screen.getByText('The API supplies these as an overall readiness list, not as gate-specific associations.')).toBeInTheDocument()
    expect(screen.getByText('Profile requires date of birth.')).toBeInTheDocument()
  })

  it('uses the existing validation endpoint only when the lifecycle capability is present', async () => {
    const profileMutate = vi.fn()
    mockUseMutation.mockReturnValueOnce({ mutate: profileMutate, error: new Error('validation failed'), isPending: false }).mockReturnValueOnce({ mutate: vi.fn(), error: null, isPending: false })
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Validate saved profile' }))
    expect(profileMutate).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not validate/i)
  })

  it('preserves readable status but suppresses mutation controls when lifecycle capability is absent', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderDetail()

    expect(screen.getByText('Participant p-1')).toBeInTheDocument()
    expect(screen.getByText('Read-only access: lifecycle changes are unavailable for this role.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validate saved profile' })).not.toBeInTheDocument()
  })
})
