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
    // Design 2: the cell takes the warning tint, and the sentence is text, not a pill. Design 8: nothing here is a live region, so nothing speaks on every recalculation.
    expect(screen.getByText('Plan budget').parentElement).toHaveClass('bg-[var(--color-warning-container)]')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    expect(screen.getByText(/updating…/)).toBeInTheDocument()
    expect(screen.queryByText('Not fully priced')).not.toBeInTheDocument()   // a decision still to make is not work left out
  })

  // Design 1: the total is what a coordinator quotes to a family, so a total that leaves work out says so beside the figure, in shifts, and on the one-line form a phone shows.
  describe('a total that leaves work out', () => {
    const issue = (reason: PlanIssue['reason'], count: number, blockId = 'b1'): PlanIssue => ({ blockId, reason, message: `${reason} ${blockId}`, count, firstDate: '2026-10-13' })
    const withIssues = (...issues: PlanIssue[]): PlanBudget => {
      const base = budget()
      return { ...base, period: { ...base.period, issues, totals: { ...base.period.totals, unpricedLines: 372, reviewLines: 219, provisionalLines: 0 } } }
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
    expect(screen.getByRole('status')).toHaveTextContent('Pricing the plan…')
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
      ready({ unsaved: { onSave, saving: false, blocked: false } })

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(within(line).getByText('Not saved')).toBeInTheDocument()
      await user.click(within(line).getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('holds Save back while it saves, and when the plan cannot be saved as it is', () => {
      const { rerender } = ready({ unsaved: { onSave: vi.fn(), saving: true, blocked: false } })
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()

      rerender(<BudgetBar status="ready" budget={budget()} planBudget={{ total: 40000, count: 1 }} unsaved={{ onSave: vi.fn(), saving: false, blocked: true }} />)
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

  it('shows a plan that prices to nothing as exactly that, with no categories to list', () => {
    ready({ budget: { period: { ...budget().period, totals: emptyTotals() }, weekly: null, week: null } })
    expect(screen.getAllByText(/\$0\.00/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('list', { name: 'By budget category' })).not.toBeInTheDocument()
  })
})
