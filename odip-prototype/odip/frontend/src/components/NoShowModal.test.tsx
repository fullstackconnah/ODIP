import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { ClaimLineItemDto } from '@/api/types'
import { NoShowModal } from './NoShowModal'

// The claim moved on (submitted by somebody else) while this modal was open: the server refuses with its reason, and the modal says it in its own error line instead of staying silent.
afterEach(() => { apiClient.defaults.adapter = undefined; vi.restoreAllMocks() })

const line = { id: 'li-1', participantName: 'Priya Nair', ndisNumber: '43100001234', cancellationReason: null } as ClaimLineItemDto

describe('NoShowModal: a refused No Show', () => {
  it("shows the server's reason in the modal and reloads the claim", async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const adapter: AxiosAdapter = async (_config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      throw Object.assign(new Error('409'), { isAxiosError: true, response: { status: 409, data: { errors: ["This claim has been submitted, so its lines can't be changed."] } } })
    }
    apiClient.defaults.adapter = adapter
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <NoShowModal claimId="claim-1" lineItem={line} onClose={() => undefined} onSuccess={() => undefined} />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: /select a reason/i }))
    await user.click(screen.getByRole('option', { name: 'Other' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText("This claim has been submitted, so its lines can't be changed.")).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith({ queryKey: ['claim', 'claim-1'] })
  })
})
