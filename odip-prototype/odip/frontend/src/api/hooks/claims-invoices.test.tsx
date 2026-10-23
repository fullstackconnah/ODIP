import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from '@/api/client'
import { useClaimInvoices, useDeleteClaim, useIssueCreditNote, useSubmitPreview, useUpdateClaim, useVoidInvoice } from '@/api/hooks/claims'
import type { ClaimInvoicesDto, SubmitPreviewDto } from '@/api/types'

// Xero PR1: the invoice hooks, through the real apiClient with only its axios adapter replaced.

interface Call { method: string; url: string; body: unknown }
const calls: Call[] = []

const invoices: ClaimInvoicesDto = { invoiceState: 'preview', invoices: [], groups: [], agencyCount: 0 }
const preview: SubmitPreviewDto = { claims: [], invoiceCount: 0 }

function payload(data: unknown): AxiosResponse {
  return { data: { data }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } } as AxiosResponse
}

beforeEach(() => {
  calls.length = 0
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const method = String(config.method ?? 'get').toLowerCase()
    const url = String(config.url ?? '')
    calls.push({ method, url, body: config.data ? JSON.parse(String(config.data)) : undefined })
    if (method === 'get' && url === '/claims/claim-1/invoices') return payload(invoices)
    if (method === 'post' && url === '/claims/submit-preview') return payload(preview)
    if (method === 'post' && url === '/invoices/inv-1/void') return payload({ id: 'inv-1' })
    if (method === 'post' && url === '/invoices/inv-1/credit-note') return payload({ id: 'cn-1' })
    if (method === 'put' && url === '/claims/claim-1') return payload(true)
    if (method === 'delete' && url === '/claims/claim-1') return payload(true)
    throw new Error(`test: unmocked ${method.toUpperCase()} ${url}`)
  }
})

afterEach(() => {
  apiClient.defaults.adapter = undefined
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { qc, wrapper }
}

const invoiceGets = () => calls.filter(c => c.method === 'get' && c.url === '/claims/claim-1/invoices').length

describe('invoice hooks', () => {
  it('useClaimInvoices reads GET /claims/{id}/invoices under [claim-invoices, id]', async () => {
    const { qc, wrapper } = setup()
    const { result } = renderHook(() => useClaimInvoices('claim-1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(qc.getQueryData(['claim-invoices', 'claim-1'])).toEqual(invoices)
  })

  it('useSubmitPreview posts every id in one body, and only while enabled', async () => {
    const { wrapper } = setup()
    const { result, rerender } = renderHook(({ on }) => useSubmitPreview(['claim-1', 'claim-2'], on), { wrapper, initialProps: { on: false } })
    expect(calls).toHaveLength(0)
    rerender({ on: true })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toEqual([{ method: 'post', url: '/claims/submit-preview', body: { claimIds: ['claim-1', 'claim-2'] } }])
  })

  it.each([
    ['void', () => useVoidInvoice(), '/invoices/inv-1/void'],
    ['credit note', () => useIssueCreditNote(), '/invoices/inv-1/credit-note'],
  ] as const)('the %s mutation sends exactly { reason } and refetches the claim invoices', async (_, hook, url) => {
    const { wrapper } = setup()
    const list = renderHook(() => useClaimInvoices('claim-1'), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    const { result } = renderHook(hook, { wrapper })

    await act(() => result.current.mutateAsync({ invoiceId: 'inv-1', claimId: 'claim-1', reason: 'Wrong rate' }))

    expect(calls.find(c => c.method === 'post')).toEqual({ method: 'post', url, body: { reason: 'Wrong rate' } })
    await waitFor(() => expect(invoiceGets()).toBe(2))
  })

  it('updating or deleting a claim refetches its invoices', async () => {
    const { wrapper } = setup()
    const list = renderHook(() => useClaimInvoices('claim-1'), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    const update = renderHook(() => useUpdateClaim(), { wrapper })
    const remove = renderHook(() => useDeleteClaim(), { wrapper })

    await act(() => update.result.current.mutateAsync({ claimId: 'claim-1', data: { status: 'Submitted' } }))
    await waitFor(() => expect(invoiceGets()).toBe(2))
    await act(() => remove.result.current.mutateAsync('claim-1'))
    await waitFor(() => expect(invoiceGets()).toBe(3))
  })
})
