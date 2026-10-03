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
  FundingPlanEditor: (props: { open: boolean; plan?: { id: string }; skipLabel?: string; defaultManagement: string; participantId: string }) => {
    editor(props)
    return props.open ? <div data-testid="editor" data-plan={props.plan?.id ?? 'new'} data-skip={props.skipLabel ?? 'Cancel'} data-management={props.defaultManagement} /> : null
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

    expect(screen.getByText('Save the participant first to record the plan budget')).toBeInTheDocument()
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
    expect(screen.getByText(/\$10,000\.00/)).toBeInTheDocument()   // 8,000 Core + 2,000 stated
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
