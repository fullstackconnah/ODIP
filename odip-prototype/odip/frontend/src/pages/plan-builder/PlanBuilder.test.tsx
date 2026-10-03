import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { DraftBlock, FundingSourceDto, PlanIssue } from '@/api/types'
import { budgetOf, draftBlock, mondayWednesday, quote, settings as makeSettings } from '@/test/fixtures/planPricing'
import { PlanBuilder } from './PlanBuilder'

const { blockQuoteState, budgetCall, budgetState, fundingState, settingsState } = vi.hoisted(() => ({
  blockQuoteState: { current: undefined as unknown },
  budgetCall: vi.fn(),
  budgetState: { current: {} as Record<string, unknown> },
  fundingState: { current: { data: [] as unknown[], isError: false } },
  settingsState: { current: { data: undefined as unknown } },
}))

vi.mock('@/api/hooks', () => ({
  usePlanPricingSettings: () => settingsState.current,
  useFundingSources: () => fundingState.current,
  usePlanBudget: (blocks: unknown[], from: string, to: string, enabled: boolean) => { budgetCall(blocks, from, to, enabled); return { ...budgetState.current, refetch: vi.fn() } },
  usePlanBlockQuote: () => ({ data: blockQuoteState.current ?? quote(), isLoading: false, isError: false, refetch: vi.fn() }),
}))

const source = (changes: Partial<FundingSourceDto> = {}): FundingSourceDto => ({
  id: 'f', participantId: 'p-1', participantName: null, routeType: 'PlanManaged', budgetCategory: null, ndisPlanNumber: null, planStartDate: '2026-07-01', planEndDate: '2027-06-30',
  budget: 40000, payerName: null, payerEmail: null, isActive: true, ...changes,
})

/** The plan belongs to the page; this is the smallest page. */
function Page({ initial = [] as DraftBlock[], readOnly = false, onPlan, footer, unsaved, from = '2026-10-01', to = '2027-06-30' }: { initial?: DraftBlock[]; readOnly?: boolean; onPlan?: (entries: DraftBlock[]) => void; footer?: React.ComponentProps<typeof PlanBuilder>['footer']; unsaved?: React.ComponentProps<typeof PlanBuilder>['unsaved']; from?: string; to?: string }) {
  const [entries, setEntries] = useState(initial)
  return (
    <MemoryRouter>
      <PlanBuilder
        participantId="p-1" state="NSW" zone="National" from={from} to={to} entries={entries}
        onChange={next => { setEntries(next); onPlan?.(next) }} readOnly={readOnly} footer={footer ?? <button type="button">Save draft</button>} unsaved={unsaved}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  budgetCall.mockReset()
  blockQuoteState.current = undefined
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
    expect(screen.getByRole('heading', { level: 3, name: 'Days and times' })).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { level: 3, name: 'Days and times' })).toBeInTheDocument()
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

  // Design review 11: the copy used to join the plan the moment Duplicate was pressed, so cancelling left an identical, overlapping block behind.
  it('duplicates a block into a block being added just after it, at Days and times: "same, but Thursday" is one click and a day, and the plan changes only when it is added', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Duplicate block 1' }))

    expect(onPlan).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Add a block' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Days and times' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Thursday' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Add to plan' }))

    const next = onPlan.mock.calls[0][0] as DraftBlock[]
    expect(next.map(entry => entry.block.id)).toEqual(['b1', 'b3', 'b2'])         // after the block it copies, on a free id
    expect(next[1].block.days).toEqual(['Monday', 'Wednesday', 'Thursday'])
    expect(next[0].block.days).toEqual(['Monday', 'Wednesday'])                    // the block it copies is as it was
  })

  it('leaves no copy behind when a duplicate is cancelled: it had never joined the plan, and nothing was changed to lose', async () => {
    const user = userEvent.setup()
    const onPlan = vi.fn()
    render(<Page initial={twoBlocks()} onPlan={onPlan} />)

    await user.click(screen.getByRole('button', { name: 'Duplicate block 1' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onPlan).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /^Duplicate block/ })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Support plan' })).toBeInTheDocument()
  })

  it('prices the copy in the place it will take, between the block it copies and the next, while it is being built', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Duplicate block 1' }))

    // The budget asks after the pause for typing to settle.
    await waitFor(() => {
      const [blocks] = budgetCall.mock.calls[budgetCall.mock.calls.length - 1]
      expect((blocks as { id: string }[]).map(block => block.id)).toEqual(['b1', 'b3', 'b2'])
    })
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
    expect(screen.getByRole('heading', { level: 3, name: 'Template' })).toBeInTheDocument()
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

  it('names the blocks in a Review message by the places they have in the plan, whichever block is open', async () => {
    const user = userEvent.setup()
    blockQuoteState.current = quote({ issues: [{ blockId: 'b2', reason: 'BlocksOverlap', message: "Blocks 'b1' and 'b2' are on at the same time on the same day. Block 'b2' is the second.", count: 2, firstDate: '2026-10-12' }] })
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Review prices of block 2' }))
    expect(within(screen.getByRole('region', { name: 'To look at' })).getByText(/Blocks 1 and 2 are on at the same time on the same day\. Block 2 is the second\./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Review prices of block 1' }))
    expect(within(screen.getByRole('region', { name: 'To look at' })).getByText(/Blocks 1 and 2 are on at the same time on the same day\. Block 2 is the second\./)).toBeInTheDocument()
  })

  it('draws the save row under the list only when the overview is showing', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add block' }))

    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  })
})

describe('PlanBuilder and where focus goes', () => {
  it('moves focus into the stepper, to the heading of the first step, when a template card opens it: the card is gone with the overview', async () => {
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: /Community access weekdays/ }))

    expect(screen.getByRole('heading', { level: 3, name: 'Days and times' })).toHaveFocus()
  })

  it('moves focus into the stepper when an edit chip opens it, and back to "Support plan" when the block is saved or the stepper is cancelled', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Edit travel and transport of block 1' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Travel and transport' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Support plan' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Edit times of block 2' }))
    await user.click(screen.getByRole('button', { name: 'Save block' }))
    expect(screen.getByRole('heading', { name: 'Support plan' })).toHaveFocus()
  })

  it('keeps a keyboard user in the list when a block is removed: the block that took its place has focus, not the top of the page', async () => {
    const user = userEvent.setup()
    render(<Page initial={[...twoBlocks(), draftBlock(mondayWednesday('b3', { days: ['Friday'] }))]} />)

    await user.click(screen.getByRole('button', { name: 'Remove block 2' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove block' }))

    // The old block 3 is block 2 now, and its first chip has focus.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit times of block 2' })).toHaveFocus())
    expect(screen.getByText('Fri · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
  })

  it('goes to the block before it when the last one is removed, and to the heading when none is left', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Remove block 2' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove block' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit times of block 1' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Remove block 1' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove block' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Support plan' })).toHaveFocus())
  })

  it('does not move focus when a removal is called off', async () => {
    const user = userEvent.setup()
    render(<Page initial={twoBlocks()} />)

    await user.click(screen.getByRole('button', { name: 'Remove block 1' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Remove block 1' })).toHaveFocus()    // the dialog's own return to its opener
  })

  it('does not take focus from a person who has not changed the view: nothing is focused when the page loads', () => {
    render(<Page initial={twoBlocks()} />)
    expect(screen.getByRole('heading', { name: 'Support plan' })).not.toHaveFocus()
    expect(document.body).toHaveFocus()
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

// Design review 6: "Add to plan" does not save, and the save row is a long scroll below the blocks, so on a phone the bar says the plan is not saved and saves from there.
// Code review N1: with no dates, a date that is no day, or an end before the start, the budget query is off. The bar said "Pricing the plan…" (and was busy) with nothing in flight, and the screen kept showing
// the answer for the dates it had before (the query keeps the previous answer): totals that were not the plan's.
describe('PlanBuilder and dates the plan cannot be priced over', () => {
  const idle = (note: string) => {
    const bar = screen.getByRole('region', { name: 'Running budget' })
    expect(bar).toHaveAttribute('aria-busy', 'false')
    expect(within(bar).getAllByText(new RegExp(note))).toHaveLength(2)
    expect(within(bar).queryByText(/Pricing the plan/)).not.toBeInTheDocument()
    expect(bar).not.toHaveTextContent('$')
  }

  it.each([
    ['no dates', '', ''],
    ['no end date', '2026-10-01', ''],
    ['a date that is no day', '2026-10-01', '2027-02-30'],
    ['a year of five digits', '20267-01-01', '2027-06-30'],
  ])('says to enter the dates, as idle and not busy, for %s, and shows no figure from the dates it had before', (_name, from, to) => {
    render(<Page initial={twoBlocks()} from={from} to={to} />)

    idle('Enter the agreement dates to price the plan')
    const rows = screen.getAllByRole('row').slice(1)
    for (const row of rows) expect(row).not.toHaveTextContent('$')    // the overview shows the en dash of a figure nobody has, not the totals of the dates before
  })

  it('says an agreement that ends before it starts in its own words, comparing the days and not the text', () => {
    render(<Page initial={twoBlocks()} from="2027-06-30" to="2026-10-01" />)

    idle('The agreement ends before it starts, so the plan cannot be priced')
  })

  it('does not take a refusal from the dates before for this plan, so Save is not held back by an answer that is not about this plan', () => {
    const refusal: PlanIssue = { blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs registration group 0125.", count: 1 }
    budgetState.current = { data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: [refusal] }) }, isError: false, isFetching: false }
    const footer = vi.fn(() => <span>save row</span>)
    render(<Page initial={twoBlocks()} footer={footer} from="" to="" />)

    expect(footer).toHaveBeenCalledWith({ refused: [] })
  })

  it('prices as before once the dates are there', () => {
    render(<Page initial={twoBlocks()} />)

    const bar = screen.getByRole('region', { name: 'Running budget' })
    expect(bar).toHaveTextContent('$30,610.28')
    expect(bar).not.toHaveTextContent('Enter the agreement dates')
  })

  it('says nothing about dates when there is no block to price: it asks for a block first', () => {
    render(<Page initial={[draftBlock({ ...mondayWednesday('b1'), days: [] })]} from="" to="" />)

    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveTextContent('Add a block to see the budget')
  })
})

describe('PlanBuilder and a plan that is not saved', () => {
  it('says Not saved on the budget bar, with a Save beside it that saves, and says nothing when there is nothing to save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { unmount } = render(<Page initial={twoBlocks()} unsaved={{ onSave, saving: false }} />)

    const bar = screen.getByRole('region', { name: 'Running budget' })
    expect(within(bar).getByText('Not saved')).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    unmount()

    render(<Page initial={twoBlocks()} />)
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
  })

  it("holds the bar's Save back while a save is under way, and when the engine refused a block (the save row says why)", () => {
    const refusal: PlanIssue = { blockId: 'b2', reason: 'RegistrationGroupNotHeld', message: "Block 'b2': needs group 0136.", count: 1 }
    const { unmount } = render(<Page initial={twoBlocks()} unsaved={{ onSave: vi.fn(), saving: true }} />)
    expect(within(screen.getByRole('region', { name: 'Running budget' })).getByRole('button', { name: 'Saving…' })).toBeDisabled()
    unmount()

    budgetState.current = { data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: [refusal] }) }, isError: false, isFetching: false }
    render(<Page initial={twoBlocks()} unsaved={{ onSave: vi.fn(), saving: false }} />)
    expect(within(screen.getByRole('region', { name: 'Running budget' })).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('PlanBuilder and what the engine refused', () => {
  const refusal: PlanIssue = { blockId: 'b2', reason: 'RegistrationGroupNotHeld', message: "Block 'b2': GroupActivity needs registration group 0136, which the provider does not hold.", count: 1 }
  const review: PlanIssue = { blockId: 'b1', reason: 'NoItem', message: "Block 'b1': no item.", count: 4 }

  it('tells the save row which issues are refusals, so it can hold Save back before the server has to', () => {
    budgetState.current = { data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: [review, refusal] }) }, isError: false, isFetching: false }
    const footer = vi.fn(() => <span>save row</span>)
    render(<Page initial={twoBlocks()} footer={footer} />)

    expect(footer).toHaveBeenCalledWith({ refused: [refusal] })     // a Review flag is not a refusal
    expect(screen.getByText('save row')).toBeInTheDocument()
  })

  it('tells it nothing was refused when only Review flags were found', () => {
    budgetState.current = { data: { ...budgetOf('b1'), period: quote({ ...budgetOf('b1').period, issues: [review] }) }, isError: false, isFetching: false }
    const footer = vi.fn(() => <span>save row</span>)
    render(<Page initial={twoBlocks()} footer={footer} />)

    expect(footer).toHaveBeenCalledWith({ refused: [] })
  })
})

describe('PlanBuilder when it cannot be changed', () => {
  it('shows the plan with its figures and nothing that changes it, and does not ask the server to price anything', () => {
    render(<Page initial={twoBlocks()} readOnly />)

    expect(screen.getByText('Mon, Wed · 09:00–13:00 · Community access 1:1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add block' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit times/ })).not.toBeInTheDocument()
    expect(budgetCall.mock.calls.every(call => call[3] === false)).toBe(true)
    // Nothing is priced for somebody who can only read, so there is no budget bar to say "Add a block" under a plan that has blocks.
    expect(screen.queryByRole('region', { name: 'Running budget' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Add a block to see/)).not.toBeInTheDocument()
  })
})
