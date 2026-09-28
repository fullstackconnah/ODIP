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
    await user.click(screen.getByRole('button', { name: 'Open onboarding for Jamie Rivers' }))
    expect(screen.getByText('Checklist route')).toBeInTheDocument()
  })

  it('keeps the readable worklist but does not promise a lifecycle mutation to ReadOnly', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUseQuery.mockReturnValue({ data: [{ participantId: 'p-2', fullName: 'Avery Lee', stage: 'Intake incomplete', completedSteps: 0, totalSteps: 5, nextAction: 'Complete intake' }], isLoading: false })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    expect(screen.getByText('Avery Lee')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View checklist' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open onboarding for/i })).not.toBeInTheDocument()
  })

  it('shows an empty state with a link back to Enquiries when there is no onboarding work', () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    expect(screen.getByText('No participants in onboarding')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View enquiries' })).toHaveAttribute('href', '/inquiries')
  })

  it('shows a retry-able error banner instead of the empty state when the worklist fails to load', async () => {
    const refetch = vi.fn()
    mockUseQuery.mockReturnValue({ data: [], isLoading: false, isError: true, refetch })
    const user = userEvent.setup()
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the onboarding worklist/i)
    expect(screen.queryByText('No participants in onboarding')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('renders gate progress as an accessible progressbar, not just a text fraction', () => {
    mockUseQuery.mockReturnValue({ data: [{ participantId: 'p-3', fullName: 'Rowan Vale', stage: 'Onboarding incomplete', completedSteps: 2, totalSteps: 5, nextAction: 'Confirm service needs' }], isLoading: false })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    const bar = screen.getByRole('progressbar', { name: '2 of 5 gates' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
    // the numeric label stays visible, so progress is never colour-only
    expect(screen.getByText('2 of 5 gates')).toBeInTheDocument()
  })

  it('derives a triage badge from the blocking reasons, and shows the remaining reasons', () => {
    mockUseQuery.mockReturnValue({
      data: [{ participantId: 'p-4', fullName: 'Sam Okafor', stage: 'Onboarding incomplete', completedSteps: 1, totalSteps: 5,
        nextAction: 'Validate profile essentials', reasons: ['Ndis number missing', 'Consent not signed'] }],
      isLoading: false,
    })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    // first reason is the badge label; the rest are listed under the next action
    expect(screen.getByText('Ndis number missing')).toBeInTheDocument()
    expect(screen.getByText('Consent not signed')).toBeInTheDocument()
  })
})
