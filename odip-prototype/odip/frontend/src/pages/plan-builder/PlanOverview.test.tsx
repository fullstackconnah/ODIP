import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PlanBudget } from '@/api/hooks'
import type { DraftBlock, PlanIssue } from '@/api/types'
import { budgetOf, draftBlock, golden, mondayWednesday, quote } from '@/test/fixtures/planPricing'
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
    await user.click(screen.getByRole('button', { name: 'Review prices of block 2' }))

    expect(onEdit.mock.calls).toEqual([[0, 'times'], [1, 'requirements'], [0, 'travel'], [1, 'review']])
  })

  // Review F14 (WCAG 2.5.3): the visible word is "Review", so the name leads with it; voice control says "click Review".
  it('names every chip so that the word on it is in its name, the Review chip included', () => {
    setUp()

    const toolbar = screen.getByRole('toolbar', { name: 'Block 1 actions' })
    for (const label of ['Times', 'Support', 'Travel', 'Review']) {
      const chip = within(toolbar).getByText(label).closest('button') as HTMLButtonElement
      expect(chip.getAttribute('aria-label')?.toLowerCase()).toContain(label.toLowerCase())
    }
    expect(screen.getByRole('button', { name: 'Review prices of block 1' })).toHaveTextContent(/^Review$/)
    expect(screen.queryByRole('button', { name: /Edit prices/ })).not.toBeInTheDocument()
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

  // Code review N6: the overview treated a refused block with en dashes, and a block whose every line was short of its item (it is in the quote, with 0 h and $0.00) with a figure that reads as a price.
  it('draws an en dash for a block that came to nothing, and money for the block beside it that did not', () => {
    const base = budget()
    const zero = (totals: typeof base.period.totals) => ({ ...totals, byBlock: totals.byBlock.map(total => (total.blockId === 'b2' ? { ...total, amount: 0, supportHours: 0 } : total)) })
    setUp({ budget: { ...base, period: { ...base.period, totals: zero(base.period.totals) }, weekly: { ...base.weekly, totals: zero(base.weekly.totals) } } })

    const second = screen.getByText(/Sat · 09:00–15:00/).closest('tr') as HTMLElement
    expect(second).not.toHaveTextContent('$0.00')
    expect(second).not.toHaveTextContent('0 h')
    expect(within(second).getAllByText('–')).toHaveLength(2)
    const first = screen.getByText(/Mon, Wed · 09:00–13:00/).closest('tr') as HTMLElement
    expect(first).toHaveTextContent('8 h · $588.64')
    expect(first).toHaveTextContent('$30,610.28')
  })

  it('draws an en dash for a block the quote left out', () => {
    setUp({ budget: { ...budget(), weekly: null, week: null, period: quote() }, budgetStatus: 'ready' })
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(4)
  })

  // Design review 1 and 5: nothing was priced from a refused block, so a "0 h · $0.00" is not a figure; and the row, not only the save row below, says what to do about it.
  describe('a block the engine refused', () => {
    const refusal: PlanIssue = { blockId: 'b2', reason: 'RegistrationGroupNotHeld', message: "Block 'b2': GroupActivity needs registration group 0136, which the provider does not hold.", count: 1 }

    it('has an en dash for both figures, and not a zero, while its neighbour keeps its own', () => {
      setUp({ issues: [refusal] })

      const rows = within(screen.getByRole('table')).getAllByRole('row')
      const refused = rows.find(row => within(row).queryByText(/Sat · 09:00–15:00/))!
      expect(within(refused).getAllByText('–')).toHaveLength(2)
      expect(refused).not.toHaveTextContent('$0.00')
      expect(refused).not.toHaveTextContent('$8,195.16')
      const priced = rows.find(row => within(row).queryByText(/Mon, Wed · 09:00–13:00/))!
      expect(priced).toHaveTextContent('8 h · $588.64')
      expect(priced).toHaveTextContent('$30,610.28')
    })

    it('says on its row what to do, and offers the step that does it', async () => {
      const user = userEvent.setup()
      const { onEdit } = setUp({ issues: [refusal] })

      expect(screen.getByText('Your organisation does not hold this registration group')).toBeInTheDocument()
      expect(screen.getByText(/Choose another support type, or an Admin can record the groups you hold in Settings, Plan pricing\./)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Open Support for block 2' }))
      expect(onEdit).toHaveBeenCalledWith(1, 'requirements')
    })

    it('does not offer a step for a refusal that is fixed in Settings', () => {
      setUp({ issues: [{ ...refusal, reason: 'StaLegacyNotSupported' }] })
      expect(screen.getByText(/An Admin can switch to the hourly items/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()
    })

    it('says what to do to somebody who can only read the plan, and gives them no button', () => {
      setUp({ issues: [refusal], readOnly: true })
      expect(screen.getByText(/Choose another support type/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()
    })

    it('says only the title and the shifts for a flag that is not a refusal: a plan can still be saved with it', () => {
      setUp({ issues: [{ blockId: 'b1', reason: 'NoItem', message: "Block 'b1': no item.", count: 4, firstDate: '2026-10-12' }] })

      expect(screen.getByText('Part of this block has no price item, 4 shifts')).toBeInTheDocument()
      expect(screen.queryByText(/Community access and group activities have no item/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()
    })
  })

  // Design review 8: six Tab stops a block is about 240 for a plan of forty. The chips, Duplicate and Remove are one toolbar, one stop, arrow keys inside.
  describe('the actions of a block as one Tab stop', () => {
    const stops = (row: HTMLElement) => within(row).getAllByRole('button').filter(button => button.getAttribute('tabindex') !== '-1')

    it('has one tabbable button in a block\'s toolbar, the first, however many actions it holds', () => {
      setUp()

      const toolbars = screen.getAllByRole('toolbar')
      expect(toolbars.map(toolbar => toolbar.getAttribute('aria-label'))).toEqual(['Block 1 actions', 'Block 2 actions'])
      for (const toolbar of toolbars) {
        expect(within(toolbar).getAllByRole('button')).toHaveLength(6)
        expect(stops(toolbar)).toHaveLength(1)
      }
      expect(stops(toolbars[0])[0]).toHaveAccessibleName('Edit times of block 1')
    })

    it('goes through a block with Tab once, and on to the next block, not through its six actions', async () => {
      const user = userEvent.setup()
      setUp()

      await user.tab()
      expect(screen.getByRole('button', { name: 'Edit times of block 1' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Edit times of block 2' })).toHaveFocus()
    })

    it('moves with the arrow keys, wraps at either end, and Home and End go to the ends; Tab then comes back to the one last used', async () => {
      const user = userEvent.setup()
      setUp()
      screen.getByRole('button', { name: 'Edit times of block 1' }).focus()

      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('button', { name: 'Edit support and requirements of block 1' })).toHaveFocus()
      await user.keyboard('{End}')
      expect(screen.getByRole('button', { name: 'Remove block 1' })).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('button', { name: 'Edit times of block 1' })).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(screen.getByRole('button', { name: 'Remove block 1' })).toHaveFocus()
      await user.keyboard('{Home}')
      expect(screen.getByRole('button', { name: 'Edit times of block 1' })).toHaveFocus()

      await user.keyboard('{ArrowRight}{ArrowRight}')    // Travel
      await user.tab()                                   // on to block 2 ...
      expect(screen.getByRole('button', { name: 'Edit times of block 2' })).toHaveFocus()
      await user.tab({ shift: true })                    // ... and back to where block 1 was left
      expect(screen.getByRole('button', { name: 'Edit travel and transport of block 1' })).toHaveFocus()
    })

    it('still works with the mouse: a click on any button does what it did, and a click makes it the tab stop', async () => {
      const user = userEvent.setup()
      const { onDuplicate } = setUp()

      await user.click(screen.getByRole('button', { name: 'Duplicate block 2' }))
      expect(onDuplicate).toHaveBeenCalledWith(1)
      const toolbar = screen.getByRole('toolbar', { name: 'Block 2 actions' })
      expect(stops(toolbar)).toHaveLength(1)
      expect(stops(toolbar)[0]).toHaveAccessibleName('Duplicate block 2')
    })

    it('starts on the step that fixes what is wrong, in a block that was refused, so Tab lands where the way out is', () => {
      setUp({ issues: [{ blockId: 'b2', reason: 'RegistrationGroupNotHeld', message: "Block 'b2': needs group 0136.", count: 1 }] })

      expect(stops(screen.getByRole('toolbar', { name: 'Block 2 actions' }))[0]).toHaveAccessibleName('Edit support and requirements of block 2')
    })

    // Code review N3: the Tab stop was chosen once, when the row mounted, and a refusal arrives with the first quote, after it: the test above renders the issue from the start, which is not how it comes.
    describe('when the refusal arrives after the row is on screen', () => {
      const refusal: PlanIssue = { blockId: 'b2', reason: 'RegistrationGroupNotHeld', message: "Block 'b2': needs group 0136.", count: 1 }
      const view = (issues: PlanIssue[]) => (
        <MemoryRouter>
          <PlanOverview entries={entries()} budget={budget()} budgetStatus="ready" issues={issues} state="NSW" zone="National" onStart={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onRemove={vi.fn()} />
        </MemoryRouter>
      )

      it('moves the Tab stop to the step that fixes it, until the person has been in the toolbar', () => {
        const { rerender } = render(view([]))
        const toolbar = () => screen.getByRole('toolbar', { name: 'Block 2 actions' })
        expect(stops(toolbar())[0]).toHaveAccessibleName('Edit times of block 2')       // nothing is wrong yet: the first

        rerender(view([refusal]))

        expect(stops(toolbar())).toHaveLength(1)
        expect(stops(toolbar())[0]).toHaveAccessibleName('Edit support and requirements of block 2')
      })

      it('keeps the stop where the person left it once they have used the toolbar, whatever arrives', async () => {
        const user = userEvent.setup()
        const { rerender } = render(view([]))
        await user.click(screen.getByRole('button', { name: 'Duplicate block 2' }))      // in the toolbar: Duplicate is the stop

        rerender(view([refusal]))

        expect(stops(screen.getByRole('toolbar', { name: 'Block 2 actions' }))[0]).toHaveAccessibleName('Duplicate block 2')
      })

      it('goes back to the first chip when the refusal is gone, if the toolbar was not used', () => {
        const { rerender } = render(view([refusal]))
        expect(stops(screen.getByRole('toolbar', { name: 'Block 2 actions' }))[0]).toHaveAccessibleName('Edit support and requirements of block 2')

        rerender(view([]))

        expect(stops(screen.getByRole('toolbar', { name: 'Block 2 actions' }))[0]).toHaveAccessibleName('Edit times of block 2')
      })
    })
  })

  // Design review D10: at 390 the muted line broke inside its link ("Confirm in" / "Settings"), so the link read as two fragments.
  it('keeps the link that confirms the registration groups whole when the line wraps', () => {
    setUp({ budget: { ...budget(), period: quote({ ...budget().period, notices: [{ code: 'registration-groups-not-confirmed', message: 'Not confirmed.', openQuestion: 1 }] }) } })

    expect(screen.getByRole('link', { name: 'Confirm in Settings' })).toHaveClass('whitespace-nowrap')
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

    // Design review 2 and 8: a standing caveat only an Admin can act on is one quiet line under the heading, not the loudest block on the screen, and it does not interrupt.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const line = screen.getByText(/Registration groups are not confirmed\./)
    expect(line.tagName).toBe('P')
    expect(line).toHaveClass('text-[var(--color-muted-foreground)]')
    expect(within(line).getByRole('link', { name: 'Confirm in Settings' })).toHaveAttribute('href', '/settings?tab=pricing')
    expect(screen.queryByRole('heading', { name: /Registration groups/ })).not.toBeInTheDocument()
    const quiet = screen.getByText('Part-day holidays may be missing').closest('details')
    expect(quiet).not.toBeNull()
    expect(quiet).not.toHaveAttribute('open')
  })

  it('says the other plan-wide notices in the engine\'s words, with the engine\'s dates written the way the screen writes them, without interrupting', () => {
    const withNotices = budget()
    withNotices.period = quote({
      ...withNotices.period,
      notices: [{ code: 'holiday-calendar-missing', message: 'The calendar has no rows after 2027-04-25 for NSW.', openQuestion: 8 }],
    })
    setUp({ budget: withNotices })

    const callout = screen.getByText('The public holiday calendar has gaps').closest('div[class*="rounded-lg"]') as HTMLElement
    expect(callout).toHaveTextContent('The calendar has no rows after Sun 25 Apr 2027 for NSW.')
    expect(callout).not.toHaveAttribute('role')            // standing: announced when it appeared, not at every return to this view
    expect(callout).toHaveClass('max-w-prose')
  })
})

describe('PlanOverview with blocks and a quote that was never asked for', () => {
  it('says nothing of the registration groups before there is an answer to say it', () => {
    setUp({ budget: undefined, budgetStatus: 'loading' })
    expect(screen.queryByText(/Registration groups/)).not.toBeInTheDocument()
  })
})

describe('PlanOverview as a Coordinator, who cannot confirm the groups', () => {
  it('names an Admin instead of linking to a tab the Coordinator does not have', () => {
    asRole('Coordinator')
    const withNotice = budget()
    withNotice.period = quote({ ...withNotice.period, notices: [{ code: 'registration-groups-not-confirmed', message: 'Not confirmed.', openQuestion: 1 }] })
    setUp({ budget: withNotice })

    expect(screen.queryByRole('link', { name: 'Confirm in Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/Registration groups are not confirmed./)).toHaveTextContent('Ask an Admin to confirm them.')
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
    expect(within(screen.getByRole('table')).getAllByText('–')).toHaveLength(4)    // two blocks, a week and an agreement figure each
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

// Review F11: a quote the engine wrote (test/fixtures/planPricing.ts). A block that asks for two things its support type has no item for has two issues counting the same ten shifts.
describe('PlanOverview on a quote the engine wrote', () => {
  it('says each of two things that cannot be priced once, with the shifts it touches, beside the block, and the refusals apart', () => {
    const personalCare = draftBlock(mondayWednesday('b1', { supportType: 'PersonalCare', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '09:00:00', end: '12:00:00' }))
    setUp({ entries: [personalCare], issues: golden.twoIssuesSameShifts.issues })

    expect(screen.getByText('Transport does not go with this support type, 10 shifts')).toBeInTheDocument()
    expect(screen.getByText('Accommodation nights are a short-term accommodation item, 10 shifts')).toBeInTheDocument()
    expect(screen.queryByText(/20 shifts/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()       // neither stops a save: no recovery to offer on the row
  })
})
