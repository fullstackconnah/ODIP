import { describe, it, expect, vi } from 'vitest'
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
  reasons: ['Profile requires date of birth.'],
}

describe('OnboardingDetailPage', () => {
  it('exposes server-owned remediation actions and reports mutation failure', async () => {
    const profileMutate = vi.fn()
    mockUseQuery.mockReturnValue({ data: incomplete, isLoading: false })
    mockUseMutation.mockReturnValueOnce({ mutate: profileMutate, error: new Error('validation failed') }).mockReturnValueOnce({ mutate: vi.fn(), error: null })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/onboarding/p-1']}><Routes><Route path="/onboarding/:id" element={<OnboardingDetailPage />} /></Routes></MemoryRouter>)

    expect(screen.getByText('Profile requires date of birth.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Validate saved profile' }))
    expect(profileMutate).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not validate/i)
    expect(screen.getByText(/cannot sign or approve an agreement/i)).toBeInTheDocument()
  })
})
