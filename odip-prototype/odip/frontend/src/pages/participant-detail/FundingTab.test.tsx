import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
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
  FundingPlanEditor: (props: { open: boolean; plan?: { id: string }; previousPlan?: { id: string }; participantId: string; defaultManagement: string; onSaved?: (plan: unknown) => void }) => {
    editor(props)
    return props.open ? <div data-testid="editor" data-plan={props.plan?.id ?? 'new'} data-previous={props.previousPlan?.id ?? 'none'} data-management={props.defaultManagement} /> : null
  },
}))

const plansReply = (plans: ReturnType<typeof plan>[], profile: { start?: string; end?: string } = { start: '2026-07-01', end: '2027-06-30' }) =>
  ({ data: { plans, profilePlanDates: profile }, isLoading: false, isError: false, refetch: vi.fn() })

const tab = () => <MemoryRouter><FundingTab participantId="participant-1" planType="PlanManaged" /></MemoryRouter>

function renderTab() {
  return render(tab())
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

  const poolCard = (name: string) => screen.getByRole('heading', { name }).closest('li')!

  it('shows each pool as a card: name, categories, management, plan amount and set-aside (an en dash when none, which a line says)', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    const core = poolCard('Core (flexible)')
    expect(within(core).getByText('01–04')).toBeInTheDocument()
    expect(within(core).getByText(/Plan Managed/)).toBeInTheDocument()
    expect(within(core).getByText('Plan amount').nextElementSibling).toHaveTextContent('$8,000.00')
    expect(within(core).getByText('Set-aside').nextElementSibling).toHaveTextContent('$4,000.00')   // the set-aside: 4 x $1,000
    const stated = poolCard('Improved Daily Living Skills')
    expect(within(stated).getByText('15')).toBeInTheDocument()
    expect(within(stated).getByText(/Agency Managed/)).toBeInTheDocument()
    expect(within(stated).getByText('Plan amount').nextElementSibling).toHaveTextContent('$2,000.00')
    expect(within(stated).getByText('Set-aside').nextElementSibling).toHaveTextContent('–')   // no set-aside on this pool: an en dash, never $0
    expect(within(screen.getByRole('region', { name: 'Pools' })).getByText('A dash means no set-aside is recorded.')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Oassist')
  })

  it('gives the two figures of every pool the same width, so the decimals line up down the page whatever the amounts', () => {
    useFundingPlans.mockReturnValue(plansReply([plan({ pools: [pool({ periods: quarters(9000, 1000) }), pool({ id: 'pool-15', paceCategory: 15, kind: 'Stated', name: 'Improved Daily Living Skills', managementType: 'AgencyManaged', periods: quarters(500, undefined, 's') })] })]))
    renderTab()

    const blocks = ['Core (flexible)', 'Improved Daily Living Skills'].flatMap(name => ['Plan amount', 'Set-aside'].map(label => within(poolCard(name)).getByText(label).parentElement!))
    expect(blocks).toHaveLength(4)
    blocks.forEach(block => expect(block).toHaveClass('w-32'))   // $36,000.00 and $2,000.00 end at the same edge; a dash stacks too
  })

  it('says nothing about a dash when every pool has a set-aside', () => {
    useFundingPlans.mockReturnValue(plansReply([plan({ pools: [pool({ periods: quarters(2000, 1000) })] })]))
    renderTab()

    expect(screen.queryByText(/A dash means/)).not.toBeInTheDocument()
  })

  it('opens a pool’s periods directly under that pool, and the control always points at something in the page', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const core = poolCard('Core (flexible)')
    expect(within(core).queryByRole('region', { name: /Periods of Core/ })).not.toBeInTheDocument()
    const toggle = within(core).getByRole('button', { name: /4 periods of Core \(flexible\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull()   // collapsed, it still names an element that exists
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const periods = within(within(core).getByRole('region', { name: /Periods of Core \(flexible\)/ })).getByRole('table')   // inside THIS pool's card
    expect(within(periods).getByText('1 Jul – 30 Sep 2026')).toBeInTheDocument()
    expect(within(periods).getAllByText('$2,000.00')).toHaveLength(4)
    expect(within(periods).getAllByText('$1,000.00')).toHaveLength(4)
    expect(within(periods).getByRole('columnheader', { name: 'Set-aside' })).toBeInTheDocument()
    expect(within(poolCard('Improved Daily Living Skills')).queryByRole('region')).not.toBeInTheDocument()   // the other pool stays closed

    await user.click(toggle)
    expect(within(core).queryByRole('region', { name: /Periods of Core/ })).not.toBeInTheDocument()
  })

  it('left-aligns the amounts of a period below md, so they sit beside their labels on a phone', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(within(poolCard('Core (flexible)')).getByRole('button', { name: /4 periods of Core/ }))

    const amount = within(screen.getByRole('region', { name: /Periods of Core \(flexible\)/ })).getAllByText('$2,000.00')[0].closest('td')!
    expect(amount).toHaveClass('text-right', 'max-md:text-left')
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

    expect(screen.getByText('Spending and forecasts will appear here in a later release.')).toBeInTheDocument()
    expect(screen.queryByText(/switched on/)).not.toBeInTheDocument()   // there is no switch: Settings holds a mode and a percentage, and says a later release uses them
    expect(screen.queryByText(/remaining|left of|forecast over|on track/i)).not.toBeInTheDocument()
  })
})

describe('Funding tab: the profile says something else', () => {
  it('offers, never forces, the plan’s dates for the profile when they differ', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()], { start: '2026-01-01', end: '2026-12-31' }))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const note = screen.getByRole('status')
    expect(note).toHaveTextContent("The profile says the plan runs 1 Jan – 31 Dec 2026. Use this plan's dates on the profile?")
    expect(apply).not.toHaveBeenCalled()
    const button = within(note).getByRole('button', { name: "Use this plan's dates" })
    expect(within(note).getByText(/^The profile says the plan runs/).nextElementSibling).toContainElement(button)   // under the sentence, not squeezing it

    await user.click(button)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0]).toBe('plan-1')
  })

  const NOW_MATCH = "The profile's plan dates now match this plan."

  /** The plan's dates applied to a profile that differed, and the plans refetched: the profile now holds the plan's own dates. */
  async function appliedAndRefetched() {
    useFundingPlans.mockReturnValue(plansReply([plan()], { start: '2026-01-01', end: '2026-12-31' }))
    const view = renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: "Use this plan's dates" }))
    act(() => { apply.mock.calls[0][1].onSuccess() })   // the server said yes
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    view.rerender(tab())
    return { view, user }
  }

  it('says the dates now match once they were applied and the profile shows them, and puts focus back on Edit rather than losing it with the callout', async () => {
    await appliedAndRefetched()

    expect(screen.getByText(NOW_MATCH)).toBeInTheDocument()
    expect(screen.queryByText(/The profile says/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
  })

  it('does not say it while the profile still differs (the refetch has not come back), since the callout above would say the opposite', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()], { start: '2026-01-01', end: '2026-12-31' }))
    renderTab()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: "Use this plan's dates" }))

    act(() => { apply.mock.calls[0][1].onSuccess() })

    expect(screen.queryByText(NOW_MATCH)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/The profile says the plan runs/)
  })

  it('takes it away when the plan’s dates are changed afterwards and the callout is back, so the two never contradict each other', async () => {
    const { view } = await appliedAndRefetched()
    expect(screen.getByText(NOW_MATCH)).toBeInTheDocument()

    useFundingPlans.mockReturnValue(plansReply([plan({ planEnd: '2027-05-31' })]))   // the plan was edited: the profile no longer matches
    view.rerender(tab())

    expect(screen.queryByText(NOW_MATCH)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/The profile says the plan runs 1\s+Jul\s+2026 – 30\s+Jun\s+2027\./)
  })

  it('takes it away after the plan is saved from the editor, whatever the profile says, and does not come back when the dates match again', async () => {
    const { view, user } = await appliedAndRefetched()
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    act(() => { editor.mock.calls.at(-1)![0].onSaved?.(plan()) })   // the editor saved

    expect(screen.queryByText(NOW_MATCH)).not.toBeInTheDocument()
    useFundingPlans.mockReturnValue(plansReply([plan({ planEnd: '2027-05-31' })]))
    view.rerender(tab())
    useFundingPlans.mockReturnValue(plansReply([plan()]))   // matching again, by the editor's doing this time, not by "Use this plan's dates"
    view.rerender(tab())
    expect(screen.queryByText(NOW_MATCH)).not.toBeInTheDocument()
  })

  it('adds no gap of its own while it has nothing to say: its live region is out of the flow, and is the sentence itself once it applies', async () => {
    useFundingPlans.mockReturnValue(plansReply([plan()], { start: '2026-01-01', end: '2026-12-31' }))
    const view = renderTab()
    const live = view.container.querySelector('p[aria-live="polite"]') as HTMLElement
    expect(live).toHaveClass('sr-only')   // absolute: a flex child that is not drawn adds no gap to the tab's column
    expect(live).toHaveTextContent('')

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: "Use this plan's dates" }))
    act(() => { apply.mock.calls[0][1].onSuccess() })
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    view.rerender(tab())

    const after = view.container.querySelectorAll('p[aria-live="polite"]')
    expect(after).toHaveLength(1)
    expect(after[0]).toBe(live)   // the same region throughout, so the sentence is announced
    expect(live).toHaveTextContent(NOW_MATCH)
    expect(live).not.toHaveClass('sr-only')
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
    // Titled by its span, so a list of plans says which is which (not "Plan budget" over and over).
    expect(screen.getByRole('heading', { name: /^Plan 1\s+Jul\s+2025 – 30\s+Jun\s+2026$/ })).toBeInTheDocument()
    // Read-only: the only Edit is the current plan's.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it('titles an upcoming plan by its span too', async () => {
    const next = plan({ id: 'plan-2', planStart: '2027-07-01', planEnd: '2028-06-30' })
    useFundingPlans.mockReturnValue(plansReply([next, plan()]))
    renderTab()

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /Upcoming plans/ }))

    expect(screen.getByRole('heading', { name: /^Plan 1\s+Jul\s+2027 – 30\s+Jun\s+2028$/ })).toBeInTheDocument()
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

describe('Funding tab: a plan that has ended', () => {
  const ended = plan({ id: 'plan-0', planStart: '2025-07-01', planEnd: '2026-06-30' })

  it('says the plan ended and offers the new one under that sentence, with one "Record a new plan", not two', async () => {
    useFundingPlans.mockReturnValue(plansReply([ended], { start: '2025-07-01', end: '2026-06-30' }))
    renderTab()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const sentence = screen.getByText(/^This plan ended on 30\s+Jun\s+2026\. Record the new plan when the participant shares it\.$/)
    const record = screen.getAllByRole('button', { name: 'Record a new plan' })
    expect(record).toHaveLength(1)
    expect(sentence.nextElementSibling).toContainElement(record[0])
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()   // an earlier plan can still be corrected here

    await user.click(record[0])

    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'new')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-previous', 'plan-0')
  })

  it('says nothing of an ending for a plan that is running, and keeps its own "Record a new plan"', () => {
    useFundingPlans.mockReturnValue(plansReply([plan()]))
    renderTab()

    expect(screen.queryByText(/This plan ended/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Record a new plan' })).toHaveLength(1)
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
