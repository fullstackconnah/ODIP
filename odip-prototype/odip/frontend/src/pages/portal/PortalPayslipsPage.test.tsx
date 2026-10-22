import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PortalPayslipsPage from './PortalPayslipsPage'
import type { PortalPayslipDto, PortalPayslipsDto } from '@/api/types'

const { mockUseMyPayslips, mockDownload } = vi.hoisted(() => ({ mockUseMyPayslips: vi.fn(), mockDownload: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useMyPayslips: mockUseMyPayslips,
  useDownloadPayslip: () => ({ mutateAsync: mockDownload }),
}))

const slip = (over: Partial<PortalPayslipDto>): PortalPayslipDto => ({
  payRunId: 9012, datePaid: '2026-10-08', periodStart: '2026-09-22', periodEnd: '2026-10-05', paySchedule: 'Fortnightly', ...over,
})
const ROWS = [
  slip({}),
  slip({ payRunId: 9011, datePaid: '2026-09-24', periodStart: '2026-09-08', periodEnd: '2026-09-21' }),
]
const ready = (payslips: PortalPayslipDto[], status: PortalPayslipsDto['status'] = 'Ready') =>
  ({ data: { status, payslips }, isLoading: false, isError: false, error: null, isFetching: false, errorUpdateCount: 0, refetch: vi.fn() })
const httpError = (status: number, message?: string) => ({ response: { status, data: message ? { errors: [message] } : {} } })
const failed = (status: number, message?: string) =>
  ({ data: undefined, isLoading: false, isError: true, error: httpError(status, message), isFetching: false, errorUpdateCount: 1, refetch: vi.fn() })

function renderPage() {
  return render(<MemoryRouter><PortalPayslipsPage /></MemoryRouter>)
}
const downloadButton = (name: RegExp | string) => screen.getByRole('button', { name })

beforeEach(() => {
  localStorage.clear()
  mockUseMyPayslips.mockReset()
  mockDownload.mockReset()
  mockDownload.mockResolvedValue(undefined)
  mockUseMyPayslips.mockReturnValue(ready(ROWS))
})

describe('PortalPayslipsPage', () => {
  it('lists the payslips newest first with one Download PDF button each', () => {
    renderPage()
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['My payslips'])
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('8 Oct 2026')
    expect(rows[0]).toHaveTextContent('22 Sep – 5 Oct 2026')
    expect(rows[0]).toHaveTextContent('Fortnightly')
    expect(rows[1]).toHaveTextContent('24 Sep 2026')
    expect(within(rows[0]).getByRole('button', { name: 'Download PDF: payslip paid 8 Oct 2026' })).toHaveTextContent('Download PDF')
    expect(screen.getAllByRole('button', { name: /^Download PDF/ })).toHaveLength(2)
  })

  it('draws the header and says "Loading payslips…" while loading', () => {
    mockUseMyPayslips.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, isFetching: true, errorUpdateCount: 0, refetch: vi.fn() })
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'My payslips' })).toBeInTheDocument()
    expect(screen.getByText('Loading payslips…')).toHaveAttribute('role', 'status')
  })

  it('shows an en dash for a missing period and schedule', () => {
    mockUseMyPayslips.mockReturnValue(ready([slip({ periodStart: null, periodEnd: null, paySchedule: null })]))
    renderPage()
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('–')
    expect(screen.getAllByRole('row')[1].textContent?.match(/–/g)).toHaveLength(2)
  })

  it('says plainly when the organisation is not connected', () => {
    mockUseMyPayslips.mockReturnValue(ready([], 'NotConnected'))
    renderPage()
    expect(screen.getByText("Payslips aren't available in ODIP")).toBeInTheDocument()
    expect(screen.getByText("Your organisation doesn't connect its payroll to ODIP. Ask your manager where to find your payslips.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('says when the account is not linked', () => {
    mockUseMyPayslips.mockReturnValue(ready([], 'NotLinked'))
    renderPage()
    expect(screen.getByText("Your account isn't linked to Employment Hero yet")).toBeInTheDocument()
    expect(screen.getByText("ODIP can't find your payslips until an Admin links you. Ask your manager or an Admin; they appear here once you're linked.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no payslips yet', () => {
    mockUseMyPayslips.mockReturnValue(ready([]))
    renderPage()
    expect(screen.getByText('No payslips yet')).toBeInTheDocument()
    expect(screen.getByText('Your payslips appear here after your first pay run in Employment Hero.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says payslips are private on a 403', () => {
    mockUseMyPayslips.mockReturnValue(failed(403, 'Payslips are private'))
    renderPage()
    expect(screen.getByText('Payslips are private')).toBeInTheDocument()
    expect(screen.getByText('Only the staff member can open their payslips, signed in as themselves.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('shows the house error with the server reason, and keeps it through a retry', () => {
    const reason = "Employment Hero can't be reached right now. Try again in a few minutes."
    mockUseMyPayslips.mockReturnValue(failed(503, reason))
    const { rerender } = renderPage()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText(reason)).toBeInTheDocument()

    mockUseMyPayslips.mockReturnValue({ ...failed(503, reason), isLoading: true, isError: false, isFetching: true })
    rerender(<MemoryRouter><PortalPayslipsPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Loading payslips…')).not.toBeInTheDocument()
  })

  it('draws no reason line when the network is down', () => {
    mockUseMyPayslips.mockReturnValue({ ...failed(503), error: new Error('Network Error') })
    renderPage()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(document.querySelector('p.text-\\[13px\\]')).toBeNull()
  })

  it('holds the pressed row while it downloads, and other rows stay usable', async () => {
    const user = userEvent.setup()
    mockDownload.mockReturnValue(new Promise(() => undefined))
    renderPage()

    await user.click(downloadButton('Download PDF: payslip paid 8 Oct 2026'))

    const pending = screen.getByRole('button', { name: 'Downloading payslip paid 8 Oct 2026' })
    expect(pending).toBeDisabled()
    expect(pending).toHaveTextContent('Downloading…')
    expect(pending).toHaveAttribute('aria-busy', 'true')
    const other = downloadButton('Download PDF: payslip paid 24 Sep 2026')
    expect(other).toBeEnabled()
    await user.click(other)
    expect(mockDownload).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Downloading payslip paid 8 Oct 2026' })).toBeDisabled()
  })

  it('names the payslip that failed, shows the server reason, and retries the same one', async () => {
    const user = userEvent.setup()
    const reason = "Payslips can't be shown right now: an Admin needs to check the Employment Hero connection."
    // the PDF request is responseType 'blob', so the error body arrives as a Blob
    mockDownload.mockRejectedValueOnce({ response: { status: 503, data: new Blob([JSON.stringify({ errors: [reason] })], { type: 'application/json' }) } })
    renderPage()

    await user.click(downloadButton('Download PDF: payslip paid 8 Oct 2026'))

    expect(await screen.findByText("Couldn't download the payslip paid 8 Oct 2026.")).toBeInTheDocument()
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh list' })).not.toBeInTheDocument()
    expect(downloadButton('Download PDF: payslip paid 8 Oct 2026')).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(mockDownload).toHaveBeenLastCalledWith({ payRunId: 9012, datePaid: '2026-10-08' })
    await waitFor(() => expect(screen.queryByText(/Couldn't download/)).not.toBeInTheDocument())
  })

  it('says to try again later when the server sent no reason', async () => {
    const user = userEvent.setup()
    mockDownload.mockRejectedValueOnce(httpError(503))
    renderPage()

    await user.click(downloadButton('Download PDF: payslip paid 24 Sep 2026'))

    expect(await screen.findByText("Couldn't download the payslip paid 24 Sep 2026.")).toBeInTheDocument()
    expect(screen.getByText('Try again in a few minutes.')).toBeInTheDocument()
  })

  it('on a 404 offers Refresh list, not Try again, and clears the failure when the refresh settles with the same list', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn().mockResolvedValue({})
    mockUseMyPayslips.mockReturnValue({ ...ready(ROWS), refetch })   // the same data object on every render, as react-query's structural sharing gives
    mockDownload.mockRejectedValueOnce(httpError(404))
    renderPage()

    await user.click(downloadButton('Download PDF: payslip paid 8 Oct 2026'))

    expect(await screen.findByText('Employment Hero no longer has it. Refresh the list.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh list' }))

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(mockDownload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText(/Couldn't download/)).not.toBeInTheDocument())
  })

  it('keeps the failure, with Refresh list, when the refresh itself fails', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn().mockResolvedValue({ isError: true })
    mockUseMyPayslips.mockReturnValue({ ...ready(ROWS), refetch })
    mockDownload.mockRejectedValueOnce(httpError(404))
    renderPage()

    await user.click(downloadButton('Download PDF: payslip paid 8 Oct 2026'))
    await user.click(await screen.findByRole('button', { name: 'Refresh list' }))

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    expect(screen.getByText("Couldn't download the payslip paid 8 Oct 2026.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh list' })).toBeEnabled()
  })

  it('brings the failure into view when it appears, since the pressed row can be far down the list', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    mockDownload.mockRejectedValueOnce(httpError(503))
    renderPage()
    expect(scrollIntoView).not.toHaveBeenCalled()

    await user.click(downloadButton('Download PDF: payslip paid 24 Sep 2026'))

    await screen.findByText("Couldn't download the payslip paid 24 Sep 2026.")
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.contexts[0]).toHaveTextContent("Couldn't download the payslip paid 24 Sep 2026.")
  })

  it('announces a finished download', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(downloadButton('Download PDF: payslip paid 8 Oct 2026'))

    await waitFor(() => expect(screen.getByText('Payslip paid 8 Oct 2026 downloaded.')).toHaveAttribute('role', 'status'))
    expect(mockDownload).toHaveBeenCalledWith({ payRunId: 9012, datePaid: '2026-10-08' })
  })

  it('never shows a money figure', () => {
    mockUseMyPayslips.mockReturnValue(ready([slip({ paySchedule: 'Weekly' })]))
    renderPage()
    expect(document.body.textContent).not.toMatch(/\$|\d+\.\d{2}/)
  })

  it('keeps the rows when a background refetch fails', () => {
    mockUseMyPayslips.mockReturnValue({ ...ready(ROWS), isError: true, error: httpError(503, 'Employment Hero is down') })
    renderPage()
    expect(screen.getAllByRole('button', { name: /^Download PDF/ })).toHaveLength(2)
    expect(screen.queryByText('Employment Hero is down')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
