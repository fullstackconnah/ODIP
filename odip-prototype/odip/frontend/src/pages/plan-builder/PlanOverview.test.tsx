import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PlanBudget } from '@/api/hooks'
import type { DraftBlock, PlanIssue } from '@/api/types'
import { budgetOf, draftBlock, mondayWednesday, quote } from '@/test/fixtures/planPricing'
import { PlanOverview } from './PlanOverview'

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))

const entries = (): DraftBlock[] => [
  draftBlock(mondayWednesday('b1', { transport: { km: 20, vehicle: 'Standard', tolls: 0, parking: 0 } }), { workerGender: 'Female', driver: true, skills: ['FirstAid'] }),
  draftBlock(mondayWednesday('b2', { supportType: 'GroupActivity', days: ['Saturday'], start: '09:00:00', end: '15:00:00', participantsPresent: 3 })),
]

const budget = (): PlanBudget => {
  const base = budgetOf('b1')
  return {
    ...base,
    period: { ...base.period, totals: { ...base.period.totals, byBlock: [...base.period.totals.byBlock, { blockId: 'b2', amount: 8195.16, supportHours: 237, occurrences: 52, skippedOccurrences: 0 }] } },
    weekly: { ...base.weekly, totals: { ...base.weekly.totals, byBlock: [...base.weekly.totals.byBlock, { blockId: 'b2', amount: 207.06, supportHours: 6, occurrences: 1, skippedOccurrences: 0 }] } },
  }
}

function setUp(props: Partial<Parameters<typeof PlanOverview>[0]> = {}) {
  const handlers = { onStart: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onRemove: vi.fn() }
  render(
    <MemoryRouter>
      <PlanOverview entries={entries()} budget={budget()} budgetStatus="ready" issues={[]} state="NSW" zone="National" {...handlers} {...props} />
    </MemoryRouter>,
  )
  return handlers
}

beforeEach(() => asRole('Admin'))
afterEach(() => localStorage.clear())

describe('PlanOverview with blocks', () => {
  it('shows every block as one readable line, numbered, with what it asks of a worker, and what it costs in a week and over the agreement', () => {
    setUp()

    expect(screen.getByText('Mon, Wed · 09:00–13:00 · Community access 1:1 · +20 km transport')).toBeInTheDocument()
    expect(screen.getByText('Sat · 09:00–15:00 · Group activity 1:3')).toBeInTheDocument()
    expect(screen.getByText('Asks for Female worker, driver, first aid')).toBeInTheDocument()
    expect(screen.getByText('8 h · $588.64')).toBeInTheDocument()
    expect(screen.getByText('6 h · $207.06')).toBeInTheDocument()
    expect(screen.getByText('$30,610.28')).toBeInTheDocument()
    expect(screen.getByText('$8,195.16')).toBeInTheDocument()
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Saturday: 09:00–15:00')   // the week strip beside them
  })

  it('opens the stepper where you choose: each block has Times, Support, Travel and Review chips that name their block', async () => {
    const user = userEvent.setup()
    const { onEdit } = setUp()

    await user.click(screen.getByRole('button', { name: 'Edit times of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Edit support and requirements of block 2' }))
    await user.click(screen.getByRole('button', { name: 'Edit travel and transport of block 1' }))
    await user.click(screen.getByRole('button', { name: 'Edit prices of block 2' }))

    expect(onEdit.mock.calls).toEqual([[0, 'times'], [1, 'requirements'], [0, 'travel'], [1, 'review']])
  })

  it('duplicates a block from a visible button, and asks before removing one', async () => {
    const user = userEvent.setup()
    const { onDuplicate, onRemove } = setUp()

    await user.click(screen.getByRole('button', { name: 'Duplicate block 2' }))
    expect(onDuplicate).toHaveBeenCalledWith(1)

    await user.click(screen.getByRole('button', { name: 'Remove block 1' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Remove block 1?' })
    expect(dialog).toHaveTextContent('Mon, Wed · 09:00–13:00 · Community access 1:1 · +20 km transport')
    expect(onRemove).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Remove block' }))
    expect(onRemove).toHaveBeenCalledWith(0)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the block when the removal is called off', async () => {
    const user = userEvent.setup()
    const { onRemove } = setUp()

    await user.click(screen.getByRole('button', { name: 'Remove block 2' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(onRemove).not.toHaveBeenCalled()
  })

  it('leaves three dots where a figure is on its way, never a zero, and a dash where there will be none', () => {
    setUp({ budget: undefined, budgetStatus: 'loading' })
    expect(screen.getAllByText('…')).toHaveLength(4)       // two blocks, a week and an agreement figure each
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('draws a dash for a block the quote left out', () => {
    setUp({ budget: { ...budget(), weekly: null, week: null, period: quote() }, budgetStatus: 'ready' })
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
  })

  it('puts what needs a person beside the block it is about, in plain words, and the refusals apart', () => {
    const issues: PlanIssue[] = [
      { blockId: 'b1', reason: 'NoItem', message: "Block 'b1': no item for Weekday Night", count: 12, firstDate: '2026-10-12' },
      { blockId: 'b2', reason: 'InvalidInput', message: "Block 'b2': choose at least one day.", count: 1 },
      { blockId: '', reason: 'InvalidInput', message: 'The agreement period must fall between the years 2000 and 2100.', count: 1 },
    ]
    setUp({ issues })

    expect(screen.getByText('Part of this block has no price item, 12 shifts')).toBeInTheDocument()
    expect(screen.getAllByText('A block breaks a rule')).toHaveLength(2)    // beside block 2, and again for the plan's own issue
    // The plan's own issue (it names no block) is a list of its own above the table.
    expect(screen.getByRole('list', { name: 'Things to look at' })).toHaveTextContent('The agreement period must fall between the years 2000 and 2100.')
  })

  // The engine keeps one issue for each block, reason and message, counting the shifts it met it on (a message names the item, never the date): a block short of two catalogue items has two
  // issues counting the same shifts, and reads as one gap with that many shifts.
  it('says a catalogue gap once for a block however many items it misses, with the number of shifts', () => {
    const gap = (blockId: string, need: string, shifts: number): PlanIssue => ({ blockId, reason: 'CatalogueNotFound', message: `No catalogue row for ${need} is valid for part of the period. Import the catalogue for that period.`, count: shifts, firstDate: '2027-07-01' })
    setUp({ issues: [gap('b1', 'Community access, Weekday Daytime', 30), gap('b1', 'Community access, Weekday Evening', 30), gap('b2', 'Community access, Weekday Daytime', 2)] })

    expect(screen.getAllByText(/No catalogue prices for part of the agreement/)).toHaveLength(2)    // one under each block, not one an item
    expect(screen.getByText('No catalogue prices for part of the agreement, 30 shifts')).toBeInTheDocument()
    expect(screen.getByText('No catalogue prices for part of the agreement, 2 shifts')).toBeInTheDocument()
  })

  it('says which registration groups are unconfirmed, with the way to confirm them for an Admin, and a quieter line for the holiday overrides', () => {
    const withNotices = budget()
    withNotices.period = quote({
      ...withNotices.period,
      notices: [
        { code: 'registration-groups-not-confirmed', message: 'The registration groups the provider holds have not been confirmed.', openQuestion: 1 },
        { code: 'holiday-overrides-end', message: 'The overrides run to 2027-04-25.', openQuestion: 8 },
      ],
    })
    setUp({ budget: withNotices })

    expect(screen.getByRole('alert')).toHaveTextContent('Registration groups are not confirmed')
    expect(screen.getByRole('link', { name: 'Confirm in Settings' })).toHaveAttribute('href', '/settings?tab=pricing')
    const quiet = screen.getByText('Part-day holidays may be missing').closest('details')
    expect(quiet).not.toBeNull()
    expect(quiet).not.toHaveAttribute('open')
  })
})

describe('PlanOverview as a Coordinator, who cannot confirm the groups', () => {
  it('names an Admin instead of linking to a tab the Coordinator does not have', () => {
    asRole('Coordinator')
    const withNotice = budget()
    withNotice.period = quote({ ...withNotice.period, notices: [{ code: 'registration-groups-not-confirmed', message: 'Not confirmed.', openQuestion: 1 }] })
    setUp({ budget: withNotice })

    expect(screen.queryByRole('link', { name: 'Confirm in Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('An Admin can confirm them in Settings, under Plan pricing.')
  })
})

describe('PlanOverview when read only', () => {
  it('draws the blocks and their figures and nothing that changes them', () => {
    setUp({ readOnly: true })

    expect(screen.getByText('Sat · 09:00–15:00 · Group activity 1:3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit .* of block/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Duplicate block/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove block/ })).not.toBeInTheDocument()
  })
})

describe('PlanOverview when read only and nothing can be priced', () => {
  it('has no column of figures waiting for a quote that will never come: the saved versions carry the prices', () => {
    setUp({ readOnly: true, budget: undefined, budgetStatus: 'idle' })

    expect(screen.getByText('Mon, Wed · 09:00–13:00 · Community access 1:1 · +20 km transport')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Block'])
    expect(screen.queryByText('…')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('—')).not.toBeInTheDocument()
  })

  it('shows a dash, not three dots, for a figure that nothing is going to fill in', () => {
    setUp({ budget: undefined, budgetStatus: 'idle' })

    expect(screen.queryByText('…')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText('—')).toHaveLength(4)    // two blocks, a week and an agreement figure each
  })
})

describe('PlanOverview with no blocks', () => {
  it('starts the week from the six templates, and says nothing is typed in by hand', async () => {
    const user = userEvent.setup()
    const { onStart } = setUp({ entries: [], budget: undefined, budgetStatus: 'idle' })

    expect(screen.getByRole('heading', { name: 'Start the week from a template' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing is typed in by hand/)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(6)
    await user.click(screen.getByRole('button', { name: /Overnight with sleepover/ }))
    expect(onStart.mock.calls[0][0].key).toBe('overnight-sleepover')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('offers no templates to somebody who can only read the plan', () => {
    setUp({ entries: [], readOnly: true, budget: undefined, budgetStatus: 'idle' })

    expect(screen.getByText('This draft has no blocks.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
