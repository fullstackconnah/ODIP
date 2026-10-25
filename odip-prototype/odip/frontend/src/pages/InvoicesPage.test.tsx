import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { InvoiceRegisterRowDto } from '@/api/types'
import InvoicesPage from './InvoicesPage'

// The invoice register: every invoice and credit note the organisation has issued, newest first, read-only. The server filters, orders and pages; the page sends the filters, says
// empty / filtered-empty / failed as three different facts, and the number on each row downloads its PDF. The API layer is mocked at the hook.

const { mockUseInvoiceRegister, mockDownloadFile } = vi.hoisted(() => ({ mockUseInvoiceRegister: vi.fn(), mockDownloadFile: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useInvoiceRegister: mockUseInvoiceRegister }))
vi.mock('@/lib/downloadFile', () => ({ downloadFile: mockDownloadFile }))

function row(overrides: Partial<InvoiceRegisterRowDto> = {}): InvoiceRegisterRowDto {
  return {
    id: 'inv-1', kind: 'Invoice', displayNumber: 'INV-0042', status: 'Issued', issueDate: '2026-10-22', participantName: 'Sam Lee', billToName: 'Pat Morgan, Harbour Plan Co',
    payerKind: 'PlanManaged', claimReference: 'TC-43001-20261020', tripClaimId: 'claim-1', total: 430.58, organisationName: 'Oassist', ...overrides,
  }
}

const ready = (rows: InvoiceRegisterRowDto[], totalCount = rows.length) => ({
  data: Object.assign([...rows], { totalCount, isTruncated: false }), isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
})

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.search}</output>
}

function renderPage(entry = '/invoices') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/invoices" element={<><InvoicesPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  )
}

const lastParams = () => mockUseInvoiceRegister.mock.calls.at(-1)?.[0]

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mockUseInvoiceRegister.mockReturnValue(ready([row()]))
  mockDownloadFile.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('InvoicesPage: the list', () => {
  it('asks for page 1 of 50 with no filters, and shows the row with its number, participant, claim, status and total', () => {
    renderPage()

    expect(lastParams()).toEqual({ page: '1', pageSize: '50' })
    expect(screen.getByRole('heading', { level: 1, name: 'Invoices' })).toBeInTheDocument()
    expect(screen.getByText('1 invoice or credit note')).toBeInTheDocument()
    const tr = screen.getByText('Sam Lee').closest('tr')!
    expect(within(tr).getByText('Bill to Pat Morgan, Harbour Plan Co')).toBeInTheDocument()
    expect(within(tr).getByText('22/10/2026')).toBeInTheDocument()
    expect(within(tr).getByText('Issued')).toBeInTheDocument()
    expect(within(tr).getByText('$430.58')).toBeInTheDocument()
    expect(within(tr).getByRole('link', { name: 'TC-43001-20261020' })).toHaveAttribute('href', '/claims/claim-1')
  })

  it('shows a credit note as a negative total with the invoice it credits, and a deleted claim as plain text', () => {
    mockUseInvoiceRegister.mockReturnValue(ready([
      row({ id: 'cn', kind: 'CreditNote', displayNumber: 'CN-0007', creditsDisplayNumber: 'INV-0012', total: -123456.78, tripClaimId: undefined, claimReference: 'TC-9-20260101' }),
    ]))
    renderPage()

    expect(screen.getByText('-$123,456.78')).toBeInTheDocument()
    expect(screen.getAllByText(/Credit note/).length).toBeGreaterThan(0)
    expect(screen.getByText('Claim deleted')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'TC-9-20260101' })).not.toBeInTheDocument()
    expect(screen.getByText('TC-9-20260101')).toBeInTheDocument()
  })

  it('mutes and strikes through the total of a voided invoice, and leaves a credited one in full ink', () => {
    mockUseInvoiceRegister.mockReturnValue(ready([
      row({ id: 'v', displayNumber: 'INV-0001', status: 'Voided', total: 111 }),
      row({ id: 'c', displayNumber: 'INV-0002', status: 'Credited', total: 222 }),
    ]))
    renderPage()

    expect(screen.getByText('$111.00')).toHaveClass('line-through', 'text-[var(--color-muted-foreground)]')
    expect(screen.getByText('$222.00')).not.toHaveClass('line-through')
    expect(screen.getByText('$222.00')).not.toHaveClass('text-[var(--color-muted-foreground)]')
  })

  it('writes the subtitle for the type filter, and the plural', () => {
    mockUseInvoiceRegister.mockReturnValue(ready([row(), row({ id: 'inv-2' })], 1234))
    renderPage('/invoices?kind=CreditNote')

    expect(screen.getByText('1,234 credit notes, newest first')).toBeInTheDocument()
  })

  it('shows the Organisation column to a SuperAdmin with no organisation chosen, and to nobody else', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin' }))
    renderPage()
    expect(screen.getByRole('columnheader', { name: 'Organisation' })).toBeInTheDocument()
    expect(screen.getByText('1 invoice or credit note across all organisations')).toBeInTheDocument()
    cleanup()

    localStorage.setItem('odip_viewing_tenant', 'tenant-1')
    renderPage()
    expect(screen.queryByRole('columnheader', { name: 'Organisation' })).not.toBeInTheDocument()
  })
})

describe('InvoicesPage: filters are sent to the server', () => {
  it('sends search (trimmed, debounced), kind, status, from, to and deletedClaimOnly, and keeps them in the URL', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByRole('textbox', { name: /search invoices/i }), ' INV-0042 ')
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'INV-0042' }))

    await user.click(screen.getByRole('button', { name: /all types/i }))
    await user.click(screen.getByRole('option', { name: 'Credit notes' }))
    await user.click(screen.getByRole('button', { name: /all statuses/i }))
    await user.click(screen.getByRole('option', { name: 'Voided' }))
    fireEvent.change(screen.getByLabelText('Issued from'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Issued to'), { target: { value: '2026-10-31' } })
    await user.click(screen.getByRole('checkbox', { name: 'Deleted claims only' }))

    await waitFor(() => expect(lastParams()).toEqual({
      page: '1', pageSize: '50', search: 'INV-0042', kind: 'CreditNote', status: 'Voided', from: '2026-10-01', to: '2026-10-31', deletedClaimOnly: 'true',
    }))
    expect(screen.getByTestId('where').textContent).toContain('kind=CreditNote')
  })

  it('reads the filters and page from the URL, and a filter change goes back to page 1', async () => {
    const user = userEvent.setup()
    mockUseInvoiceRegister.mockReturnValue(ready([row()], 130))
    renderPage('/invoices?page=3&status=Issued')

    expect(lastParams()).toEqual({ page: '3', pageSize: '50', status: 'Issued' })
    await user.click(screen.getByRole('button', { name: /issued$/i }))
    await user.click(screen.getByRole('option', { name: 'Voided' }))
    expect(lastParams()).toEqual({ page: '1', pageSize: '50', status: 'Voided' })
  })

  it('keeps the filter row off a first load with no filters and an empty register, but draws it once any filter is set', () => {
    mockUseInvoiceRegister.mockReturnValue(ready([]))
    renderPage()
    expect(screen.queryByRole('textbox', { name: /search invoices/i })).not.toBeInTheDocument()
    cleanup()

    renderPage('/invoices?status=Voided')
    expect(screen.getByRole('textbox', { name: /search invoices/i })).toBeInTheDocument()
  })
})

describe('InvoicesPage: states', () => {
  it('says the register is empty, with no action, when nothing is issued and no filter is set', () => {
    mockUseInvoiceRegister.mockReturnValue(ready([]))
    renderPage()

    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
    expect(screen.getByText('An invoice is numbered here when a claim is marked as submitted, and stays here even if its claim is later deleted.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  })

  it('says nothing matches, with Clear filters, for a page past the end with no filter set', async () => {
    const user = userEvent.setup()
    mockUseInvoiceRegister.mockReturnValue(ready([]))
    renderPage('/invoices?page=9')

    expect(screen.getByText('No invoices match these filters')).toBeInTheDocument()
    expect(screen.queryByText('No invoices yet')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByTestId('where').textContent).toBe('')
  })

  it('says nothing matches, and Clear filters empties every filter and the page', async () => {
    const user = userEvent.setup()
    mockUseInvoiceRegister.mockReturnValue(ready([]))
    renderPage('/invoices?status=Voided&kind=Invoice&page=2&deletedClaimOnly=true')

    expect(screen.getByText('No invoices match these filters')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByTestId('where').textContent).toBe('')
    expect(lastParams()).toEqual({ page: '1', pageSize: '50' })
  })

  it('keeps the filters and shows the error banner with Try again when the load fails', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockUseInvoiceRegister.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, refetch })
    renderPage('/invoices?status=Issued')

    expect(screen.getByRole('textbox', { name: /search invoices/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('InvoicesPage: the number downloads the PDF', () => {
  it('downloads /invoices/{id}/pdf as {number}.pdf when the number is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Download INV-0042 PDF' }))
    expect(mockDownloadFile).toHaveBeenCalledWith('/invoices/inv-1/pdf', 'INV-0042.pdf', "Couldn't download INV-0042. Try again.")
  })

  it('shows the failure under that row, and announces it once', async () => {
    const user = userEvent.setup()
    mockDownloadFile.mockRejectedValue(new Error("Couldn't download INV-0042. Try again."))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Download INV-0042 PDF' }))
    expect(await screen.findAllByText("Couldn't download INV-0042. Try again.")).toHaveLength(2) // the visible line and the live region
    expect(screen.getAllByRole('status').some(el => el.textContent === "Couldn't download INV-0042. Try again.")).toBe(true)
  })

  it('refuses a second download while one runs, with aria-disabled rather than a silent no-op', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    mockDownloadFile.mockReturnValue(new Promise<void>(resolve => { release = resolve }))
    mockUseInvoiceRegister.mockReturnValue(ready([row(), row({ id: 'inv-2', displayNumber: 'INV-0043' })]))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Download INV-0042 PDF' }))
    expect(screen.getByRole('button', { name: 'Download INV-0042 PDF' })).toHaveAttribute('aria-busy', 'true')
    const other = screen.getByRole('button', { name: 'Download INV-0043 PDF' })
    expect(other).toHaveAttribute('aria-disabled', 'true')
    await user.click(other)
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download INV-0043 PDF' })).not.toHaveAttribute('aria-disabled', 'true'))
  })
})
