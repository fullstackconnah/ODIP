import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { AgreementRevisionRef, AgreementRow } from '@/api/types'
import AgreementsPage from './AgreementsPage'
import { AgreementsBulkBar } from './agreements/AgreementsBulkBar'

const { mockUseAgreements, mockApprove } = vi.hoisted(() => ({ mockUseAgreements: vi.fn(), mockApprove: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useAgreements: mockUseAgreements,
  useApproveAgreements: () => ({ mutateAsync: mockApprove, isPending: false }),
}))

vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

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

  it('shows the empty state when there are no agreements', () => {
    mockUseAgreements.mockReturnValue(ready([]))
    renderPage()
    expect(screen.getByText('No agreements yet')).toBeInTheDocument()
  })
})

describe('AgreementsBulkBar', () => {
  const bar = (selected: number) => (
    <AgreementsBulkBar selected={selected} approvable={selected} canApprove shown={200} allShownSelected={false} onToggleShown={vi.fn()} onClear={vi.fn()} onApprove={vi.fn()} />
  )
  it('refuses more than 100 ticked rows, in words', () => {
    render(bar(101))
    expect(screen.getByText('Choose 100 or fewer (101 selected).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve 101' })).toBeDisabled()
  })
})
