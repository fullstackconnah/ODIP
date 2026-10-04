import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BudgetAttentionBand } from './BudgetAttentionBand'
import { band } from './fixtures'
import { BUDGET_RISK_LABELS, noRiskLine, overNote } from './wording'

// The quiet budget band. The states it must keep apart: loading, failed, ready with counts, and ready at zero. Two of those are about what
// the band must NOT say: a figure-less band never says "nothing needs you", and a refresh never blanks a count it already knows.
//
// No snapshots: every assertion is a role, a name or a string a person would have to read.

const renderBand = (view: Parameters<typeof BudgetAttentionBand>[0]['view']) =>
  render(<MemoryRouter><BudgetAttentionBand view={view} /></MemoryRouter>)

const region = () => screen.getByRole('region', { name: 'Budgets needing attention' })

describe('BudgetAttentionBand: no data behind the sentence', () => {
  it('shows a dash and says it is loading, never a zero and never an all-clear', () => {
    renderBand(band({ loading: true }))

    expect(region()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading')).toBeInTheDocument()   // what a screen reader hears in place of the number
    expect(screen.getByText('Checking the participant budgets…')).toBeInTheDocument()
    expect(screen.queryByText(noRiskLine)).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText(/No participant budget needs attention/)).not.toBeInTheDocument()
  })

  it('says a failure is a failure and never dresses it as health', () => {
    renderBand(band({ failed: true, failureMessage: 'The budget service did not answer.' }))

    expect(screen.getByText("Couldn't load")).toBeInTheDocument()
    expect(screen.getByText('The budget service did not answer.')).toBeInTheDocument()
    expect(region()).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText(noRiskLine)).not.toBeInTheDocument()
    expect(screen.queryByText(/No participant budget needs attention/)).not.toBeInTheDocument()
  })

  it('has its own wording for a failure the caller did not explain', () => {
    renderBand(band({ failed: true }))

    expect(screen.getByText(/could not be read, so nothing is being claimed about them/)).toBeInTheDocument()
  })

  it('will not read a ready state with no counts as an all-clear: an absent answer is not a zero', () => {
    renderBand(band({ counts: undefined }))

    expect(screen.getByText(/have not arrived yet, so nothing is being claimed about them/)).toBeInTheDocument()
    expect(screen.queryByText(noRiskLine)).not.toBeInTheDocument()
  })
})

describe('BudgetAttentionBand: counts that are known', () => {
  it('names each risky state with its own count, and says the total as participants', () => {
    renderBand(band({ counts: { Over: 2, ForecastOver: 3, Approaching: 1 } }))

    expect(screen.getByText('Over: 2')).toBeInTheDocument()
    expect(screen.getByText('Forecast over: 3')).toBeInTheDocument()
    expect(screen.getByText('Approaching: 1')).toBeInTheDocument()
    expect(screen.getByText('6 participants')).toBeInTheDocument()
    expect(screen.getByText(`2 ${BUDGET_RISK_LABELS.Over}, 3 ${BUDGET_RISK_LABELS.ForecastOver} and 1 ${BUDGET_RISK_LABELS.Approaching}. A participant is counted once, in its worst state.`)).toBeInTheDocument()
  })

  it('agrees the noun with a single participant', () => {
    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 } }))

    expect(screen.getByText('1 participant')).toBeInTheDocument()
  })

  it('omits a state that is not at risk at all, so a zero never appears as a chip', () => {
    renderBand(band({ counts: { Over: 0, ForecastOver: 1, Approaching: 0 } }))

    expect(screen.queryByText(/^Over:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Approaching:/)).not.toBeInTheDocument()
    expect(screen.getByText('Forecast over: 1')).toBeInTheDocument()
  })

  it('puts the danger note under a band holding something over, and leaves it off otherwise', () => {
    const { unmount } = renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 } }))
    expect(screen.getByText(overNote)).toBeInTheDocument()
    unmount()

    renderBand(band({ counts: { Over: 0, ForecastOver: 4, Approaching: 0 } }))
    expect(screen.queryByText(overNote)).not.toBeInTheDocument()
  })

  it('tints danger when anything is over and warning otherwise, using the two tone fills', () => {
    const danger = renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 } }))
    expect(danger.container.firstElementChild!.className).toContain('var(--color-error-container)')
    danger.unmount()

    // Unmounted first: two bands share one region name, and a document-wide query would find both.
    const warning = renderBand(band({ counts: { Over: 0, ForecastOver: 1, Approaching: 0 } }))
    expect(warning.container.firstElementChild!.className).toContain('var(--color-warning-container)')
    expect(warning.container.firstElementChild!.className).not.toContain('var(--color-error-container)')
  })

  it('keeps the last known counts on screen while a refresh is on its way, and says so', () => {
    renderBand(band({ counts: { Over: 2, ForecastOver: 0, Approaching: 0 }, refreshing: true }))

    expect(screen.getByText('Over: 2')).toBeInTheDocument()
    expect(screen.getByText('2 participants')).toBeInTheDocument()
    expect(region()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText(/updating…/)).toBeInTheDocument()
  })

  // F-18. The band carries no icon and no chip, so these words are the only cue a reader has.
  it('names the base the counts are counted from, so a count is not read as a share of everyone', () => {
    renderBand(band({ counts: { Over: 2, ForecastOver: 3, Approaching: 1 }, denominator: 20 }))

    expect(screen.getByText(/of 20 participants with a recorded budget/)).toBeInTheDocument()
  })

  it('agrees the base’s noun with one participant', () => {
    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 }, denominator: 1 }))

    expect(screen.getByText(/of 1 participant with a recorded budget/)).toBeInTheDocument()
  })

  it('leaves the base off rather than inventing one when the server has not said', () => {
    renderBand(band({ counts: { Over: 2, ForecastOver: 0, Approaching: 0 } }))

    // A made-up base would be a worse lie than a missing one: the counts are still true, and the sentence still reads.
    expect(screen.queryByText(/with a recorded budget/)).not.toBeInTheDocument()
    expect(screen.getByText(/2 over budget\. A participant is counted once/)).toBeInTheDocument()
  })

  it('never puts a participant with no recorded budget in the base', () => {
    // The base the adapter supplies counts participants with a budget. A no-budget participant raises no risk (SHAPE-BRIEF §5), so
    // the band has no way to include one: there is no prop for it, and the sentence names the base it was given.
    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 }, denominator: 1 }))

    expect(screen.getByText(/of 1 participant with a recorded budget/)).toBeInTheDocument()
    expect(screen.queryByText(/no budget/i)).not.toBeInTheDocument()
  })
})

describe('BudgetAttentionBand: the all-clear', () => {
  it('says no budget needs attention only when every count is a real zero', () => {
    renderBand(band({ counts: { Over: 0, ForecastOver: 0, Approaching: 0 } }))

    expect(screen.getByText('No participant budget needs attention.')).toBeInTheDocument()
    expect(screen.getByText(noRiskLine)).toBeInTheDocument()
    expect(screen.queryByText(/participants$/)).not.toBeInTheDocument()
  })

  it('is not tinted: an all-clear is a sentence on the card, never a warning fill', () => {
    const node = renderBand(band({ counts: { Over: 0, ForecastOver: 0, Approaching: 0 } })).container.firstElementChild!
    expect(node.className).not.toContain('var(--color-warning-container)')
    expect(node.className).not.toContain('var(--color-error-container)')
  })
})

describe('BudgetAttentionBand: where it goes', () => {
  it('renders a link action to the exact route the caller named, and reaches it with the keyboard', async () => {
    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 }, action: { label: 'Open the budgets list', to: '/budgets' } }))
    const link = screen.getByRole('link', { name: 'Open the budgets list' })

    expect(link).toHaveAttribute('href', '/budgets')
    link.focus()
    expect(link).toHaveFocus()
    // Keyboard operability is the whole point of it being a link and not a div.
    await userEvent.keyboard('{Enter}')
    expect(link).toHaveAttribute('href', '/budgets')
  })

  it('calls a callback action once per activation and never navigates', async () => {
    const onSelect = vi.fn()
    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 }, action: { label: 'Show these budgets', onSelect } }))

    const button = screen.getByRole('button', { name: 'Show these budgets' })
    expect(button).not.toHaveAttribute('href')

    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('shows no action at all when the caller supplies none, and does not invent a destination', () => {
    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 } }))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses the caller’s own label, and defaults to "Budgets at risk"', () => {
    const { unmount } = renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 }, label: 'Budgets to watch' }))
    expect(within(region()).getByText('Budgets to watch')).toBeInTheDocument()
    unmount()

    renderBand(band({ counts: { Over: 1, ForecastOver: 0, Approaching: 0 }, label: undefined }))
    expect(within(region()).getByText('Budgets at risk')).toBeInTheDocument()
  })
})
