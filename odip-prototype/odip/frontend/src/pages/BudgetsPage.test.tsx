import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { budgetList, budgetRow, noBudget } from '@/test/fixtures/budgets'
import BudgetsPage from './BudgetsPage'

// The Budgets list page (budget phase 2b): every participant's pools for the funding period running now, riskiest first. The server sends the figures and the order; the page filters by status
// and by name, keeps the participants with no budget in force behind a count, and says loading, failed and empty as three different facts. The API layer is mocked at the hook.

const { mockUseBudgetList } = vi.hoisted(() => ({ mockUseBudgetList: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useBudgetList: mockUseBudgetList }))

const ready = (data = budgetList()) => ({ data, isLoading: false, isPending: false, isError: false, fetchStatus: 'idle' })

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}{location.search}</output>
}

function renderPage(entry = '/budgets') {
  return render(<MemoryRouter initialEntries={[entry]}><BudgetsPage /><Where /></MemoryRouter>)
}

/** The participant of each body row, in the order the table is showing them. */
const participants = () => screen.queryAllByRole('row').slice(1).map(tr => (tr as HTMLTableRowElement).cells[0].textContent ?? '')
const filter = (name: RegExp) => screen.getByRole('radio', { name })

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockUseBudgetList.mockReturnValue(ready())
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('BudgetsPage: the list', () => {
  it('shows the server’s rows in the server’s order, riskiest first, with each status and the figures', () => {
    renderPage()

    expect(participants()).toEqual(['Olive Over', 'Ford Cast', 'Appa Roach', 'Alma Fine'])
    const over = screen.getByText('Olive Over').closest('tr')!
    expect(within(over).getByText('Over')).toBeInTheDocument()
    expect(within(over).getByText('$1,000.00')).toBeInTheDocument()   // available
    expect(within(over).getAllByText('$1,500.00').length).toBeGreaterThan(0)   // used (and the forecast, which is the same here)
    expect(within(screen.getByText('Ford Cast').closest('tr')!).getByText('Forecast over')).toBeInTheDocument()
    expect(within(screen.getByText('Appa Roach').closest('tr')!).getByText('Approaching')).toBeInTheDocument()
    expect(within(screen.getByText('Alma Fine').closest('tr')!).getByText('On track')).toBeInTheDocument()
  })

  it('names the pool and the funding period of every row, and says how many pools of how many participants, as of which day', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument()
    expect(screen.getByText('4 pools across 4 participants, as of 8 Oct 2026')).toBeInTheDocument()
    expect(within(screen.getByText('Appa Roach').closest('tr')!).getByText('Improved Daily Living Skills')).toBeInTheDocument()
    expect(within(screen.getByText('Appa Roach').closest('tr')!).getByText('1 Oct – 31 Dec 2026')).toBeInTheDocument()
  })

  it('links every row to the participant’s Funding tab, by a name that says whose it is', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Open funding for Olive Over' })).toHaveAttribute('href', '/participants/p-0010?tab=funding')
    expect(screen.getByRole('link', { name: 'Open funding for Alma Fine' })).toHaveAttribute('href', '/participants/p-0013?tab=funding')
  })

  it('labels every value in the card layout a phone gets, so nothing is lost at 390', () => {
    renderPage()

    const row = screen.getByText('Olive Over').closest('tr')!
    for (const label of ['Participant', 'Pool', 'Period', 'Status', 'Available', 'Used', 'Booked ahead', 'Forecast']) {
      expect(row.querySelector(`[data-label="${label}"]`), label).not.toBeNull()
    }
  })

  it('draws a pool a plan records at $0 as $0.00 and not as a dash', () => {
    mockUseBudgetList.mockReturnValue(ready(budgetList({ rows: [budgetRow({ available: 0, used: 0, bookedAhead: 0, forecast: 0 })] })))
    renderPage()

    const row = screen.getByText('Sienna Williams').closest('tr')!
    expect(row.querySelector('[data-label="Available"]')).toHaveTextContent('$0.00')
    expect(row.querySelector('[data-label="Forecast"]')).toHaveTextContent('$0.00')
  })

  it('asks for the list only for a role that may see money', () => {
    cleanup()
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    renderPage()
    expect(mockUseBudgetList).toHaveBeenLastCalledWith(false)

    cleanup()
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderPage()
    expect(mockUseBudgetList).toHaveBeenLastCalledWith(false)

    cleanup()
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    renderPage()
    expect(mockUseBudgetList).toHaveBeenLastCalledWith(true)
  })
})

describe('BudgetsPage: filtering by status', () => {
  it('offers each status with how many rows it holds, and All', () => {
    renderPage()

    for (const label of [/^All \(4\)$/, /^Over \(1\)$/, /^Forecast over \(1\)$/, /^Approaching \(1\)$/, /^On track \(1\)$/]) expect(filter(label)).toBeInTheDocument()
    expect(filter(/^All/)).toHaveAttribute('aria-checked', 'true')
  })

  it('shows only the rows of the status chosen, and puts it in the address so the list can be shared', async () => {
    renderPage()

    await userEvent.click(filter(/^Over \(1\)/))

    expect(participants()).toEqual(['Olive Over'])
    expect(screen.getByTestId('where')).toHaveTextContent('/budgets?status=Over')
    await userEvent.click(filter(/^All/))
    expect(participants()).toHaveLength(4)
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/budgets$/)
  })

  it('starts on the status in the address, and treats anything that is not a status as All', () => {
    const { unmount } = renderPage('/budgets?status=Approaching')
    expect(participants()).toEqual(['Appa Roach'])
    unmount()

    renderPage('/budgets?status=Nonsense')
    expect(participants()).toHaveLength(4)
  })
})

describe('BudgetsPage: searching for a participant', () => {
  it('narrows the rows to the names that contain the words, whatever their case', async () => {
    renderPage()

    await userEvent.type(screen.getByRole('textbox', { name: 'Search participants' }), '  FORD ')

    expect(participants()).toEqual(['Ford Cast'])
  })

  // "Over (1)" with a name typed that no over row has ended in "No budgets match these filters": the counts are of the rows the search leaves, so a filter that would show nothing says (0).
  it('counts each status within the search, so a filter never promises rows the search has taken away', async () => {
    renderPage()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search participants' }), 'ford')

    for (const label of [/^All \(1\)$/, /^Over \(0\)$/, /^Forecast over \(1\)$/, /^Approaching \(0\)$/, /^On track \(0\)$/]) expect(filter(label)).toBeInTheDocument()
  })

  it('combines with the status, and says so plainly when nothing matches, with a way back', async () => {
    renderPage()
    await userEvent.click(filter(/^Over \(1\)/))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search participants' }), 'ford')

    expect(screen.getByText('No budgets match these filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(participants()).toHaveLength(4)
    expect(screen.getByRole('textbox', { name: 'Search participants' })).toHaveValue('')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/budgets$/)
  })
})

describe('BudgetsPage: the participants with no budget in force', () => {
  const open = async () => userEvent.click(screen.getByRole('button', { name: '2 participants with no budget recorded' }))

  it('keeps them at the end behind a count, closed, and never among the rows', () => {
    renderPage()

    expect(participants()).not.toContain('Noor Hassan')
    expect(screen.getByRole('button', { name: '2 participants with no budget recorded' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists them when the count is opened, each with why and a way to record a budget', async () => {
    renderPage()

    await open()

    const list = document.getElementById(screen.getByRole('button', { name: /no budget recorded/ }).getAttribute('aria-controls')!)!
    expect(within(list).getByText('Noor Hassan')).toBeVisible()
    expect(within(list).getByText('No budget recorded')).toBeVisible()
    expect(within(list).getByText('Edna Ended')).toBeVisible()
    expect(within(list).getByText('Plan ended 30 Jun 2026')).toBeVisible()
    expect(within(list).getByRole('link', { name: 'Record budget for Noor Hassan' })).toHaveAttribute('href', '/participants/p-0005?tab=funding')
    expect(within(list).getByRole('link', { name: 'Record a new plan for Edna Ended' })).toHaveAttribute('href', '/participants/p-0006?tab=funding')   // the Funding tab's own button for a plan that ended
    expect(within(list).getByText('ODIP cannot warn about a budget it does not hold. Record the plan to start tracking.')).toBeVisible()
  })

  // A plan recorded for later is not "no budget recorded": the entry says when it starts, and the Funding tab (where the plan is) is the link.
  it('says when a plan starts for a participant whose plan is recorded for later, with the Funding tab as its link', async () => {
    mockUseBudgetList.mockReturnValue(ready(budgetList({ noBudget: [noBudget({ participantId: 'p-0007', participantName: 'Una Upcoming', reason: 'NotStarted', planStart: '2026-11-01' })] })))
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: '1 participant with no budget recorded' }))

    const list = document.getElementById(screen.getByRole('button', { name: /no budget recorded/ }).getAttribute('aria-controls')!)!
    expect(within(list).getByText('Una Upcoming')).toBeVisible()
    expect(within(list).getByText('Plan starts 1 Nov 2026')).toBeVisible()
    expect(within(list).getByRole('link', { name: 'Open funding for Una Upcoming' })).toHaveAttribute('href', '/participants/p-0007?tab=funding')
  })

  it('is part of All only: a participant with no budget has no status to filter by', async () => {
    renderPage()

    await userEvent.click(filter(/^Over \(1\)/))

    expect(screen.queryByRole('button', { name: /no budget recorded/ })).not.toBeInTheDocument()
  })

  it('is narrowed by the search like everyone else, and stays below the words that say no budget matches', async () => {
    renderPage()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search participants' }), 'noor')

    expect(screen.getByText('No budgets match these filters.')).toBeInTheDocument()   // no pool has a participant called that...
    expect(screen.getByRole('button', { name: '1 participant with no budget recorded' })).toBeInTheDocument()   // ...but one without a budget does
  })

  it('is what the page says when nobody has a budget yet: no filters, no caption about risk order, the words, and the people open from the start', () => {
    mockUseBudgetList.mockReturnValue(ready(budgetList({ rows: [] })))
    renderPage()

    expect(screen.getByText('No budgets are being tracked yet. Record a participant’s plan to start.')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^All/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search participants' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Riskiest first/)).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: '2 participants with no budget recorded' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(document.getElementById(toggle.getAttribute('aria-controls')!)!).getByText('Noor Hassan')).toBeVisible()
  })
})

describe('BudgetsPage: loading, failed and empty are three different facts', () => {
  it('says it is loading, as every page does, and draws no filter and no figure while there is nothing to filter', () => {
    mockUseBudgetList.mockReturnValue({ data: undefined, isLoading: true, isPending: true, isError: false, fetchStatus: 'fetching' })
    renderPage()

    expect(screen.getByText('Loading budget list…')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^All/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search participants' })).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('says it failed, as an alert with a way to ask again, and never as an empty list that would read as nobody at risk', async () => {
    const refetch = vi.fn()
    mockUseBudgetList.mockReturnValue({ data: undefined, isLoading: false, isPending: false, isError: true, fetchStatus: 'idle', refetch })
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load this budget list. Check your connection and try again./)
    expect(screen.queryByText(/No budgets are being tracked yet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^All/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says nothing is tracked yet, and what to do, when the server sent no row and no participant', () => {
    mockUseBudgetList.mockReturnValue(ready(budgetList({ rows: [], noBudget: [] })))
    renderPage()

    expect(screen.getByText('No budgets are being tracked yet. Record a participant’s plan to start.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /^All/ })).not.toBeInTheDocument()
  })
})
