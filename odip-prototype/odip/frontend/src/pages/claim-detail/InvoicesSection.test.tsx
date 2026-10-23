import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { ClaimInvoicesDto, InvoiceSummaryDto, PayerGroupDto } from '@/api/types'
import { formatInstantDateAu } from '@/lib/format'
import { formatDateAu } from '@/lib/utils'
import { InvoicesSection } from './InvoicesSection'

// Xero PR1, SHAPE section 2: the claim's Invoices card, through the real hooks with only the axios adapter replaced.

type Answer = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>
interface Call { method: string; url: string; body: unknown }
const calls: Call[] = []
const routes = new Map<string, Answer>()
const originalAdapter = apiClient.defaults.adapter
const saved: string[] = []

const ok = (data: unknown, config: InternalAxiosRequestConfig): AxiosResponse => ({ data: { data }, status: 200, statusText: 'OK', headers: {}, config })
const pdf = (config: InternalAxiosRequestConfig): AxiosResponse => ({ data: new Blob(['%PDF-1.4']), status: 200, statusText: 'OK', headers: {}, config })
function refuse(status: number, body: unknown, config: InternalAxiosRequestConfig): never {
  throw new AxiosError('refused', 'ERR_BAD_REQUEST', config, null, { data: body, status, statusText: '', headers: {}, config } as AxiosResponse)
}
const NO_CONFIG = { headers: {} } as InternalAxiosRequestConfig
/** A response held until the test releases it. */
function deferred() {
  let release: (answer: () => AxiosResponse) => void = () => {}
  const gate = new Promise<() => AxiosResponse>(resolve => { release = resolve })
  return { gate, release }
}

const plan: PayerGroupDto = { groupId: 'b-plan', participantName: 'Sam Lee', billToName: 'Pat Morgan — Harbour Plan Co', payerKind: 'PlanManaged', total: 430.58 }
const self: PayerGroupDto = { groupId: 'b-self', participantName: 'Ava Nguyen', billToName: 'Ava Nguyen', payerKind: 'SelfManaged', total: 1234.56 }

function row(overrides: Partial<InvoiceSummaryDto>): InvoiceSummaryDto {
  return {
    id: 'inv-42', kind: 'Invoice', number: 42, displayNumber: 'INV-0042', status: 'Issued', ...plan, issueDate: '2026-10-22', dueDate: '2026-11-05', paymentRecorded: false,
    ...overrides,
  }
}

const issued: ClaimInvoicesDto = {
  invoiceState: 'issued', groups: [plan, self], agencyCount: 0,
  invoices: [
    row({ id: 'inv-40', number: 40, displayNumber: 'INV-0040', status: 'Voided' }),
    row({ id: 'inv-41', number: 41, displayNumber: 'INV-0041', status: 'Credited', creditedByDisplayNumber: 'CN-0007', paymentRecorded: true }),
    row({ id: 'cn-7', kind: 'CreditNote', number: 7, displayNumber: 'CN-0007', creditsDisplayNumber: 'INV-0041', dueDate: undefined }),
    row({ id: 'inv-42' }),
    row({ id: 'inv-43', number: 43, displayNumber: 'INV-0043', ...self, paymentRecorded: true }),
  ],
}

const claim = { id: 'claim-1', claimReference: 'TC-0001', submittedDate: '2026-03-04T02:30:00Z' }

function serve(key: string, answer: Answer) { routes.set(key, answer) }
const serveInvoices = (dto: ClaimInvoicesDto) => serve('get /claims/claim-1/invoices', async config => ok(dto, config))

beforeEach(() => {
  calls.length = 0
  saved.length = 0
  routes.clear()
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const method = String(config.method).toLowerCase()
    calls.push({ method, url: String(config.url), body: config.data ? JSON.parse(String(config.data)) : undefined })
    const answer = routes.get(`${method} ${config.url}`)
    if (!answer) throw new Error(`test: unmocked ${method} ${config.url}`)
    return answer(config)
  }
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download) })
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  localStorage.clear()
  vi.restoreAllMocks()
})

function renderSection() {
  const onAnnounce = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><InvoicesSection claim={claim} onAnnounce={onAnnounce} /></QueryClientProvider>)
  return { onAnnounce }
}

/** The table row (or phone card) holding this exact text. */
const rowOf = (text: string) => {
  const found = screen.getAllByRole('row').find(r => within(r).queryByText(text, { exact: true }))
  if (!found) throw new Error(`no row with ${text}`)
  return found
}

describe('InvoicesSection', () => {
  it('preview: one "Not issued" row per payer, saying when they are issued, each with a Preview named for the participant', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan, self], agencyCount: 0 })
    renderSection()

    expect(await screen.findByRole('button', { name: 'Preview invoice for Sam Lee' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview invoice for Ava Nguyen' })).toBeInTheDocument()
    expect(screen.getByText('Issued when the claim is marked as submitted. Until then, each one is a preview.')).toBeInTheDocument()
    expect(screen.getByText('Preview', { selector: 'span' })).toBeInTheDocument()   // the strip's count
    const planRow = rowOf('Pat Morgan — Harbour Plan Co')
    expect(within(planRow).getAllByText('Not issued')).toHaveLength(2)   // the number cell and the pill
    expect(within(planRow).getByText('for Sam Lee · Plan managed')).toBeInTheDocument()
    expect(within(rowOf('Ava Nguyen')).getByText('Self managed')).toBeInTheDocument()
  })

  it('a preview is saved as DRAFT-<claimRef>-<Participant-Name>.pdf from the payer\'s derived render', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan], agencyCount: 0 })
    serve('get /claims/claim-1/invoices/b-plan', async config => pdf(config))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Preview invoice for Sam Lee' }))

    await waitFor(() => expect(saved).toEqual(['DRAFT-TC-0001-Sam-Lee.pdf']))
  })

  it('issued: number, bill-to, dates, total and pill per row; the count says how many', async () => {
    serveInvoices(issued)
    renderSection()

    const r42 = await waitFor(() => rowOf('INV-0042'))
    expect(within(r42).getByText('Pat Morgan — Harbour Plan Co')).toBeInTheDocument()
    expect(within(r42).getByText(formatDateAu('2026-10-22'))).toBeInTheDocument()
    expect(within(r42).getByText(formatDateAu('2026-11-05'))).toBeInTheDocument()
    expect(within(r42).getByText('$430.58')).toBeInTheDocument()
    expect(within(r42).getByText('Issued')).toBeInTheDocument()
    expect(within(rowOf('INV-0040')).getByText('Voided')).toBeInTheDocument()
    expect(within(rowOf('INV-0041')).getByText('Credited')).toBeInTheDocument()
    expect(screen.getByText('5 issued')).toBeInTheDocument()
  })

  it('a credit note row says what it credits, shows its total negative and has no due date', async () => {
    serveInvoices(issued)
    renderSection()

    const cn = await waitFor(() => rowOf('CN-0007'))
    expect(within(cn).getByText('Credit note · credits INV-0041')).toBeInTheDocument()
    expect(within(cn).getByText('-$430.58')).toBeInTheDocument()
    expect(within(cn).getByText('—')).toBeInTheDocument()
  })

  it('an Admin gets exactly one corrective action per Issued invoice, by whether a payment is recorded, and none elsewhere', async () => {
    serveInvoices(issued)
    renderSection()

    await screen.findByRole('button', { name: 'Download INV-0042' })
    expect(screen.getByRole('button', { name: 'Void INV-0042' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Issue credit note for INV-0042' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue credit note for INV-0043' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void INV-0043' })).not.toBeInTheDocument()
    for (const n of ['INV-0040', 'INV-0041', 'CN-0007']) {
      expect(within(rowOf(n)).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([`Download ${n}`])
    }
    expect(screen.queryByText('Only an Admin can void an invoice or issue a credit note.')).not.toBeInTheDocument()
  })

  it('an Admin\'s actions column is reserved at the same width in preview as when issued (SHAPE C4)', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan], agencyCount: 0 })
    renderSection()

    await screen.findByRole('button', { name: 'Preview invoice for Sam Lee' })
    const actionsHeader = screen.getAllByRole('columnheader').at(-1)!
    expect(actionsHeader.style.getPropertyValue('--col-min')).toBe('17.75rem')   // the measured widest pair (Download and "Issue credit note") plus the cell padding: 282px
  })

  it('the Status column is reserved at one width, so a pill swap (Issued to Voided or Credited) never widens the table (SHAPE C3)', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan], agencyCount: 0 })
    renderSection()

    await screen.findByRole('button', { name: 'Preview invoice for Sam Lee' })
    const statusHeader = screen.getByRole('columnheader', { name: 'Status' })
    expect(statusHeader.style.getPropertyValue('--col-min')).toBe('7rem')
  })

  it('the actions column is held AT its reserved width, so a wide table\'s slack goes elsewhere (SHAPE C4 at 1440)', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan], agencyCount: 0 })
    renderSection()

    await screen.findByRole('button', { name: 'Preview invoice for Sam Lee' })
    const wrapper = screen.getByRole('table').parentElement!
    expect(wrapper.className).toContain('md:[&_:is(th,td):last-child]:w-[var(--col-min)]')
  })

  it('Download keeps its label-swap min-width on the phone card too (SHAPE C6 at 390)', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan], agencyCount: 0 })
    renderSection()

    // ROW_ACTIONS_CARD's 44px min-width outranks a plain utility below md; the reserve must win there.
    expect((await screen.findByRole('button', { name: 'Preview invoice for Sam Lee' })).className).toContain('min-w-[8.5rem]!')
  })

  it('Total and Status come before the dates, so only a date can ever sit under the pinned actions (finish 1)', async () => {
    serveInvoices(issued)
    renderSection()

    await screen.findByRole('button', { name: 'Download INV-0042' })
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Number', 'Bill to', 'Total', 'Status', 'Issued', 'Due', ''])
  })

  it('Download holds one x across rows on desktop and every phone card ends in a full-width actions row (finish 2, 4)', async () => {
    serveInvoices(issued)
    renderSection()

    const download = await screen.findByRole('button', { name: 'Download INV-0042' })
    expect(download.parentElement!.className).toContain('md:justify-start')
    expect(download.closest('td')!.className).toContain('max-md:basis-full')
  })

  it('the phone card labels its dates "Issued … Due …" and a missing value drops out with no stray dash (finish 3)', async () => {
    serveInvoices(issued)
    renderSection()

    const r42 = await waitFor(() => rowOf('INV-0042'))
    expect(within(r42).getByText(formatDateAu('2026-10-22')).className).toContain("before:content-['Issued_']")
    expect(within(r42).getByText(formatDateAu('2026-11-05')).className).toContain("before:content-['Due_']")
    // The labels are phone-only: the desktop header already names the column.
    expect(within(r42).getByText(formatDateAu('2026-10-22')).className).toContain('md:before:hidden')
    // A credit note has no due date: its card keeps the issue date only.
    const cn = rowOf('CN-0007')
    expect(cn.querySelectorAll('td[data-card="meta"]')).toHaveLength(1)
  })

  it('a preview or legacy row shows no dash pill or date meta on the phone card (finish 3)', async () => {
    serveInvoices({ invoiceState: 'preview', invoices: [], groups: [plan], agencyCount: 0 })
    renderSection()
    const preview = await waitFor(() => rowOf('Pat Morgan — Harbour Plan Co'))
    expect(preview.querySelectorAll('td[data-card="meta"]')).toHaveLength(0)
  })

  it('a legacy row has its status dash hidden on the phone card (finish 3)', async () => {
    serveInvoices({ invoiceState: 'legacy', invoices: [], groups: [plan], agencyCount: 0 })
    renderSection()
    const r = await waitFor(() => rowOf('Pat Morgan — Harbour Plan Co'))
    const dashes = within(r).getAllByText('—')
    expect(dashes.length).toBeGreaterThan(0)
    expect(dashes.find(d => d.closest('td')!.getAttribute('data-card') === 'status')!.className).toContain('max-md:hidden')
  })

  it('a Coordinator has the two footnotes in one wrapper, so they sit together (finish 7)', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    serveInvoices({ ...issued, agencyCount: 2 })
    renderSection()

    const agency = await screen.findByText('2 agency-managed participants are claimed in the BPR CSV, not invoiced.')
    const only = screen.getByText('Only an Admin can void an invoice or issue a credit note.')
    expect(agency.parentElement).toBe(only.parentElement)
    expect(agency.parentElement).not.toBe(agency.closest('section'))   // a wrapper of their own, not two bare children of the card
  })

  it('the Admin\x27s actions scroll with the row so Total and Status stay whole at 1024; a Coordinator\x27s stay pinned (round 2)', async () => {
    serveInvoices(issued)
    renderSection()
    const admin = (await screen.findByRole('button', { name: 'Download INV-0042' })).closest('td')!
    expect(admin.className).not.toContain('md:sticky')
    cleanup()

    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderSection()
    const coordinator = (await screen.findByRole('button', { name: 'Download INV-0042' })).closest('td')!
    expect(coordinator.className).toContain('md:sticky')
  })

  it('a Coordinator gets Download only, and the line saying who can correct', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    serveInvoices(issued)
    renderSection()

    await screen.findByRole('button', { name: 'Download INV-0042' })
    expect(screen.queryByRole('button', { name: /^Void / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Issue credit note/ })).not.toBeInTheDocument()
    expect(screen.getByText('Only an Admin can void an invoice or issue a credit note.')).toBeInTheDocument()
  })

  it.each([
    [2, '2 agency-managed participants are claimed in the BPR CSV, not invoiced.'],
    [1, '1 agency-managed participant is claimed in the BPR CSV, not invoiced.'],
  ])('a mixed claim with %i agency-managed participant(s) says why they have no row', async (agencyCount, line) => {
    serveInvoices({ ...issued, agencyCount })
    renderSection()
    expect(await screen.findByText(line)).toBeInTheDocument()
  })

  it.each([
    ['none', { invoiceState: 'none', invoices: [], groups: [], agencyCount: 3 }],
    ['preview with no payer', { invoiceState: 'preview', invoices: [], groups: [], agencyCount: 3 }],
  ] as const)('agency only (%s): no table, one empty strip', async (_, dto) => {
    serveInvoices(dto as unknown as ClaimInvoicesDto)
    renderSection()
    expect(await screen.findByText("No invoices. Everyone on this claim is agency managed, so it's claimed in the BPR CSV.")).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('legacy: says why, dates each payer\'s row by the claim\'s submittedDate (an instant), no pill and no correction', async () => {
    serveInvoices({ invoiceState: 'legacy', invoices: [], groups: [plan], agencyCount: 0 })
    serve('get /claims/claim-1/invoices/b-plan', async config => pdf(config))
    renderSection()

    expect(await screen.findByText('Submitted before ODIP numbered its invoices. These keep their old reference and are drawn from the claim each time.')).toBeInTheDocument()
    const r = rowOf('Pat Morgan — Harbour Plan Co')
    expect(within(r).getByText(formatInstantDateAu(claim.submittedDate))).toBeInTheDocument()
    expect(within(r).queryByText('Issued')).not.toBeInTheDocument()
    expect(within(r).getAllByRole('button')).toHaveLength(1)
    await userEvent.click(within(r).getByRole('button', { name: 'Download invoice for Sam Lee' }))
    await waitFor(() => expect(saved).toEqual(['invoice-Sam-Lee.pdf']))
  })

  it('loading: a status strip inside the card', () => {
    serve('get /claims/claim-1/invoices', () => new Promise(() => {}))
    renderSection()
    expect(screen.getByRole('status')).toHaveTextContent('Loading invoices…')
  })

  it('error: a strip with Try again that stays up through its own retry', async () => {
    serve('get /claims/claim-1/invoices', async config => refuse(500, { message: 'boom' }, config))
    renderSection()

    expect(await screen.findByText("Couldn't load the invoices.")).toBeInTheDocument()
    const retry = deferred()
    serve('get /claims/claim-1/invoices', async () => (await retry.gate)())
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText("Couldn't load the invoices.")).toBeInTheDocument()
    retry.release(() => ok(issued, NO_CONFIG))
    expect(await screen.findByRole('button', { name: 'Download INV-0042' })).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the invoices.")).not.toBeInTheDocument()
  })

  it('a download says "Downloading…" while it runs; a refusal shows the server\'s words, cleared by the next download', async () => {
    serveInvoices(issued)
    const first = deferred()
    serve('get /invoices/inv-42/pdf', async () => (await first.gate)())
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Download INV-0042' }))
    const pending = screen.getByRole('button', { name: 'Download INV-0042' })
    expect(pending).toHaveTextContent('Downloading…')
    expect(pending).toHaveAttribute('aria-disabled', 'true')

    const refusal = new Blob([JSON.stringify({ success: false, message: 'That invoice is not in this organisation.' })], { type: 'application/json' })
    first.release(() => refuse(404, refusal, NO_CONFIG))
    expect(await screen.findByRole('alert')).toHaveTextContent('That invoice is not in this organisation.')
    expect(screen.getByRole('button', { name: 'Download INV-0042' })).toHaveTextContent('Download')

    serve('get /invoices/inv-43/pdf', async config => pdf(config))
    await userEvent.click(screen.getByRole('button', { name: 'Download INV-0043' }))
    await waitFor(() => expect(saved).toEqual(['INV-0043.pdf']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a refusal the server gave no words for says which file failed', async () => {
    serveInvoices(issued)
    serve('get /invoices/inv-42/pdf', async config => refuse(500, new Blob(['oops']), config))
    renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Download INV-0042' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't download INV-0042. Try again.")
  })

  it.each([
    ['Void INV-0042', 'Void invoice', '/invoices/inv-42/void', row({ status: 'Voided' }), 'INV-0042 voided.', 'INV-0042'],
    ['Issue credit note for INV-0043', 'Issue credit note', '/invoices/inv-43/credit-note',
      row({ id: 'cn-8', kind: 'CreditNote', number: 8, displayNumber: 'CN-0008', creditsDisplayNumber: 'INV-0043' }), 'CN-0008 issued. INV-0043 is credited.', 'INV-0043'],
  ])('after "%s" the page announces it and focus lands on that row\'s Download', async (open, confirm, url, answer, said, number) => {
    serveInvoices(issued)
    serve(`post ${url}`, async config => ok(answer, config))
    const { onAnnounce } = renderSection()

    await userEvent.click(await screen.findByRole('button', { name: open }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Wrong rate')
    await userEvent.click(screen.getByRole('button', { name: confirm }))

    await waitFor(() => expect(onAnnounce).toHaveBeenCalledWith(said))
    expect(calls.find(c => c.method === 'post')).toEqual({ method: 'post', url, body: { reason: 'Wrong rate' } })
    await waitFor(() => expect(screen.getByRole('button', { name: `Download ${number}` })).toHaveFocus())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
