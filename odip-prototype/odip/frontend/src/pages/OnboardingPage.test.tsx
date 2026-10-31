import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { OnboardingTable } from './OnboardingPage'
import { intakeCompleteState } from './intake/intakeComplete'

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: mockUseQuery }))

const row = (over: object = {}) => ({ participantId: 'p-1', fullName: 'Jamie Rivers', servicesStartedAt: null, completedSteps: 2, totalSteps: 6, firstMissing: 'Signed agreement', ...over })

describe('OnboardingPage', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  })

  it('shows each participant with "N of M done" and the first item still open, and opens their checklist', async () => {
    mockUseQuery.mockReturnValue({ data: [row()], isLoading: false })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route path="/onboarding" element={<OnboardingTable />} /><Route path="/onboarding/:id" element={<div>Checklist route</div>} /></Routes></MemoryRouter>)

    expect(screen.getByText('Jamie Rivers')).toBeInTheDocument()
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument()
    expect(screen.getByText('Signed agreement')).toBeInTheDocument()
    expect(screen.queryByText('Services started')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Open onboarding for Jamie Rivers' }))
    expect(screen.getByText('Checklist route')).toBeInTheDocument()
  })

  it('tags a participant whose services have started, and says "All done" when nothing is open', () => {
    mockUseQuery.mockReturnValue({ data: [row({ servicesStartedAt: '2026-10-10T01:00:00Z', completedSteps: 4, firstMissing: null })], isLoading: false })
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)

    expect(screen.getByText('Services started')).toBeInTheDocument()
    expect(screen.getByText('All done')).toBeInTheDocument()
  })

  it('opens the checklist from a click anywhere on the row, and names the participant as a link to it', async () => {
    mockUseQuery.mockReturnValue({ data: [row()], isLoading: false })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route path="/onboarding" element={<OnboardingTable />} /><Route path="/onboarding/:id" element={<div>Checklist route</div>} /></Routes></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Jamie Rivers' })).toHaveAttribute('href', '/onboarding/p-1')
    await user.click(screen.getByText('Signed agreement'))
    expect(screen.getByText('Checklist route')).toBeInTheDocument()
  })

  it('keeps the readable worklist but does not promise a lifecycle mutation to ReadOnly', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUseQuery.mockReturnValue({ data: [row({ participantId: 'p-2', fullName: 'Avery Lee', completedSteps: 0 })], isLoading: false })
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)

    expect(screen.getByText('Avery Lee')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View checklist' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open onboarding for/i })).not.toBeInTheDocument()
  })

  it('shows an empty state with a link back to Enquiries when there is no onboarding work', () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false })
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)
    expect(screen.getByText('No participants in onboarding')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View enquiries' })).toHaveAttribute('href', '/participants?tab=enquiries')
  })

  it('shows a retry-able error banner instead of the empty state when the worklist fails to load', async () => {
    const refetch = vi.fn()
    mockUseQuery.mockReturnValue({ data: [], isLoading: false, isError: true, refetch })
    const user = userEvent.setup()
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the onboarding worklist/i)
    expect(screen.queryByText('No participants in onboarding')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('renders progress as an accessible progressbar, not just a text fraction', () => {
    mockUseQuery.mockReturnValue({ data: [row({ participantId: 'p-3', fullName: 'Rowan Vale' })], isLoading: false })
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)
    const bar = screen.getByRole('progressbar', { name: '2 of 6 done' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '6')
    // the numeric label stays visible, so progress is never colour-only
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument()
  })

  it('filters the worklist by participant name and by what is still open', async () => {
    mockUseQuery.mockReturnValue({ data: [
      row({ firstMissing: 'Funding' }),
      row({ participantId: 'p-2', fullName: 'Avery Lee', completedSteps: 0, firstMissing: 'Profile details' }),
    ], isLoading: false })
    const user = userEvent.setup()
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)
    const box = () => screen.getByRole('textbox', { name: /search participants/i })
    await user.type(box(), 'Avery')
    expect(screen.queryByText('Jamie Rivers')).not.toBeInTheDocument()
    expect(screen.getByText('Avery Lee')).toBeInTheDocument()
    await user.clear(box())
    await user.type(box(), 'funding')
    expect(screen.getByText('Jamie Rivers')).toBeInTheDocument()
    expect(screen.queryByText('Avery Lee')).not.toBeInTheDocument()
  })
})

describe('OnboardingTable: arriving from a completed intake', () => {
  const rows = [
    row(),
    row({ participantId: 'p-2', fullName: 'Avery Lee' }),
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
  // jsdom does no layout, so this pins the cause: DataTable cells never wrap, so a long name would set its column's width.
  function renderLongRow() {
    mockUseQuery.mockReturnValue({ data: [row({ participantId: 'p-9', fullName: 'Alexandra Christine Montgomery-Featherstonehaugh', servicesStartedAt: '2026-10-10T01:00:00Z' })], isLoading: false })
    render(<MemoryRouter><OnboardingTable /></MemoryRouter>)
  }

  it('lets the participant name wrap (no nowrap)', () => {
    renderLongRow()
    expect(screen.getByText('Alexandra Christine Montgomery-Featherstonehaugh').closest('td')).not.toHaveClass('md:whitespace-nowrap')
  })

  it('keeps a floor under every column, so none is squeezed out of view and the headers stay readable', () => {
    renderLongRow()
    const floors: Record<string, string> = { Participant: '9rem', Progress: '10rem', 'Still to do': '10rem', Action: '6rem' }
    for (const [header, min] of Object.entries(floors)) {
      const th = screen.getByRole('columnheader', { name: new RegExp(header) })
      expect(th, header).toHaveClass('md:min-w-[var(--col-min)]')
      expect(th.getAttribute('style'), header).toContain(`--col-min: ${min}`)
    }
  })
})
