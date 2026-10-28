import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { budgetSeries } from '@/test/fixtures/budgetSeries'
import BudgetTrackCard from './BudgetTrackCard'

// The budget graph's card on the Funding tab: the states around the chart (loading, failed, a failed refresh, no pricing, none). The chart itself has its own tests.

const { useBudgetSeries } = vi.hoisted(() => ({ useBudgetSeries: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useBudgetSeries: (...args: unknown[]) => useBudgetSeries(...args) }))

const reply = (over: Record<string, unknown>) => ({ data: undefined, isLoading: false, isError: false, isFetching: false, errorUpdateCount: 0, refetch: vi.fn(), ...over })

beforeEach(() => { vi.clearAllMocks() })

describe('BudgetTrackCard', () => {
  it('loading shows the titled card with aria-busy and "Loading the budget chart…"', () => {
    useBudgetSeries.mockReturnValue(reply({ isLoading: true, isFetching: true }))
    render(<BudgetTrackCard participantId="p-1" />)
    expect(useBudgetSeries).toHaveBeenCalledWith('p-1')
    expect(screen.getByRole('heading', { name: 'How the budget is tracking' })).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toContainElement(document.querySelector('[data-chart-skeleton]') as HTMLElement)
    expect(screen.getByText('Loading the budget chart…')).toHaveClass('sr-only')
    expect(document.querySelector('[data-plot]')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('loading pulses as one block that holds the plot placeholder, which does not pulse on its own', () => {
    useBudgetSeries.mockReturnValue(reply({ isLoading: true, isFetching: true }))
    render(<BudgetTrackCard participantId="p-1" />)
    const blocks = document.querySelectorAll('[data-chart-skeleton]')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveClass('animate-pulse')
    expect(blocks[0].querySelector('[data-chart-plot-skeleton]')).not.toBeNull()
    expect(blocks[0].querySelector('[data-chart-plot-skeleton]')).not.toHaveClass('animate-pulse')
  })

  it('loading with two or more pools lays the switch out unseen, with the sentence and the footnote, and shows no control', () => {
    useBudgetSeries.mockReturnValue(reply({ isLoading: true, isFetching: true }))
    const { container } = render(<BudgetTrackCard participantId="p-1" poolCount={3} />)
    expect(container.querySelector('select, [role="radiogroup"]')?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(container.textContent).toContain('so it can differ from the total that was approved')
  })

  it('a failed load shows the warning and Try again; the retry hold says "Trying again…", then "Couldn\'t load it again."', async () => {
    let settle!: (result: unknown) => void
    const refetch = vi.fn(() => new Promise(resolve => { settle = resolve }))
    useBudgetSeries.mockReturnValue(reply({ isError: true, errorUpdateCount: 1, refetch }))
    render(<BudgetTrackCard participantId="p-1" />)
    expect(screen.getByRole('heading', { name: 'How the budget is tracking' })).toBeInTheDocument()
    expect(screen.getByText("The budget chart couldn't load. The figures below are not affected.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Trying again…')
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => { settle({ isError: true }) })
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't load it again.")
  })

  it('a failed refetch keeps the chart and adds "The chart couldn\'t be refreshed, so it may be out of date."', async () => {
    const refetch = vi.fn()
    useBudgetSeries.mockReturnValue(reply({ data: budgetSeries(), isError: true, errorUpdateCount: 1, refetch }))
    render(<BudgetTrackCard participantId="p-1" />)
    expect(document.querySelector('[data-plot]')).not.toBeNull()
    expect(screen.getByText("The chart couldn't be refreshed, so it may be out of date.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('NoPricing shows the one-line strip and no card', () => {
    useBudgetSeries.mockReturnValue(reply({ data: budgetSeries({ chart: 'NoPricing', scopes: [] }) }))
    render(<BudgetTrackCard participantId="p-1" />)
    expect(document.querySelector('[data-chart-state="no-pricing"]')).toHaveTextContent("The chart needs the price list for this plan's dates before it can be drawn.")
    expect(screen.queryByRole('heading')).toBeNull()
    expect(document.querySelector('[data-plot]')).toBeNull()
  })

  it('None renders nothing', () => {
    useBudgetSeries.mockReturnValue(reply({ data: budgetSeries({ chart: 'None', scopes: [] }) }))
    const { container } = render(<BudgetTrackCard participantId="p-1" />)
    expect(container).toBeEmptyDOMElement()
  })
})
