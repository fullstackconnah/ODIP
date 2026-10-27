import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { AgreementBulkResult } from '@/api/types'
import { AgreementsReview } from './AgreementsReview'
import { changeWords } from './agreementRows'
import type { BulkRun } from './AgreementActionDialog'

const { mockApprove } = vi.hoisted(() => ({ mockApprove: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useApproveAgreements: () => ({ mutateAsync: mockApprove, isPending: false }) }))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))

const made = (id: string, name: string, over: Partial<AgreementBulkResult> = {}): AgreementBulkResult => ({
  participantId: id, name, outcome: 'Created', reason: null, sourceDraftId: `s-${id}`, newDraftId: `n-${id}`,
  before: { start: '2026-01-01', end: '2026-12-31', total: 1000 }, after: { start: '2027-01-01', end: '2027-12-31', total: 1250.5 }, hasIssues: false, ...over,
})
const results: AgreementBulkResult[] = [
  made('a', 'Ana Lee'),
  made('b', 'Ben Ng', { hasIssues: true }),
  made('c', 'Cy Roe'),
  { ...made('d', 'Dee Ray'), outcome: 'Skipped', reason: 'Has a draft waiting', newDraftId: null, before: null, after: null },
  { ...made('e', 'Eve Fox'), outcome: 'Failed', reason: 'The plan ends first', newDraftId: null, before: null, after: null },
]
const run = (over: Partial<BulkRun> = {}): BulkRun => ({ action: 'renew', label: '', results, stopped: null, ...over })
const show = (r: BulkRun, canApprove = true) => {
  const onBack = vi.fn()
  render(<MemoryRouter><AgreementsReview run={r} canApprove={canApprove} onBack={onBack} /></MemoryRouter>)
  return { onBack }
}
const tick = (name: string) => userEvent.click(within(screen.getByText(name).closest('tr')!).getByRole('checkbox'))

beforeEach(() => { mockApprove.mockResolvedValue({ results: [], stopped: null }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('changeWords', () => {
  it.each([[1000, 1250.5, '+$250.50'], [1000, 900, '−$100.00'], [1000, 1000, '$0.00']])('%d to %d reads %s', (before, after, words) => {
    expect(changeWords(before, after)).toBe(words)
  })
})

describe('AgreementsReview', () => {
  it('names the run, counts each group and says nothing changes until approval', () => {
    show(run())
    expect(screen.getByRole('heading', { level: 2, name: 'Renewal drafts' })).toHaveFocus()
    expect(screen.getByText('3 drafts made')).toBeInTheDocument()
    expect(screen.getByText('1 skipped')).toBeInTheDocument()
    expect(screen.getByText('1 failed')).toBeInTheDocument()
    expect(screen.getByText(/Nothing changes on the roster until you approve a draft/)).toBeInTheDocument()
    expect(screen.getByText('Has a draft waiting')).toBeInTheDocument()
    expect(screen.getByText('The plan ends first')).toBeInTheDocument()
  })

  it('shows old and new term and total with a signed change', () => {
    show(run())
    const ana = screen.getByText('Ana Lee').closest('tr')!
    expect(within(ana).getByText('$1,000.00')).toBeInTheDocument()
    expect(within(ana).getByText('$1,250.50')).toBeInTheDocument()
    expect(within(ana).getByText('+$250.50')).toBeInTheDocument()
  })

  it('headings and columns follow the action', () => {
    show(run({ action: 'extend', label: '2027-06-30' }))
    expect(screen.getByRole('heading', { level: 2, name: /^Extension drafts [(]to [A-Za-z]+ 30 Jun 2027[)]$/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Added total' })).toBeInTheDocument()
    cleanup()
    show(run({ action: 'reprice', label: '2026-27' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Reprice drafts (2026-27)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'After' })).toBeInTheDocument()
  })

  it('flags a draft with findings and leaves it out of Approve', async () => {
    show(run())
    expect(within(screen.getByText('Ben Ng').closest('tr')!).getByText('Needs review')).toBeInTheDocument()
    await tick('Ana Lee')
    await tick('Ben Ng')
    expect(screen.getByRole('button', { name: 'Approve 1' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Approve 1' }))
    expect(within(screen.getByRole('dialog')).getByText(/1 needs review and is left out/)).toBeInTheDocument()
  })

  it('approves the ticked drafts by their new draft ids and shows each outcome', async () => {
    mockApprove.mockResolvedValue({ results: [{ participantId: 'a', draftId: 'n-a', participantName: 'Ana Lee', outcome: 'Approved', reasons: [] }], stopped: null })
    show(run())
    await tick('Ana Lee')
    await userEvent.click(screen.getByRole('button', { name: 'Approve 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 1' }))
    expect(mockApprove).toHaveBeenCalledWith([{ participantId: 'a', draftId: 'n-a' }])
    await waitFor(() => expect(within(screen.getByText('Ana Lee').closest('tr')!).getByText('Approved')).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'Outcome' })).toBeInTheDocument()
  })

  it('shows no approve controls for a role that cannot approve', () => {
    show(run(), false)
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('warns when the run stopped partway and offers the drafts waiting', async () => {
    const { onBack } = show(run({ stopped: { done: 25, total: 60, notSent: 35, noReply: false } }))
    expect(screen.getByText(/Stopped after 25 of 60/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show drafts waiting' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('All agreements goes back', async () => {
    const { onBack } = show(run())
    await userEvent.click(screen.getByRole('button', { name: 'All agreements' }))
    expect(onBack).toHaveBeenCalled()
  })
})
