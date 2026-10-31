import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import ComplaintsPage from './ComplaintsPage'

const { mockUseComplaints, mockArchiveMutate, mockRestoreMutate } = vi.hoisted(() => ({
  mockUseComplaints: vi.fn(),
  mockArchiveMutate: vi.fn(),
  mockRestoreMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useComplaints: mockUseComplaints,
  useArchiveComplaint: () => ({ mutate: mockArchiveMutate, isPending: false }),
  useRestoreComplaint: () => ({ mutate: mockRestoreMutate, isPending: false }),
}))

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1', receivedOn: '2026-10-05', channel: 'Phone', complainantKind: 'FamilyOrCarer', complainantName: 'Sam Carer',
    participantName: null, summary: 'Support worker was late three times', status: 'Open', openDays: 12,
    acknowledgedOn: '2026-10-06', isActive: true, updatedAt: '2026-10-06T00:00:00Z', ...overrides,
  }
}

function list(items: unknown[], extra: Record<string, unknown> = {}) {
  const data = Object.assign([...items], { totalCount: items.length, isTruncated: false })
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...extra }
}

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname}{loc.search}</div>
}

function renderPage(url = '/complaints') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/complaints" element={<><ComplaintsPage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const lastParams = () => mockUseComplaints.mock.calls.at(-1)![0] as Record<string, string>

describe('ComplaintsPage', () => {
  beforeEach(() => {
    mockUseComplaints.mockReset()
    mockArchiveMutate.mockReset()
    mockRestoreMutate.mockReset()
  })
  afterEach(() => { vi.useRealTimers() })

  it('prints the count and a row with the kind, name, dates and status', () => {
    mockUseComplaints.mockReturnValue(list([row()]))
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Complaints' })).toBeInTheDocument()
    expect(screen.getByText('1 complaint')).toBeInTheDocument()
    const table = screen.getAllByRole('row')[1]
    expect(within(table).getByRole('link', { name: 'Support worker was late three times' })).toHaveAttribute('href', '/complaints/c-1')
    expect(within(table).getByText(/Family or carer · Sam Carer/)).toBeInTheDocument()
    expect(within(table).getByText(/05\/10\/2026/)).toBeInTheDocument()
    expect(within(table).getByText('Open', { selector: 'span.rounded-full' })).toBeInTheDocument()
    expect(within(table).getByText(/06\/10\/2026/)).toBeInTheDocument()
  })

  it('clamps a long summary to three lines on a phone card and keeps the one-line truncate on desktop', () => {
    mockUseComplaints.mockReturnValue(list([row({ id: 'a', summary: 'x '.repeat(2000) })]))
    renderPage()
    const link = within(screen.getAllByRole('row')[1]).getAllByRole('link')[0]
    expect(link.className).toContain('max-md:line-clamp-3')
    expect(link.className).toContain('md:truncate')
    expect(link).toHaveAttribute('title', 'x '.repeat(2000))
  })

  it('words "Open for" as Since today, 1 day, N days, and an en dash read as "Not open" once closed', () => {
    mockUseComplaints.mockReturnValue(list([
      row({ id: 'a', summary: 'Today', openDays: 0 }),
      row({ id: 'b', summary: 'Yesterday', openDays: 1 }),
      row({ id: 'c', summary: 'Old', openDays: 34 }),
      row({ id: 'd', summary: 'Shut', status: 'Closed', openDays: null }),
    ]))
    renderPage()
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Since today')).toBeInTheDocument()
    // The phone card puts the label after "Open", so it reads "Open since today"; the desktop cell keeps the capital.
    expect(within(rows[0]).getByText('since today').className).toContain('md:hidden')
    expect(within(rows[1]).getByText('1 day')).toBeInTheDocument()
    const old = within(rows[2]).getByText('34 days')
    expect(old.className).toContain('font-medium')
    expect(within(rows[1]).getByText('1 day').className).not.toContain('font-medium')
    expect(within(rows[3]).getByText('Not open')).toBeInTheDocument()
  })

  it('shows Anonymous alone and "Not yet" when nothing has been acknowledged', () => {
    mockUseComplaints.mockReturnValue(list([row({ complainantKind: 'Anonymous', complainantName: null, acknowledgedOn: null })]))
    renderPage()
    const r = screen.getAllByRole('row')[1]
    expect(within(r).getByText('Anonymous')).toBeInTheDocument()
    expect(within(r).getByText('Not yet')).toBeInTheDocument()
  })

  it('names a Participant complainant by the linked participant', () => {
    mockUseComplaints.mockReturnValue(list([row({ complainantKind: 'Participant', complainantName: null, participantName: 'Jo Smith' })]))
    renderPage()
    expect(screen.getByText('Participant · Jo Smith')).toBeInTheDocument()
  })

  it('asks the server for the active page by default', () => {
    mockUseComplaints.mockReturnValue(list([row()]))
    renderPage()
    expect(lastParams()).toEqual({ isActive: 'true', page: '1', pageSize: '25' })
  })

  it('writes open=over21 to the URL and sends longOpen=true when the checkbox is ticked', async () => {
    mockUseComplaints.mockReturnValue(list([row()]))
    renderPage()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open longer than 21 days' }))
    expect(screen.getByTestId('where').textContent).toContain('open=over21')
    expect(lastParams()).toMatchObject({ longOpen: 'true', isActive: 'true' })
  })

  it('reads the filters from the URL', () => {
    mockUseComplaints.mockReturnValue(list([row()]))
    renderPage('/complaints?status=Investigating&open=over21')
    expect(lastParams()).toMatchObject({ status: 'Investigating', longOpen: 'true' })
    expect(screen.getByRole('checkbox', { name: 'Open longer than 21 days' })).toBeChecked()
  })

  it('debounces the search: the server sees the text once typing pauses for 300 ms', async () => {
    vi.useFakeTimers()
    mockUseComplaints.mockReturnValue(list([row()]))
    renderPage()
    const box = screen.getByRole('textbox', { name: 'Search complaints' })
    fireEvent.change(box, { target: { value: 'late' } })
    expect(mockUseComplaints.mock.calls.some(c => (c[0] as Record<string, string>).search)).toBe(false)
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(lastParams().search).toBe('late')
    expect(mockUseComplaints.mock.calls.filter(c => (c[0] as Record<string, string>).search).every(c => (c[0] as Record<string, string>).search === 'late')).toBe(true)
  })

  it('first use: the empty state offers Record a complaint', () => {
    mockUseComplaints.mockReturnValue(list([]))
    renderPage()
    expect(screen.getByText('No complaints recorded')).toBeInTheDocument()
    expect(screen.getByText(/however it reached you/)).toBeInTheDocument()
    // Once in the header and once in the empty state.
    const links = screen.getAllByRole('link', { name: 'Record a complaint' })
    expect(links).toHaveLength(2)
    links.forEach(l => expect(l).toHaveAttribute('href', '/complaints/new'))
  })

  it('no matches: Clear filters removes status, open and q', async () => {
    mockUseComplaints.mockReturnValue(list([]))
    renderPage('/complaints?status=Closed&q=zzz')
    expect(screen.getByText('No complaints match')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByTestId('where').textContent).toBe('/complaints')
  })

  it('over-21 filter with nothing: its own copy, and Show all open complaints clears it', async () => {
    mockUseComplaints.mockReturnValue(list([]))
    renderPage('/complaints?open=over21')
    expect(screen.getByText('No complaints open longer than 21 days')).toBeInTheDocument()
    expect(screen.getByText('Every open complaint is 21 days old or newer.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all open complaints' }))
    expect(screen.getByTestId('where').textContent).toBe('/complaints')
  })

  it('archived view with nothing: its own copy, no Record action, only the toggle and search stay', async () => {
    mockUseComplaints.mockReturnValue(list([]))
    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    expect(screen.getByText('No archived complaints')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Record a complaint/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Open longer than 21 days' })).not.toBeInTheDocument()
    expect(lastParams()).toMatchObject({ isActive: 'false' })
    expect(lastParams().longOpen).toBeUndefined()
  })

  it('the "n complaints" subtitle waits for a list: hidden while loading and after a failed load', () => {
    mockUseComplaints.mockReturnValue(list([], { isLoading: true }))
    const loading = renderPage()
    expect(screen.queryByText(/d+ complaints?$/)).not.toBeInTheDocument()
    loading.unmount()
    mockUseComplaints.mockReturnValue(list([], { isError: true, error: { response: { status: 500 } } }))
    renderPage()
    expect(screen.queryByText(/d+ complaints?$/)).not.toBeInTheDocument()
  })

  it('an unacknowledged complaint reads "Not acknowledged" on the phone card as well as "Not yet" under the column', () => {
    mockUseComplaints.mockReturnValue(list([row({ acknowledgedOn: null })]))
    renderPage()
    const r = screen.getAllByRole('row')[1]
    expect(within(r).getByText('Not acknowledged')).toBeInTheDocument()
    expect(within(r).getByText('Not yet')).toBeInTheDocument()
  })

  it('a failed load shows the error with Try again', async () => {
    const refetch = vi.fn()
    mockUseComplaints.mockReturnValue(list([], { isError: true, error: { response: { status: 500 } }, refetch }))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('a 403 shows the danger callout in place of the table, with no retry', () => {
    mockUseComplaints.mockReturnValue(list([], { isError: true, error: { response: { status: 403 } } }))
    renderPage()
    expect(screen.getByText("You can't see complaints. They're for Admins and Coordinators.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again|retry/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('archive confirms with the received date, never the complainant name, then archives by id', async () => {
    mockUseComplaints.mockReturnValue(list([row()]))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Archive "the complaint received 05/10/2026"?')
    expect(dialog).not.toHaveTextContent('Sam Carer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(mockArchiveMutate).toHaveBeenCalledWith('c-1', expect.anything())
  })
})
