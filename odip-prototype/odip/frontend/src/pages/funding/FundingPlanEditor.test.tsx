import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FundingPlanEditor, type FundingPlanEditorProps } from './FundingPlanEditor'
import { PACE_CATEGORIES, plan, pool, quarters } from '@/test/fixtures/funding'
import type { BillingSourcesHintDto } from '@/api/types'

// The plan budget editor (budget phase 1): plan fields, pools (Core flexible, stated), periods PROPOSED from the dates and the length with amounts split by days and still editable,
// the sum message, plain-words validation beside the fields, the request bodies, the server's reasons (400), the stale-revision flow (409: "Load the latest", input kept), the Billing hint
// prefill, and the "Plan not shared yet" skip that simply closes.

const { create, update, categories, hint, plans } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  categories: vi.fn(),
  hint: vi.fn(),
  plans: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useCreateFundingPlan: () => ({ mutate: create, isPending: false }),
  useUpdateFundingPlan: () => ({ mutate: update, isPending: false }),
  usePaceCategories: categories,
  useBillingSourcesHint: hint,
  useFundingPlans: plans,
}))

const noHint: { data: BillingSourcesHintDto } = { data: { total: 0, rows: [] } }

function renderEditor(props: Partial<FundingPlanEditorProps> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const utils = render(<FundingPlanEditor open onClose={onClose} onSaved={onSaved} participantId="participant-1" defaultManagement="PlanManaged" {...props} />)
  return { ...utils, onClose, onSaved, user: userEvent.setup() }
}

const day = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } })

/** Plan start and end typed for 1 Jul 2026 to 30 Jun 2027. */
function typeYear() {
  day('Plan start', '2026-07-01')
  day('Plan end', '2027-06-30')
}

const coreCard = () => screen.getByRole('region', { name: /^Core \(flexible\), Plan Managed/ })

beforeEach(() => {
  vi.clearAllMocks()
  categories.mockReturnValue({ data: PACE_CATEGORIES })
  hint.mockReturnValue(noHint)
  plans.mockReturnValue({ data: undefined, refetch: vi.fn() })
})

describe('editor: a new plan', () => {
  it('opens as a dialog with the plan fields, starting 3-monthly from a copy of the plan', () => {
    renderEditor()

    const dialog = screen.getByRole('dialog', { name: 'Record plan budget' })
    expect(within(dialog).getByLabelText(/^Plan start/)).toHaveValue('')
    expect(within(dialog).getByLabelText(/^Plan end/)).toHaveValue('')
    expect(within(dialog).getByLabelText('Reassessment date')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Funding periods')).toHaveValue('3')
    expect(within(dialog).getByLabelText('Where the figures came from')).toHaveValue('PlanCopy')
    expect(within(dialog).getByLabelText('Confirmed on')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Confirmed by')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Notes')).toBeInTheDocument()
    const lengths = within(within(dialog).getByLabelText('Funding periods')).getAllByRole('option').map(o => o.textContent)
    expect(lengths).toEqual(['No funding periods', 'Monthly', '3-monthly', '6-monthly', '12-monthly'])
  })

  it('starts the next plan the day after the last one ended, a year long, with the same funding periods', () => {
    renderEditor({ previousPlan: plan({ planEnd: '2027-06-30', periodLengthMonths: 6 }) })

    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('2027-07-01')
    expect(screen.getByLabelText(/^Plan end/)).toHaveValue('2028-06-30')
    expect(screen.getByLabelText('Funding periods')).toHaveValue('6')
  })

  it('adds a Core (flexible) pool under the management type chosen, and the participant’s plan type is the default', async () => {
    const { user } = renderEditor({ defaultManagement: 'AgencyManaged' })
    expect(screen.getByLabelText('Management type')).toHaveValue('AgencyManaged')

    await user.selectOptions(screen.getByLabelText('Management type'), 'PlanManaged')
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    const card = coreCard()
    expect(within(card).getByText('01–04')).toBeInTheDocument()
    expect(within(card).getByLabelText('Plan amount for the whole plan')).toBeInTheDocument()
    expect(within(card).getByLabelText("Set-aside (optional)")).toBeInTheDocument()
  })

  it('offers stated supports from the served list, never 01 to 04 or Recurring Transport (18)', async () => {
    const { user } = renderEditor()

    const options = within(screen.getByLabelText('Stated support category')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Choose a category', '05 Assistive Technology', '09 Increased Social and Community Participation', '15 Improved Daily Living Skills', '16 Home and Living', '20 Behaviour Support'])

    await user.selectOptions(screen.getByLabelText('Stated support category'), '15')
    await user.click(screen.getByRole('button', { name: 'Add a stated support' }))

    const card = screen.getByRole('region', { name: /^Improved Daily Living Skills, Plan Managed/ })
    expect(within(card).getByText('15')).toBeInTheDocument()
  })

  it('will not add the same category under the same management type twice, and says why', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    expect(screen.getByRole('button', { name: 'Add Core (flexible)' })).toBeDisabled()
    expect(screen.getByText('Core (flexible) is already in this plan under this management type.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Management type'), 'AgencyManaged')
    expect(screen.getByRole('button', { name: 'Add Core (flexible)' })).toBeEnabled()
  })

  it('removes a pool', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    await user.click(screen.getByRole('button', { name: 'Remove Core (flexible), Plan Managed' }))

    expect(screen.queryByRole('region', { name: /Core \(flexible\)/ })).not.toBeInTheDocument()
  })
})

describe('editor: the periods are proposed, and stay editable', () => {
  it('works the periods out from the dates and the length, splitting the typed amount by days to the cent', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')

    const card = coreCard()
    expect(within(card).getByLabelText('Plan amount, 1 Jul – 30 Sep 2026')).toHaveValue('2016.44')
    expect(within(card).getByLabelText('Plan amount, 1 Oct – 31 Dec 2026')).toHaveValue('2016.44')
    expect(within(card).getByLabelText('Plan amount, 1 Jan – 31 Mar 2027')).toHaveValue('1972.60')
    expect(within(card).getByLabelText('Plan amount, 1 Apr – 30 Jun 2027')).toHaveValue('1994.52')
    expect(within(card).getByText('The periods add up to $8,000.00')).toBeInTheDocument()
  })

  it('works them out again when the funding period length changes', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')

    await user.selectOptions(screen.getByLabelText('Funding periods'), '6')

    const card = coreCard()
    expect(within(card).getAllByLabelText(/^Plan amount, /)).toHaveLength(2)
    expect(within(card).getByLabelText('Plan amount, 1 Jul – 31 Dec 2026')).toHaveValue('4032.88')
  })

  it('shows no periods for a plan with no funding periods: the whole plan is one period', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.selectOptions(screen.getByLabelText('Funding periods'), '')
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    expect(within(coreCard()).queryByLabelText(/^Plan amount, /)).not.toBeInTheDocument()
    expect(within(coreCard()).getByText('The whole plan is one period: 1 Jul 2026 – 30 Jun 2027.')).toBeInTheDocument()
  })

  it('says in plain words when edited period amounts no longer add up to the typed amount, and that the periods are what is saved', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')

    const last = within(coreCard()).getByLabelText('Plan amount, 1 Apr – 30 Jun 2027')
    await user.clear(last)
    await user.type(last, '2004.52')   // $10 more than the proposal

    expect(within(coreCard()).getByText('The periods add up to $8,010.00, not the $8,000.00 you typed. The periods are what is saved.')).toBeInTheDocument()
    // Editing a period stops the proposal rewriting the others: typing a new total leaves them alone.
    await user.clear(within(coreCard()).getByLabelText('Plan amount for the whole plan'))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '9000')
    expect(within(coreCard()).getByLabelText('Plan amount, 1 Jul – 30 Sep 2026')).toHaveValue('2016.44')
  })

  it('splits the amounts again on request, which drops the edit and the message', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')
    const last = within(coreCard()).getByLabelText('Plan amount, 1 Apr – 30 Jun 2027')
    await user.clear(last)
    await user.type(last, '1')

    await user.click(within(coreCard()).getByRole('button', { name: 'Split again from the plan amount' }))

    expect(within(coreCard()).getByLabelText('Plan amount, 1 Apr – 30 Jun 2027')).toHaveValue('1994.52')
    expect(within(coreCard()).queryByText(/you typed/)).not.toBeInTheDocument()
  })

  it('splits the set-aside the same way', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '4000')
    await user.type(within(coreCard()).getByLabelText("Set-aside (optional)"), '2000')

    expect(within(coreCard()).getByLabelText('Set-aside, 1 Jul – 30 Sep 2026')).toHaveValue('504.11')
    expect(within(coreCard()).getByLabelText('Set-aside, 1 Apr – 30 Jun 2027')).toHaveValue('498.63')
  })

  it('tells the person when changing the dates replaced amounts they had edited', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')
    const first = within(coreCard()).getByLabelText('Plan amount, 1 Jul – 30 Sep 2026')
    await user.clear(first)
    await user.type(first, '1')

    day('Plan end', '2027-03-31')

    expect(screen.getByText('The periods were worked out again from the new dates, so amounts you had edited were replaced.')).toBeInTheDocument()
  })
})

describe('editor: saying what is wrong, beside the field', () => {
  it('refuses an empty plan in plain words, and sends nothing', async () => {
    const { user } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(screen.getByText('Give the day the plan starts.')).toBeInTheDocument()
    expect(screen.getByText('Give the day the plan ends.')).toBeInTheDocument()
    expect(screen.getByText('Add at least one pool from the plan.')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('says what is wrong with a pool’s amount', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    expect(within(coreCard()).getByText('Give the plan amount for the whole plan.')).toBeInTheDocument()

    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '12.345')
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    expect(within(coreCard()).getByText('Enter dollars and cents, like 8000.00.')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('says when the plan ends before it starts', async () => {
    const { user } = renderEditor()
    day('Plan start', '2027-06-30')
    day('Plan end', '2026-07-01')

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(screen.getByText('The plan cannot end before it starts.')).toBeInTheDocument()
  })
})

describe('editor: saving', () => {
  async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')
    await user.type(within(coreCard()).getByLabelText("Set-aside (optional)"), '4000')
    await user.selectOptions(screen.getByLabelText('Stated support category'), '15')
    await user.selectOptions(screen.getByLabelText('Management type'), 'AgencyManaged')
    await user.click(screen.getByRole('button', { name: 'Add a stated support' }))
    await user.type(within(screen.getByRole('region', { name: /^Improved Daily Living Skills, Agency Managed/ })).getByLabelText('Plan amount for the whole plan'), '1200')
    await user.type(screen.getByLabelText('Confirmed by'), 'Priya Coordinator')
    day('Confirmed on', '2026-09-20')
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
  }

  it('posts the plan, its pools and every period, exactly, and closes when it saved', async () => {
    const saved = plan()
    create.mockImplementation((_body, options) => options.onSuccess(saved))
    const { user, onClose, onSaved } = renderEditor()

    await fillAndSave(user)

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toEqual({
      planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3, evidence: 'PlanCopy', confirmedOn: '2026-09-20', confirmedByName: 'Priya Coordinator',
      pools: [
        {
          kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged',
          periods: [
            { periodStart: '2026-07-01', periodEnd: '2026-09-30', planAmount: 2016.44, setAside: 1008.22 },
            { periodStart: '2026-10-01', periodEnd: '2026-12-31', planAmount: 2016.44, setAside: 1008.22 },
            { periodStart: '2027-01-01', periodEnd: '2027-03-31', planAmount: 1972.6, setAside: 986.3 },
            { periodStart: '2027-04-01', periodEnd: '2027-06-30', planAmount: 1994.52, setAside: 997.26 },
          ],
        },
        {
          kind: 'Stated', paceCategory: 15, managementType: 'AgencyManaged',
          periods: [
            { periodStart: '2026-07-01', periodEnd: '2026-09-30', planAmount: 302.47 },
            { periodStart: '2026-10-01', periodEnd: '2026-12-31', planAmount: 302.47 },
            { periodStart: '2027-01-01', periodEnd: '2027-03-31', planAmount: 295.89 },
            { periodStart: '2027-04-01', periodEnd: '2027-06-30', planAmount: 299.17 },
          ],
        },
      ],
    })
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps everything on screen and lists the server’s reasons when it refuses the plan (400)', async () => {
    create.mockImplementation((_body, options) => options.onError({ response: { status: 400, data: { success: false, errors: ['The plan runs 900 days.', 'Add at least one pool from the plan.'] } } }))
    const { user, onClose } = renderEditor()

    await fillAndSave(user)

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('The plan runs 900 days.')).toBeInTheDocument()
    expect(within(alert).getByText('Add at least one pool from the plan.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('2026-07-01')
    expect(within(coreCard()).getByLabelText('Plan amount for the whole plan')).toHaveValue('8000')
  })

  it('shows the server’s sentence when the plan overlaps another (409), naming it', async () => {
    const message = 'This plan (1 Jul 2026 to 30 Jun 2027) overlaps the plan that runs 1 Jan 2026 to 31 Dec 2026. Change the dates, or edit that plan.'
    create.mockImplementation((_body, options) => options.onError({ response: { status: 409, data: { success: false, code: 'funding-plan-overlap', errors: [message], data: { conflictingPlanId: 'x' } } } }))
    const { user } = renderEditor()

    await fillAndSave(user)

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Load the latest' })).not.toBeInTheDocument()
  })

  it('closes without saving when the person says the plan has not been shared yet', async () => {
    const { user, onClose } = renderEditor({ skipLabel: 'Plan not shared yet' })

    await user.click(screen.getByRole('button', { name: 'Plan not shared yet' }))

    expect(onClose).toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('calls the cancelling button Cancel by default', () => {
    renderEditor()

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})

describe('editor: changing a recorded plan', () => {
  const stored = plan({ revision: 4 })

  it('opens on the plan as saved, titled for editing, and carries its revision with the save', async () => {
    update.mockImplementation((_variables, options) => options.onSuccess(plan({ revision: 5 })))
    const { user, onClose } = renderEditor({ plan: stored })

    expect(screen.getByRole('dialog', { name: 'Edit plan budget' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('Confirmed by')).toHaveValue('Priya Coordinator')
    expect(within(screen.getByRole('region', { name: /^Core \(flexible\), Plan Managed/ })).getByLabelText('Plan amount for the whole plan')).toHaveValue('8000.00')

    await user.clear(screen.getByLabelText('Confirmed by'))
    await user.type(screen.getByLabelText('Confirmed by'), 'Sam Admin')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(update).toHaveBeenCalledTimes(1)
    const [variables] = update.mock.calls[0]
    expect(variables.planId).toBe('plan-1')
    expect(variables.body).toMatchObject({ revision: 4, confirmedByName: 'Sam Admin', planStart: '2026-07-01', planEnd: '2027-06-30', periodLengthMonths: 3 })
    expect(variables.body.pools).toHaveLength(2)
    expect(onClose).toHaveBeenCalled()
  })

  it('offers "Load the latest" when somebody else saved first (409), keeps the person’s input on screen, and loads the newer plan on request', async () => {
    update.mockImplementation((_variables, options) => options.onError({ response: { status: 409, data: { success: false, code: 'funding-revision-conflict', errors: ['This plan was changed by someone else since you opened it.'], data: { currentRevision: 5 } } } }))
    const newer = plan({ revision: 5, confirmedByName: 'Somebody Else', pools: [pool({ periods: quarters(3000) })] })
    const refetch = vi.fn().mockResolvedValue({ data: { plans: [newer], profilePlanDates: {} } })
    plans.mockReturnValue({ data: { plans: [stored], profilePlanDates: {} }, refetch })
    const { user, onClose } = renderEditor({ plan: stored })

    await user.clear(screen.getByLabelText('Confirmed by'))
    await user.type(screen.getByLabelText('Confirmed by'), 'My Change')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Someone else changed this plan after you opened it. What you typed is still here. Load the latest to see their changes; that replaces what you have typed.')
    expect(screen.getByLabelText('Confirmed by')).toHaveValue('My Change')   // their input is still there
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Load the latest' }))

    await waitFor(() => expect(screen.getByLabelText('Confirmed by')).toHaveValue('Somebody Else'))
    expect(refetch).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Load the latest' })).not.toBeInTheDocument()

    // And a save from here carries the newer revision.
    update.mockClear()
    update.mockImplementation((_variables, options) => options.onSuccess(plan({ revision: 6 })))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(update.mock.calls[0][0].body.revision).toBe(5)
  })
})

describe('editor: start from Billing funding sources', () => {
  const rows: BillingSourcesHintDto = {
    total: 25100.5, planStart: '2026-07-01', planEnd: '2027-06-30', managementType: 'PlanManaged',
    rows: [{ id: 'f1', routeType: 'PlanManaged', budget: 25100.5, budgetCategory: 'Core - Social & Community Participation', planStartDate: '2026-07-01', planEndDate: '2027-06-30' }],
  }

  it('shows the offer only when the hint has rows, and prefills one Core pool and the dates for review', async () => {
    hint.mockReturnValue({ data: rows })
    const { user } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Start from Billing funding sources' }))

    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('2026-07-01')
    expect(screen.getByLabelText(/^Plan end/)).toHaveValue('2027-06-30')
    const card = coreCard()
    expect(within(card).getByLabelText('Plan amount for the whole plan')).toHaveValue('25100.50')
    expect(within(card).getAllByLabelText(/^Plan amount, /)).toHaveLength(4)
    // Offered once: it is gone once the pool is there.
    expect(screen.queryByRole('button', { name: 'Start from Billing funding sources' })).not.toBeInTheDocument()
  })

  it('says nothing when there is nothing to start from', () => {
    hint.mockReturnValue(noHint)
    renderEditor()

    expect(screen.queryByRole('button', { name: 'Start from Billing funding sources' })).not.toBeInTheDocument()
  })

  it('is not offered when editing a recorded plan', () => {
    hint.mockReturnValue({ data: rows })
    renderEditor({ plan: plan() })

    expect(screen.queryByRole('button', { name: 'Start from Billing funding sources' })).not.toBeInTheDocument()
  })

  it('only asks the server for the hint while it can be offered: a new plan, with the editor open', () => {
    renderEditor()
    expect(hint).toHaveBeenLastCalledWith('participant-1', true)

    renderEditor({ plan: plan() })
    expect(hint).toHaveBeenLastCalledWith('participant-1', false)
  })
})

// ── What the reviews found (budget fix round 1) ──────────────────────────────

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView   // jsdom has no layout, so no scrollIntoView: the call is what is checked
})

const staleReply = { response: { status: 409, data: { success: false, code: 'funding-revision-conflict', errors: ['This plan was changed by someone else since you opened it.'], data: { currentRevision: 5 } } } }

describe('editor: a refused save is never out of sight', () => {
  async function addCoreWithAmount(user: ReturnType<typeof userEvent.setup>) {
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')
  }

  it('scrolls the server’s reasons into view and moves focus to them when a save is refused (400)', async () => {
    create.mockImplementation((_body, options) => options.onError({ response: { status: 400, data: { success: false, errors: ['The plan runs 900 days.'] } } }))
    const { user } = renderEditor()
    await addCoreWithAmount(user)

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The plan runs 900 days.')
    expect(alert.parentElement).toHaveFocus()   // the Save button was at the bottom of a long form: the reason is what is announced and in view now
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('does the same for a stale save (409), and says it in these words', async () => {
    update.mockImplementation((_variables, options) => options.onError(staleReply))
    const { user } = renderEditor({ plan: plan({ revision: 4 }) })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Someone else changed this plan after you opened it. What you typed is still here. Load the latest to see their changes; that replaces what you have typed.')
    expect(alert.parentElement).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('focuses the first field that needs attention when the plan fails its own checks, and says each has a message beside it', async () => {
    const { user } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(screen.getByLabelText(/^Plan start/)).toHaveFocus()
    expect(screen.getByText('Some fields need attention. Each has a message beside it.')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('goes to a pool’s amount when the dates are fine, and to the missing-pool message when that is all that is wrong', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    expect(screen.getByText('Add at least one pool from the plan.')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    expect(within(coreCard()).getByLabelText('Plan amount for the whole plan')).toHaveFocus()
  })

  it('goes to a period’s own amount when that is the first thing wrong', async () => {
    const { user } = renderEditor()
    await addCoreWithAmount(user)
    const second = within(coreCard()).getByLabelText('Plan amount, 1 Oct – 31 Dec 2026')
    await user.clear(second)
    await user.type(second, 'abc')

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(within(coreCard()).getByLabelText('Plan amount, 1 Oct – 31 Dec 2026')).toHaveFocus()
  })
})

describe('editor: the buttons sit under the sentence, not beside it', () => {
  it('puts "Load the latest" under the 409 sentence', async () => {
    update.mockImplementation((_variables, options) => options.onError(staleReply))
    const { user } = renderEditor({ plan: plan({ revision: 4 }) })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const sentence = within(screen.getByRole('alert')).getByText(/^Someone else changed this plan/)
    expect(sentence.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Load the latest' }))
  })

  it('puts "Start from Billing funding sources" under its sentence', () => {
    hint.mockReturnValue({ data: { total: 25100.5, planStart: '2026-07-01', planEnd: '2027-06-30', managementType: 'PlanManaged', rows: [{ id: 'f1', routeType: 'PlanManaged', budget: 25100.5 }] } })
    renderEditor()

    const sentence = screen.getByText(/^The Billing page records \$25,100\.50 across one funding source/)
    expect(sentence.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Start from Billing funding sources' }))
  })
})

describe('editor: the proposed periods say they are a proposal', () => {
  const PROPOSAL = 'Worked out from the plan dates and split by days. Change any amount to match the plan’s release schedule.'

  it('says the periods were worked out, and that the person can change any amount', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')

    expect(within(coreCard()).getByText(PROPOSAL)).toBeInTheDocument()
    expect(within(coreCard()).queryByText(/You have edited some amounts/)).not.toBeInTheDocument()
  })

  it('adds that amounts were edited once one has been', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')
    const first = within(coreCard()).getByLabelText('Plan amount, 1 Jul – 30 Sep 2026')
    await user.clear(first)
    await user.type(first, '1000')

    expect(within(coreCard()).getByText(`${PROPOSAL} You have edited some amounts.`)).toBeInTheDocument()
  })

  it('says nothing about a proposal for the periods of a saved plan, until an amount is edited: then only that it was', async () => {
    const { user } = renderEditor({ plan: plan() })
    const core = screen.getByRole('region', { name: /^Core \(flexible\), Plan Managed/ })
    expect(within(core).queryByText(/Worked out from the plan dates/)).not.toBeInTheDocument()
    expect(within(core).queryByText(/You have edited some amounts/)).not.toBeInTheDocument()

    const first = within(core).getByLabelText('Plan amount, 1 Jul – 30 Sep 2026')
    await user.clear(first)
    await user.type(first, '2100')

    expect(within(core).getByText('You have edited some amounts.')).toBeInTheDocument()
    expect(within(core).queryByText(/Worked out from the plan dates/)).not.toBeInTheDocument()
  })

  it('offers "Split again" only after an amount was changed (or the periods stopped adding up), never on a saved pool as it was loaded', async () => {
    const { user } = renderEditor({ plan: plan() })
    const core = screen.getByRole('region', { name: /^Core \(flexible\), Plan Managed/ })
    expect(within(core).queryByRole('button', { name: 'Split again from the plan amount' })).not.toBeInTheDocument()

    const first = within(core).getByLabelText('Plan amount, 1 Jul – 30 Sep 2026')
    await user.clear(first)
    await user.type(first, '2100')

    expect(within(core).getByRole('button', { name: 'Split again from the plan amount' })).toBeInTheDocument()
  })

  it('offers it too when the typed total no longer matches the saved periods, since that is what it is for', async () => {
    const { user } = renderEditor({ plan: plan() })
    const core = screen.getByRole('region', { name: /^Core \(flexible\), Plan Managed/ })

    const total = within(core).getByLabelText('Plan amount for the whole plan')
    await user.clear(total)
    await user.type(total, '9000')

    expect(within(core).getByText(/not the \$9,000\.00 you typed/)).toBeInTheDocument()
    expect(within(core).getByRole('button', { name: 'Split again from the plan amount' })).toBeInTheDocument()
  })
})

describe('editor: the set-aside is the organisation’s, and says so without naming it', () => {
  it('labels the field, hints at what it is for, and heads the column "Set-aside"', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    const card = coreCard()
    expect(within(card).getByLabelText('Set-aside (optional)')).toBeInTheDocument()
    expect(within(card).getByText('The part of this pool kept for your organisation when the participant also uses other providers. Leave blank if none is set aside.')).toBeInTheDocument()
    await user.type(within(card).getByLabelText('Plan amount for the whole plan'), '8000')
    expect(within(card).getByRole('columnheader', { name: 'Set-aside' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Oassist')
  })

  it('says a set-aside above the plan amount is too much, beside the field', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '1000')
    await user.type(within(coreCard()).getByLabelText('Set-aside (optional)'), '1500')

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(within(coreCard()).getByText('The set-aside cannot be more than the plan amount.')).toBeInTheDocument()
  })
})

describe('editor: a set-aside typed after a period was edited is saved, in either order', () => {
  async function startPool(user: ReturnType<typeof userEvent.setup>, total = '4000') {
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), total)
  }
  const editPeriod = async (user: ReturnType<typeof userEvent.setup>, label: string, amount: string) => {
    const input = within(coreCard()).getByLabelText(label)
    await user.clear(input)
    await user.type(input, amount)
  }
  const savedPeriods = () => (create.mock.calls[0][0].pools[0].periods as { planAmount: number; setAside?: number }[])
  const cents = (values: (number | undefined)[]) => values.reduce<number>((sum, value) => sum + Math.round((value ?? 0) * 100), 0)

  it('saves a set-aside typed AFTER a period was edited, on every period, adding up to what was typed', async () => {
    const { user } = renderEditor()
    await startPool(user)
    await editPeriod(user, 'Plan amount, 1 Jul – 30 Sep 2026', '1000')
    await user.type(within(coreCard()).getByLabelText('Set-aside (optional)'), '800')

    expect(within(coreCard()).getByLabelText('Set-aside, 1 Jul – 30 Sep 2026')).not.toHaveValue('')   // it shows on the periods: nothing is saved that is not seen
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    const periods = savedPeriods()
    expect(periods.every(period => typeof period.setAside === 'number')).toBe(true)
    expect(cents(periods.map(period => period.setAside))).toBe(80000)
    periods.forEach(period => expect(Math.round((period.setAside ?? 0) * 100)).toBeLessThanOrEqual(Math.round(period.planAmount * 100)))
  })

  it('saves a set-aside typed BEFORE a period was edited, unchanged by the edit', async () => {
    const { user } = renderEditor()
    await startPool(user)
    await user.type(within(coreCard()).getByLabelText('Set-aside (optional)'), '800')
    await editPeriod(user, 'Plan amount, 1 Jul – 30 Sep 2026', '1000')

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(cents(savedPeriods().map(period => period.setAside))).toBe(80000)
  })

  it('saves no set-aside at all once the box is cleared, even after periods were edited', async () => {
    const { user } = renderEditor()
    await startPool(user)
    await user.type(within(coreCard()).getByLabelText('Set-aside (optional)'), '800')
    await editPeriod(user, 'Plan amount, 1 Jul – 30 Sep 2026', '1000')

    await user.clear(within(coreCard()).getByLabelText('Set-aside (optional)'))
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(savedPeriods().some(period => 'setAside' in period)).toBe(false)
    expect(within(coreCard()).queryByText(/set-asides add up to/)).not.toBeInTheDocument()
  })
})

describe('editor: a plan over 800 days has no periods, and says why', () => {
  it('says so, in the table, for a year typed digit by digit (0002 on the way to 2026)', async () => {
    const { user } = renderEditor()
    day('Plan start', '2026-07-01')
    day('Plan end', '2027-06-30')
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')

    day('Plan start', '0002-07-01')

    expect(within(coreCard()).queryByLabelText(/^Plan amount, /)).not.toBeInTheDocument()
    expect(within(coreCard()).getByText('A plan can run at most 800 days, so no periods are shown. Check the plan’s dates.')).toBeInTheDocument()

    day('Plan start', '2026-07-01')
    expect(within(coreCard()).getAllByLabelText(/^Plan amount, /)).toHaveLength(4)
  })

  it('asks for the dates when they are missing, and says so when the plan ends before it starts', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    expect(within(coreCard()).getByText('Give the plan’s dates to see its periods.')).toBeInTheDocument()

    day('Plan start', '2027-06-30')
    day('Plan end', '2026-07-01')
    expect(within(coreCard()).getByText('The plan ends before it starts, so there are no periods to show.')).toBeInTheDocument()
  })
})

describe('editor: focus goes where the person is looking', () => {
  it('moves focus to the new pool’s amount when a pool is added, so the person can type it', async () => {
    const { user } = renderEditor()
    typeYear()

    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    expect(within(coreCard()).getByLabelText('Plan amount for the whole plan')).toHaveFocus()

    await user.selectOptions(screen.getByLabelText('Stated support category'), '15')
    await user.click(screen.getByRole('button', { name: 'Add a stated support' }))
    expect(within(screen.getByRole('region', { name: /^Improved Daily Living Skills, Plan Managed/ })).getByLabelText('Plan amount for the whole plan')).toHaveFocus()
  })

  it('moves focus to the pool before a removed one, or to the Pools heading when none is left, so it is not lost with the button', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.selectOptions(screen.getByLabelText('Stated support category'), '15')
    await user.click(screen.getByRole('button', { name: 'Add a stated support' }))

    await user.click(screen.getByRole('button', { name: 'Remove Improved Daily Living Skills, Plan Managed' }))
    expect(coreCard()).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Remove Core (flexible), Plan Managed' }))
    expect(screen.getByRole('heading', { name: 'Pools' })).toHaveFocus()
  })
})

describe('editor: what counts as having changed something', () => {
  it('is not changed after "Load the latest", so closing does not ask to discard what the person never typed', async () => {
    update.mockImplementation((_variables, options) => options.onError(staleReply))
    const newer = plan({ revision: 5, confirmedByName: 'Somebody Else', pools: [pool({ periods: quarters(3000) })] })
    plans.mockReturnValue({ data: { plans: [plan({ revision: 4 })], profilePlanDates: {} }, refetch: vi.fn().mockResolvedValue({ data: { plans: [newer], profilePlanDates: {} } }) })
    const { user, onClose } = renderEditor({ plan: plan({ revision: 4 }) })
    await user.clear(screen.getByLabelText('Confirmed by'))
    await user.type(screen.getByLabelText('Confirmed by'), 'My Change')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await user.click(screen.getByRole('button', { name: 'Load the latest' }))
    await waitFor(() => expect(screen.getByLabelText('Confirmed by')).toHaveValue('Somebody Else'))

    await user.keyboard('{Escape}')

    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('still asks before discarding something that was typed, and not when the typed value is put back', async () => {
    const { user, onClose } = renderEditor({ plan: plan() })
    const by = screen.getByLabelText('Confirmed by')
    await user.type(by, 'x')
    await user.keyboard('{Escape}')
    expect(screen.getByText('Discard changes?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))

    await user.clear(by)
    await user.type(by, 'Priya Coordinator')   // as it was
    await user.keyboard('{Escape}')

    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('calls the closing button Cancel as soon as something has been typed, even where it says "Plan not shared yet" until then', async () => {
    const { user } = renderEditor({ skipLabel: 'Plan not shared yet' })
    expect(screen.getByRole('button', { name: 'Plan not shared yet' })).toBeInTheDocument()

    day('Plan start', '2026-07-01')

    expect(screen.queryByRole('button', { name: 'Plan not shared yet' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  })
})

describe('editor: a first plan starts from the dates the profile already holds', () => {
  it('prefills the plan dates from the profile, and proposes the periods as soon as a pool is added', async () => {
    plans.mockReturnValue({ data: { plans: [], profilePlanDates: { start: '2026-07-01', end: '2027-06-30' } }, refetch: vi.fn() })
    const { user } = renderEditor()

    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('2026-07-01')
    expect(screen.getByLabelText(/^Plan end/)).toHaveValue('2027-06-30')
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '8000')
    expect(within(coreCard()).getAllByLabelText(/^Plan amount, /)).toHaveLength(4)
  })

  it('leaves the dates empty when the profile has only one, and follows the last plan instead when there is one', () => {
    plans.mockReturnValue({ data: { plans: [], profilePlanDates: { start: '2026-07-01' } }, refetch: vi.fn() })
    const first = renderEditor()
    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('')
    first.unmount()

    plans.mockReturnValue({ data: { plans: [plan()], profilePlanDates: { start: '2020-01-01', end: '2020-12-31' } }, refetch: vi.fn() })
    renderEditor({ previousPlan: plan({ planEnd: '2027-06-30' }) })
    expect(screen.getByLabelText(/^Plan start/)).toHaveValue('2027-07-01')
  })
})

// ── What the second reviews found (budget fix round 2) ───────────────────────

const SOME_FIELDS = 'Some fields need attention. Each has a message beside it.'
const NOT_APPLIED = 'The set-aside is not on any period yet. Split again from the plan amount to apply it.'

describe('editor: Save and Cancel stay at the right whatever the footer says', () => {
  const buttons = () => screen.getByRole('button', { name: 'Save plan budget' }).parentElement as HTMLElement

  it('keeps the buttons in a group pushed to the right, with the sentence on its own row only while it has text', async () => {
    const { user } = renderEditor()
    const live = buttons().previousElementSibling as HTMLElement
    expect(buttons()).toHaveClass('ml-auto')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveClass('sr-only')   // empty: it takes no room, and is still there to be announced from
    expect(live).toHaveTextContent('')

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(live).toHaveTextContent(SOME_FIELDS)
    expect(live).toHaveClass('basis-full')
    expect(live).not.toHaveClass('sr-only')
    expect(buttons()).toHaveClass('ml-auto')
    expect(buttons().previousElementSibling).toBe(live)   // the same live region throughout, so what it says is announced
  })
})

describe('editor: the pool amounts sit side by side from the small breakpoint, under a short label', () => {
  it('puts the plan amount and the set-aside in one two-column grid, the set-aside labelled "Set-aside (optional)" with its hint', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))

    const amount = within(coreCard()).getByLabelText('Plan amount for the whole plan')
    const setAside = within(coreCard()).getByLabelText('Set-aside (optional)')
    const grid = amount.closest('.grid') as HTMLElement
    expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
    expect(grid).toContainElement(setAside)
    expect(within(coreCard()).queryByLabelText(/for your organisation/)).not.toBeInTheDocument()   // the hint says whose it is; the label need not
    expect(setAside).toHaveAccessibleDescription(/kept for your organisation/)
  })
})

describe('editor: a pool shows its problems once the person has started on it, or on the next Save', () => {
  const ASK = 'Give the plan amount for the whole plan.'
  async function afterAFailedCheck() {
    const view = renderEditor()
    typeYear()
    await view.user.click(screen.getByRole('button', { name: 'Save plan budget' }))   // fails: no pool yet
    await view.user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    return view
  }

  it('does not say a pool added after a failed check is missing its amount before anyone has typed in it', async () => {
    await afterAFailedCheck()
    const amount = within(coreCard()).getByLabelText('Plan amount for the whole plan')

    expect(amount).toHaveFocus()
    expect(amount).not.toHaveAttribute('aria-invalid')
    expect(within(coreCard()).queryByText(ASK)).not.toBeInTheDocument()
    expect(screen.queryByText(SOME_FIELDS)).not.toBeInTheDocument()   // nothing on screen has a message to point to
  })

  it('says it on the next Save, and takes the person to it', async () => {
    const { user } = await afterAFailedCheck()

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(within(coreCard()).getByText(ASK)).toBeInTheDocument()
    expect(within(coreCard()).getByLabelText('Plan amount for the whole plan')).toHaveFocus()
    expect(screen.getByText(SOME_FIELDS)).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('says it as soon as the person starts on another field of that pool', async () => {
    const { user } = await afterAFailedCheck()
    const card = coreCard()   // (its name is the pool's name, so it is looked up before that is typed over)

    await user.type(within(card).getByLabelText('Name on the plan'), 'C')

    expect(within(card).getByText(ASK)).toBeInTheDocument()
    expect(screen.getByText(SOME_FIELDS)).toBeInTheDocument()
  })

  it('shows nothing of a pool before any save was tried, however much the person has typed in it', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    const card = coreCard()
    await user.type(within(card).getByLabelText('Plan amount for the whole plan'), '4000')

    await user.type(within(card).getByLabelText('Name on the plan'), 'C')
    const second = within(card).getByLabelText('Plan amount, 1 Oct – 31 Dec 2026')
    await user.clear(second)   // a blank amount in a period, mid-edit
    await user.clear(within(card).getByLabelText('Plan amount for the whole plan'))

    expect(within(card).queryByText(ASK)).not.toBeInTheDocument()
    expect(within(card).queryByText('Enter an amount.')).not.toBeInTheDocument()
    expect(second).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(SOME_FIELDS)).not.toBeInTheDocument()
  })

  it('shows the messages of every pool on the first Save, as before', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.selectOptions(screen.getByLabelText('Stated support category'), '15')
    await user.click(screen.getByRole('button', { name: 'Add a stated support' }))

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(screen.getAllByText(ASK)).toHaveLength(2)
  })
})

describe('editor: what a refused save scrolls to, and where focus goes after "Load the latest"', () => {
  it('keeps the 409 sentence clear of the panel’s header rule when it is scrolled into view', async () => {
    update.mockImplementation((_variables, options) => options.onError(staleReply))
    const { user } = renderEditor({ plan: plan({ revision: 4 }) })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const region = screen.getByRole('alert').parentElement as HTMLElement
    expect(region.style.scrollMarginTop).toBe('0.75rem')   // scroll-mt-3: "nearest" alone leaves it flush under the rule
    expect(scrollIntoView.mock.contexts).toContain(region)
  })

  it('keeps the first field that needs attention clear of it too', async () => {
    const { user } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    const first = screen.getByLabelText(/^Plan start/)
    expect(first).toHaveFocus()
    expect(first.style.scrollMarginTop).toBe('0.75rem')
    expect(scrollIntoView.mock.contexts).toContain(first)
  })

  it('keeps a pool, and the Pools heading, clear of it when focus is sent to them', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.selectOptions(screen.getByLabelText('Stated support category'), '15')
    await user.click(screen.getByRole('button', { name: 'Add a stated support' }))

    await user.click(screen.getByRole('button', { name: 'Remove Improved Daily Living Skills, Plan Managed' }))
    expect(coreCard()).toHaveFocus()
    expect(coreCard().style.scrollMarginTop).toBe('0.75rem')

    await user.click(screen.getByRole('button', { name: 'Remove Core (flexible), Plan Managed' }))
    const heading = screen.getByRole('heading', { name: 'Pools' })
    expect(heading).toHaveFocus()
    expect(heading.style.scrollMarginTop).toBe('0.75rem')
  })

  it('sends focus to the first field after "Load the latest", since the button that had it is gone with its sentence', async () => {
    update.mockImplementation((_variables, options) => options.onError(staleReply))
    const newer = plan({ revision: 5, confirmedByName: 'Somebody Else' })
    plans.mockReturnValue({ data: { plans: [plan({ revision: 4 })], profilePlanDates: {} }, refetch: vi.fn().mockResolvedValue({ data: { plans: [newer], profilePlanDates: {} } }) })
    const { user } = renderEditor({ plan: plan({ revision: 4 }) })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await user.click(screen.getByRole('button', { name: 'Load the latest' }))

    await waitFor(() => expect(screen.getByLabelText('Confirmed by')).toHaveValue('Somebody Else'))
    expect(screen.queryByRole('button', { name: 'Load the latest' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Plan start/)).toHaveFocus()
  })
})

describe('editor: a set-aside the person typed into a period is not overwritten by the box', () => {
  const setAsideBox = (card: HTMLElement) => within(card).getByLabelText('Set-aside (optional)')
  const periodSetAsides = (card: HTMLElement) => within(card).getAllByLabelText(/^Set-aside, /).map(input => (input as HTMLInputElement).value)

  it('leaves it when the box is corrected, says the periods no longer add up to the box, and applies the box on "Split again"', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '4000')
    await user.type(setAsideBox(coreCard()), '400')                  // spread over the periods
    const first = within(coreCard()).getByLabelText('Set-aside, 1 Jul – 30 Sep 2026')
    await user.clear(first)
    await user.type(first, '10')                                      // the person's own figure
    const others = periodSetAsides(coreCard()).slice(1)

    fireEvent.change(setAsideBox(coreCard()), { target: { value: '200' } })   // the box is corrected over it

    expect(first).toHaveValue('10')
    expect(periodSetAsides(coreCard()).slice(1)).toEqual(others)   // nothing was overwritten
    expect(within(coreCard()).getByText(/^The set-asides add up to \$3\d\d\.\d\d, not the \$200\.00 you typed\. The periods are what is saved\.$/)).toBeInTheDocument()

    await user.click(within(coreCard()).getByRole('button', { name: 'Split again from the plan amount' }))

    expect(periodSetAsides(coreCard())).toEqual(['50.41', '50.41', '49.32', '49.86'])   // the box, applied
    expect(within(coreCard()).queryByText(/set-asides add up to/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    expect((create.mock.calls[0][0].pools[0].periods as { setAside: number }[]).map(period => period.setAside)).toEqual([50.41, 50.41, 49.32, 49.86])
  })

  it('keeps the set-asides of a saved plan when its box is corrected, and saves them as they are', async () => {
    const { user } = renderEditor({ plan: plan() })   // Core: 1000.00 set aside on each of four periods
    const core = screen.getByRole('region', { name: /^Core \(flexible\), Plan Managed/ })

    fireEvent.change(setAsideBox(core), { target: { value: '4100' } })

    expect(periodSetAsides(core)).toEqual(['1000.00', '1000.00', '1000.00', '1000.00'])
    expect(within(core).getByText('The set-asides add up to $4,000.00, not the $4,100.00 you typed. The periods are what is saved.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((update.mock.calls[0][0].body.pools[0].periods as { setAside: number }[]).map(period => period.setAside)).toEqual([1000, 1000, 1000, 1000])
  })

  it('still follows the box digit by digit while the cells are its own shares', async () => {
    const { user } = renderEditor()
    typeYear()
    await user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '4000')

    await user.type(setAsideBox(coreCard()), '800')

    expect(periodSetAsides(coreCard()).reduce((sum, text) => sum + Math.round(Number(text) * 100), 0)).toBe(80000)
    expect(within(coreCard()).queryByText(/set-asides add up to/)).not.toBeInTheDocument()
  })
})

describe('editor: a set-aside that no period carries is said, and "Split again" applies it', () => {
  async function typedOverABlank() {
    const view = renderEditor()
    typeYear()
    await view.user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await view.user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '4000')
    const second = within(coreCard()).getByLabelText('Plan amount, 1 Oct – 31 Dec 2026')
    await view.user.clear(second)                                                              // an amount cleared to retype it
    await view.user.type(within(coreCard()).getByLabelText('Set-aside (optional)'), '4000')   // the box typed meanwhile: nothing to spread over
    await view.user.type(second, '1008.22')                                                    // and the amount retyped
    return view
  }

  it('says so as soon as it is so, as a warning, not yet as an error', async () => {
    await typedOverABlank()

    const line = within(coreCard()).getByText(NOT_APPLIED)
    expect(line).not.toHaveAttribute('data-problem')
    expect(within(coreCard()).getByRole('button', { name: 'Split again from the plan amount' })).toBeInTheDocument()
  })

  it('refuses the save in the same words, beside the periods, and takes the person to it', async () => {
    const { user } = await typedOverABlank()

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    expect(create).not.toHaveBeenCalled()
    expect(within(coreCard()).getAllByText(NOT_APPLIED)).toHaveLength(1)   // the one line: the warning becomes the error
    expect(within(coreCard()).getByText(NOT_APPLIED)).toHaveFocus()
    expect(screen.getByText(SOME_FIELDS)).toBeInTheDocument()
  })

  it('goes away on "Split again", which puts the set-aside on every period so that it is saved', async () => {
    const { user } = await typedOverABlank()

    await user.click(within(coreCard()).getByRole('button', { name: 'Split again from the plan amount' }))

    expect(within(coreCard()).queryByText(NOT_APPLIED)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    const periods = create.mock.calls[0][0].pools[0].periods as { planAmount: number; setAside?: number }[]
    expect(periods.every(period => period.setAside === period.planAmount)).toBe(true)   // the whole 4000 is set aside
  })
})

describe('editor: a typed zero set-aside is "none" until the person confirms it means $0 (Q1)', () => {
  const ZERO_LINE = 'A set-aside of $0 means nothing may be claimed against this pool. Leave it blank if none is recorded.'
  const confirmBox = () => within(coreCard()).queryByRole('checkbox', { name: /set aside \$0/i })

  async function typedZero(box = '0') {
    const view = renderEditor()
    typeYear()
    await view.user.click(screen.getByRole('button', { name: 'Add Core (flexible)' }))
    await view.user.type(within(coreCard()).getByLabelText('Plan amount for the whole plan'), '4000')
    await view.user.type(within(coreCard()).getByLabelText('Set-aside (optional)'), box)
    return view
  }

  it('shows the confirmation line, with a check box, beside the box while it holds a zero, in whichever way the zero is written', async () => {
    for (const box of ['0', '0.00']) {
      const { unmount } = await typedZero(box)

      expect(within(coreCard()).getByText(ZERO_LINE)).toBeInTheDocument()
      expect(confirmBox()).toBeInTheDocument()
      expect(confirmBox()).not.toBeChecked()
      unmount()
    }
  })

  it('says nothing while the box is blank or holds another figure', async () => {
    const { user } = await typedZero('500')
    expect(within(coreCard()).queryByText(ZERO_LINE)).not.toBeInTheDocument()
    expect(confirmBox()).not.toBeInTheDocument()

    await user.clear(within(coreCard()).getByLabelText('Set-aside (optional)'))
    expect(within(coreCard()).queryByText(ZERO_LINE)).not.toBeInTheDocument()
  })

  it('saves no set-aside for a zero nobody confirmed: it is the same as leaving the box blank', async () => {
    const { user } = await typedZero()

    expect(within(coreCard()).getAllByLabelText(/^Set-aside, /).map(input => (input as HTMLInputElement).value)).toEqual(['', '', '', ''])
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))

    const periods = create.mock.calls[0][0].pools[0].periods as { planAmount: number; setAside?: number }[]
    expect(periods).toHaveLength(4)
    expect(periods.every(period => period.setAside === undefined)).toBe(true)
  })

  it('saves $0 on every period once it is confirmed, and shows the zeros it put on the periods', async () => {
    const { user } = await typedZero()

    await user.click(confirmBox()!)

    expect(confirmBox()).toBeChecked()
    expect(within(coreCard()).getAllByLabelText(/^Set-aside, /).map(input => (input as HTMLInputElement).value)).toEqual(['0.00', '0.00', '0.00', '0.00'])
    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    const periods = create.mock.calls[0][0].pools[0].periods as { planAmount: number; setAside?: number }[]
    expect(periods.map(period => period.setAside)).toEqual([0, 0, 0, 0])
  })

  it('goes back to saving nothing when the confirmation is taken back', async () => {
    const { user } = await typedZero()
    await user.click(confirmBox()!)

    await user.click(confirmBox()!)

    await user.click(screen.getByRole('button', { name: 'Save plan budget' }))
    const periods = create.mock.calls[0][0].pools[0].periods as { planAmount: number; setAside?: number }[]
    expect(periods.every(period => period.setAside === undefined)).toBe(true)
  })

  it('shows a saved plan whose set-asides are $0 with the confirmation already given, and saves it as it was', async () => {
    const stored = plan({ pools: [pool({ periods: quarters(2000, 0) })] })
    const { user } = renderEditor({ plan: stored })

    expect(confirmBox()).toBeChecked()
    expect(within(coreCard()).getByText(ZERO_LINE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((update.mock.calls[0][0].body.pools[0].periods as { setAside?: number }[]).map(period => period.setAside)).toEqual([0, 0, 0, 0])
  })
})
