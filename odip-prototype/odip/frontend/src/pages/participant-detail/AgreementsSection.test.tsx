import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ServiceAgreementDraftDto } from '@/api/types'

const refetch = vi.fn()
const deleteMutate = vi.fn()
const endMutate = vi.fn()
const pdfMutate = vi.fn()
let listState: { data?: ServiceAgreementDraftDto[]; isLoading?: boolean; isError?: boolean } = {}

vi.mock('@/api/hooks', () => ({
  useServiceAgreementDrafts: () => ({ ...listState, refetch }),
  useDeleteServiceAgreementDraft: () => ({ mutate: deleteMutate, isPending: false }),
  useEndAgreementEarly: () => ({ mutate: endMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: pdfMutate, isPending: false }),
}))

import { AgreementsSection } from './AgreementsSection'

const approval = { approvedAt: '2026-06-20T01:00:00Z', approvedByName: 'Sam Lee', patternsCreated: 2, patternsEnded: 0, shiftsCreated: 0 }
const version = (n: number, start: string, end: string, changes: Partial<ServiceAgreementDraftDto> = {}): ServiceAgreementDraftDto => ({
  id: `d-${n}`, participantId: 'p-1', version: n, state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: start, agreementEndDate: end,
  blocks: [], lines: [], isSummary: true, blockCount: 1, lineCount: 1, total: 1000 * n, caveats: [], approval, ...changes,
}) as ServiceAgreementDraftDto

const mixed = () => [
  version(4, '2026-10-01', '2027-06-30', { approval: undefined }),
  version(3, '2026-07-01', '2027-06-30'),
  version(2, '2026-01-01', '2026-06-30'),
]

const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search + useLocation().hash}</span>
const renderSection = () => render(
  <MemoryRouter initialEntries={['/participants/p-1']}>
    <Routes><Route path="*" element={<><AgreementsSection participantId="p-1" /><Where /></>} /></Routes>
  </MemoryRouter>,
)
const row = (n: number) => screen.getByRole('row', { name: new RegExp(`Version ${n}\\b`) })
const action = (n: number, name: string | RegExp) => within(row(n)).queryByRole('button', { name }) ?? within(row(n)).queryByRole('link', { name })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T10:00:00') })
  listState = { data: mixed() }
  for (const m of [refetch, deleteMutate, endMutate, pdfMutate]) m.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('AgreementsSection: the table', () => {
  it('lists the columns in order, with an unnamed Actions column last', () => {
    renderSection()
    const heads = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(heads.slice(0, 5)).toEqual(['Version', 'Status', 'Term', 'Total', 'Approved'])
    expect(heads).toHaveLength(6)
  })

  it('shows one badge per status, with the term and the approval line', () => {
    renderSection()
    expect(within(row(4)).getByText('Draft')).toBeInTheDocument()
    expect(within(row(3)).getByText('Approved')).toBeInTheDocument()
    expect(within(row(2)).getByText('Ended')).toBeInTheDocument()
    expect(within(row(3)).getByText('20 Jun 2026 · Sam Lee')).toBeInTheDocument()
    expect(within(row(4)).getByText('—')).toBeInTheDocument()
  })
})

describe('AgreementsSection: actions per status', () => {
  it('newest Draft: Edit, and Delete draft', () => {
    renderSection()
    expect(action(4, 'Edit')).toHaveAttribute('href', '/participants/p-1/agreement-draft')
    expect(action(4, 'Delete draft')).toBeInTheDocument()
    expect(action(4, /End early/)).toBeNull()
  })

  it('a running approved row below the draft: PDF and End early, but no New revision', () => {
    renderSection()
    expect(action(3, /End early/)).toBeInTheDocument()
    expect(action(3, 'New revision')).toBeNull()
    expect(action(3, 'PDF')).toBeInTheDocument()
  })

  it('the newest approved row: Open, New revision (?revise=1), End early, Download PDF', () => {
    listState = { data: [version(3, '2026-07-01', '2027-06-30')] }
    renderSection()
    expect(action(3, 'Open')).toHaveAttribute('href', '/participants/p-1/agreement-draft')
    expect(action(3, 'New revision')).toBeInTheDocument()
    expect(action(3, /End early/)).toBeInTheDocument()
    expect(action(3, 'Download PDF')).toBeInTheDocument()
  })

  it('an ended row offers only the PDF', () => {
    renderSection()
    expect(action(2, 'PDF')).toBeInTheDocument()
    expect(action(2, /End early/)).toBeNull()
    expect(action(2, 'Delete draft')).toBeNull()
  })

  it('S1: an approved row with a newer approved revision starting on or before its end offers no End early', () => {
    listState = { data: [version(5, '2027-03-01', '2027-06-30'), version(4, '2026-07-01', '2027-06-30')] }
    renderSection()
    expect(action(4, /End early/)).toBeNull()
    expect(action(5, /End early/)).toBeInTheDocument()
  })

  it('a renewal starting after the end does not hide End early on the running row', () => {
    listState = { data: [version(5, '2027-07-01', '2028-06-30'), version(4, '2026-07-01', '2027-06-30')] }
    renderSection()
    expect(action(4, /End early/)).toBeInTheDocument()
  })

  it('New revision goes to the draft page with revise=1', async () => {
    vi.useRealTimers()
    listState = { data: [version(3, '2026-07-01', '2027-06-30')] }
    renderSection()
    await userEvent.click(action(3, 'New revision')!)
    expect(screen.getByTestId('where')).toHaveTextContent('/participants/p-1/agreement-draft?revise=1')
  })

  it('Download PDF calls the download with the participant and the version id', async () => {
    vi.useRealTimers()
    renderSection()
    await userEvent.click(action(2, 'PDF')!)
    expect(pdfMutate).toHaveBeenCalledWith({ participantId: 'p-1', id: 'd-2' })
  })
})

describe('AgreementsSection: New agreement', () => {
  it('is hidden while a version is Draft or Approved', () => {
    renderSection()
    expect(screen.queryByRole('link', { name: 'New agreement' })).toBeNull()
  })

  it('shows when the newest has ended and goes to the draft page with no revise', async () => {
    vi.useRealTimers()
    listState = { data: [version(2, '2025-07-01', '2026-06-30')] }
    renderSection()
    await userEvent.click(screen.getByRole('link', { name: 'New agreement' }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/participants\/p-1\/agreement-draft$/)
  })
})

describe('AgreementsSection: Delete draft', () => {
  const open = async () => {
    vi.useRealTimers()
    renderSection()
    await userEvent.click(action(4, 'Delete draft')!)
    return screen.getByRole('alertdialog')
  }

  it('asks in the plan words, and Keep draft has focus', async () => {
    const dialog = await open()
    expect(within(dialog).getByText('Delete draft version 4?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent("This draft was never approved. Deleting it can't be undone. Version 3 stays as it is.")
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Keep draft' })).toHaveFocus())
  })

  it('Delete draft sends the participant and draft id', async () => {
    const dialog = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    expect(deleteMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-4' }, expect.any(Object))
  })

  it('a 409 shows the server words inline and the dialog stays open', async () => {
    deleteMutate.mockImplementation((_v, o) => o.onError({ response: { data: { errors: ['Version 4 is already approved.'] } } }))
    const dialog = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Version 4 is already approved.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('on success the dialog closes and focus moves to the section heading', async () => {
    deleteMutate.mockImplementation((_v, o) => { listState = { data: mixed().slice(1) }; o.onSuccess() })
    const dialog = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Agreements' })).toHaveFocus())
  })
})

describe('AgreementsSection: End early', () => {
  const open = async () => {
    vi.useRealTimers()
    renderSection()
    await userEvent.click(action(3, /End early/)!)
    return screen.getByRole('alertdialog')
  }
  const dateField = (dialog: HTMLElement) => within(dialog).getByLabelText('Last day of support') as HTMLInputElement

  it('says what it does, with the date empty and bounded by the start and the day before the end', async () => {
    const dialog = await open()
    expect(within(dialog).getByText('End version 3 early?')).toBeInTheDocument()
    expect(within(dialog).getByText(/^It runs from 1 Jul 2026 to 30 Jun 2027\. Choose the last day of support\./)).toBeInTheDocument()
    const input = dateField(dialog)
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('min', '2026-07-01')
    expect(input).toHaveAttribute('max', '2027-06-29')
    expect(within(dialog).getByRole('button', { name: 'End early' })).toBeDisabled()
  })

  it('an out-of-range day keeps End early disabled and shows the range hint', async () => {
    const dialog = await open()
    await userEvent.type(dateField(dialog), '2027-06-30')
    expect(within(dialog).getByText('Choose a day from 1 Jul 2026 to 29 Jun 2027.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'End early' })).toBeDisabled()
  })

  it('a valid day enables it and sends the last day', async () => {
    const dialog = await open()
    await userEvent.type(dateField(dialog), '2026-11-15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'End early' }))
    expect(endMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-3', lastDay: '2026-11-15' }, expect.any(Object))
  })

  it('a 409 shows the server words inline and the dialog stays open', async () => {
    endMutate.mockImplementation((_v, o) => o.onError({ response: { data: { errors: ['Version 4 is waiting. Approve or delete it first.'] } } }))
    const dialog = await open()
    await userEvent.type(dateField(dialog), '2026-11-15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'End early' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Version 4 is waiting. Approve or delete it first.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('on success a status line gives the kept and removed counts, with an Open roster link', async () => {
    endMutate.mockImplementation((_v, o) => o.onSuccess({ agreementEndDate: '2026-11-15', oldShiftsRemaining: { open: 1, assigned: 2, removed: 4 } }))
    const dialog = await open()
    await userEvent.type(dateField(dialog), '2026-11-15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'End early' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Version 3 now ends 15 Nov 2026.')
    expect(status).toHaveTextContent('3 shifts after it are still on the roster: cancel or move them.')
    expect(status).toHaveTextContent('4 unfilled draft shifts were removed.')
    expect(within(status).getByRole('link', { name: 'Open roster' })).toHaveAttribute('href', '/participants/p-1?tab=people#roster')
  })

  it('on success focus returns to the row it came from', async () => {
    endMutate.mockImplementation((_v, o) => o.onSuccess({ agreementEndDate: '2026-11-15', oldShiftsRemaining: { open: 0, assigned: 0 } }))
    const dialog = await open()
    await userEvent.type(dateField(dialog), '2026-11-15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'End early' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(row(3).contains(document.activeElement)).toBe(true))
  })
})

describe('AgreementsSection: states', () => {
  it('loading', () => {
    listState = { isLoading: true }
    renderSection()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('error offers Try again, which refetches', async () => {
    vi.useRealTimers()
    listState = { isError: true }
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('empty: the plan copy and a New agreement action', () => {
    listState = { data: [] }
    renderSection()
    expect(screen.getByText('No service agreements yet')).toBeInTheDocument()
    expect(screen.getByText("Create one to price this participant's supports and roster them once it's approved.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New agreement' })).toBeInTheDocument()
  })
})
