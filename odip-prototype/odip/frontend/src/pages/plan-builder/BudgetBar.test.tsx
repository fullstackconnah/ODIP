import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanBudget } from '@/api/hooks'
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
    expect(warning).toHaveAttribute('role', 'status')       // polite: it is a warning, never an interruption or a block
    expect(screen.getByText('122% used')).toBeInTheDocument()
    expect(screen.getByText('Over budget')).toBeInTheDocument()   // and on the one-line form a phone shows
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
    ready({ budget: { ...noWeek, weekly: null, week: null, period: { ...noWeek.period, totals: { ...noWeek.period.totals, reviewLines: 2, provisionalLines: 3 } } }, incompleteBlocks: 1, refreshing: true })

    expect(screen.getByText('The agreement is shorter than a week.')).toBeInTheDocument()
    expect(screen.getByText('2 lines to review, 3 provisional.')).toBeInTheDocument()
    expect(screen.getByText('1 block left out of these figures until it is complete.')).toBeInTheDocument()
    expect(screen.getByText(/updating…/)).toBeInTheDocument()
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
    expect(document.getElementById('plan-budget-details')).toHaveClass('hidden', 'md:grid')
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
