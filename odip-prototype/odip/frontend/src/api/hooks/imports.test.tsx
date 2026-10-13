import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(async (_url: string) => ({ data: { data: [] } })),
  mockPost: vi.fn(async (_url: string, _body: unknown, _config?: unknown) => ({ data: { data: { batchId: 'b1' } } })),
}))

vi.mock('../client', () => ({
  apiClient: { get: mockGet },
  apiGet: async (url: string) => (await mockGet(url)).data.data,
  apiPost: async (url: string, body: unknown, config: unknown) => (await mockPost(url, body, config)).data.data,
}))

import { useCommitImport, useImportHistory, usePreviewImport } from './imports'

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
})
