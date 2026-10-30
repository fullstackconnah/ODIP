import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { apiClient } from '@/api/client'
import { ClaimFileError, fetchClaimFile, useBuildClaimFile, useDismissBatchLine, useImportResults, useMarkBatchPaid, useMarkBatchUploaded } from '@/api/hooks/claimHub'

// The claims hub hooks, through the real apiClient with only its axios adapter replaced.

interface Call { method: string; url: string; body: unknown; responseType?: string }
const calls: Call[] = []
let reply: (call: Call) => AxiosResponse

function response(data: unknown, status = 200, headers: Record<string, string> = {}): AxiosResponse {
  return { data, status, statusText: '', headers, config: { headers: {} as never } } as AxiosResponse
}
function refuse(status: number, data: unknown): never {
  const err = Object.assign(new Error('refused'), { isAxiosError: true, response: response(data, status) })
  throw err
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)

beforeEach(() => {
  calls.length = 0
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const call = {
      method: String(config.method).toLowerCase(),
      url: String(config.url),
      body: config.data instanceof FormData ? config.data : config.data ? JSON.parse(String(config.data)) : undefined,
      responseType: config.responseType,
    }
    calls.push(call)
    return reply(call)
  }
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  apiClient.defaults.adapter = undefined
})

describe('fetchClaimFile', () => {
  it('posts the lines as a blob request, saves under the server file name and returns the batch id', async () => {
    reply = () => response(new Blob(['a,b']), 200, { 'content-disposition': 'attachment; filename="bpr-2026-10-30-01.csv"', 'x-claim-batch-id': 'batch-9' })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const out = await fetchClaimFile('post', '/claim-batches', { lineIds: ['l1'], confirmedLineIds: ['l2'] }, 'fallback.csv')
    expect(calls[0]).toMatchObject({ method: 'post', url: '/claim-batches', body: { lineIds: ['l1'], confirmedLineIds: ['l2'] }, responseType: 'blob' })
    expect(out).toEqual({ batchId: 'batch-9', fileName: 'bpr-2026-10-30-01.csv' })
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
  })

  it('throws the server sentence and the per-line problems of a refused build', async () => {
    const body = { success: false, errors: ['PartClaim'], data: { problems: [{ lineId: 'l1', claimReference: 'CLM-1', rule: 'PriceLimit', message: 'Over the price limit.' }] } }
    reply = () => refuse(400, new Blob([JSON.stringify(body)]))
    const err = await fetchClaimFile('post', '/claim-batches', { lineIds: ['l1'] }, 'f.csv', "Couldn't build the file.").catch(e => e)
    expect(err).toBeInstanceOf(ClaimFileError)
    expect(err.status).toBe(400)
    expect(err.problems).toEqual(body.data.problems)
  })

  it("shows a 409's own sentence", async () => {
    reply = () => refuse(409, new Blob([JSON.stringify({ success: false, errors: ['This file was discarded. Build a new one.'] })]))
    const err = await fetchClaimFile('get', '/claim-batches/b1/file', undefined, 'f.csv', 'x').catch(e => e)
    expect(err.message).toBe('This file was discarded. Build a new one.')
    expect(err.status).toBe(409)
  })
})

describe('batch mutations', () => {
  it('mark uploaded, mark paid and dismiss send their full bodies', async () => {
    reply = () => response({ success: true, data: { id: 'b1' } })
    const uploaded = renderHook(() => useMarkBatchUploaded(), { wrapper })
    const paid = renderHook(() => useMarkBatchPaid(), { wrapper })
    const dismiss = renderHook(() => useDismissBatchLine(), { wrapper })
    await act(() => uploaded.result.current.mutateAsync('b1'))
    await act(() => paid.result.current.mutateAsync({ batchId: 'b1', lines: [{ batchLineId: 'x', amount: 12.5 }] }))
    await act(() => dismiss.result.current.mutateAsync('bl-3'))
    expect(calls.map(c => [c.method, c.url, c.body])).toEqual([
      ['post', '/claim-batches/b1/uploaded', undefined],
      ['post', '/claim-batches/b1/paid', { lines: [{ batchLineId: 'x', amount: 12.5 }] }],
      ['post', '/claim-batch-lines/bl-3/dismiss', undefined],
    ])
  })

  it('imports results as multipart with the field "file"', async () => {
    reply = () => response({ success: true, data: { successful: 1 } })
    const { result } = renderHook(() => useImportResults(), { wrapper })
    const file = new File(['x'], 'results.csv', { type: 'text/csv' })
    const out = await act(() => result.current.mutateAsync({ batchId: 'b1', file }))
    expect(calls[0].url).toBe('/claim-batches/b1/results')
    expect((calls[0].body as FormData).get('file')).toBe(file)
    expect(out).toEqual({ successful: 1 })
  })
})

describe('cache refresh', () => {
  const KEYS = [['claim-hub', 'lines'], ['claim-batches'], ['claim', 'c1'], ['claim-invoices', 'c1'], ['claims'], ['invoice-register', {}]]
  function seeded() {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    KEYS.forEach(k => qc.setQueryData(k, 1))
    const w = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const stale = (k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated
    return { qc, w, stale }
  }

  it.each([
    ['a built file', () => response(new Blob(['a']), 200, { 'x-claim-batch-id': 'b1' })],
    ['a refused build (400)', () => refuse(400, new Blob([JSON.stringify({ data: { problems: [] } })]))],
    ['a build refused as already done (409)', () => refuse(409, new Blob([JSON.stringify({ errors: ['x'] })]))],
  ])('refreshes the hub after %s', async (_name, answer) => {
    reply = answer
    const { w, stale } = seeded()
    const { result } = renderHook(() => useBuildClaimFile(), { wrapper: w })
    await act(() => result.current('post', '/claim-batches', { lineIds: ['l1'] }, 'f.csv').catch(() => {}))
    expect(stale(['claim-hub', 'lines'])).toBe(true)
    expect(stale(['claim-batches'])).toBe(true)
  })

  it('marking a file uploaded also refreshes the claim invoices, the claims list and the invoices register', async () => {
    reply = () => response({ success: true, data: { id: 'b1' } })
    const { w, stale } = seeded()
    const { result } = renderHook(() => useMarkBatchUploaded(), { wrapper: w })
    await act(() => result.current.mutateAsync('b1'))
    for (const k of KEYS) expect(stale(k), JSON.stringify(k)).toBe(true)
  })
})
