import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { BatchDetailDto, BatchDto, HubLineDto, HubLinesDto, RejectedLineDto, ResultsImportDto } from '@/api/types'
import { ClaimFileError } from '@/api/hooks/claimHub'
import ClaimsHubPage from './ClaimsHubPage'

// The NDIA claims hub page. The API layer is mocked at the hook; fetchClaimFile (the build and download) is mocked as the server's answer.

const m = vi.hoisted(() => ({
  lines: vi.fn(), batches: vi.fn(), batch: vi.fn(), fetchClaimFile: vi.fn(), preview: vi.fn(),
  uploaded: vi.fn(), discard: vi.fn(), importResults: vi.fn(), paid: vi.fn(), dismiss: vi.fn(),
}))
vi.mock('@/api/hooks/claimHub', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/claimHub')>('@/api/hooks/claimHub')
  const mutation = (fn: ReturnType<typeof vi.fn>) => () => ({ mutate: fn, isPending: false, isError: false, error: null, reset: vi.fn() })
  return {
    ClaimFileError: actual.ClaimFileError,
    useHubLines: m.lines, useClaimBatches: m.batches, useClaimBatch: m.batch, fetchClaimFile: m.fetchClaimFile, useBuildClaimFile: () => m.fetchClaimFile,
    useMarkBatchUploaded: mutation(m.uploaded), useDiscardBatch: mutation(m.discard), useImportResults: mutation(m.importResults),
    useMarkBatchPaid: mutation(m.paid), useDismissBatchLine: mutation(m.dismiss),
  }
})
vi.mock('@/api/hooks/claims', () => ({ useSubmitPreview: m.preview }))

const query = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() })

function line(over: Partial<HubLineDto> = {}): HubLineDto {
  return {
    lineId: 'l-1', claimId: 'c-1', claimReference: 'TC-1', claimKind: 'shift', participantId: 'p-1', participantName: 'Alex Park',
    supportNumber: '01_011_0107_1_1', from: '2026-08-01', to: '2026-08-01', hours: 2.5, unitPrice: 70, totalAmount: 175, gstCode: 'P2',
    claimType: '', fundingType: 'agency', ageDays: 20, ageBand: 'none', nextAttempt: 1, problems: [], ...over,
  }
}
function rejected(over: Partial<RejectedLineDto> = {}): RejectedLineDto {
  return { ...line(), batchLineId: 'bl-1', batchId: 'b-1', fileName: 'BPR261020001.csv', rejectCode: 'V17', rejectMessage: 'Insufficient funds', needsDecision: true,
    hint: "Their budget doesn't cover this line.", rejectedAt: '2026-10-21T00:00:00Z', ...over }
}
function batch(over: Partial<BatchDto> = {}): BatchDto {
  return { id: 'b-1', fileName: 'BPR261030001.csv', status: 'Built', createdAt: '2026-10-30T01:00:00Z', createdByName: 'Sam Lee', lineCount: 2, totalAmount: 350,
    pending: 2, successful: 0, rejected: 0, withdrawn: 0, paid: 0, paidAmount: 0, ...over }
}
const detail = (over: Partial<BatchDetailDto> = {}): BatchDetailDto => ({
  ...batch(), lines: [
    { batchLineId: 'bl-1', claimId: 'c-1', participantName: 'Alex Park', supportNumber: 'x', from: '2026-08-01', to: '2026-08-01', amount: 175, attempt: 1, rowReference: 'R1', outcome: 'Pending' },
    { batchLineId: 'bl-2', claimId: 'c-1', participantName: 'Alex Park', supportNumber: 'y', from: '2026-08-02', to: '2026-08-02', amount: 175, attempt: 1, rowReference: 'R2', outcome: 'Pending' },
  ], ...over,
})
const hub = (over: Partial<HubLinesDto> = {}): HubLinesDto => ({ ready: [], rejected: [], managed: [], ...over })

function Where() {
  return <output data-testid="where">{useLocation().search}</output>
}
function renderPage(entry = '/claims') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/claims" element={<><ClaimsHubPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  m.lines.mockReturnValue(query(hub()))
  m.batches.mockReturnValue(query([]))
  m.batch.mockReturnValue({ ...query(undefined), isLoading: false })
  m.preview.mockReturnValue({ data: { claims: [], invoiceCount: 2 }, isLoading: false })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('ClaimsHubPage: Ready to send', () => {
  it('badges the tabs with their counts and marks ages at 59, 60, 80 and 91 days by band', () => {
    m.lines.mockReturnValue(query(hub({ ready: [
      line({ lineId: 'a', ageDays: 59, ageBand: 'none' }), line({ lineId: 'b', ageDays: 60, ageBand: 'amber' }),
      line({ lineId: 'c', ageDays: 80, ageBand: 'red' }), line({ lineId: 'd', ageDays: 91, ageBand: 'over90' }),
    ], rejected: [rejected()] })))
    renderPage()

    expect(screen.getByRole('tab', { name: /Ready to send/ })).toHaveTextContent('4')
    expect(screen.getByRole('tab', { name: /Needs action/ })).toHaveTextContent('1')
    expect(screen.getByText('59 days').closest('[data-tone]')).toHaveAttribute('data-tone', 'none')
    expect(screen.getByText('60 days').closest('[data-tone]')).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByText('80 days').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByText('Over 90 days').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')
  })

  it("won't tick a blocked line, and says why", () => {
    m.lines.mockReturnValue(query(hub({ ready: [line({ lineId: 'bad', problems: [{ rule: 'PriceLimit', severity: 'block', message: 'The price is over the limit' }] })] })))
    renderPage()

    const box = within(screen.getByTestId('claims-panel-ready')).getAllByRole('checkbox').find(b => b.getAttribute('aria-describedby'))!
    expect(box).toBeDisabled()
    expect(document.getElementById(box.getAttribute('aria-describedby')!)).toHaveTextContent('The price is over the limit')
  })

  it('builds a file from the ticked lines, announces it and opens its panel', async () => {
    const user = userEvent.setup()
    m.lines.mockReturnValue(query(hub({ ready: [line({ lineId: 'l-1' }), line({ lineId: 'l-2', claimId: 'c-2' })] })))
    m.fetchClaimFile.mockResolvedValue({ batchId: 'b-9', fileName: 'BPR261030009.csv' })
    renderPage()

    const boxes = within(screen.getByTestId('claims-panel-ready')).getAllByRole('checkbox')
    await user.click(boxes[boxes.length - 1])
    await user.click(screen.getByTestId('claims-build'))

    expect(m.fetchClaimFile).toHaveBeenCalledWith('post', '/claim-batches', { lineIds: ['l-2'] }, expect.any(String), expect.any(String))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('file=b-9'))
    expect(screen.getByText("BPR261030009.csv built with 1 line. It's downloading.")).toBeInTheDocument()
  })

  it("shows the server's refusal and names the lines that failed", async () => {
    const user = userEvent.setup()
    const { ClaimFileError } = await import('@/api/hooks/claimHub')
    m.lines.mockReturnValue(query(hub({ ready: [line()] })))
    m.fetchClaimFile.mockRejectedValue(new ClaimFileError('Some lines failed.', 400, [{ lineId: 'l-1', claimReference: 'TC-1', rule: 'PriceLimit', message: 'Price over the limit' }]))
    renderPage()

    await user.click(within(screen.getByTestId('claims-panel-ready')).getAllByRole('checkbox').at(-1)!)
    await user.click(screen.getByTestId('claims-build'))

    expect(await screen.findByText("The file wasn't built")).toBeInTheDocument()
    expect(screen.getByText(/Price over the limit/)).toBeInTheDocument()
  })
})

describe('ClaimsHubPage: files', () => {
  it('shows at most 3 unfinished files in the strip, and none when every file is done', () => {
    m.batches.mockReturnValue(query([
      batch({ id: '1', fileName: 'F1.csv' }), batch({ id: '2', fileName: 'F2.csv', status: 'Uploaded' }), batch({ id: '3', fileName: 'F3.csv' }),
      batch({ id: '4', fileName: 'F4.csv' }), batch({ id: '5', fileName: 'F5.csv', status: 'Discarded' }),
    ]))
    renderPage()
    expect(within(screen.getByTestId('claims-strip')).getAllByTestId('strip-file-name')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'See all 4 in Files' })).toBeInTheDocument()

    cleanup()
    m.batches.mockReturnValue(query([batch({ status: 'Discarded' })]))
    renderPage()
    expect(screen.queryByTestId('claims-strip')).toBeNull()
  })

  it('confirms the upload with the claim and invoice counts, then marks the file uploaded', async () => {
    const user = userEvent.setup()
    m.batch.mockReturnValue(query(detail()))
    renderPage('/claims?file=b-1')

    await user.click(within(screen.getByTestId('file-panel')).getByTestId('file-next-action'))
    expect(screen.getByText(/This marks 1 claim as submitted and issues 2 invoices/)).toBeInTheDocument()
    expect(m.preview).toHaveBeenLastCalledWith(['c-1'], true)
    // The step card and the dialog both say it; the dialog is the last one open.
    await user.click(screen.getAllByRole('button', { name: "I've uploaded it" }).at(-1)!)
    expect(m.uploaded).toHaveBeenCalledWith('b-1', expect.anything())
  })

  it('holds Import results until a file is chosen, then shows what was left alone and what was not in the file', async () => {
    const user = userEvent.setup()
    m.batch.mockReturnValue(query(detail({ status: 'Uploaded' })))
    const summary: ResultsImportDto = { successful: 3, rejected: 1, unchanged: 0, leftAlone: 2, conflicts: [], unknownReferences: ['X1'], unreadRows: [], batch: batch() }
    m.importResults.mockImplementation((_v, o) => o.onSuccess(summary))
    renderPage('/claims?file=b-1')

    const run = screen.getByTestId('file-next-action')
    expect(run).toHaveAttribute('aria-disabled', 'true')
    await user.click(run)
    expect(m.importResults).not.toHaveBeenCalled()

    const file = new File(['a'], 'results.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Results file (.csv)'), file)
    await user.click(screen.getByTestId('file-next-action'))

    expect(m.importResults).toHaveBeenCalledWith({ batchId: 'b-1', file }, expect.anything())
    expect(await screen.findByText('Results imported')).toBeInTheDocument()
    expect(screen.getByText('2 lines already had a result and were left alone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 line in the file weren't in BPR261030001/ })).toBeInTheDocument()
  })

  it("says the results belong to another file when none of the lines match", async () => {
    const user = userEvent.setup()
    m.batch.mockReturnValue(query(detail({ status: 'Uploaded' })))
    m.importResults.mockImplementation((_v, o) => o.onSuccess({ successful: 0, rejected: 0, unchanged: 0, leftAlone: 0, conflicts: [], unknownReferences: ['X1'], unreadRows: [], batch: batch() }))
    renderPage('/claims?file=b-1')

    await user.upload(screen.getByLabelText('Results file (.csv)'), new File(['a'], 'r.csv'))
    await user.click(screen.getByTestId('file-next-action'))
    expect(await screen.findByText(/None of the lines in this file belong to BPR261030001/)).toBeInTheDocument()
  })
})

describe('ClaimsHubPage: Needs action', () => {
  it('puts decisions first, and sends a decided line again with its confirmation', async () => {
    const user = userEvent.setup()
    m.lines.mockReturnValue(query(hub({ rejected: [
      rejected({ batchLineId: 'f1', lineId: 'x1', rejectCode: 'C38', needsDecision: false, hint: 'Lower the price.' }),
      rejected({ batchLineId: 'd1', lineId: 'x2', rejectCode: 'V17' }),
    ] })))
    m.fetchClaimFile.mockResolvedValue({ batchId: 'b-7', fileName: 'BPR261030007.csv' })
    renderPage('/claims?tab=action')

    const titles = within(screen.getByTestId('claims-panel-action')).getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(titles).toEqual(['V17 Not enough funding left', 'C38 Price over the limit'])

    // The V17 group comes first, so its "Send again…" is the first row button of that name.
    await user.click(screen.getAllByRole('button', { name: /^Send again: / })[0])
    expect(m.fetchClaimFile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Send again' }))
    expect(m.fetchClaimFile).toHaveBeenCalledWith('post', '/claim-batches', { lineIds: ['x2'], confirmedLineIds: ['x2'] }, expect.any(String), expect.any(String))
  })
})

describe('ClaimsHubPage: finish round 2', () => {
  it('orders Needs action columns so the NDIA message and Age come before the wide ones', () => {
    m.lines.mockReturnValue(query(hub({ rejected: [rejected()] })))
    renderPage('/claims?tab=action')

    const table = within(screen.getByTestId('claims-panel-action')).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Participant', 'NDIA message', 'Amount', 'Age', 'Delivered', 'Support item', 'Claim', 'File', 'Actions'])
  })

  it('renders no hint line and no double gap in the confirm when the server sends an empty hint', async () => {
    const user = userEvent.setup()
    m.lines.mockReturnValue(query(hub({ rejected: [rejected({ hint: '' })] })))
    renderPage('/claims?tab=action')

    const panel = screen.getByTestId('claims-panel-action')
    expect([...panel.querySelectorAll('p')].filter(p => !p.textContent?.trim())).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /^Send again: / }))
    expect(screen.getByText(/The NDIA rejected it as V17/).textContent).not.toContain('  ')
  })

  it('marks a passing Ready line so its Checks cell can leave the phone card, and a blocked line keeps its reason', () => {
    m.lines.mockReturnValue(query(hub({ ready: [
      line({ lineId: 'ok', participantName: 'Alex Park' }),
      line({ lineId: 'bad', claimId: 'c-2', claimReference: 'TC-2', participantName: 'Bo Reed', problems: [{ rule: 'PriceLimit', severity: 'block', message: 'The price is over the limit' }] }),
    ] })))
    renderPage()

    const rows = within(screen.getByTestId('claims-panel-ready')).getAllByRole('row')
    const ok = rows.find(r => r.textContent?.includes('Alex Park'))!
    const bad = rows.find(r => r.textContent?.includes('Bo Reed'))!
    expect(ok.querySelector('[data-pass]')).not.toBeNull()
    expect(bad.querySelector('[data-pass]')).toBeNull()
    expect(bad).toHaveTextContent('The price is over the limit')
  })

  it('shows delivered dates with a month name, ranges keeping the year', () => {
    m.lines.mockReturnValue(query(hub({ ready: [line({ from: '2026-07-31', to: '2026-08-02' })], rejected: [rejected({ from: '2026-08-12', to: '2026-08-12' })] })))
    renderPage()
    expect(screen.getByText('31 Jul – 2 Aug 2026')).toBeInTheDocument()
  })

  it('names the Built date in the Files table with a month name', () => {
    m.batches.mockReturnValue(query([batch()]))
    renderPage('/claims?tab=files')
    expect(within(screen.getByTestId('claims-panel-files')).getByText(/30 Oct 2026/)).toBeInTheDocument()
  })
})

describe('ClaimsHubPage: decisions and errors', () => {
  it('takes a decision from the server per line, even for a code the page has no title for', async () => {
    const user = userEvent.setup()
    m.lines.mockReturnValue(query(hub({ rejected: [
      rejected({ batchLineId: 'u1', lineId: 'x9', rejectCode: 'Z99', needsDecision: true }),
      rejected({ batchLineId: 'u2', lineId: 'x8', rejectCode: 'Y11', needsDecision: false }),
    ] })))
    m.fetchClaimFile.mockResolvedValue({ batchId: 'b-7', fileName: 'BPR261030007.csv' })
    renderPage('/claims?tab=action')

    const panel = within(screen.getByTestId('claims-panel-action'))
    expect(panel.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Other codes', 'Other codes'])
    expect(panel.getAllByRole('button', { name: /^Don't claim: / })).toHaveLength(1)
    expect(panel.getAllByRole('link', { name: /^Fix: / })).toHaveLength(1)
    await user.click(panel.getByText('Send again…'))
    expect(m.fetchClaimFile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Send again' }))
    expect(m.fetchClaimFile).toHaveBeenCalledWith('post', '/claim-batches', { lineIds: ['x9'], confirmedLineIds: ['x9'] }, expect.any(String), expect.any(String))
  })

  it("shows a refused Send again inside the open dialog, with the first failed line's message", async () => {
    const user = userEvent.setup()
    m.lines.mockReturnValue(query(hub({ rejected: [rejected({ lineId: 'x2' })] })))
    m.fetchClaimFile.mockRejectedValue(new ClaimFileError('1 line did not pass the checks.', 409, [{ lineId: 'x2', claimReference: 'TC-1', rule: 'Funding', message: 'Over the funding left' }]))
    renderPage('/claims?tab=action')

    await user.click(screen.getAllByRole('button', { name: /^Send again: / })[0])
    await user.click(screen.getByRole('button', { name: 'Send again' }))
    expect(await within(screen.getByRole('alertdialog')).findByText(/1 line did not pass the checks\. Over the funding left/)).toBeInTheDocument()
  })
})

describe('ClaimsHubPage: file panel', () => {
  const resultsIn = (over: Partial<BatchDetailDto> = {}) => detail({
    status: 'ResultsImported', successful: 1, rejected: 1, pending: 0, paid: 0,
    lines: [
      { batchLineId: 'bl-1', claimId: 'c-1', participantName: 'Alex Park', supportNumber: 'x', from: '2026-08-01', to: '2026-08-01', amount: 175, attempt: 1, rowReference: 'R1', outcome: 'Successful', resultAmount: 175 },
      { batchLineId: 'bl-2', claimId: 'c-1', participantName: 'Alex Park', supportNumber: 'y', from: '2026-08-02', to: '2026-08-02', amount: 175, attempt: 1, rowReference: 'R2', outcome: 'Rejected', rejectCode: 'V17' },
    ], ...over,
  })

  it('Review rejected lines closes the file and opens Needs action filtered to it', async () => {
    const user = userEvent.setup()
    m.batch.mockReturnValue(query(resultsIn()))
    m.lines.mockReturnValue(query(hub({ rejected: [rejected()] })))
    renderPage('/claims?tab=files&file=b-1')

    await user.click(screen.getByRole('button', { name: 'Review 1 rejected line' }))
    expect(screen.getByTestId('where').textContent).not.toContain('file=')
    expect(screen.getByTestId('where')).toHaveTextContent('tab=action')
    expect(await screen.findByText(/Showing rejected lines from/)).toBeInTheDocument()
  })

  it("shows a line's reject code inside its Outcome cell, with no Code column", () => {
    m.batch.mockReturnValue(query(resultsIn()))
    renderPage('/claims?tab=files&file=b-1')

    const table = within(screen.getByRole('dialog')).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Participant', 'Outcome', 'Amount', 'Support item', 'Delivered'])
    const [ok, rejectedRow] = within(table).getAllByRole('row').slice(1)
    expect(within(rejectedRow).getByText('V17')).toBeInTheDocument()
    expect(ok.textContent).not.toContain('V17')
  })

  it('reads dates the house way: ranges with a month name, and no stray full stop after the file name', () => {
    m.batch.mockReturnValue(query(detail()))
    renderPage('/claims?tab=files&file=b-1')

    const panel = within(screen.getByRole('dialog'))
    expect(panel.getByText(/^Built 30 Oct 2026 by Sam Lee/)).toBeInTheDocument()
    expect(panel.getAllByText('1 Aug 2026').length).toBeGreaterThan(0)
    expect(screen.getByTestId('file-step-name').closest('li')!.textContent).toBe('Upload BPR261030001.csv')
  })

  it('will not mark a line paid with a cleared amount, and says so', async () => {
    const user = userEvent.setup()
    m.batch.mockReturnValue(query(resultsIn({ rejected: 0 })))
    renderPage('/claims?file=b-1')

    await user.click(screen.getByRole('button', { name: 'Mark 1 line as paid' }))
    await user.clear(screen.getByLabelText('Paid for Alex Park'))
    await user.click(screen.getByRole('button', { name: 'Mark as paid' }))
    expect(m.paid).not.toHaveBeenCalled()
    expect(screen.getByText('Enter the amount paid.')).toBeInTheDocument()
  })

  it('counts a file with no successful lines as finished: no badge, no strip, no Mark paid', () => {
    m.batches.mockReturnValue(query([batch({ status: 'ResultsImported', successful: 0, rejected: 2, pending: 0, paid: 0 })]))
    m.batch.mockReturnValue(query(resultsIn({ successful: 0, rejected: 2 })))
    renderPage('/claims?tab=files')

    expect(screen.getByRole('tab', { name: /^Files/ })).not.toHaveTextContent(/\d/)
    expect(screen.queryByTestId('claims-strip')).toBeNull()
    expect(screen.getByText('Results in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Mark paid/ })).toBeNull()

    cleanup()
    renderPage('/claims?file=b-1')
    expect(screen.queryByRole('button', { name: /Mark 0 lines as paid/ })).toBeNull()
  })

  it('holds the upload confirm and offers Try again when the invoice check fails', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    m.batch.mockReturnValue(query(detail()))
    m.preview.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderPage('/claims?file=b-1')

    await user.click(screen.getByTestId('file-next-action'))
    const dialog = within(screen.getByRole('alertdialog'))
    expect(dialog.getByText("Couldn't check which invoices this issues.")).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: "I've uploaded it" })).toBeDisabled()
    await user.click(dialog.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
  })
})

describe('ClaimsHubPage: no organisation', () => {
  it('asks a SuperAdmin to choose one in place of the tabs', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin' }))
    renderPage()
    expect(screen.getByText('Choose an organisation to see its claims.')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
