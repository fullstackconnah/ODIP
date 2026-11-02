import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ClaimAgainDialog } from './ClaimAgainDialog'

// Claims PR3: the Claim again confirm, through the real hooks with only the axios adapter replaced.

interface Call { method: string; url: string }
const calls: Call[] = []
const originalAdapter = apiClient.defaults.adapter
type Handler = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>
let onPreview: Handler
let onMake: Handler

const ok = (data: unknown, config: InternalAxiosRequestConfig): AxiosResponse => ({ data: { data }, status: 200, statusText: 'OK', headers: {}, config })
function refused(message: string, config: InternalAxiosRequestConfig, status = 400): never {
  const response = { data: { success: false, message, errors: [message] }, status, statusText: 'Refused', headers: {}, config } as AxiosResponse
  throw new AxiosError(message, 'ERR_BAD_REQUEST', config, null, response)
}

const line = (n: number) => ({ shiftId: `s${n}`, serviceDate: `2026-10-2${n}`, description: 'Shift 09:00–11:00', quantity: 2, unitPrice: 50, totalAmount: 100 })
const preview = (lines: number, leftOut: unknown[] = []) => ({ totalAmount: lines * 100, lineItems: Array.from({ length: lines }, (_, i) => line(i)), leftOut })
const held = { shiftId: 'x', serviceDate: '2026-10-22', description: 'Shift 13:00–15:00 · 2 h', reason: 'Ava Nguyen: it is now on claim TC-7.', heldByClaimId: 'c7', heldByClaimReference: 'TC-7' }

beforeEach(() => {
  calls.length = 0
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  onPreview = async config => ok(preview(3), config)
  onMake = async config => ok({ id: 'new-1', claimReference: 'TC-NEW', status: 'Draft', participantId: 'p1' }, config)
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const call = { method: String(config.method).toLowerCase(), url: String(config.url) }
    calls.push(call)
    if (call.url.endsWith('/claim-again/preview')) return onPreview(config)
    if (call.url.endsWith('/claim-again')) return onMake(config)
    return ok([], config)   // the lists the success path refreshes
  }
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
  localStorage.clear()
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}|{JSON.stringify(l.state)}</p>
}

function renderDialog(status: 'Rejected' | 'Cancelled' = 'Rejected') {
  const onCancel = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/claims/old-1']}>
        <Routes>
          <Route path="/claims/old-1" element={<><ClaimAgainDialog open claimId="old-1" claimReference="TC-OLD-1" claimStatus={status} onCancel={onCancel} /><Where /></>} />
          <Route path="/claims/new-1" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onCancel }
}

const confirm = () => screen.getByRole('button', { name: 'Delete TC-OLD-1 and claim again' })

describe('ClaimAgainDialog', () => {
  it('asks for the preview as it opens, holds the confirm while it works, then says what it makes', async () => {
    let release!: () => void
    onPreview = config => new Promise(resolve => { release = () => resolve(ok(preview(3), config)) })
    renderDialog()
    expect(screen.getByRole('status')).toHaveTextContent('Working out the new claim…')
    expect(confirm()).toBeDisabled()
    await waitFor(() => expect(calls).toContainEqual({ method: 'post', url: '/claims/old-1/claim-again/preview' }))
    release()
    expect(await screen.findByText(/for its 3 shifts \(\$300\.00\)/)).toBeInTheDocument()
    expect(screen.getByText(/Bunya Support deletes rejected claim/)).toBeInTheDocument()
    expect(screen.getByText("Changes made on TC-OLD-1 aren't kept. You can check the new claim before you send it.")).toBeInTheDocument()
    expect(confirm()).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('says "cancelled" for a cancelled claim and "shift" for one shift', async () => {
    onPreview = async config => ok(preview(1), config)
    renderDialog('Cancelled')
    expect(await screen.findByText(/deletes cancelled claim/)).toBeInTheDocument()
    expect(screen.getByText(/for its shift \(\$100\.00\)/)).toBeInTheDocument()
  })

  it('lists what the new claim leaves out, with a link to the claim that holds a shift', async () => {
    onPreview = async config => ok(preview(2, [held]), config)
    renderDialog()
    expect(await screen.findByText(/Shift 13:00–15:00 · 2 h · Ava Nguyen: it is now on claim TC-7\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open TC-7' })).toHaveAttribute('href', '/claims/c7')
    expect(screen.getByRole('link', { name: 'Open TC-7' })).toHaveClass('underline')   // always underlined, not only on hover
  })

  it('with nothing claimable says so and holds the confirm', async () => {
    onPreview = async config => ok({ totalAmount: 0, lineItems: [], leftOut: [held] }, config)
    renderDialog()
    expect((await screen.findByText(/can be claimed again./)).textContent).toBe('Nothing on TC-OLD-1 can be claimed again.')
    expect(confirm()).toBeDisabled()
  })

  it('a refused preview shows the server sentence (an issued invoice) and holds the confirm', async () => {
    onPreview = async config => refused('Void INV-0042 first, then claim again.', config, 409)
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Void INV‑0042 first, then claim again.')   // the reference never breaks across lines
    expect(confirm()).toBeDisabled()
  })

  it('a refused make shows the sentence, keeps the dialog and the confirm, and never navigates', async () => {
    onMake = async config => refused('This claim has already been claimed again or deleted. Refresh to see the new claim.', config, 409)
    renderDialog()
    await screen.findByText(/for its 3 shifts/)
    await userEvent.click(confirm())
    expect(await screen.findByText(/This claim has already been claimed again or deleted\./)).toBeInTheDocument()
    expect(confirm()).toBeEnabled()
    expect(screen.getByTestId('where')).toHaveTextContent('/claims/old-1')
  })

  it('on success goes to the new claim, replacing the old page, and carries the old reference', async () => {
    renderDialog()
    await screen.findByText(/for its 3 shifts/)
    await userEvent.click(confirm())
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/claims/new-1|{"claimedAgainFrom":"TC-OLD-1"}'))
    expect(calls).toContainEqual({ method: 'post', url: '/claims/old-1/claim-again' })
  })

  it('while the claim is being made the confirm shows it is working and Cancel does nothing', async () => {
    onMake = () => new Promise(() => {})
    const { onCancel } = renderDialog()
    await screen.findByText(/for its 3 shifts/)
    await userEvent.click(confirm())
    expect(await screen.findByText('Processing...')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Cancel closes without making anything', async () => {
    const { onCancel } = renderDialog()
    await screen.findByText(/for its 3 shifts/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(calls.some(c => c.url.endsWith('/claim-again'))).toBe(false)
  })
})
