import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import OnboardingPage from './OnboardingPage'

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: mockUseQuery }))

describe('OnboardingPage', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  })

  it('shows tenant-derived stage, progress, and one dominant next action that preserves the participant route', async () => {
    mockUseQuery.mockReturnValue({ data: [{ participantId: 'p-1', fullName: 'Jamie Rivers', stage: 'Onboarding incomplete', completedSteps: 2, totalSteps: 5, nextAction: 'Confirm service needs' }], isLoading: false })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route path="/onboarding" element={<OnboardingPage />} /><Route path="/onboarding/:id" element={<div>Checklist route</div>} /></Routes></MemoryRouter>)

    expect(screen.getByText('Jamie Rivers')).toBeInTheDocument()
    expect(screen.getByText('Onboarding incomplete')).toBeInTheDocument()
    expect(screen.getByText('2 of 5 gates')).toBeInTheDocument()
    expect(screen.getByText('Confirm service needs')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Open: Confirm service needs' }))
    expect(screen.getByText('Checklist route')).toBeInTheDocument()
  })

  it('keeps the readable worklist but does not promise a lifecycle mutation to ReadOnly', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUseQuery.mockReturnValue({ data: [{ participantId: 'p-2', fullName: 'Avery Lee', stage: 'Intake incomplete', completedSteps: 0, totalSteps: 5, nextAction: 'Complete intake' }], isLoading: false })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    expect(screen.getByText('Avery Lee')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View checklist' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open: complete intake/i })).not.toBeInTheDocument()
  })
})
