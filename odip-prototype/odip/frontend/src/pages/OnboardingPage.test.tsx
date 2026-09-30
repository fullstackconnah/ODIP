import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, RouterProvider, createMemoryRouter } from 'react-router-dom'
import OnboardingPage, { OnboardingTable } from './OnboardingPage'
import { intakeCompleteState } from './intake/intakeComplete'

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
    expect(screen.getByRole('link', { name: 'View enquiries' })).toHaveAttribute('href', '/participants?tab=enquiries')
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

  it('filters the worklist by participant name, stage and gate reasons', async () => {
    mockUseQuery.mockReturnValue({ data: [
      { participantId: 'p-1', fullName: 'Jamie Rivers', stage: 'Onboarding incomplete', completedSteps: 2, totalSteps: 5, nextAction: 'Confirm service needs', reasons: ['Missing current NDIS plan'] },
      { participantId: 'p-2', fullName: 'Avery Lee', stage: 'Intake incomplete', completedSteps: 0, totalSteps: 5, nextAction: 'Complete intake', reasons: [] },
    ], isLoading: false })
    const user = userEvent.setup()
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)

    expect(screen.getByText('Jamie Rivers')).toBeInTheDocument()
    expect(screen.getByText('Avery Lee')).toBeInTheDocument()

    const box = () => screen.getByRole('textbox', { name: /search participants/i })
    await user.type(box(), 'Avery')
    expect(screen.queryByText('Jamie Rivers')).not.toBeInTheDocument()
    expect(screen.getByText('Avery Lee')).toBeInTheDocument()

    await user.clear(box())
    await user.type(box(), 'NDIS plan')
    expect(screen.getByText('Jamie Rivers')).toBeInTheDocument()
    expect(screen.queryByText('Avery Lee')).not.toBeInTheDocument()
  })
})

describe('OnboardingTable: arriving from a completed intake', () => {
  const rows = [
    { participantId: 'p-1', fullName: 'Jamie Rivers', stage: 'Onboarding incomplete', completedSteps: 1, totalSteps: 5, nextAction: 'Validate profile essentials' },
    { participantId: 'p-2', fullName: 'Avery Lee', stage: 'Onboarding incomplete', completedSteps: 1, totalSteps: 5, nextAction: 'Validate profile essentials' },
  ]
  const HIGHLIGHT = 'bg-[var(--color-primary)]/10'

  function renderArrival(state: unknown) {
    mockUseQuery.mockReturnValue({ data: rows, isLoading: false })
    const router = createMemoryRouter(
      [{ path: '/participants', element: <OnboardingTable /> }],
      { initialEntries: [{ pathname: '/participants', search: '?tab=onboarding', state }] },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it('confirms the intake in a polite status message and highlights that participant\'s row only', () => {
    renderArrival(intakeCompleteState('p-1', 'Jamie Rivers'))

    expect(screen.getByRole('status')).toHaveTextContent('Intake complete — Jamie Rivers is now in onboarding.')
    expect(screen.getByText('Jamie Rivers').closest('tr')).toHaveClass(HIGHLIGHT)
    expect(screen.getByText('Avery Lee').closest('tr')).not.toHaveClass(HIGHLIGHT)
  })

  it('shows it once: the notice is cleared from history state (so a reload does not replay it) while it stays on screen', async () => {
    const router = renderArrival(intakeCompleteState('p-1', 'Jamie Rivers'))

    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(router.state.location.pathname + router.state.location.search).toBe('/participants?tab=onboarding')
    expect(screen.getByRole('status')).toHaveTextContent(/intake complete/i)
  })

  it('shows no confirmation and highlights nothing for an ordinary visit, or for unrecognised navigation state', () => {
    renderArrival({ intakeComplete: { participantId: 42 } })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    for (const row of screen.getAllByRole('row').slice(1)) expect(row).not.toHaveClass(HIGHLIGHT)
  })
})

describe('OnboardingTable: column budget (the table must fit, not scroll sideways)', () => {
  // jsdom does no layout, so this pins the cause. DataTable cells never wrap, so an unbudgeted stage chip (the first
  // blocking reason, a full sentence) or reasons list sets its column's width: with realistic rows the table was ~2000px
  // wide at 1280 and "Action" sat off the right edge. Measured in a browser at 1280/1366/1440, see REPORT.md.
  const LONG_REASON = 'A current dated provisional service-agreement draft with valid catalogue-priced support lines is required.'
  const LONG_NEXT = 'Confirm service needs for the current draft revision and review the agreement evidence with the representative'

  function renderLongRow() {
    mockUseQuery.mockReturnValue({
      data: [{ participantId: 'p-9', fullName: 'Alexandra Christine Montgomery-Featherstonehaugh', stage: 'Onboarding incomplete', completedSteps: 2, totalSteps: 5,
        nextAction: LONG_NEXT, reasons: [LONG_REASON, 'Current immutable agreement evidence is pending; the UnapprovedDraft source is not complete or eligible.'] }],
      isLoading: false,
    })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)
  }

  it('wraps the stage chip inside a cap instead of letting a long reason set the column width', () => {
    renderLongRow()
    const chip = screen.getByText(LONG_REASON)
    expect(chip).toHaveClass('md:max-w-[18rem]', 'md:whitespace-normal', 'md:inline-block')
  })

  it('lets the next-action cell and the participant name wrap (no nowrap), with the next action capped in width', () => {
    renderLongRow()
    const next = screen.getByText(LONG_NEXT).closest('td')!
    expect(next).not.toHaveClass('md:whitespace-nowrap')
    expect(screen.getByText(LONG_NEXT).parentElement).toHaveClass('md:max-w-[32rem]')
    expect(screen.getByText('Alexandra Christine Montgomery-Featherstonehaugh').closest('td')).not.toHaveClass('md:whitespace-nowrap')
  })

  it('keeps a floor under every column, so none is squeezed out of view and the headers stay readable', () => {
    renderLongRow()
    const floors: Record<string, string> = { Participant: '9rem', 'Current stage': '11rem', Progress: '10rem', 'Recommended next action': '16rem', Action: '6rem' }
    for (const [header, min] of Object.entries(floors)) {
      const th = screen.getByRole('columnheader', { name: new RegExp(header) })
      expect(th, header).toHaveClass('md:min-w-[var(--col-min)]')
      expect(th.getAttribute('style'), header).toContain(`--col-min: ${min}`)
    }
  })
})
