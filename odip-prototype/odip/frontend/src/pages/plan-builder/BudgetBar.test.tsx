import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanBudget } from '@/api/hooks'
import type { PlanIssue } from '@/api/types'
import { budgetOf, emptyTotals } from '@/test/fixtures/planPricing'
import { BudgetBar } from './BudgetBar'

const budget = (): PlanBudget => budgetOf()

const ready = (props: Partial<Parameters<typeof BudgetBar>[0]> = {}) =>
  render(<BudgetBar status="ready" budget={budget()} planBudget={{ total: 40000, count: 1 }} {...props} />)

describe('BudgetBar', () => {
  it('says what an ordinary week and the whole agreement come to, and the agreement by budget category', () => {
    ready()

    const bar = screen.getByRole('region', { name: 'Running budget' })
    expect(within(bar).getByText('An ordinary week')).toBeInTheDocument()
    expect(bar).toHaveTextContent('8 h · $588.64')
    expect(bar).toHaveTextContent('$30,610.28 416 h of support')
    const categories = within(bar).getByRole('list', { name: 'By budget category' })
    expect(within(categories).getByText('Community participation $30,610.28')).toHaveAttribute('title', 'Assistance with Social, Economic and Community Participation')
  })

  it('compares the agreement with the plan budget: how much of it is used and how much is left', () => {
    ready()

    expect(screen.getByText('Plan budget')).toBeInTheDocument()
    expect(screen.getByText(/\$40,000\.00/)).toBeInTheDocument()
    expect(screen.getByText('77% used')).toBeInTheDocument()
    expect(screen.getByText('$9,389.72 left.')).toBeInTheDocument()
    expect(screen.queryByText(/Over the plan budget/)).not.toBeInTheDocument()
  })

  it('warns when the plan is over its budget, in words, and says it does not stop the save', () => {
    ready({ planBudget: { total: 25000, count: 2 } })

    const warning = screen.getByText(/Over the plan budget by \$5,610\.28/)
    expect(warning).toHaveTextContent('You can still save the draft.')
    expect(screen.getByText('122% used')).toBeInTheDocument()
    expect(screen.getByText('Over budget')).toBeInTheDocument()   // and on the one-line form a phone shows
    // Design 2: the cell takes the warning tint, and the sentence is text, not a pill. Design 8: the figures are not live regions, so nothing speaks on every recalculation.
    expect(screen.getByText('Plan budget').parentElement).toHaveClass('bg-[var(--color-warning-container)]')
    expect(warning.closest('[role="status"]')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Code review N11: at ae279094 the over-budget line was a status; design 8 took the live regions off the figures, and a screen reader that adds the block that tips the plan over was told nothing.
  describe('the plan crossing its budget', () => {
    const over = { planBudget: { total: 25000, count: 1 } }
    const under = { planBudget: { total: 40000, count: 1 } }

    it('has one polite status, visually hidden, that says so when the plan is over and is empty when it is not', () => {
      const { rerender } = ready(under)
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('')

      rerender(<BudgetBar status="ready" budget={budget()} {...over} />)
      expect(screen.getByRole('status')).toHaveTextContent('Over the plan budget.')
      expect(screen.getByRole('status').querySelector('p')).toHaveClass('sr-only')
      expect(screen.getAllByRole('status')).toHaveLength(1)
    })

    it('says it when it crosses, and says nothing new while the amount over changes, so it does not speak on every recalculation', () => {
      const { rerender } = ready(under)
      rerender(<BudgetBar status="ready" budget={budget()} {...over} />)
      const sentence = screen.getByRole('status').textContent

      rerender(<BudgetBar status="ready" budget={budget()} planBudget={{ total: 20000, count: 1 }} />)    // more over: the figure in the bar moves, the announcement does not
      expect(screen.getByRole('status').textContent).toBe(sentence)
      expect(screen.getByRole('status').textContent).not.toMatch(/\$|\d/)
    })

    it('puts the status in the page empty before it is filled, so that the change is announced', () => {
      const { rerender } = ready(under)
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('')

      rerender(<BudgetBar status="ready" budget={budget()} {...over} />)
      expect(screen.getByRole('status')).toBe(region)             // the same node: filled in place, not inserted already holding its text
      expect(region).toHaveTextContent('Over the plan budget.')
    })
  })

  // Design review D3: the amber cell said "You can still save the draft" while the Callout said the plan cannot be saved and Save draft was off.
  it('does not say the draft can still be saved while a block is refused', () => {
    const { rerender } = ready({ planBudget: { total: 25000, count: 1 } })
    expect(screen.getByText(/Over the plan budget by/)).toHaveTextContent('You can still save the draft.')

    rerender(<BudgetBar status="ready" budget={budget()} planBudget={{ total: 25000, count: 1 }} blocked />)
    expect(screen.getByText(/Over the plan budget by \$5,610\.28/)).not.toHaveTextContent(/save the draft/)
  })

  it('shows the totals on their own, and says so, when no plan budget is recorded or it could not be read', () => {
    const { rerender } = ready({ planBudget: null })
    expect(screen.getByText('Not recorded for this participant. The totals stand alone.')).toBeInTheDocument()
    expect(screen.queryByText(/% used/)).not.toBeInTheDocument()
    expect(screen.queryByText('Over budget')).not.toBeInTheDocument()

    rerender(<BudgetBar status="ready" budget={budget()} planBudget={null} planBudgetUnreadable />)
    expect(screen.getByText('The plan budget could not be read, so there is no comparison.')).toBeInTheDocument()
  })

  it('names the plans it cannot give a week for, and what is flagged, and what it left out', () => {
    const noWeek = budget()
    const holiday = { blockId: 'b1', date: '2026-10-05', holidayName: 'Labour Day', decision: 'Review' as const, skipped: false }
    ready({
      budget: { ...noWeek, weekly: null, week: null, period: { ...noWeek.period, holidayOccurrences: [holiday, { ...holiday, date: '2026-12-25', holidayName: 'Christmas Day' }], totals: { ...noWeek.period.totals, provisionalLines: 3 } } },
      incompleteBlocks: 1, refreshing: true,
    })

    expect(screen.getByText('The agreement is shorter than a week.')).toBeInTheDocument()
    expect(screen.getByText('2 public holiday shifts to decide · some lines use provisional rates.')).toBeInTheDocument()
    expect(screen.getByText('1 block left out of these figures until it is complete.')).toBeInTheDocument()
    expect(screen.getAllByText(/updating…/)).toHaveLength(2)   // in the one line, and in Details
    expect(screen.queryByText('Not fully priced')).not.toBeInTheDocument()   // a decision still to make is not work left out
  })

  // Design 1: the total is what a coordinator quotes to a family, so a total that leaves work out says so beside the figure, in shifts, and on the one-line form a phone shows.
  describe('a total that leaves work out', () => {
    const issue = (reason: PlanIssue['reason'], count: number, blockId = 'b1'): PlanIssue => ({ blockId, reason, message: `${reason} ${blockId}`, count, firstDate: '2026-10-13' })
    const withIssues = (...issues: PlanIssue[]): PlanBudget => {
      const base = budget()
      return { ...base, period: { ...base.period, issues, totals: { ...base.period.totals, lineCount: 744, unpricedLines: 372, reviewLines: 219, provisionalLines: 0 } } }
    }

    it('counts the shifts with a part not priced, once, never the lines (shifts times items) the engine counts', () => {
      ready({ budget: withIssues(issue('NoItem', 186), issue('CatalogueNotFound', 186), issue('CatalogueNotFound', 40, 'b2')) })

      expect(screen.getByText('226 shifts with a part not priced.')).toBeInTheDocument()
      expect(screen.queryByText(/372|219/)).not.toBeInTheDocument()
    })

    it('says Not fully priced on the one-line form, beside the figure a phone shows', () => {
      ready({ budget: withIssues(issue('CatalogueNotFound', 4)) })

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all')
      expect(line.parentElement).toHaveTextContent('Not fully priced')
      expect(line.parentElement).not.toHaveTextContent('Over budget')
    })

    it('counts a block that cannot be priced at all, and says the total is not complete', () => {
      ready({ budget: withIssues(issue('RegistrationGroupNotHeld', 1, 'b2')) })

      expect(screen.getByText('1 block cannot be priced.')).toBeInTheDocument()
      expect(screen.getByText('Not fully priced')).toBeInTheDocument()
    })

    it('says nothing of it when every shift is priced', () => {
      ready()

      expect(screen.queryByText('Not fully priced')).not.toBeInTheDocument()
      expect(screen.queryByText(/not priced/)).not.toBeInTheDocument()
    })
  })

  it('counts the funding sources a plan budget is the sum of', () => {
    ready({ planBudget: { total: 45000, count: 2 } })
    expect(screen.getByText('$14,389.72 left, across 2 funding sources.')).toBeInTheDocument()
  })

  it('has one line, and a Details toggle that opens the rest, for a phone', async () => {
    const user = userEvent.setup()
    ready()

    const details = screen.getByRole('button', { name: /Details/ })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('plan-budget-details')).toHaveClass('hidden', 'xl:grid')   // the one-line form is for everything below 1280px, a tablet included
    expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all')).toBeInTheDocument()

    await user.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('plan-budget-details')).not.toHaveClass('hidden')
  })

  it('says it is pricing, never a zero, while the first answer is on its way', () => {
    render(<BudgetBar status="loading" planBudget={null} />)

    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByText('Pricing the plan…')).toHaveLength(2)                 // the one line, and the details; aria-busy says it to a screen reader
    expect(screen.getByRole('status').textContent).toBe('')                            // nothing is announced by it: a status that is inserted holding its text is not reliably spoken
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('asks for a block while there is nothing to price', () => {
    render(<BudgetBar status="idle" planBudget={null} />)
    expect(screen.getByText('Add a block to see the weekly hours and cost, and what the agreement comes to.')).toBeInTheDocument()
  })

  // Design 5: the error and Try again are not inside the Details a phone keeps shut, where they were display:none and never announced.
  it('says why a plan could not be priced, announced, with a way to try again only when trying again can help', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(<BudgetBar status="error" error={{ response: { status: 429, data: {} } }} onRetry={onRetry} planBudget={null} />)

    expect(screen.getByRole('alert')).toHaveTextContent('The pricing service is busy.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<BudgetBar status="error" error={{ response: { status: 400, data: { errors: ['The agreement period ends before it starts.'] } } }} onRetry={onRetry} planBudget={null} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The agreement period ends before it starts.')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  // Design review 6: "Add to plan" does not save, the save row is a long scroll below the blocks, and the one-line bar a phone shows was silent about it.
  describe('a plan that is not saved', () => {
    it('says Not saved on the one-line form with a Save that saves, named by its own visible word so it is not the save row\'s Save draft', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      ready({ unsaved: { onSave, saving: false } })

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(within(line).getByText('Not saved')).toBeInTheDocument()
      await user.click(within(line).getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('holds Save back while it saves, and when the plan cannot be saved as it is', () => {
      const { rerender } = ready({ unsaved: { onSave: vi.fn(), saving: true } })
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()

      rerender(<BudgetBar status="ready" budget={budget()} planBudget={{ total: 40000, count: 1 }} unsaved={{ onSave: vi.fn(), saving: false }} blocked />)
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('says nothing of saving when there is nothing to save', () => {
      ready()
      expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  it('shows the error outside the collapsible details, and only once', () => {
    render(<BudgetBar status="error" error={{ response: { status: 429, data: {} } }} onRetry={vi.fn()} planBudget={null} />)

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert').closest('#plan-budget-details')).toBeNull()
    expect(document.getElementById('plan-budget-details')).toBeNull()
  })

  // Review F1: the framework's validation answer (errors as an object by field) threw inside render and emptied the page.
  it('reads the framework\'s validation answer without throwing, and says it in words', () => {
    const error = { response: { status: 400, data: { title: 'One or more validation errors occurred.', status: 400, errors: { 'blocks[0].block.sleepoverActiveHours': ['The JSON value could not be converted to System.Decimal. Path: $.blocks[0]...'] } } } }

    expect(() => render(<BudgetBar status="error" error={error} onRetry={vi.fn()} planBudget={null} />)).not.toThrow()

    expect(screen.getByRole('alert')).toHaveTextContent('A box in the plan is empty or is not a number.')
  })

  // Code review N6 and design D8: a plan that prices to nothing printed "0 h · $0.00 a week", "$0.00" and the whole plan budget as left, beside a chip that said it was not fully priced. An en dash is the figure
  // of something that is not known; the overview, Review and the PDF already say it so.
  describe('a plan that prices to nothing', () => {
    const issue: PlanIssue = { blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs registration group 0125.", count: 1 }
    const nothing = (): PlanBudget => {
      const base = budget()
      return { ...base, period: { ...base.period, issues: [issue], totals: { ...emptyTotals() } }, weekly: { ...base.weekly!, totals: emptyTotals() } }
    }

    it('shows an en dash for every headline, no $0.00, and no categories to list', () => {
      ready({ budget: nothing() })

      const bar = screen.getByRole('region', { name: 'Running budget' })
      expect(bar).not.toHaveTextContent('$0.00')
      expect(screen.getByText('An ordinary week').nextElementSibling).toHaveTextContent('– h · –')
      expect(screen.getByText('The agreement period').nextElementSibling).toHaveTextContent(/^–/)
      expect(screen.queryByRole('list', { name: 'By budget category' })).not.toBeInTheDocument()
    })

    it('says so in the one line a tablet reads', () => {
      ready({ budget: nothing() })

      expect(screen.getByText('– h · – a week · – in all')).toBeInTheDocument()
      expect(screen.getByText('– h · – a week · – in all').parentElement).toHaveTextContent('Not fully priced')
    })

    it('does not say any of the plan budget is left, or how much of it is used, and says there is nothing to compare', () => {
      ready({ budget: nothing(), planBudget: { total: 20000, count: 1 } })

      expect(screen.getByText('Plan budget').nextElementSibling).toHaveTextContent('$20,000.00')
      expect(screen.queryByText(/left/)).not.toBeInTheDocument()
      expect(screen.queryByText(/% used/)).not.toBeInTheDocument()
      expect(screen.getByText('Nothing is priced yet, so there is nothing to compare with it.')).toBeInTheDocument()
      expect(screen.queryByText('Over budget')).not.toBeInTheDocument()
    })

    it('is the same when every line is there and not one has a price, and when the agreement is shorter than a week', () => {
      const base = budget()
      ready({ budget: { period: { ...base.period, totals: { ...emptyTotals(), lineCount: 6, unpricedLines: 6 } }, weekly: null, week: null } })

      expect(screen.getByText('– in all')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Running budget' })).not.toHaveTextContent('$0.00')
      expect(screen.getByText('The agreement is shorter than a week.')).toBeInTheDocument()
    })

    it('still prints a priced plan as money, whatever it leaves out', () => {
      const base = budget()
      ready({ budget: { ...base, period: { ...base.period, totals: { ...base.period.totals, lineCount: 208, unpricedLines: 100 } } } })

      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all')).toBeInTheDocument()
    })
  })

  // Code review N1: with no dates (or a date that is no day, or an end before the start) the query is off, nothing is in flight, and the bar said "Pricing the plan…" and was busy for as long as it took the
  // person to find the date boxes.
  describe('a plan with no dates to price it over', () => {
    const note = 'Enter the agreement dates to price the plan'

    it('says what is missing, as idle: not "Pricing the plan…", not busy, and no figure', () => {
      render(<BudgetBar status="idle" idleNote={note} planBudget={{ total: 40000, count: 1 }} />)

      const bar = screen.getByRole('region', { name: 'Running budget' })
      expect(bar).toHaveAttribute('aria-busy', 'false')
      expect(screen.getAllByText(new RegExp(note))).toHaveLength(2) // the one line, and Details
      expect(within(bar).queryByText(/Pricing the plan/)).not.toBeInTheDocument()
      expect(bar).not.toHaveTextContent('$')
      expect(screen.queryByText('Add a block to see the budget')).not.toBeInTheDocument()
    })

    it('says an agreement that ends before it starts in its own words', () => {
      render(<BudgetBar status="idle" idleNote="The agreement ends before it starts, so the plan cannot be priced" planBudget={null} />)

      expect(screen.getByText('The agreement ends before it starts, so the plan cannot be priced')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'false')
    })
  })

  // Code review N5: the one line a tablet reads (everything below 1280px) held the previous plan's total with no cue that a newer one was on its way, and the left-out count was inside the Details.
  describe('the one line, while the figure is provisional', () => {
    it('says it is updating, and busy, while a newer answer is on its way, and not otherwise', () => {
      const { rerender } = ready({ refreshing: true })
      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(line).toHaveTextContent('· updating…')
      expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')

      rerender(<BudgetBar status="ready" budget={budget()} planBudget={{ total: 40000, count: 1 }} />)
      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement).not.toHaveTextContent('updating')
      expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'false')
    })

    it('says how many blocks it leaves out, in the one line', () => {
      ready({ incompleteBlocks: 2 })

      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement).toHaveTextContent('· 2 blocks left out')
    })

    it('is quiet when the figure is the answer', () => {
      ready()

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(line).not.toHaveTextContent(/updating|left out/)
    })
  })
})
