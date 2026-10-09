import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from '@/api/client'
import type { TripClaimListDto } from '@/api/types/claims'
import type { TripDetailDto } from '@/api/types/trips'
import ClaimsTab from './ClaimsTab'

// The trip's Claims tab can mark a claim Rejected too: from its status pill, and for several claims at once from the bulk control. Budget phase 2b asks for the NDIA's code whenever a claim is
// marked Rejected (the code is the only direct sign a pool is empty), so these two routes ask as the claim page does, instead of rejecting with no word of it.
//
// The hooks are the real ones, over a stubbed transport: the point of the bulk case is that every claim is written and the dialog then closes, which a mocked hook could not show.

interface Call { method: string; url: string; body: unknown }
const calls: Call[] = []
let refuse: ((call: Call) => boolean) | null = null

beforeEach(() => {
  calls.length = 0
  refuse = null
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const call: Call = { method: String(config.method ?? 'get').toLowerCase(), url: String(config.url ?? ''), body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data }
    calls.push(call)
    if (refuse?.(call)) {
      const error = Object.assign(new Error('Request failed with status code 400'), { isAxiosError: true, response: { status: 400, data: { errors: ['The NDIA code is at most 10 characters.'] } } })
      throw error
    }
    return { data: { data: true }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => { apiClient.defaults.adapter = undefined })

const claim = (id: string, status: TripClaimListDto['status'] = 'Submitted'): TripClaimListDto => ({
  id, kind: 'Trip', tripInstanceId: 't-1', tripName: 'Byron Bay', status, claimReference: `TC-${id}`, totalAmount: 960, createdAt: '2026-06-01T09:00:00Z', submittedDate: '2026-06-02T09:00:00Z',
})

function renderTab(claims: TripClaimListDto[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ClaimsTab tripId="t-1" claims={claims} trip={{} as TripDetailDto} canWrite /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const puts = () => calls.filter(call => call.method === 'put')
const dialog = () => screen.getByRole('alertdialog', { name: 'Mark as rejected?' })

/** Opens a status pill (its button is named for the status it shows) and chooses a status from its list. */
async function choose(user: ReturnType<typeof userEvent.setup>, from: string, status: string) {
  await user.click(screen.getByRole('button', { name: from }))
  await user.click(screen.getByRole('option', { name: status }))
}

describe('ClaimsTab: a claim marked Rejected from its status pill', () => {
  it('asks for the NDIA code first and writes nothing until it is answered', async () => {
    const user = userEvent.setup()
    renderTab([claim('c1')])

    await choose(user, 'Submitted', 'Rejected')

    expect(within(dialog()).getByRole('combobox', { name: 'NDIA rejection code (optional)' })).toHaveValue('')
    expect(puts()).toEqual([])
  })

  it('sends the status alone when no code is given, and the chosen code in the same request when one is', async () => {
    const user = userEvent.setup()
    const { unmount } = renderTab([claim('c1')])
    await choose(user, 'Submitted', 'Rejected')
    await user.click(within(dialog()).getByRole('button', { name: 'Mark as Rejected' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toEqual({ method: 'put', url: '/claims/c1', body: { status: 'Rejected' } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    unmount()

    calls.length = 0
    renderTab([claim('c2')])
    await choose(user, 'Submitted', 'Rejected')
    await user.selectOptions(within(dialog()).getByRole('combobox', { name: 'NDIA rejection code (optional)' }), 'V18')
    await user.click(within(dialog()).getByRole('button', { name: 'Mark as Rejected' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toEqual({ method: 'put', url: '/claims/c2', body: { status: 'Rejected', rejectionCode: 'V18' } })
  })

  it('writes nothing when it is called off, and the claim keeps the status it had', async () => {
    const user = userEvent.setup()
    renderTab([claim('c1')])

    await choose(user, 'Submitted', 'Rejected')
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(puts()).toEqual([])
    expect(screen.getByRole('button', { name: 'Submitted' })).toBeInTheDocument()
  })

  it('says the server\'s refusal in the dialog and keeps it open, with what was chosen', async () => {
    const user = userEvent.setup()
    refuse = call => call.method === 'put'
    renderTab([claim('c1')])

    await choose(user, 'Submitted', 'Rejected')
    await user.selectOptions(within(dialog()).getByRole('combobox', { name: 'NDIA rejection code (optional)' }), 'V27')
    await user.click(within(dialog()).getByRole('button', { name: 'Mark as Rejected' }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('The NDIA code is at most 10 characters.')
    expect(within(dialog()).getByRole('combobox', { name: 'NDIA rejection code (optional)' })).toHaveValue('V27')
  })

  it('leaves every other status change as it was: written at once, with no question', async () => {
    const user = userEvent.setup()
    renderTab([claim('c1')])

    await choose(user, 'Submitted', 'Paid')

    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0]).toEqual({ method: 'put', url: '/claims/c1', body: { status: 'Paid' } })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks again for a claim that is already Rejected, which is how a code that was not given is recorded later', async () => {
    const user = userEvent.setup()
    renderTab([claim('c1', 'Rejected')])

    await choose(user, 'Rejected', 'Rejected')
    await user.selectOptions(within(dialog()).getByRole('combobox', { name: 'NDIA rejection code (optional)' }), 'V28')
    await user.click(within(dialog()).getByRole('button', { name: 'Mark as Rejected' }))

    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0].body).toEqual({ status: 'Rejected', rejectionCode: 'V28' })
  })
})

describe('ClaimsTab: several claims marked Rejected at once', () => {
  async function selectBoth(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
  }

  it('asks once, says how many, and writes the same status and code to every selected claim, then closes', async () => {
    const user = userEvent.setup()
    renderTab([claim('c1'), claim('c2')])

    await selectBoth(user)
    await user.click(screen.getByRole('button', { name: '2 rows' }))
    await user.click(screen.getByRole('option', { name: 'Rejected' }))
    expect(dialog()).toHaveTextContent('Mark these 2 claims as rejected? This cannot be undone.')
    expect(puts()).toEqual([])

    // The one code goes to every claim selected, and the field says so.
    await user.selectOptions(within(dialog()).getByRole('combobox', { name: 'NDIA rejection code, applied to all 2 claims (optional)' }), 'V17')
    await user.click(within(dialog()).getByRole('button', { name: 'Mark as Rejected' }))

    // Both are written (the bulk change used to wait for ever on the second), and the question closes.
    await waitFor(() => expect(puts()).toHaveLength(2))
    expect(puts().map(call => [call.url, call.body])).toEqual([
      ['/claims/c1', { status: 'Rejected', rejectionCode: 'V17' }],
      ['/claims/c2', { status: 'Rejected', rejectionCode: 'V17' }],
    ])
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '2 rows' })).not.toBeInTheDocument()   // the selection is cleared
  })

  it('writes every other bulk status to all of them at once, with no question, and no longer waits for ever', async () => {
    const user = userEvent.setup()
    renderTab([claim('c1'), claim('c2')])

    await selectBoth(user)
    await user.click(screen.getByRole('button', { name: '2 rows' }))
    await user.click(screen.getByRole('option', { name: 'Paid' }))

    await waitFor(() => expect(puts()).toHaveLength(2))
    expect(puts().map(call => call.body)).toEqual([{ status: 'Paid' }, { status: 'Paid' }])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: '2 rows' })).not.toBeInTheDocument())   // the selection cleared: the change settled
  })
})
