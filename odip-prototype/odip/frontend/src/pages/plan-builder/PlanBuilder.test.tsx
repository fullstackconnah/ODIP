import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { DraftBlock, FundingSourceDto, PlanIssue } from '@/api/types'
import { budgetOf, draftBlock, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import { PlanBuilder } from './PlanBuilder'

const { budgetCall, budgetState, fundingState, settingsState } = vi.hoisted(() => ({
  budgetCall: vi.fn(),
  budgetState: { current: {} as Record<string, unknown> },
  fundingState: { current: { data: [] as unknown[], isError: false } },
  settingsState: { current: { data: undefined as unknown } },
}))

vi.mock('@/api/hooks', () => ({
  usePlanPricingSettings: () => settingsState.current,
  useFundingSources: () => fundingState.current,
  usePlanBudget: (blocks: unknown[], from: string, to: string, enabled: boolean) => { budgetCall(blocks, from, to, enabled); return { ...budgetState.current, refetch: vi.fn() } },
  usePlanBlockQuote: () => ({ data: quote(), isLoading: false, isError: false, refetch: vi.fn() }),
}))

const source = (changes: Partial<FundingSourceDto> = {}): FundingSourceDto => ({
  id: 'f', participantId: 'p-1', participantName: null, routeType: 'PlanManaged', budgetCategory: null, ndisPlanNumber: null, planStartDate: '2026-07-01', planEndDate: '2027-06-30',
  budget: 40000, payerName: null, payerEmail: null, isActive: true, ...changes,
})

/** The plan belongs to the page; this is the smallest page. */
function Page({ initial = [] as DraftBlock[], readOnly = false, onPlan }: { initial?: DraftBlock[]; readOnly?: boolean; onPlan?: (entries: DraftBlock[]) => void }) {
  const [entries, setEntries] = useState(initial)
  return (
    <MemoryRouter>
      <PlanBuilder
        participantId="p-1" state="NSW" zone="National" from="2026-10-01" to="2027-06-30" entries={entries}
        onChange={next => { setEntries(next); onPlan?.(next) }} readOnly={readOnly} footer={<button type="button">Save draft</button>}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  budgetCall.mockReset()
  budgetState.current = { data: { ...budgetOf('b1') }, isError: false, isFetching: false, error: null }
  fundingState.current = { data: [source()], isError: false }
  settingsState.current = { data: makeSettings() }
})
afterEach(() => localStorage.clear())

const twoBlocks = () => [draftBlock(mondayWednesday('b1')), draftBlock(mondayWednesday('b2', { supportType: 'GroupActivity', days: ['Saturday'], start: '09:00:00', end: '15:00:00', participantsPresent: 3 }))]

describe('PlanBuilder from an empty plan', () => {
  it('starts with the templates, and a card opens the stepper at Days and times on that template', async () => {
    const user = userEvent.setup()
    render(<Page />)

    expect(screen.getByRole('heading', { name: 'Support plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add block' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Community access weekdays/ }))

    expect(screen.getByRole('heading', { name: 'Add a block' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Days and times' })).toBeInTheDocument()
    expect(screen.getByText('Mon–Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
  })

  it('adds the block to the plan from Review, and the overview then shows it as a line', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: /Community access weekdays/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add to plan' }))

    expect(onPlan).toHaveBeenCalledTimes(1)
    const [added] = onPlan.mock.calls[0][0] as DraftBlock[]
    expect(added.block).toMatchObject({ id: 'b1', supportType: 'CommunityAccess', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '09:00:00', end: '13:00:00' })
    expect(added.requirements).toEqual({ workerGender: 'NoPreference', driver: false, skills: [] })
    expect(screen.getByRole('heading', { name: 'Support plan' })).toBeInTheDocument()
    expect(screen.getByText('Mon–Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add block' })).toBeInTheDocument()
  })

  it('shows nothing of the budget while there is nothing to price', () => {
    render(<Page />)
    expect(screen.queryByRole('region', { name: 'Running budget' })).not.toBeInTheDocument()
  })
})

describe('PlanBuilder with a plan', () => {
  it('opens the stepper at the chip you choose, on a copy: cancelling leaves the plan as it was, and nothing changes in the plan before Save block', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Edit times of block 2' }))
    expect(screen.getByRole('heading', { name: 'Edit block 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Days and times' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Friday' }))
    expect(onPlan).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Discard this block?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    expect(onPlan).not.toHaveBeenCalled()
    expect(screen.getByText('Sat · 09:00–15:00 · Group activity 1:3')).toBeInTheDocument()
  })

  it('keeps editing when the discard is called off', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Edit times of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Tuesday' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }))

    expect(screen.getByRole('heading', { name: 'Edit block 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not ask before discarding a block nobody has changed', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Edit travel and transport of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Support plan' })).toBeInTheDocument()
  })

  it('replaces the block with its edited copy on Save block, in the same place', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Edit times of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Friday' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))

    const next = onPlan.mock.calls[0][0] as DraftBlock[]
    expect(next.map(entry => entry.block.id)).toEqual(['b1', 'b2'])
    expect(next[0].block.days).toEqual(['Monday', 'Wednesday', 'Friday'])
    expect(screen.getByText('Mon, Wed, Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
  })

  it('duplicates a block just after it on its own id, and opens the copy at Days and times, so "same, but Thursday" is one click and a day', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Duplicate block 1' }))

    const next = onPlan.mock.calls[0][0] as DraftBlock[]
    expect(next.map(entry => entry.block.id)).toEqual(['b1', 'b3', 'b2'])
    expect(screen.getByRole('heading', { name: 'Edit block 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Days and times' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes a block once it is confirmed', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Remove block 2' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove block' }))

    expect((onPlan.mock.calls[0][0] as DraftBlock[]).map(entry => entry.block.id)).toEqual(['b1'])
  })

  it('adds another block from Add block, opening at Template, with the next free id', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Add block' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Template' })).toBeInTheDocument()
    expect(screen.getByText('Choose where the block starts. Nothing changes in the plan until you add it.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Personal care mornings/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add to plan' }))

    const next = onPlan.mock.calls[0][0] as DraftBlock[]
    expect(next.map(entry => entry.block.id)).toEqual(['b1', 'b2', 'b3'])
    expect(next[2].block.supportType).toBe('PersonalCare')
  })

  it('draws the save row under the list only when the overview is showing', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add block' }))

    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  })
})

describe('PlanBuilder and the budget', () => {
  it('prices the plan as it would be saved: the agreement period, every complete block, stamped with the agreement\'s state and zone', async () => {
    render(<Page initial={twoBlocks()} />)

    await waitFor(() => expect(budgetCall).toHaveBeenCalled())
    const [blocks, from, to, enabled] = budgetCall.mock.calls[budgetCall.mock.calls.length - 1]
    expect(blocks).toHaveLength(2)
    expect(blocks[0].location).toEqual({ state: 'NSW', zone: 'National' })
    expect([from, to, enabled]).toEqual(['2026-10-01', '2027-06-30', true])
  })

  it('shows the running budget below the plan, with the plan budget from the funding sources and the comparison', () => {
    render(<Page initial={twoBlocks()} />)

    const bar = screen.getByRole('region', { name: 'Running budget' })
    expect(bar).toHaveTextContent('$30,610.28')
    expect(bar).toHaveTextContent('$40,000.00')
    expect(bar).toHaveTextContent('77% used')
  })

  it('says over the plan budget in a warning that does not stop anything', () => {
    fundingState.current = { data: [source({ budget: 10000 }), source({ id: 'g', budget: 5000 })], isError: false }
    render(<Page initial={twoBlocks()} />)

    expect(screen.getByText(/Over the plan budget by \$15,610\.28/)).toHaveTextContent('You can still save the draft.')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
  })

  it('says there is no plan budget to compare with when no funding source records one, and when they could not be read', () => {
    fundingState.current = { data: [], isError: false }
    const { unmount } = render(<Page initial={twoBlocks()} />)
    expect(screen.getByText('Not recorded for this participant. The totals stand alone.')).toBeInTheDocument()
    unmount()

    fundingState.current = { data: undefined as never, isError: true }
    render(<Page initial={twoBlocks()} />)
    expect(screen.getByText('The plan budget could not be read, so there is no comparison.')).toBeInTheDocument()
  })

  it('leaves a block that is not complete out of the figures, and says so', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Edit times of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Monday' }))
    await user.click(screen.getByRole('button', { name: 'Wednesday' }))

    expect(screen.getByText('1 block left out of these figures until it is complete.')).toBeInTheDocument()
  })

  it('says the plan is being priced while the first answer is on its way, and that a quote failed when it did', () => {
    budgetState.current = { data: undefined, isError: false, isFetching: true }
    const { unmount } = render(<Page initial={twoBlocks()} />)
    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')
    unmount()

    budgetState.current = { data: undefined, isError: true, error: { response: { status: 429, data: {} } } }
    render(<Page initial={twoBlocks()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The pricing service is busy.')
  })

  it('shows the issues the plan quote found beside their blocks', () => {
    const issue: PlanIssue = { blockId: 'b1', reason: 'NoItem', message: "Block 'b1': no item.", count: 4, firstDate: '2026-10-12' }
    budgetState.current = { data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: [issue] }) }, isError: false, isFetching: false }
    render(<Page initial={twoBlocks()} />)

    expect(screen.getByText('Part of this block has no price item, 4 shifts')).toBeInTheDocument()
  })
})

describe('PlanBuilder when it cannot be changed', () => {
  it('shows the plan with its figures and nothing that changes it, and does not ask the server to price anything', () => {
    render(<Page initial={twoBlocks()} readOnly />)

    expect(screen.getByText('Mon, Wed · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add block' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit times/ })).not.toBeInTheDocument()
    expect(budgetCall.mock.calls.every(call => call[3] === false)).toBe(true)
  })
})
