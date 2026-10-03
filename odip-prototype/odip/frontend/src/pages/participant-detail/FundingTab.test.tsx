import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import FundingTab from './FundingTab'
import { plan, pool, quarters } from '@/test/fixtures/funding'

// The participant hub's Funding tab (budget phase 1): "No budget recorded" with where the figures come from, the recorded plan as facts, a pools table whose pools expand to their
// periods, the profile-dates mismatch with its explicit apply action, past plans, and the one muted line that says spending and forecasts are not here yet.

const { useFundingPlans, apply, editor } = vi.hoisted(() => ({
  useFundingPlans: vi.fn(),
  apply: vi.fn(),
  editor: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useFundingPlans,
  useApplyPlanDatesToProfile: () => ({ mutate: apply, isPending: false, isError: false }),
}))

// The editor has its own tests: here it is a marker that says how the tab opened it.
vi.mock('@/pages/funding/FundingPlanEditor', () => ({
  FundingPlanEditor: (props: { open: boolean; plan?: { id: string }; previousPlan?: { id: string }; participantId: string; defaultManagement: string }) => {
    editor(props)
    return props.open ? <div data-testid="editor" data-plan={props.plan?.id ?? 'new'} data-previous={props.previousPlan?.id ?? 'none'} data-management={props.defaultManagement} /> : null
  },
}))

const plansReply = (plans: ReturnType<typeof plan>[], profile: { start?: string; end?: string } = { start: '2026-07-01', end: '2027-06-30' }) =>
  ({ data: { plans, profilePlanDates: profile }, isLoading: false, isError: false, refetch: vi.fn() })

function renderTab() {
  return render(<MemoryRouter><FundingTab participantId="participant-1" planType="PlanManaged" /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T03:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('Funding tab: nothing recorded', () => {
  it('says no budget is recorded and where the figures come from, and offers to record one', async () => {
    useFundingPlans.mockReturnValue(plansReply([]))
    renderTab()

    expect(screen.getByText('No budget recorded')).toBeInTheDocument()
    expect(screen.getByText(/the plan the participant shares, or their plan manager\. The NDIA does not show providers a participant.s budget\./)).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Record plan budget' }))

    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'new')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-management', 'PlanManaged')   // the participant's plan type is the editor's default
  })

  it('shows nothing about spending, and no profile-dates question, with no plan to compare', () => {
    useFundingPlans.mockReturnValue(plansReply([], { start: '2026-01-01', end: '2026-12-31' }))
    renderTab()

    expect(screen.queryByText(/Spending and forecasts/)).not.toBeInTheDocument()
    expect(screen.queryByText(/The profile says/)).not.toBeInTheDocument()
  })
})

describe('Funding tab: a recorded plan', () => {
  it('lists the plan as facts: dates, period length, reassessment, source and who confirmed it', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    const facts = screen.getByText('Plan dates').closest('dl')!
    expect(within(facts).getByText('1 Jul 2026 – 30 Jun 2027')).toBeInTheDocument()
    expect(within(facts).getByText('3-monthly')).toBeInTheDocument()
    expect(within(facts).getByText('1 May 2027')).toBeInTheDocument()
    expect(within(facts).getByText('A copy of the plan')).toBeInTheDocument()
    expect(within(facts).getByText('Confirmed 20 Sep 2026 by Priya Coordinator')).toBeInTheDocument()
  })

  it('says "No funding periods" for a plan that has none', () => {
    useFundingPlans.mockReturnValue(plansReply([plan({ periodLengthMonths: undefined, pools: [pool({ periods: [{ id: 'whole', position: 0, periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 8000 }] })] })]))
    renderTab()

    expect(screen.getByText('No funding periods')).toBeInTheDocument()
  })

  it('shows each pool: name, categories, management, plan amount, Oassist set-aside (an en dash when none) and its periods', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    const table = within(screen.getByRole('region', { name: 'Pools' })).getByRole('table')
    const core = within(table).getByRole('row', { name: /Core \(flexible\)/ })
    expect(within(core).getByText('01–04')).toBeInTheDocument()
    expect(within(core).getByText('Plan Managed')).toBeInTheDocument()
    expect(within(core).getByText('$8,000.00')).toBeInTheDocument()
    expect(within(core).getByText('$4,000.00')).toBeInTheDocument()   // the set-aside: 4 x $1,000
    const stated = within(table).getByRole('row', { name: /Improved Daily Living Skills/ })
    expect(within(stated).getByText('15')).toBeInTheDocument()
    expect(within(stated).getByText('Agency Managed')).toBeInTheDocument()
    expect(within(stated).getByText('$2,000.00')).toBeInTheDocument()
    expect(within(stated).getByText('–')).toBeInTheDocument()          // no set-aside on this pool: an en dash, never $0
  })

  it('expands a pool to its periods: dates, plan amount and set-aside', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    expect(screen.queryByRole('region', { name: /Periods of Core/ })).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /4 periods.*Core \(flexible\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const periods = within(screen.getByRole('region', { name: /Periods of Core \(flexible\)/ })).getByRole('table')
    expect(within(periods).getByText('1 Jul 2026 – 30 Sep 2026')).toBeInTheDocument()
    expect(within(periods).getAllByText('$2,000.00')).toHaveLength(4)
    expect(within(periods).getAllByText('$1,000.00')).toHaveLength(4)

    await user.click(toggle)
    expect(screen.queryByRole('region', { name: /Periods of Core/ })).not.toBeInTheDocument()
  })

  it('opens the editor on this plan with Edit', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'plan-1')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-previous', 'none')
  })

  it('records a new plan from the current one, so the editor starts the day after it ends', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByRole('button', { name: 'Record a new plan' }))

    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'new')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-previous', 'plan-1')
  })

  it('says that spending and forecasts arrive later, as one muted line, and promises nothing now', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    expect(screen.getByText('Spending and forecasts will appear here once budget tracking is switched on.')).toBeInTheDocument()
    expect(screen.queryByText(/remaining|left of|forecast over|on track/i)).not.toBeInTheDocument()
  })
})

describe('Funding tab: the profile says something else', () => {
  it('offers, never forces, the plan’s dates for the profile when they differ', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()], { start: '2026-01-01', end: '2026-12-31' }))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const note = screen.getByRole('status')
    expect(note).toHaveTextContent("The profile says the plan runs 1 Jan 2026 – 31 Dec 2026. Use this plan's dates on the profile?")
    expect(apply).not.toHaveBeenCalled()

    await user.click(within(note).getByRole('button', { name: "Use this plan's dates" }))

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0]).toBe('plan-1')
  })

  it('says so when the profile has no plan dates at all', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()], {}))
    renderTab()

    expect(screen.getByRole('status')).toHaveTextContent("The profile has no plan dates. Use this plan's dates on the profile?")
  })

  it('stays quiet when the profile already has this plan’s dates', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    expect(screen.queryByText(/The profile says/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Use this plan's dates" })).not.toBeInTheDocument()
  })
})

describe('Funding tab: past plans', () => {
  const past = plan({ id: 'plan-0', planStart: '2025-07-01', planEnd: '2026-06-30', revision: 3, pools: [pool({ id: 'old-core', periods: quarters(1000, undefined, 'o') })] })

  it('keeps earlier plans in a collapsed, read-only section', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan(), past]))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const toggle = screen.getByRole('button', { name: /Past plans/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('1 Jul 2025 – 30 Jun 2026')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('1 Jul 2025 – 30 Jun 2026')).toBeInTheDocument()
    // Read-only: the only Edit is the current plan's.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it('has no past-plans section when there are none', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    expect(screen.queryByRole('button', { name: /Past plans/ })).not.toBeInTheDocument()
  })

  it('leads with the plan running today even when a later plan is already recorded', () => {
    const next = plan({ id: 'plan-2', planStart: '2027-07-01', planEnd: '2028-06-30' })
    useFundingPlans.mockReturnValue(plansReply([next, plan()]))
    renderTab()

    expect(screen.getByText('1 Jul 2026 – 30 Jun 2027')).toBeInTheDocument()
  })
})

describe('Funding tab: loading and failing', () => {
  it('says it is loading, and says when it could not load, offering to try again', async () => {
    useFundingPlans.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    const { unmount } = renderTab()
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    unmount()

    const refetch = vi.fn()
    useFundingPlans.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('x'), refetch })
    renderTab()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /Try again/i }))

    expect(refetch).toHaveBeenCalled()
  })
})
