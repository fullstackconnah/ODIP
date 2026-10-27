import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '@/api/client'
import type { AgreementApproveResult, AgreementRow } from '@/api/types'
import AgreementsPage from './AgreementsPage'

// The real approve hook on a real QueryClient; only the transport (the axios adapter) is replaced, so the refetch and the result list are the page's own.
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => false }))
const originalAdapter = apiClient.defaults.adapter

const draftRow = (name: string, n: number): AgreementRow => ({
  participantId: `p${n}`, participantName: name, status: 'DraftWaiting', endingState: 'None', hasWaitingDraft: true,
  current: null, waiting: { draftId: `d${n}`, version: 1, agreementStartDate: '2027-01-01', agreementEndDate: '2027-12-31', total: 1000 },
  daysLeft: null, termStart: null, priceList: { version: '2025-26', start: '2025-07-01' }, newerPriceList: null,
})
const rows = [draftRow('Ana Lee', 1), draftRow('Ben Ng', 2), draftRow('Cy Roe', 3)]
const answer = (participantId: string, draftId: string, participantName: string, outcome: AgreementApproveResult['outcome']): AgreementApproveResult =>
  ({ participantId, draftId, participantName, outcome, reasons: outcome === 'NeedsReview' ? ['No item for block weekdays.'] : [] })

let seen: InternalAxiosRequestConfig[]
beforeEach(() => {
  seen = []
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  const adapter: AxiosAdapter = async config => {
    seen.push(config)
    const data = config.method === 'post'
      ? [answer('p1', 'd1', 'Ana Lee', 'Approved'), answer('p2', 'd2', 'Ben Ng', 'NeedsReview'), answer('p3', 'd3', 'Cy Roe', 'Busy')]
      : { canApprove: true, rows }
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
})
afterEach(() => { cleanup(); localStorage.clear(); apiClient.defaults.adapter = originalAdapter })

describe('AgreementsPage approve (real hook)', () => {
  it('lists what each agreement came to and reads the list again afterwards', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/agreements']}><AgreementsPage /></MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByText('Ana Lee')
    const reads = () => seen.filter(c => c.method === 'get' && c.url === '/service-agreements').length
    expect(reads()).toBe(1)

    await user.click(within(screen.getByText('Ana Lee').closest('tr')!).getByRole('checkbox'))
    await user.click(within(screen.getByText('Ben Ng').closest('tr')!).getByRole('checkbox'))
    await user.click(within(screen.getByText('Cy Roe').closest('tr')!).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Approve 3' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 3' }))

    const dialog = within(await screen.findByRole('dialog', { name: '1 of 3 approved' }))
    expect(JSON.parse(String(seen.find(c => c.method === 'post')!.data)).items).toHaveLength(3)
    expect(dialog.getByText("2 weren't approved. Each row says why.")).toBeInTheDocument()
    const items = dialog.getAllByRole('listitem')
    expect(items).toHaveLength(2)                                   // the approved one is counted, not listed
    expect(within(items[0]).getByText('Ben Ng')).toBeInTheDocument()   // needs review comes first
    expect(within(items[0]).getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/participants/p2/agreement-draft')
    expect(within(items[1]).getByText('Cy Roe')).toBeInTheDocument()
    expect(within(items[1]).getByText('Roster busy: try again')).toBeInTheDocument()
    await waitFor(() => expect(reads()).toBe(2))                    // the invalidation refetched the list
  })
})
