import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { ClaimInvoicesDto, ClaimSubmitPreviewDto, InvoiceSummaryDto } from '@/api/types'
import { BulkSubmitDialog, SubmitClaimDialog } from './SubmitClaimDialog'

// Xero PR1, SHAPE section 3: one submit confirm, through the real hooks with only the axios adapter replaced.

interface Call { method: string; url: string; body: unknown }
const calls: Call[] = []
const originalAdapter = apiClient.defaults.adapter
type Handler = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>
let onPreview: Handler
let onInvoices: Handler
let onPut: Handler

function ok(data: unknown, config: InternalAxiosRequestConfig): AxiosResponse {
  return { data: { data }, status: 200, statusText: 'OK', headers: {}, config }
}

function refused(message: string, config: InternalAxiosRequestConfig, status = 409): never {
  const response = { data: { success: false, message, errors: [message] }, status, statusText: 'Refused', headers: {}, config } as AxiosResponse
  throw new AxiosError(message, 'ERR_BAD_REQUEST', config, null, response)
}

function pending(n: number, from = 42) {
  return Array.from({ length: n }, (_, i) => ({ groupId: `g${i}`, participantName: `P${i}`, billToName: `P${i}`, total: 100, predictedNumber: `INV-${String(from + i).padStart(4, '0')}` }))
}

function previewOf(claim: Partial<ClaimSubmitPreviewDto>, claimId = 'claim-1') {
  const c = { claimId, toIssue: [], alreadyIssued: 0, missingSettings: false, ...claim }
  return { claims: [c], invoiceCount: c.toIssue.length }
}

function issued(id: string, displayNumber: string): InvoiceSummaryDto {
  return {
    id, kind: 'Invoice', number: Number(displayNumber.slice(4)), displayNumber, status: 'Issued', groupId: id, participantName: 'Ava Nguyen', billToName: 'Ava Nguyen',
    payerKind: 'SelfManaged', issueDate: '2026-10-22', dueDate: '2026-11-05', total: 100, paymentRecorded: false,
  }
}

const noInvoices: ClaimInvoicesDto = { invoiceState: 'preview', invoices: [], groups: [], agencyCount: 0 }

beforeEach(() => {
  calls.length = 0
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  onPreview = async config => ok(previewOf({ toIssue: pending(1) }), config)
  onInvoices = async config => ok(noInvoices, config)
  onPut = async config => ok(true, config)
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const call = { method: String(config.method).toLowerCase(), url: String(config.url), body: config.data ? JSON.parse(String(config.data)) : undefined }
    calls.push(call)
    if (call.url.endsWith('/claims/submit-preview')) return onPreview(config)
    if (call.url.endsWith('/invoices')) return onInvoices(config)
    if (call.method === 'put') return onPut(config)
    throw new Error(`unexpected ${call.method} ${call.url}`)
  }
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  localStorage.clear()
})

function renderDialog() {
  const onCancel = vi.fn()
  const onSubmitted = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter><SubmitClaimDialog claimId="claim-1" onCancel={onCancel} onSubmitted={onSubmitted} /></MemoryRouter></QueryClientProvider>)
  return { onCancel, onSubmitted }
}

const confirmButton = () => screen.getByRole('button', { name: 'Mark as Submitted' })

describe('SubmitClaimDialog', () => {
  it.each([
    ['1 new', { toIssue: pending(1) }, 'This issues invoice INV-0042.'],
    ['2 new', { toIssue: pending(2) }, 'This issues 2 invoices: INV-0042 and INV-0043.'],
    ['3 or more new', { toIssue: pending(5) }, 'This issues 5 invoices, INV-0042 to INV-0046.'],
    ['a resubmit', { toIssue: pending(1, 45), alreadyIssued: 2 }, 'This issues 1 invoice (INV-0045). The 2 already issued stay as they are.'],
    ['all already issued', { alreadyIssued: 2 }, 'Its 2 invoices are already issued and stay as they are.'],
    ['agency only', {}, 'No invoices are issued: everyone on this claim is agency managed.'],
  ])('says what it issues: %s', async (_, claim, words) => {
    onPreview = async config => ok(previewOf(claim), config)
    renderDialog()
    expect(screen.getByText("Mark this claim as submitted to the NDIA? You can't change its lines after this.")).toBeInTheDocument()
    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it('asks for the preview of this one claim as it opens, and holds Confirm with "Checking…" until it answers', async () => {
    let release!: () => void
    onPreview = config => new Promise(resolve => { release = () => resolve(ok(previewOf({ toIssue: pending(1) }), config)) })
    renderDialog()
    expect(screen.getByRole('status')).toHaveTextContent('Checking which invoices this issues…')
    expect(confirmButton()).toBeDisabled()
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/claims/submit-preview'))).toBeDefined())
    expect(calls.find(c => c.url.endsWith('/claims/submit-preview'))).toEqual({ method: 'post', url: '/claims/submit-preview', body: { claimIds: ['claim-1'] } })
    release()
    expect(await screen.findByText('This issues invoice INV-0042.')).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it('a failed preview says "Couldn\'t check…" with Try again, holds Confirm, and Try again asks again', async () => {
    let fail = true
    onPreview = async config => (fail ? refused('Server error', config, 500) : ok(previewOf({ toIssue: pending(1) }), config))
    renderDialog()
    expect(await screen.findByText("Couldn't check which invoices this issues.")).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('This issues invoice INV-0042.')).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it("RN1: a failed read of the claim's invoices says \"Couldn't check…\" too, so Confirm is never held without a reason", async () => {
    onInvoices = async config => refused('Server error', config, 500)
    renderDialog()
    expect(await screen.findByText("Couldn't check which invoices this issues.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  it('missing organisation details: an Admin gets the link to the organisation profile, and Confirm stays held', async () => {
    onPreview = async config => ok(previewOf({ toIssue: [{ groupId: 'g0', participantName: 'P0', billToName: 'P0', total: 100 }], missingSettings: true }), config)
    renderDialog()
    expect(await screen.findByText(/Set up your organisation's invoice details in Settings first\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Organisation profile' })).toHaveAttribute('href', '/settings?section=organisation')
    // A 44px floor on touch (SHAPE C2): the link is alone at the end of the note.
    expect(screen.getByRole('link', { name: 'Open Organisation profile' }).className).toContain('min-h-[var(--tap-min)]')
    expect(confirmButton()).toBeDisabled()
  })

  it('missing organisation details: anyone else is told to ask an Admin, with no link', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    onPreview = async config => ok(previewOf({ toIssue: [{ groupId: 'g0', participantName: 'P0', billToName: 'P0', total: 100 }], missingSettings: true }), config)
    renderDialog()
    expect(await screen.findByText(/Ask an Admin to fill in the organisation profile\./)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  it('submits with exactly { status: "Submitted" } and announces only the numbers this submit issued, read back from the server', async () => {
    const before = issued('inv-40', 'INV-0040')
    let afterSubmit = false
    onInvoices = async config => ok(afterSubmit
      ? { ...noInvoices, invoiceState: 'issued', invoices: [before, issued('inv-42', 'INV-0042'), issued('inv-43', 'INV-0043')] }
      : { ...noInvoices, invoiceState: 'issued', invoices: [before] }, config)
    onPut = async config => { afterSubmit = true; return ok(true, config) }
    onPreview = async config => ok(previewOf({ toIssue: pending(2), alreadyIssued: 1 }), config)
    const { onSubmitted } = renderDialog()
    await screen.findByText('This issues 2 invoices (INV-0042 and INV-0043). The 1 already issued stays as it is.')

    await userEvent.click(confirmButton())

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('Claim submitted. Issued INV-0042 and INV-0043.'))
    expect(calls.filter(c => c.method === 'put')).toEqual([{ method: 'put', url: '/claims/claim-1', body: { status: 'Submitted' } }])
  })

  it('an agency-only claim announces "No invoices issued."', async () => {
    onPreview = async config => ok(previewOf({}), config)
    const { onSubmitted } = renderDialog()
    await screen.findByText('No invoices are issued: everyone on this claim is agency managed.')
    await userEvent.click(confirmButton())
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('Claim submitted. No invoices issued.'))
  })

  it("a refused submit shows the server's words and the dialog stays open", async () => {
    onPut = async config => refused("Set up your organisation's invoice details in Settings first.", config)
    const { onSubmitted } = renderDialog()
    await screen.findByText('This issues invoice INV-0042.')
    await userEvent.click(confirmButton())
    expect(await screen.findByRole('alert')).toHaveTextContent("Set up your organisation's invoice details in Settings first.")
    expect(screen.getByRole('alertdialog', { name: 'Mark as submitted?' })).toBeInTheDocument()
    expect(onSubmitted).not.toHaveBeenCalled()
  })
})

describe('BulkSubmitDialog', () => {
  function renderBulk(ids: string[]) {
    const onConfirm = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><BulkSubmitDialog claimIds={ids} onCancel={vi.fn()} onConfirm={onConfirm} /></QueryClientProvider>)
    return { onConfirm }
  }

  it('asks ONE preview for every selected claim, then says how many invoices it issues, with no numbers', async () => {
    onPreview = async config => ok({ claims: [], invoiceCount: 5 }, config)
    const { onConfirm } = renderBulk(['c1', 'c2', 'c3'])
    expect(screen.getByRole('heading', { name: 'Mark 3 claims as submitted?' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Checking which invoices these issue…')
    expect(confirmButton()).toBeDisabled()
    expect(await screen.findByText("This issues 5 invoices. You can't change their lines after this.")).toBeInTheDocument()
    expect(calls).toEqual([{ method: 'post', url: '/claims/submit-preview', body: { claimIds: ['c1', 'c2', 'c3'] } }])
    await userEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('a failed preview says "Couldn\'t check…" with Try again and holds Confirm', async () => {
    onPreview = async config => refused('Server error', config, 500)
    renderBulk(['c1', 'c2'])
    expect(await screen.findByText("Couldn't check which invoices these issue.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })
})
