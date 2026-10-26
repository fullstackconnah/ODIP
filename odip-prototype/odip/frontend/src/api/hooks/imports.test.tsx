import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn<(url: string) => Promise<{ data: { data: unknown } }>>(async () => ({ data: { data: [] } })),
  mockPost: vi.fn<(url: string, body: unknown, config?: unknown) => Promise<{ data: { data: unknown } }>>(async () => ({ data: { data: { batchId: 'b1' } } })),
}))

vi.mock('../client', () => ({
  apiClient: { get: mockGet },
  apiGet: async (url: string) => (await mockGet(url)).data.data,
  apiPost: async (url: string, body: unknown, config: unknown) => (await mockPost(url, body, config)).data.data,
}))

import { useCommitImport, useDownloadImportTemplate, useImportHistory, usePreviewImport } from './imports'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>

afterEach(() => { mockGet.mockClear(); mockPost.mockClear() })

describe('import hooks', () => {
  it('reads the history from GET /imports', async () => {
    const { result } = renderHook(() => useImportHistory(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/imports')
  })

  it('posts the file and the column matches as a form to preview', async () => {
    const file = new File(['First name\nAva\n'], 'people.csv', { type: 'text/csv' })
    const { result } = renderHook(() => usePreviewImport(), { wrapper })
    await result.current.mutateAsync({ kind: 'participants', file, mapping: ['firstName', null] })
    const [url, form] = mockPost.mock.calls[0] as unknown as [string, FormData]
    expect(url).toBe('/imports/participants/preview')
    expect(form.get('file')).toBe(file)
    expect(form.get('mapping')).toBe('["firstName",null]')
  })

  it('sends the landing and the idempotency key with a commit', async () => {
    const file = new File(['x'], 'people.csv')
    const { result } = renderHook(() => useCommitImport(), { wrapper })
    await result.current.mutateAsync({ kind: 'participants', file, mapping: ['firstName'], landing: 'Onboarding', idempotencyKey: 'k-1' })
    const [url, form] = mockPost.mock.calls[0] as unknown as [string, FormData]
    expect(url).toBe('/imports/participants/commit')
    expect([form.get('landing'), form.get('idempotencyKey')]).toEqual(['Onboarding', 'k-1'])
  })

  it('sends the shape, start and weeks of an upcoming-shifts file with preview and commit', async () => {
    const file = new File(['x'], 'roster.csv')
    const extra = { shape: 'pattern', from: '2026-11-02', weeks: '12' }
    const preview = renderHook(() => usePreviewImport(), { wrapper })
    await preview.result.current.mutateAsync({ kind: 'upcoming-shifts', file, extra })
    const [previewUrl, previewForm] = mockPost.mock.calls[0] as unknown as [string, FormData]
    expect(previewUrl).toBe('/imports/upcoming-shifts/preview')
    expect([previewForm.get('shape'), previewForm.get('from'), previewForm.get('weeks')]).toEqual(['pattern', '2026-11-02', '12'])

    const commit = renderHook(() => useCommitImport(), { wrapper })
    await commit.result.current.mutateAsync({ kind: 'upcoming-shifts', file, mapping: ['weekday'], idempotencyKey: 'k-3', extra })
    const [, commitForm] = mockPost.mock.calls[1] as unknown as [string, FormData]
    expect([commitForm.get('shape'), commitForm.get('from'), commitForm.get('weeks'), commitForm.get('idempotencyKey')]).toEqual(['pattern', '2026-11-02', '12', 'k-3'])
  })

  it('asks for the template of the chosen shape', async () => {
    mockGet.mockResolvedValueOnce({ data: new Blob(['x']) } as never)
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const { result } = renderHook(() => useDownloadImportTemplate(), { wrapper })
    await result.current.mutateAsync({ kind: 'upcoming-shifts', shape: 'dated' })
    expect(mockGet).toHaveBeenCalledWith('/imports/upcoming-shifts/template?shape=dated', { responseType: 'blob' })
  })

  it('refreshes the Funding tab and the onboarding checklist after a commit', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useCommitImport(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
    await result.current.mutateAsync({ kind: 'funding-plans', file: new File(['x'], 'budgets.csv'), mapping: ['amount'], idempotencyKey: 'k-2' })
    expect(mockPost.mock.calls[0][0]).toBe('/imports/funding-plans/commit')
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0])).toEqual(
      expect.arrayContaining(['imports', 'participants', 'participant-funding', 'onboarding', 'participant-onboarding-worklist', 'budget-list']))
  })
})
