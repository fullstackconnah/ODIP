import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import OnboardingPage from './OnboardingPage'

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: mockUseQuery }))

describe('OnboardingPage', () => {
  it('shows server-derived incomplete work and routes the next action to its checklist', async () => {
    mockUseQuery.mockReturnValue({ data: [{ participantId: 'p-1', fullName: 'Jamie Rivers', stage: 'Onboarding incomplete', completedSteps: 2, totalSteps: 4, nextAction: 'Confirm service needs' }], isLoading: false })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route path="/onboarding" element={<OnboardingPage />} /><Route path="/onboarding/:id" element={<div>Checklist route</div>} /></Routes></MemoryRouter>)

    expect(screen.getByText('Jamie Rivers')).toBeInTheDocument()
    expect(screen.getByText('2 of 4 steps')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm service needs' }))
    expect(screen.getByText('Checklist route')).toBeInTheDocument()
  })
})
