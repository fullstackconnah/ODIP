import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { AgreementRevisionRef, AgreementRow } from '@/api/types'
import AgreementsPage from './AgreementsPage'
import { AgreementsBulkBar } from './agreements/AgreementsBulkBar'

const { mockUseAgreements, mockApprove, mockNarrow } = vi.hoisted(() => ({ mockUseAgreements: vi.fn(), mockApprove: vi.fn(), mockNarrow: vi.fn(() => false) }))
vi.mock('@/api/hooks', () => ({
  useAgreements: mockUseAgreements,
  useApproveAgreements: () => ({ mutateAsync: mockApprove, isPending: false }),
}))

vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: mockNarrow }))

const rev = (n: number, start: string, end: string, total = 1000): AgreementRevisionRef => ({ draftId: `d${n}`, version: n, agreementStartDate: start, agreementEndDate: end, total })
const row = (name: string, over: Partial<AgreementRow> = {}): AgreementRow => ({
  participantId: name, participantName: name, status: 'Active', endingState: 'None', hasWaitingDraft: false, current: rev(1, '2026-01-01', '2026-12-31'),
  waiting: null, daysLeft: null, termStart: '2026-01-01', priceList: { version: '2025-26', start: '2025-07-01' }, newerPriceList: null, ...over,
})
const rows = [
  row('Ana Lee'),
  row('Ben Ng', { status: 'Ending', endingState: 'Ending', daysLeft: 12 }),
  row('Dee Ray', { status: 'DraftWaiting', hasWaitingDraft: true, waiting: rev(7, '2027-01-01', '2027-12-31', 2500) }),
  row('Eve Fox', { status: 'NotApproved', current: null, waiting: rev(1, '2026-03-01', '2027-02-28'), hasWaitingDraft: true, termStart: null }),
]
const ready = (list = rows, canApprove = true) => ({ data: { canApprove, rows: list }, isLoading: false, isPending: false, isError: false, fetchStatus: 'idle', refetch: vi.fn() })

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname}{l.search}</output>
}
function renderPage(entry = '/agreements') {
  return render(<MemoryRouter initialEntries={[entry]}><AgreementsPage /><Where /></MemoryRouter>)
}
const tick = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(within(screen.getByText(name).closest('tr')!).getByRole('checkbox'))

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockUseAgreements.mockReturnValue(ready())
  mockNarrow.mockReturnValue(false)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

describe('AgreementsPage', () => {
  it('lists every agreement with its status, term, total and price list, and counts them', () => {
    renderPage()
    expect(screen.getByText('4 agreements')).toBeInTheDocument()
    const dee = screen.getByText('Dee Ray').closest('tr')!
    expect(within(dee).getByText('Draft waiting')).toBeInTheDocument()
    expect(within(dee).getByText('Draft v7: 1 Jan – 31 Dec 2027')).toBeInTheDocument()
    expect(within(screen.getByText('Ben Ng').closest('tr')!).getByText('Ends in 12 days')).toBeInTheDocument()
    expect(within(screen.getByText('Eve Fox').closest('tr')!).getByText('Draft v1, never approved')).toBeInTheDocument()
  })

  it('narrows by Show and writes it to the address, and says why nothing matches', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'Draft waiting' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/agreements?show=draft')
    expect(screen.getByText('2 of 4 agreements')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Ended' }))
    expect(screen.getByText('No agreement has ended without a newer one.')).toBeInTheDocument()
  })

  it('opens on the view named in the address (the old Agreements ending link)', () => {
    renderPage('/agreements?show=ending')
    expect(screen.getByRole('radio', { name: 'Ending soon' })).toBeChecked()
    expect(screen.getByText('Ben Ng')).toBeInTheDocument()
    expect(screen.queryByText('Ana Lee')).not.toBeInTheDocument()
  })

  it('names only the filters that are set when nothing matches', async () => {
    const user = userEvent.setup()
    renderPage('/agreements?show=ended&q=zzzz')
    expect(screen.getByText('No agreements match. Clear the search or choose All under Show.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Price list' }), '2025-26')
    expect(screen.getByText('No agreements match. Clear the search, choose All under Show or choose Any price list.')).toBeInTheDocument()
    cleanup()
    renderPage('/agreements?q=zzzz')
    expect(screen.getByText('No agreements match. Clear the search.')).toBeInTheDocument()
  })

  it('scrolls the chosen Show option into view inside its strip, and never the page', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const width = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(500)
    const client = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(200)
    const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return (this.getAttribute('aria-checked') === 'true' ? { left: 400, right: 480, width: 80 } : { left: 0, right: 200, width: 200 }) as DOMRect
    })
    try {
      renderPage('/agreements?show=new-price-list')
      expect(scrollTo).toHaveBeenCalledWith({ left: 300 })
    } finally {
      width.mockRestore(); client.mockRestore(); box.mockRestore()
      delete (Element.prototype as { scrollTo?: unknown }).scrollTo
    }
  })

  it('gives a role that cannot approve no checkboxes and no Approve', () => {
    mockUseAgreements.mockReturnValue(ready(rows, false))
    renderPage()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
  })

  it('counts only the ticked rows that have a draft, and explains an Approve that has nothing to do', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText('None selected')).toBeInTheDocument()
    await tick(user, 'Ana Lee')
    expect(screen.getByText('None of the ticked rows has a draft waiting.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    await tick(user, 'Dee Ray')
    expect(screen.getByRole('button', { name: 'Approve 1' })).toBeEnabled()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('approves the ticked drafts after a confirm, unticks the approved ones and says what happened', async () => {
    mockApprove.mockResolvedValue({ results: [{ participantId: 'Dee Ray', draftId: 'd7', participantName: 'Dee Ray', outcome: 'Approved', reasons: [] }] })
    const user = userEvent.setup()
    renderPage()
    await tick(user, 'Ana Lee')
    await tick(user, 'Dee Ray')
    await user.click(screen.getByRole('button', { name: 'Approve 1' }))
    expect(screen.getByRole('heading', { name: 'Approve 1 agreement?' })).toBeInTheDocument()
    expect(screen.getByText(/1 ticked row has no draft/)).toBeInTheDocument()

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 1' }))

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith([{ participantId: 'Dee Ray', draftId: 'd7' }]))
    expect(await screen.findAllByText('1 approved.')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()   // Ana Lee stays, Dee Ray was approved
  })

  it('keeps the dialog open with the words for a 429 that sent nothing', async () => {
    mockApprove.mockResolvedValue({ results: [], stopped: { error: { response: { status: 429 } }, notSent: 1 } })
    const user = userEvent.setup()
    renderPage()
    await tick(user, 'Dee Ray')
    await user.click(screen.getByRole('button', { name: 'Approve 1' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 1' }))

    expect(await screen.findByText('Too many requests just now. Wait a minute, then try again.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Approve 1 agreement?' })).toBeInTheDocument()
  })

  const approveDee = async (user: ReturnType<typeof userEvent.setup>) => {
    await tick(user, 'Dee Ray')
    await user.click(screen.getByRole('button', { name: 'Approve 1' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 1' }))
  }

  it('tells a 403 the role cannot approve, with no "Try again"', async () => {
    mockApprove.mockResolvedValue({ results: [], stopped: { error: { response: { status: 403 } }, notSent: 1 } })
    renderPage()
    await approveDee(userEvent.setup())

    const words = await screen.findByText(/Your role can't approve agreements/)
    expect(words).toHaveTextContent('An Admin can change who may approve, in Settings, Plan pricing.')
    expect(screen.queryByText(/Try again/)).not.toBeInTheDocument()
    // A retry can only be refused again: Approve is off, Cancel still closes.
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', { name: 'Approve 1' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('leaves Approve on for a retry after any other error', async () => {
    mockApprove.mockResolvedValue({ results: [], stopped: { error: { response: { status: 500 } }, notSent: 1 } })
    renderPage()
    await approveDee(userEvent.setup())

    const dialog = within(screen.getByRole('dialog'))
    expect(await dialog.findByText('Could not approve these. Try again.')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Approve 1' })).toBeEnabled()
  })

  it.each([502, 503, 504])('reads a proxy %i as no reply, since the server may have gone on', async status => {
    mockApprove.mockResolvedValue({ results: [], stopped: { error: { response: { status } }, notSent: 1 } })
    renderPage()
    await approveDee(userEvent.setup())

    expect(await screen.findByText("We didn't hear back, so some of these may have been approved. Refresh to check before trying again.")).toBeInTheDocument()
    expect(screen.queryByText(/Could not approve these/)).not.toBeInTheDocument()
  })

  it('says some may have been approved when the request got no answer at all', async () => {
    mockApprove.mockResolvedValue({ results: [], stopped: { error: new Error('timeout of 60000ms exceeded'), notSent: 1 } })
    renderPage()
    await approveDee(userEvent.setup())

    expect(await screen.findByText("We didn't hear back, so some of these may have been approved. Refresh to check before trying again.")).toBeInTheDocument()
    expect(screen.queryByText(/weren't started|Could not approve these/)).not.toBeInTheDocument()
  })

  it('does not call a later chunk with no answer "not started"', async () => {
    mockApprove.mockResolvedValue({
      results: [{ participantId: 'Dee Ray', draftId: 'd7', participantName: 'Dee Ray', outcome: 'Approved', reasons: [] }],
      stopped: { error: new Error('Network Error'), notSent: 2 },
    })
    renderPage()
    await approveDee(userEvent.setup())

    const dialog = within(screen.getByRole('dialog'))
    expect(await dialog.findByText(/No answer came back for the last 2: some may have been approved./)).toBeInTheDocument()
    expect(screen.queryByText(/weren't started/)).not.toBeInTheDocument()
  })

  it('never sends a ticked row that a filter has hidden', async () => {
    mockApprove.mockResolvedValue({ results: [] })
    const user = userEvent.setup()
    renderPage()
    await tick(user, 'Dee Ray')
    await tick(user, 'Eve Fox')
    await user.type(screen.getByRole('textbox', { name: 'Search participants' }), 'Dee')
    await user.click(screen.getByRole('button', { name: 'Approve 1' }))
    expect(screen.getByRole('heading', { name: 'Approve 1 agreement?' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 1' }))

    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(1))
    expect(mockApprove).toHaveBeenCalledWith([{ participantId: 'Dee Ray', draftId: 'd7' }])
  })

  it('cannot be closed while the approvals are in flight', async () => {
    let finish: (run: unknown) => void = () => {}
    mockApprove.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    renderPage()
    await approveDee(user)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Approving 1 agreement...')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(dialog.parentElement!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Approving 1 agreement...')).toBeInTheDocument()

    finish({ results: [{ participantId: 'Dee Ray', draftId: 'd7', participantName: 'Dee Ray', outcome: 'Approved', reasons: [] }] })
    expect(await screen.findByRole('heading', { name: '1 agreement approved' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no agreements', () => {
    mockUseAgreements.mockReturnValue(ready([]))
    renderPage()
    expect(screen.getByText('No agreements yet')).toBeInTheDocument()
  })
})

describe('AgreementsBulkBar', () => {
  it('on a phone is one row: box, count, Actions; the reason is the menu item, and there is no Clear', async () => {
    mockNarrow.mockReturnValue(true)
    const user = userEvent.setup()
    render(<AgreementsBulkBar selected={2} approvable={0} canApprove shown={4} allShownSelected={false} onToggleShown={vi.fn()} onClear={vi.fn()} onApprove={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Select shown' })).toBeInTheDocument()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    expect(screen.queryByText('None of the ticked rows has a draft waiting.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Actions/ }))
    const item = screen.getByRole('option', { name: /Approve/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('None of the ticked rows has a draft waiting.')
  })

  const bar = (selected: number) => (
    <AgreementsBulkBar selected={selected} approvable={selected} canApprove shown={200} allShownSelected={false} onToggleShown={vi.fn()} onClear={vi.fn()} onApprove={vi.fn()} />
  )
  it('refuses more than 100 ticked rows, in words', () => {
    render(bar(101))
    expect(screen.getByText('Choose 100 or fewer (101 selected).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve 101' })).toBeDisabled()
  })
})
