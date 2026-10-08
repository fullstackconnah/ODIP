import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BudgetRiskTable } from './BudgetRiskTable'
import { hiddenRow, noBudgetEntry, noBudgetRow, readyTable, riskRow } from './fixtures'
import type { BudgetRiskRow } from './viewModel'
import { NO_FIGURE, configuredZero, noBudgetHiddenLabel, unavailableFigure } from './wording'

// The Budgets list body. What these tests hold:
//   - the six states that must never be confused: loading, failed, empty, a row with no budget recorded, a pool configured at zero, and a
//     figure the server could not give;
//   - the privacy contract: a row the viewer may not see the money of must not leak a figure into the cell, a title, an aria or an attribute;
//   - long, awkward real content: a very long name, a long money figure, a period across two years, all still readable and never truncated
//     into ambiguity;
//   - the row's own keyboard-operable action, and where it goes.
//
// The DOM-privacy assertion is the important one: it reads the whole rendered row, attributes included, and fails if any dollar figure is
// anywhere in it.

const renderTable = (state: Parameters<typeof BudgetRiskTable>[0]['state'], caption?: string) =>
  render(<MemoryRouter><BudgetRiskTable state={state} caption={caption} /></MemoryRouter>)

const rowFor = (label: string) => screen.getByText(label).closest('tr')!
/** A row's cell for a named column, found by its `data-label` (what DataTable puts there for the phone card layout) rather than by an index. */
const cellOf = (participant: string, column: string) => {
  const cells = within(rowFor(participant)).getAllByRole('cell')
  const cell = cells.find(c => c.getAttribute('data-label') === column)
  if (!cell) throw new Error(`no ${column} cell; the row has ${cells.map(c => c.getAttribute('data-label')).join(', ')}`)
  return cell
}
/** Every dollar figure anywhere in a row, including any attribute, title or aria text. */
const figuresIn = (element: HTMLElement) => (element.outerHTML.match(/\$[\d,]+(?:\.\d{2})?/g) ?? [])

/**
 * Tab forward until `element` has focus, and say so. These tests are about REACHABILITY, not about an element being first in the tab
 * order: the Status header is itself focusable (it is the sort control), so "one Tab from the top" is not a stable thing to assert.
 */
async function tabTo(element: HTMLElement, limit = 30) {
  for (let i = 0; i < limit; i += 1) {
    if (document.activeElement === element) return
    await userEvent.tab()
  }
  throw new Error(`${element.tagName} "${element.textContent ?? ''}" was not reachable by Tab in ${limit} stops`)
}

describe('BudgetRiskTable: the states that are not rows', () => {
  it('says it is loading, and says nothing about anyone’s figures', () => {
    renderTable({ status: 'loading' })

    expect(screen.getByRole('status')).toHaveTextContent('Loading the participant budgets')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('never renders a failure as an empty list: an empty list would read as "nobody is at risk"', () => {
    renderTable({ status: 'failed' })

    expect(screen.getByRole('alert')).toHaveTextContent('The participant budgets could not be read, so nothing is being claimed about them.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('No participant budgets are being tracked yet.')).not.toBeInTheDocument()
  })

  it('shows the caller’s own failure sentence when it has one', () => {
    renderTable({ status: 'failed', message: 'The budget service is unavailable (503).' })

    expect(screen.getByRole('alert')).toHaveTextContent('The budget service is unavailable (503).')
  })

  it('says plainly that nothing is tracked yet, as a real answer to a real question', () => {
    renderTable({ status: 'empty' })

    expect(screen.getByText('No participant budgets are being tracked yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a ready state with no rows says the same thing as empty, rather than rendering a bare header', () => {
    renderTable(readyTable([]))

    expect(screen.getByText('No participant budgets are being tracked yet.')).toBeInTheDocument()
  })
})

describe('BudgetRiskTable: a real row', () => {
  const row = riskRow({ action: { label: 'Open funding', to: '/participants/participant-1?tab=funding' } })

  it('shows who it is about, which pool, which period, the status and the figures', () => {
    renderTable(readyTable([row]))

    expect(screen.getByText('Amara Okonkwo-Bell')).toBeInTheDocument()
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(screen.getByText('1 Jul – 30 Sep 2026')).toBeInTheDocument()
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.getByText('$2,000.00')).toBeInTheDocument()   // available
    expect(screen.getByText('$640.50')).toBeInTheDocument()     // used
    expect(screen.getByText('$730.75')).toBeInTheDocument()     // forecast
  })

  it('renders every column header once, so the card layout at 390 labels every value', () => {
    renderTable(readyTable([row]))

    for (const header of ['Participant', 'Pool', 'Period', 'Status', 'Available', 'Used', 'Booked ahead', 'Forecast']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
  })

  it('keeps each figure in its own cell, and never adds two of them together', () => {
    renderTable(readyTable([row]))
    const cells = within(rowFor('Amara Okonkwo-Bell')).getAllByRole('cell')
    const labels = cells.map(c => c.getAttribute('data-label') || (c.textContent ?? '').slice(0, 20))

    // The figure columns are found BY THEIR HEADER LABEL, not by a hard-coded index: an index would silently test the wrong cell the
    // moment a column is added, which is exactly the bug this file exists to catch.
    const cellFor = (header: string) => cells[cells.findIndex(c => c.getAttribute('data-label') === header)]
    expect(labels[3]).toBe('Status')
    expect(figuresIn(cellFor('Available'))).toEqual(['$2,000.00'])
    expect(figuresIn(cellFor('Used'))).toEqual(['$640.50'])
    expect(figuresIn(cellFor('Forecast'))).toEqual(['$730.75'])
  })

  it('draws a dash in a column the server left out entirely (no booked-ahead figure at all)', () => {
    const withoutAhead = riskRow({ bookedAhead: undefined })
    renderTable(readyTable([withoutAhead]))

    const ahead = cellOf('Amara Okonkwo-Bell', 'Booked ahead')
    expect(ahead).toHaveTextContent(NO_FIGURE)
    expect(figuresIn(ahead)).toEqual([])   // a dash, never a $0.00 invented for a field that is absent
  })

  it('tints a row that is over, and a row forecast to go over, and leaves the rest on the card', () => {
    const { unmount } = renderTable(readyTable([riskRow({ status: 'Over', available: 1000, used: 1400, forecast: 1400 })]))
    expect(rowFor('Amara Okonkwo-Bell').className).toContain('var(--color-error-container)')
    unmount()

    const warning = renderTable(readyTable([riskRow({ status: 'ForecastOver' })]))
    expect(rowFor('Amara Okonkwo-Bell').className).toContain('var(--color-warning-container)')
    warning.unmount()

    renderTable(readyTable([riskRow({ status: 'OnTrack' })]))
    expect(rowFor('Amara Okonkwo-Bell').className).not.toContain('error-container')
    expect(rowFor('Amara Okonkwo-Bell').className).not.toContain('warning-container')
  })

  it('puts the pill of a tinted row on the card fill from md up, so it does not vanish into its own tint, and keeps the pill of an untinted row in its tone', () => {
    renderTable(readyTable([
      riskRow({ id: 'a', participantLabel: 'Over Person', status: 'Over' }),
      riskRow({ id: 'b', participantLabel: 'Forecast Person', status: 'ForecastOver' }),
      riskRow({ id: 'c', participantLabel: 'Approaching Person', status: 'Approaching' }),
    ]))

    // Below md a row is an untinted card, so the pill keeps its own tone there; from md the row is tinted in that tone and the pill is lifted onto the card fill.
    expect(screen.getByText('Over').className).toContain('bg-[var(--color-error-container)]')
    expect(screen.getByText('Over').className).toContain('md:bg-[var(--color-card)]')
    expect(screen.getByText('Forecast over').className).toContain('bg-[var(--color-warning-container)]')
    expect(screen.getByText('Forecast over').className).toContain('md:bg-[var(--color-card)]')
    expect(screen.getByText('Approaching').className).toContain('bg-[var(--color-warning-container)]')
    expect(screen.getByText('Approaching').className).not.toContain('md:bg-[var(--color-card)]')
  })

  it('leaves the row order exactly as the server sent it, and never re-ranks it by risk itself', () => {
    // Deliberately worst-last. If the component sorted, this would come out in a different order.
    const rows = [riskRow({ id: 'a', participantLabel: 'Zoe Wellard', status: 'OnTrack' }), riskRow({ id: 'b', participantLabel: 'Adam Bright', status: 'Over' })]
    renderTable(readyTable(rows))

    const order = screen.getAllByRole('row').slice(1).map(tr => within(tr).getAllByRole('cell')[0].textContent)
    expect(order).toEqual(['Zoe Wellard', 'Adam Bright'])
  })
})

describe('BudgetRiskTable: zero, missing, and unknown are three different things', () => {
  it('a configured zero is a real figure and says so out loud, so nobody reads it as missing', () => {
    renderTable(readyTable([riskRow({ available: 0, used: 0, bookedAhead: 0, forecast: 0 })]))

    const available = cellOf('Amara Okonkwo-Bell', 'Available')
    expect(available).toHaveTextContent('$0.00')
    expect(available).not.toHaveTextContent(NO_FIGURE)
    expect(available).toHaveTextContent(configuredZero)   // the screen-reader note is real text in the DOM
  })

  it('a null figure is a dash with the server’s own reason beside it, never $0.00', () => {
    renderTable(readyTable([riskRow({ forecast: null, unavailableReason: 'The forecast engine could not price the booked shifts.' })]))

    const forecast = cellOf('Amara Okonkwo-Bell', 'Forecast')
    expect(forecast).toHaveTextContent(NO_FIGURE)
    expect(forecast).not.toHaveTextContent('$0.00')
    expect(forecast).toHaveTextContent('The forecast engine could not price the booked shifts.')
  })

  it('says "Not available" for a screen reader where the visible dash is', () => {
    renderTable(readyTable([riskRow({ forecast: null })]))

    const forecast = cellOf('Amara Okonkwo-Bell', 'Forecast')
    expect(within(forecast).getAllByText(/Not available\./).length).toBeGreaterThan(0)
    expect(forecast).toHaveTextContent('Not available.')
  })

  it('falls back to its own wording when the server gave no reason, and still never says zero', () => {
    renderTable(readyTable([riskRow({ forecast: null, unavailableReason: undefined })]))

    const forecast = cellOf('Amara Okonkwo-Bell', 'Forecast')
    expect(forecast).toHaveTextContent(unavailableFigure())
    expect(figuresIn(forecast)).toEqual([])
  })

  it('a participant with no budget recorded is a state of its own, not a row of zeroes', () => {
    renderTable(readyTable([noBudgetRow()]))

    const row = rowFor('Bilal Nasser')
    expect(within(row).getByText('No budget recorded')).toBeInTheDocument()
    expect(row).toHaveTextContent('No budget is recorded for this participant yet.')
    expect(figuresIn(row)).toEqual([])   // not one $0.00 anywhere: a missing budget is not a zero budget
  })
})

describe('BudgetRiskTable: the privacy contract', () => {
  it('withholds every amount for a viewer who may not see them, in the cell, the title, the aria and every attribute', () => {
    const secret = hiddenRow({ available: 987_654.32, used: 12_345.67, bookedAhead: 5000, forecast: 1_234_567.89 })
    const { container } = renderTable(readyTable([secret]))

    const row = rowFor('Amara Okonkwo-Bell')
    expect(figuresIn(row)).toEqual([])   // the strongest form of the check: no dollar figure anywhere in the row's markup
    expect(figuresIn(container)).toEqual([])
    expect(container.innerHTML).not.toContain('987654')
    expect(container.innerHTML).not.toContain('1234567')
    expect(row.innerHTML).not.toMatch(/\d{3,}\.\d{2}/)   // nor any other unpunctuated trace of the numbers
  })

  it('still shows the labels, the status and the period, so the row is not useless', () => {
    renderTable(readyTable([hiddenRow({ status: 'Over' })]))

    const row = rowFor('Amara Okonkwo-Bell')
    expect(within(row).getByText('Core')).toBeInTheDocument()
    expect(within(row).getByText('1 Jul – 30 Sep 2026')).toBeInTheDocument()
    expect(within(row).getByText('Over')).toBeInTheDocument()
  })

  it('says Not shown, with the contract’s own reason, and never a dash that could be read as zero', () => {
    const reason = 'This role may see that a participant is near a budget, but not the figures behind it.'
    renderTable(readyTable([hiddenRow()]))

    const row = rowFor('Amara Okonkwo-Bell')
    expect(within(row).getAllByText('Not shown').length).toBeGreaterThanOrEqual(3)
    expect(row).toHaveTextContent(reason)
    expect(figuresIn(row)).toEqual([])
  })

  it('a visible row and a hidden row can sit in the same table without either leaking', () => {
    const { container } = renderTable(readyTable([riskRow({ id: 'v', participantLabel: 'Visible Pat' }), hiddenRow({ id: 'h', participantLabel: 'Hidden Pat' })]))

    expect(figuresIn(rowFor('Visible Pat')).length).toBeGreaterThan(0)
    expect(figuresIn(rowFor('Hidden Pat'))).toEqual([])
    expect(figuresIn(container).some(f => f === '$2,000.00')).toBe(true)
  })
})

describe('BudgetRiskTable: long and awkward content', () => {
  const long = 'Maximiliana Featherstonehaugh-Woollacombe-Delacroix III of Van Diemen’s Landing'

  it('keeps a very long participant name whole, and offers it as a title rather than a mystery', () => {
    renderTable(readyTable([riskRow({ participantLabel: long })]))

    const cell = screen.getByText(long).closest('td')!
    expect(cell).toHaveTextContent(long)
    expect(cell).toHaveAttribute('data-label', 'Participant')
    expect(within(cell).getByText(long)).toHaveAttribute('title', long)
  })

  it('prints a very large money figure in full, with its cents, not an ellipsis of it', () => {
    renderTable(readyTable([riskRow({ available: 254_999.99, used: 249_001.5, forecast: 251_000 })]))
    const row = rowFor('Amara Okonkwo-Bell')

    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Available'))).toEqual(['$254,999.99'])
    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Used'))).toEqual(['$249,001.50'])
    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Forecast'))).toEqual(['$251,000.00'])
    expect(figuresIn(row)).toHaveLength(4)   // available, used, booked ahead (the fixture's own) and forecast
  })

  it('keeps both ends and the year of a period that crosses two years', () => {
    renderTable(readyTable([riskRow({ periodStart: '2026-07-01', periodEnd: '2027-06-30' })]))

    expect(screen.getByText('1 Jul 2026 – 30 Jun 2027')).toBeInTheDocument()
  })

  it('names every value in the phone card layout, so nothing is lost below md', () => {
    renderTable(readyTable([riskRow()]))
    for (const label of ['Participant', 'Pool', 'Period', 'Status', 'Available', 'Used', 'Booked ahead', 'Forecast']) {
      expect(rowFor('Amara Okonkwo-Bell').querySelector(`[data-label="${label}"]`)).not.toBeNull()
    }
  })
})

describe('BudgetRiskTable: the next action', () => {
  it('links the row to the exact destination the caller named, and its accessible name says whose it is', async () => {
    renderTable(readyTable([riskRow({ action: { label: 'Open funding', to: '/participants/participant-1?tab=funding' } })]))

    const link = screen.getByRole('link', { name: 'Open funding for Amara Okonkwo-Bell' })
    expect(link).toHaveAttribute('href', '/participants/participant-1?tab=funding')
    await tabTo(link)
    expect(link).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(link).toHaveAttribute('href', '/participants/participant-1?tab=funding')
  })

  it('calls a callback with the row it belongs to, and names the button for its own participant', async () => {
    const onSelect = vi.fn()
    renderTable(readyTable([
      riskRow({ id: 'a', participantLabel: 'First Person', action: { label: 'Review', onSelect } }),
      riskRow({ id: 'b', participantLabel: 'Second Person', action: { label: 'Review', onSelect } }),
    ]))

    const buttons = screen.getAllByRole('button', { name: /^Review / })
    expect(buttons.map(b => b.textContent)).toEqual(['First Person', 'Second Person'])   // the visible name is the participant's, inside the accessible name "Review for {name}"

    await userEvent.click(screen.getByRole('button', { name: 'Review for First Person' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('makes the participant\'s own name the link, with no column of buttons to take room from the figures', () => {
    renderTable(readyTable([riskRow({ action: { label: 'Open funding', to: '/participants/participant-1?tab=funding' } })]))

    const link = screen.getByRole('link', { name: 'Open funding for Amara Okonkwo-Bell' })
    expect(link).toHaveTextContent('Amara Okonkwo-Bell')                      // the visible text is inside the accessible name (WCAG 2.5.3)
    expect(link).toHaveAttribute('title', 'Open funding for Amara Okonkwo-Bell')
    expect(link.closest('td')).toBe(within(rowFor('Amara Okonkwo-Bell')).getAllByRole('cell')[0])   // in the first, pinned cell
    expect(within(rowFor('Amara Okonkwo-Bell')).getAllByRole('cell')).toHaveLength(8)             // participant, pool, period, status and the four figures
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('leaves a row with no action on without one, rather than a dead control', () => {
    renderTable(readyTable([riskRow()]))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('BudgetRiskTable: the no-budget tail', () => {
  const entries = () => [
    noBudgetEntry({ id: 'p3', participantLabel: 'Chen Wei' }),
    noBudgetEntry({ id: 'p4', participantLabel: 'Dara Okafor', reason: 'Plan ended 30 Jun 2026', action: { label: 'Open funding tab', to: '/participants/p4?tab=funding' } }),
  ]

  it('keeps them behind a count that says what it is, closed, and says why they are not warned about', () => {
    renderTable(readyTable([riskRow()], { noBudget: entries() }))

    const toggle = screen.getByRole('button', { name: noBudgetHiddenLabel(2) })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/A participant with no budget recorded is never warned about: there is no limit to be near\./)).toBeInTheDocument()
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeVisible()
  })

  it('opens on a click or from the keyboard, lists each participant with the reason and the way to record a budget, and closes again', async () => {
    renderTable(readyTable([riskRow()], { noBudget: entries() }))
    const toggle = screen.getByRole('button', { name: noBudgetHiddenLabel(2) })
    const controlled = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(controlled).not.toBeNull()

    await tabTo(toggle)
    expect(toggle).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(controlled).toBeVisible()
    expect(within(controlled!).getByText('Chen Wei')).toBeVisible()
    expect(within(controlled!).getByText('Plan ended 30 Jun 2026')).toBeVisible()
    expect(within(controlled!).getByRole('link', { name: 'Open funding tab for Dara Okafor' })).toHaveAttribute('href', '/participants/p4?tab=funding')
    expect(figuresIn(controlled!)).toEqual([])   // not one dollar figure: there is no budget to state

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(controlled).not.toBeVisible()
  })

  it('has no tail at all when there is nothing to keep behind it', () => {
    renderTable(readyTable([riskRow()]))

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/no budget recorded/i)).not.toBeInTheDocument()
  })
})

describe('BudgetRiskTable: a caption', () => {
  it('shows the caller’s caption, which is where the “one participant, counted once” rule lives', () => {
    renderTable(readyTable([riskRow()]), 'Sorted by risk. A participant appears once, in its worst state.')

    expect(screen.getByText('Sorted by risk. A participant appears once, in its worst state.')).toBeInTheDocument()
  })
})

// F-15, mandatory. `DataTable.defaultComparator` falls through to `String(a).localeCompare(b)`, so a Status column with no
// `sortFn` sorts the risk words ALPHABETICALLY — Approaching, Forecast over, On track, Over — the exact reverse of the required
// order. A coordinator scrolling by risk would see the safe rows first and the over-budget rows last. This drives the real table
// through a real click on the Status header, so it fails if the `sortFn` is ever dropped.
describe('BudgetRiskTable: sorting by risk', () => {
  const oneEach = () => {
    const over = riskRow({ id: 'a', participantLabel: 'Ada', status: 'Over' })
    const forecast = riskRow({ id: 'b', participantLabel: 'Bea', status: 'ForecastOver' })
    const approaching = riskRow({ id: 'c', participantLabel: 'Cleo', status: 'Approaching' })
    const onTrack = riskRow({ id: 'd', participantLabel: 'Dev', status: 'OnTrack' })
    const none = riskRow({ id: 'e', participantLabel: 'Eli', status: 'NoBudget' })
    return [onTrack, approaching, none, over, forecast]
  }

  const labelsNow = () =>
    screen.getAllByRole('row').slice(1).map(tr => (tr as HTMLTableRowElement).cells[0].textContent ?? '')

  /** The Status header IS the sort control (`DataTable` puts the handler on the `th` itself), so it is clicked, not a button inside it. */
  const statusHeader = () => screen.getByRole('columnheader', { name: 'Status' })

  it('puts Over first and no budget recorded last, not in alphabetical order', async () => {
    renderTable(readyTable(oneEach()))

    await userEvent.click(statusHeader())

    expect(labelsNow()).toEqual(['Ada', 'Bea', 'Cleo', 'Dev', 'Eli'])
  })

  it('tells a screen reader which way the sort is running, so the order it reads is the order it is in', async () => {
    renderTable(readyTable(oneEach()))
    expect(statusHeader()).toHaveAttribute('aria-sort', 'none')

    await userEvent.click(statusHeader())

    expect(statusHeader()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('is the same order in reverse, because the risk rank does not change direction', async () => {
    renderTable(readyTable(oneEach()))

    await userEvent.click(statusHeader())
    await userEvent.click(statusHeader())

    expect(labelsNow()).toEqual(['Eli', 'Dev', 'Cleo', 'Bea', 'Ada'])
  })

  it('breaks a tie on the participant’s name, so a re-sort is stable', async () => {
    const zoe = riskRow({ id: 'z', participantLabel: 'Zoe', status: 'Over' })
    const amy = riskRow({ id: 'a2', participantLabel: 'Amy', status: 'Over' })
    renderTable(readyTable([zoe, amy]))

    await userEvent.click(statusHeader())

    expect(labelsNow()).toEqual(['Amy', 'Zoe'])
  })

  it('is reachable and operable from the keyboard alone', async () => {
    renderTable(readyTable(oneEach()))

    statusHeader().focus()
    await userEvent.keyboard('{Enter}')

    expect(labelsNow()).toEqual(['Ada', 'Bea', 'Cleo', 'Dev', 'Eli'])
  })
})

// The type the view-model forces: a row that is ready to render must say what may be seen in it. This is a compile-time contract, pinned
// here as a runtime shape check so a change that makes `figures` optional fails here too.
describe('BudgetRiskTable: the shape the view-model demands', () => {
  it('has no `undefined` anywhere in a row, only a figure or an explicit null', () => {
    const row: BudgetRiskRow = riskRow()
    const walked = JSON.stringify(row, (_k, v) => (v === undefined ? 'UNDEFINED_LEAKED' : v))
    expect(walked).not.toContain('UNDEFINED_LEAKED')
  })
})
