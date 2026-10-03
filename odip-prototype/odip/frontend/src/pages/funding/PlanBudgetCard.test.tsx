import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanBudgetCard } from './PlanBudgetCard'
import { plan } from '@/test/fixtures/funding'

// The "Plan budget" card on Intake's NDIS & Funding step and the Profile wizard (budget phase 1): it summarises the current plan record, opens the same editor, and offers "Plan not shared
// yet" as the explicit skip. It saves through the funding endpoints (the editor does), never through the participant's patch groups.

const { useFundingPlans, editor } = vi.hoisted(() => ({ useFundingPlans: vi.fn(), editor: vi.fn() }))

vi.mock('@/api/hooks', () => ({ useFundingPlans }))
vi.mock('./FundingPlanEditor', () => ({
  FundingPlanEditor: (props: { open: boolean; plan?: { id: string }; previousPlan?: { id: string }; skipLabel?: string; defaultManagement: string; participantId: string }) => {
    editor(props)
    return props.open ? <div data-testid="editor" data-plan={props.plan?.id ?? 'new'} data-previous={props.previousPlan?.id ?? 'none'} data-skip={props.skipLabel ?? 'Cancel'} data-management={props.defaultManagement} /> : null
  },
}))

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))
const reply = (plans: ReturnType<typeof plan>[]) => ({ data: { plans, profilePlanDates: {} }, isLoading: false, isError: false, refetch: vi.fn() })

beforeEach(() => {
  vi.clearAllMocks()
  asRole('Coordinator')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T03:00:00Z'))
  useFundingPlans.mockReturnValue(reply([]))
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

describe('Plan budget card', () => {
  it('asks to save the participant first when there is no participant yet, and does not ask the server anything', () => {
    render(<PlanBudgetCard planType="PlanManaged" />)

    expect(screen.getByText('Save as draft first, then record the plan budget on the participant’s Funding tab.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record plan budget' })).not.toBeInTheDocument()
    expect(useFundingPlans).toHaveBeenCalledWith(undefined)
  })

  it('says "Not recorded", offers to record it, and opens the editor with "Plan not shared yet" as its skip', async () => {
    render(<PlanBudgetCard participantId="participant-1" planType="AgencyManaged" />)

    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Record plan budget' }))

    const opened = screen.getByTestId('editor')
    expect(opened).toHaveAttribute('data-plan', 'new')
    expect(opened).toHaveAttribute('data-skip', 'Plan not shared yet')
    expect(opened).toHaveAttribute('data-management', 'AgencyManaged')
  })

  it('summarises the current plan: its dates, funding periods, pools and total, with Edit', async () => {
    useFundingPlans.mockReturnValue(reply([plan()]))
    render(<PlanBudgetCard participantId="participant-1" planType="PlanManaged" />)

    expect(screen.getByText('1 Jul 2026 – 30 Jun 2027')).toBeInTheDocument()
    expect(screen.getByText(/3-monthly/)).toBeInTheDocument()
    expect(screen.getByText(/2 pools/)).toBeInTheDocument()
    expect(screen.getByText(/\$10,000\.00 in total/)).toBeInTheDocument()   // 8,000 Core + 2,000 stated
    expect(screen.queryByText('Ended')).not.toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByTestId('editor')).toHaveAttribute('data-plan', 'plan-1')
    expect(screen.getByTestId('editor')).toHaveAttribute('data-skip', 'Cancel')   // an existing plan is changed, not skipped
  })

  it('summarises the plan running today when a later one is also recorded', () => {
    useFundingPlans.mockReturnValue(reply([plan({ id: 'plan-2', planStart: '2027-07-01', planEnd: '2028-06-30' }), plan()]))
    render(<PlanBudgetCard participantId="participant-1" planType="PlanManaged" />)

    expect(screen.getByText('1 Jul 2026 – 30 Jun 2027')).toBeInTheDocument()
    expect(screen.queryByText('1 Jul 2027 – 30 Jun 2028')).not.toBeInTheDocument()
  })

  it('says a plan has ended, and offers a NEW plan after it instead of Edit, so the old plan’s history is not overwritten', async () => {
    useFundingPlans.mockReturnValue(reply([plan({ id: 'plan-0', planStart: '2025-07-01', planEnd: '2026-06-30' })]))
    render(<PlanBudgetCard participantId="participant-1" planType="PlanManaged" />)

    expect(screen.getByText('Ended')).toBeInTheDocument()
    expect(screen.getByText(/1\s+Jul\s+2025 – 30\s+Jun\s+2026/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: 'Record a new plan' }))

    const opened = screen.getByTestId('editor')
    expect(opened).toHaveAttribute('data-plan', 'new')          // not the ended plan
    expect(opened).toHaveAttribute('data-previous', 'plan-0')   // the new one starts the day after it ended
    expect(opened).toHaveAttribute('data-skip', 'Plan not shared yet')
  })

  it('keeps the editor out of the form it sits in, so Enter in one of its fields cannot submit the wizard', async () => {
    useFundingPlans.mockReturnValue(reply([plan()]))
    render(<form data-testid="wizard"><PlanBudgetCard participantId="participant-1" planType="PlanManaged" /></form>)

    await user().click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('button', { name: 'Edit' }).closest('form')).toBe(screen.getByTestId('wizard'))   // the card is in the form
    expect(screen.getByTestId('editor').closest('form')).toBeNull()                                             // the editor is not
  })

  it('shows an en dash while it loads, and "Couldn’t load" when it could not', async () => {
    useFundingPlans.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    const { unmount } = render(<PlanBudgetCard participantId="participant-1" planType="PlanManaged" />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record plan budget' })).not.toBeInTheDocument()
    unmount()

    const refetch = vi.fn()
    useFundingPlans.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    render(<PlanBudgetCard participantId="participant-1" planType="PlanManaged" />)
    expect(screen.getByText('Couldn’t load')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('is not there at all for a role that may not see money', () => {
    asRole('SupportWorker')
    const { container } = render(<PlanBudgetCard participantId="participant-1" planType="PlanManaged" />)

    expect(container).toBeEmptyDOMElement()
    expect(useFundingPlans).not.toHaveBeenCalled()   // it is not even mounted, so it asks the server for nothing
  })
})
