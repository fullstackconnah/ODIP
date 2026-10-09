import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BudgetRiskTable } from './BudgetRiskTable'
import { hiddenRow, noBudgetEntry, noBudgetRow, readyTable, riskRow } from './fixtures'
import type { BudgetRiskRow } from './viewModel'
import { NO_FIGURE, ROLLED_OVER_LEGEND, UNPRICED_LEGEND, configuredZero, noBudgetHiddenLabel, unavailableFigure } from './wording'

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
  // The page-level states are the app's own (PageState), as on every record page and the Funding tab: a left-aligned card of its own, and a message that said "claimed" for "billed", were not.
  it('says it is loading, as every page does, and says nothing about anyone’s figures', () => {
    renderTable({ status: 'loading' })

    expect(screen.getByRole('status')).toHaveTextContent('Loading budget list…')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('never renders a failure as an empty list: an empty list would read as "nobody is at risk"', () => {
    renderTable({ status: 'failed' })

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load this budget list. Check your connection and try again.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/No budgets are being tracked yet/)).not.toBeInTheDocument()
  })

  it('offers Try again when it can ask again, and not when it cannot', async () => {
    const onRetry = vi.fn()
    const { unmount } = renderTable({ status: 'failed', onRetry })

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    unmount()

    renderTable({ status: 'failed' })
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('says plainly that nothing is tracked yet and what to do, as a real answer to a real question', () => {
    renderTable({ status: 'empty' })

    expect(screen.getByText('No budgets are being tracked yet. Record a participant’s plan to start.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a ready state with no rows says the same thing as empty, rather than rendering a bare header', () => {
    renderTable(readyTable([]))

    expect(screen.getByText('No budgets are being tracked yet. Record a participant’s plan to start.')).toBeInTheDocument()
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

  // Risk reads first by sort order, so the tint must not rank it backwards: "Over" used to wear the error container at 30% (barely pink) and "Forecast over" the full warning container, so the milder row
  // was the louder one. Both take the same weak step as the Qualifications table's overdue and due-soon rows, and the pill (not the row) carries the status.
  it('tints a row that is over and a row forecast to go over at the same weak step, and leaves the rest on the card', () => {
    const { unmount } = renderTable(readyTable([riskRow({ status: 'Over', available: 1000, used: 1400, forecast: 1400, remaining: -400 })]))
    expect(rowFor('Amara Okonkwo-Bell').className).toContain('bg-[var(--color-error-container)]/10')
    unmount()

    const warning = renderTable(readyTable([riskRow({ status: 'ForecastOver' })]))
    expect(rowFor('Amara Okonkwo-Bell').className).toContain('bg-[var(--color-warning-container)]/10')
    warning.unmount()

    renderTable(readyTable([riskRow({ status: 'OnTrack' })]))
    expect(rowFor('Amara Okonkwo-Bell').className).not.toContain('error-container')
    expect(rowFor('Amara Okonkwo-Bell').className).not.toContain('warning-container')
  })

  it('keeps every pill in its own filled tone, tinted row or not: Over red, Forecast over and Approaching amber', () => {
    renderTable(readyTable([
      riskRow({ id: 'a', participantLabel: 'Over Person', status: 'Over' }),
      riskRow({ id: 'b', participantLabel: 'Forecast Person', status: 'ForecastOver' }),
      riskRow({ id: 'c', participantLabel: 'Approaching Person', status: 'Approaching' }),
      riskRow({ id: 'd', participantLabel: 'Fine Person', status: 'OnTrack' }),
    ]))

    expect(screen.getByText('Over').className).toContain('bg-[var(--color-error-container)]')
    expect(screen.getByText('Forecast over').className).toContain('bg-[var(--color-warning-container)]')
    expect(screen.getByText('Approaching').className).toContain('bg-[var(--color-warning-container)]')
    expect(screen.getByText('On track').className).toContain('bg-[var(--color-primary-fixed)]')
    for (const word of ['Over', 'Forecast over', 'Approaching', 'On track']) expect(screen.getByText(word).className, word).not.toContain('md:bg-[var(--color-card)]')
  })

  // The first question about an Over row is "by how much", and Available beside a larger Used reads like a mistake: the server sends what is left, or how far over, and the cell says it in the Funding
  // sentence's own words. Available also includes what rolled over from earlier periods, which the Funding tab labels "not confirmed": the list says so too.
  it('says how far over an over row is, and what is left on the others, under the status', () => {
    renderTable(readyTable([
      riskRow({ id: 'a', participantLabel: 'Over Person', status: 'Over', available: 1000, used: 1400, forecast: 1400, remaining: -400 }),
      riskRow({ id: 'b', participantLabel: 'Fine Person', status: 'OnTrack', remaining: 1359.5 }),
    ]))

    expect(cellOf('Over Person', 'Status')).toHaveTextContent('Over$400.00 over')
    expect(cellOf('Fine Person', 'Status')).toHaveTextContent('On track$1,359.50 left')
  })

  it('says exactly nothing left as a figure: $0.00 left, not over', () => {
    renderTable(readyTable([riskRow({ status: 'Approaching', available: 1000, used: 1000, remaining: 0 })]))

    expect(cellOf('Amara Okonkwo-Bell', 'Status')).toHaveTextContent('$0.00 left')
    expect(cellOf('Amara Okonkwo-Bell', 'Status')).not.toHaveTextContent('over')
  })

  it('says nothing under the status when the server could not say what is left', () => {
    renderTable(readyTable([noBudgetRow({ status: 'OnTrack' })]))

    expect(cellOf('Bilal Nasser', 'Status')).not.toHaveTextContent(/left|over\b/)
  })

  // Available includes money rolled over from earlier periods, which the Funding tab labels "not confirmed" (somebody else may have used it). The list says so with a mark beside the figure, named in
  // words for a screen reader and a pointer, and one line under the table says what the mark is. (It was a note of its own under every such figure, which made those rows two to three lines taller.)
  it('marks Available with what part of it was rolled over, named in words, and has no mark when none was', () => {
    renderTable(readyTable([
      riskRow({ id: 'a', participantLabel: 'Rolled Person', available: 3473.32, carried: 448.66, remaining: 1541.32 }),
      riskRow({ id: 'b', participantLabel: 'Plain Person', available: 2000, carried: 0 }),
    ]))

    const available = cellOf('Rolled Person', 'Available')
    expect(available).toHaveTextContent('$3,473.32')
    expect(available).not.toHaveTextContent('incl.')   // no note of its own under the figure
    const mark = within(available).getByRole('img', { name: 'Includes $448.66 rolled over, not confirmed' })
    expect(mark).toHaveAttribute('title', 'Includes $448.66 rolled over, not confirmed')
    expect(within(cellOf('Plain Person', 'Available')).queryByRole('img')).not.toBeInTheDocument()
  })

  it('says what the mark is once, under the table, when any row has it, and not otherwise', () => {
    const { unmount } = renderTable(readyTable([riskRow({ carried: 100 }), riskRow({ id: 'b', participantLabel: 'Bilal Nasser', carried: 5 })]))

    expect(screen.getAllByText(ROLLED_OVER_LEGEND)).toHaveLength(1)
    unmount()
    renderTable(readyTable([riskRow({ carried: 0 })]))
    expect(screen.queryByText(ROLLED_OVER_LEGEND)).not.toBeInTheDocument()
  })

  it('withholds what is left and what rolled over from a viewer who may not see money, like every other amount: no mark, no legend', () => {
    renderTable(readyTable([hiddenRow({ carried: 448.66, remaining: 1541.32 })]))

    expect(figuresIn(rowFor('Amara Okonkwo-Bell'))).toEqual([])
    expect(rowFor('Amara Okonkwo-Bell')).not.toHaveTextContent(/rolled over|left/)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(ROLLED_OVER_LEGEND)).not.toBeInTheDocument()
  })

  // ODIP's arithmetic can say On track while the NDIA has just refused a claim for want of funds, and the list is where the dashboard sends people: the row says the NDIA's word in a pill of its own.
  it('says the NDIA word in a danger pill beside the status, even when ODIP own status is On track', () => {
    renderTable(readyTable([
      riskRow({ id: 'a', participantLabel: 'Refused Person', status: 'OnTrack', ndiaWord: { date: '2026-10-08', code: 'V27' } }),
      riskRow({ id: 'b', participantLabel: 'Quiet Person', status: 'OnTrack' }),
    ]))

    const pill = within(cellOf('Refused Person', 'Status')).getByText('NDIA says the funds ran out')
    expect(pill.className).toContain('bg-[var(--color-error-container)]')
    expect(within(cellOf('Refused Person', 'Status')).getByText('On track')).toBeInTheDocument()
    expect(within(cellOf('Quiet Person', 'Status')).queryByText('NDIA says the funds ran out')).not.toBeInTheDocument()
  })

  it('names the NDIA claim date and code to a pointer and a screen reader, and carries no money', () => {
    renderTable(readyTable([riskRow({ ndiaWord: { date: '2026-10-08', code: 'V27' } })]))

    const pill = screen.getByText('NDIA says the funds ran out')
    expect(pill.closest('[title]')?.getAttribute('title')?.replace(/\s/g, ' ')).toBe('NDIA rejected a claim on 8 Oct 2026 (V27)')
    expect(figuresIn(pill.parentElement!)).toEqual([])
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
    renderTable(readyTable([riskRow({ available: 254_999.99, used: 249_001.5, forecast: 251_000, remaining: 5_998.49 })]))
    const row = rowFor('Amara Okonkwo-Bell')

    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Available'))).toEqual(['$254,999.99'])
    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Used'))).toEqual(['$249,001.50'])
    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Forecast'))).toEqual(['$251,000.00'])
    expect(figuresIn(cellOf('Amara Okonkwo-Bell', 'Status'))).toEqual(['$5,998.49'])   // what is left, under the status
    expect(figuresIn(row)).toHaveLength(5)   // available, used, booked ahead (the fixture's own), forecast and what is left
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

// A shift the shift claim cannot price (a sleepover, a passive night, a group shift) is $0 in every figure, so a forecast leaves it out. The row says so beside the forecast, and a line under the table
// says what the mark is, so the list does not read as the whole picture.
describe('BudgetRiskTable: a forecast that leaves shifts out', () => {
  it('marks the forecast with how many shifts it leaves out, named in words for a screen reader and for a pointer', () => {
    renderTable(readyTable([riskRow({ unpricedShifts: 1 }), riskRow({ id: 'b', participantLabel: 'Bilal Nasser', unpricedShifts: 3 })]))

    const one = within(cellOf('Amara Okonkwo-Bell', 'Forecast')).getByRole('img', { name: 'Leaves out 1 shift that is not priced yet' })
    expect(one).toHaveAttribute('title', 'Leaves out 1 shift that is not priced yet')
    expect(within(cellOf('Bilal Nasser', 'Forecast')).getByRole('img', { name: 'Leaves out 3 shifts that are not priced yet' })).toBeInTheDocument()
  })

  it('says what the mark is once, under the table, when any row has it', () => {
    renderTable(readyTable([riskRow({ unpricedShifts: 2 }), riskRow({ id: 'b', participantLabel: 'Bilal Nasser', unpricedShifts: 1 })]))

    expect(screen.getAllByText(UNPRICED_LEGEND)).toHaveLength(1)
  })

  it('says nothing, and has no mark, when every shift priced', () => {
    renderTable(readyTable([riskRow(), riskRow({ id: 'b', participantLabel: 'Bilal Nasser' })]))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(UNPRICED_LEGEND)).not.toBeInTheDocument()
  })

  it('says nothing to a viewer who is not shown the figures: there is no forecast to leave anything out of', () => {
    renderTable(readyTable([hiddenRow({ unpricedShifts: 2 })]))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(UNPRICED_LEGEND)).not.toBeInTheDocument()
  })
})

describe('BudgetRiskTable: the no-budget tail', () => {
  const entries = () => [
    noBudgetEntry({ id: 'p3', participantLabel: 'Chen Wei' }),
    noBudgetEntry({ id: 'p4', participantLabel: 'Dara Okafor', reason: 'Plan ended 30 Jun 2026', action: { label: 'Open funding tab', to: '/participants/p4?tab=funding' } }),
  ]

  // The old line beside the toggle ("... is never warned about: there is no limit to be near") said the opposite of the truth: every plan has a limit, ODIP just does not hold it, and it read as
  // reassurance. It now sits inside the opened list, where the people it is about are, and says what ODIP cannot do.
  it('keeps them behind a count that says what it is, closed, and says inside the list that ODIP cannot warn about a budget it does not hold', () => {
    renderTable(readyTable([riskRow()], { noBudget: entries() }))

    const toggle = screen.getByRole('button', { name: noBudgetHiddenLabel(2) })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(list).not.toBeVisible()
    expect(within(list).getByText('ODIP cannot warn about a budget it does not hold. Record the plan to start tracking.')).toBeInTheDocument()
    expect(screen.queryByText(/never warned about|no limit to be near/)).not.toBeInTheDocument()
  })

  it('is open from the start when it is told to be, as it is on a page where nobody has a budget yet', () => {
    renderTable(readyTable([], { noBudget: entries() }))

    const toggle = screen.getByRole('button', { name: noBudgetHiddenLabel(2) })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(document.getElementById(toggle.getAttribute('aria-controls')!)!).getByText('Chen Wei')).toBeVisible()
    expect(screen.getByText('No budgets are being tracked yet. Record a participant’s plan to start.')).toBeInTheDocument()
  })

  it('stays closed when there are rows to look at first', () => {
    renderTable(readyTable([riskRow()], { noBudget: entries() }))

    expect(screen.getByRole('button', { name: noBudgetHiddenLabel(2) })).toHaveAttribute('aria-expanded', 'false')
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

  // The server lists a pool the NDIA has refused for want of funds straight after Over (its word outranks ODIP's forecast: BudgetListService.Rank). The header's sort says the same, or one click on it
  // drops that pool into the On track group, where ODIP's own status alone would put it, and away from where the list had it.
  const refused = { date: '2026-10-08', code: 'V27' }

  it('puts a pool the NDIA has refused straight after Over, as the list does, and not among On track', async () => {
    const fay = riskRow({ id: 'f', participantLabel: 'Fay', status: 'OnTrack', ndiaWord: refused })
    renderTable(readyTable([...oneEach(), fay]))

    await userEvent.click(statusHeader())

    expect(labelsNow()).toEqual(['Ada', 'Fay', 'Bea', 'Cleo', 'Dev', 'Eli'])
  })

  it('ranks Over before the NDIA’s word when a pool has both, and the NDIA’s word before Forecast over, ties by name', async () => {
    const fay = riskRow({ id: 'f', participantLabel: 'Fay', status: 'OnTrack', ndiaWord: refused })
    const gus = riskRow({ id: 'g', participantLabel: 'Gus', status: 'Over', ndiaWord: refused })
    const hal = riskRow({ id: 'h', participantLabel: 'Hal', status: 'ForecastOver', ndiaWord: refused })
    renderTable(readyTable([...oneEach(), hal, gus, fay]))

    await userEvent.click(statusHeader())

    expect(labelsNow()).toEqual(['Ada', 'Gus', 'Fay', 'Hal', 'Bea', 'Cleo', 'Dev', 'Eli'])
  })

  it('runs the same order in reverse, the NDIA’s word included', async () => {
    const fay = riskRow({ id: 'f', participantLabel: 'Fay', status: 'OnTrack', ndiaWord: refused })
    renderTable(readyTable([...oneEach(), fay]))

    await userEvent.click(statusHeader())
    await userEvent.click(statusHeader())

    expect(labelsNow()).toEqual(['Eli', 'Dev', 'Cleo', 'Bea', 'Fay', 'Ada'])
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
