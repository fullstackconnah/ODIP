import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { InvoiceSummaryDto } from '@/api/types'
import { VoidInvoiceDialog } from './VoidInvoiceDialog'

// Xero PR1, SHAPE section 2 "Void dialog": both modes, through the real hooks with only the axios adapter replaced.

interface Call { method: string; url: string; body: unknown }
const calls: Call[] = []
let answer: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>
const originalAdapter = apiClient.defaults.adapter

const invoice: InvoiceSummaryDto = {
  id: 'inv-42', kind: 'Invoice', number: 42, displayNumber: 'INV-0042', status: 'Issued', groupId: 'b-self', participantName: 'Ava Nguyen', billToName: 'Ava Nguyen',
  payerKind: 'SelfManaged', issueDate: '2026-10-22', dueDate: '2026-11-05', total: 1234.56, paymentRecorded: false,
}

function ok(data: unknown, config: InternalAxiosRequestConfig): AxiosResponse {
  return { data: { data }, status: 200, statusText: 'OK', headers: {}, config }
}

function refused(message: string, config: InternalAxiosRequestConfig): never {
  const response = { data: { success: false, message, errors: [message] }, status: 409, statusText: 'Conflict', headers: {}, config } as AxiosResponse
  throw new AxiosError(message, 'ERR_BAD_REQUEST', config, null, response)
}

beforeEach(() => {
  calls.length = 0
  answer = async config => ok({ ...invoice, status: 'Voided' }, config)
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push({ method: String(config.method).toLowerCase(), url: String(config.url), body: config.data ? JSON.parse(String(config.data)) : undefined })
    return answer(config)
  }
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

function renderDialog(mode: 'void' | 'credit', row: InvoiceSummaryDto = invoice) {
  const onCancel = vi.fn()
  const onDone = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><VoidInvoiceDialog claimId="claim-1" invoice={row} mode={mode} onCancel={onCancel} onDone={onDone} /></QueryClientProvider>)
  return { onCancel, onDone }
}

describe('VoidInvoiceDialog', () => {
  it('void: says what voiding does, and an empty reason holds the request with "Say why it\'s being voided."', async () => {
    renderDialog('void')
    expect(screen.getByRole('heading', { name: 'Void INV-0042?' })).toBeInTheDocument()
    expect(screen.getByText('The invoice stays on record marked VOID, and its number is never used again. Let the payer know it no longer stands.')).toBeInTheDocument()
    expect(screen.getByText('Kept in the audit log. Not printed on the invoice.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Void invoice' }))

    expect(screen.getByText("Say why it's being voided.")).toBeInTheDocument()
    expect(screen.queryByText('Kept in the audit log. Not printed on the invoice.')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('credit: names the full amount, and an empty reason says "Say why it\'s being credited."', async () => {
    renderDialog('credit', { ...invoice, paymentRecorded: true })
    expect(screen.getByRole('heading', { name: 'Issue a credit note for INV-0042?' })).toBeInTheDocument()
    expect(screen.getByText("A payment is recorded against this invoice, so it can't be voided. A credit note for the full $1,234.56 cancels it, and the invoice is marked CREDITED.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Issue credit note' }))

    expect(screen.getByText("Say why it's being credited.")).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['void', 'Void invoice', '/invoices/inv-42/void'],
    ['credit', 'Issue credit note', '/invoices/inv-42/credit-note'],
  ] as const)('%s: confirm posts exactly { reason } to %s and hands back the answer', async (mode, confirm, url) => {
    const { onDone } = renderDialog(mode)
    await userEvent.type(screen.getByLabelText('Reason'), 'Wrong rate')
    await userEvent.click(screen.getByRole('button', { name: confirm }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-42', status: 'Voided' })))
    expect(calls).toEqual([{ method: 'post', url, body: { reason: 'Wrong rate' } }])
  })

  it('a refusal shows the server\'s words in the dialog, and the typed reason survives', async () => {
    answer = async config => refused('A payment is recorded, so issue a credit note instead.', config)
    const { onDone } = renderDialog('void')
    await userEvent.type(screen.getByLabelText('Reason'), 'Wrong rate')
    await userEvent.click(screen.getByRole('button', { name: 'Void invoice' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A payment is recorded, so issue a credit note instead.')
    expect(screen.getByLabelText('Reason')).toHaveValue('Wrong rate')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('Cancel is held while the request runs', async () => {
    let release: () => void = () => {}
    answer = config => new Promise(resolve => { release = () => resolve(ok(invoice, config)) })
    const { onCancel, onDone } = renderDialog('void')
    await userEvent.type(screen.getByLabelText('Reason'), 'Wrong rate')
    await userEvent.click(screen.getByRole('button', { name: 'Void invoice' }))
    await screen.findByRole('button', { name: 'Void invoice' })   // the confirm keeps its accessible name while it reads "Processing..."
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
