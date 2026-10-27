import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { apiClient } from '@/api/client'
import type { AgreementBulkResult, AgreementRow } from '@/api/types'
import AgreementsPage from './AgreementsPage'

// The real bulk hook and chunking on a real QueryClient; only the transport (the axios adapter) is replaced.
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))
const originalAdapter = apiClient.defaults.adapter

const row = (n: number): AgreementRow => ({
  participantId: `p${n}`, participantName: `Person ${String(n).padStart(2, '0')}`, status: 'Active', endingState: 'None', hasWaitingDraft: false,
  current: { draftId: `c${n}`, version: 1, agreementStartDate: '2026-01-01', agreementEndDate: '2026-12-31', total: 1000 }, waiting: null,
  daysLeft: null, termStart: '2026-01-01', priceList: { version: '2025-26', start: '2025-07-01' }, newerPriceList: null,
})
const rows = Array.from({ length: 60 }, (_, i) => row(i + 1))
const made = (id: string, n: number): AgreementBulkResult => ({
  participantId: id, name: `Person ${String(n).padStart(2, '0')}`, outcome: 'Created', reason: null, sourceDraftId: `c${n}`, newDraftId: `n${n}`,
  before: { start: '2026-01-01', end: '2026-12-31', total: 1000 }, after: { start: '2027-01-01', end: '2027-12-31', total: 1200 }, hasIssues: false,
})

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname}{l.search}</output>
}

let seen: InternalAxiosRequestConfig[]
let failFirst: boolean
beforeEach(() => {
  seen = []
  failFirst = false
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  const adapter: AxiosAdapter = async config => {
    seen.push(config)
    if (config.method === 'post') {
      if (failFirst) return Promise.reject(Object.assign(new Error('busy'), { config, isAxiosError: true, response: { status: 429, data: {}, config } }))
      const body = JSON.parse(config.data) as { participantIds: string[] }
      return { data: { success: true, data: body.participantIds.map(id => made(id, Number(id.slice(1)))) }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
    }
    const data = config.url === '/service-agreements/price-lists'
      ? [{ version: '2026-27', start: '2026-07-01' }, { version: '2025-26', start: '2025-07-01' }]
      : { canApprove: true, rows }
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
})
afterEach(() => { cleanup(); localStorage.clear(); apiClient.defaults.adapter = originalAdapter })

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/agreements']}><AgreementsPage /><Where /></MemoryRouter>
  </QueryClientProvider>,
)
const posts = () => seen.filter(c => c.method === 'post')
const bodyOf = (c: InternalAxiosRequestConfig) => JSON.parse(c.data) as { action: string; participantIds: string[]; priceList?: string }
const tickFirst = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText('Person 01')
  await user.click(within(screen.getByText('Person 01').closest('tr')!).getByRole('checkbox'))
}

describe('AgreementsPage bulk actions (real hook)', () => {
  it('renews 60 ticked agreements in three requests of 25, 25 and 10, then shows the review with 60 results', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Person 01')
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    await user.click(screen.getByRole('button', { name: 'Renew 60' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make 60 drafts' }))

    expect(await screen.findByRole('heading', { name: 'Renewal drafts' })).toBeInTheDocument()
    expect(posts().map(c => bodyOf(c).participantIds.length)).toEqual([25, 25, 10])
    expect(posts().every(c => c.url === '/service-agreements/bulk' && bodyOf(c).action === 'renew')).toBe(true)
    expect(screen.getByText('Drafts made (60)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '60 drafts made' })).toBeInTheDocument()
  })

  it('sends the chosen price list on a reprice', async () => {
    const user = userEvent.setup()
    renderPage()
    await tickFirst(user)
    await user.click(screen.getByRole('button', { name: 'Reprice to…' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('option', { name: /2026-27/ })
    await user.click(within(dialog).getByRole('button', { name: 'Make 1 draft' }))

    expect(await screen.findByRole('heading', { name: 'Reprice drafts (2026-27)' })).toBeInTheDocument()
    expect(bodyOf(posts()[0])).toEqual({ action: 'reprice', participantIds: ['p1'], priceList: '2026-27' })
  })

  it('keeps the dialog open with the reason when the first request is refused', async () => {
    failFirst = true
    const user = userEvent.setup()
    renderPage()
    await tickFirst(user)
    await user.click(screen.getByRole('button', { name: 'Renew 1' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make 1 draft' }))

    expect(await screen.findByText(/Another save is running for your organisation/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('returns from the review to the list filtered to the drafts waiting', async () => {
    const user = userEvent.setup()
    renderPage()
    await tickFirst(user)
    await user.click(screen.getByRole('button', { name: 'Renew 1' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make 1 draft' }))
    await user.click(await screen.findByRole('button', { name: 'All agreements' }))

    expect(screen.getByTestId('where')).toHaveTextContent('/agreements?show=draft')
    expect(screen.getByRole('radio', { name: 'Draft waiting' })).toBeChecked()
  })
})
