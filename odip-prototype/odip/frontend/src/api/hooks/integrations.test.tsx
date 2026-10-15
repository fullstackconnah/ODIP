import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet, mockPost, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn<(url: string) => Promise<unknown>>(async () => ({ connected: false })),
  mockPost: vi.fn<(url: string, body?: unknown) => Promise<unknown>>(async () => ({ connected: true })),
  mockDelete: vi.fn<(url: string) => Promise<void>>(async () => undefined),
}))

vi.mock('../client', () => ({ apiGet: mockGet, apiPost: mockPost, apiDelete: mockDelete }))

import {
  useConnectEmploymentHero, useDisconnectEmploymentHero, useDismissEmploymentHeroItem, useEmploymentHeroBusinesses,
  useEmploymentHeroEmployees, useEmploymentHeroStatus, useLinkEmploymentHeroStaff, useSyncEmploymentHero,
} from './integrations'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
const BASE = '/integrations/employment-hero'

afterEach(() => { mockGet.mockClear(); mockPost.mockClear(); mockDelete.mockClear() })

describe('Employment Hero hooks', () => {
  it('reads the card from GET /integrations/employment-hero and the picker from /employees', async () => {
    const status = renderHook(() => useEmploymentHeroStatus(), { wrapper })
    const employees = renderHook(() => useEmploymentHeroEmployees(true), { wrapper })
    await waitFor(() => expect(status.result.current.isSuccess && employees.result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith(BASE)
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/employees`)
  })

  it('sends exactly the pasted key, the business, the employee and the item', async () => {
    const run = async <V,>(hook: () => { mutateAsync: (v: V) => Promise<unknown> }, value: V) => {
      const { result } = renderHook(hook, { wrapper })
      await result.current.mutateAsync(value)
    }
    await run(useEmploymentHeroBusinesses, 'key-1')
    await run(useConnectEmploymentHero, { apiKey: 'key-1', businessId: '777' })
    await run(useSyncEmploymentHero, undefined)
    await run(useLinkEmploymentHeroStaff, { itemId: 'i1', employeeId: '301' })
    await run(useDismissEmploymentHeroItem, 'i2')
    await run(useDisconnectEmploymentHero, undefined)

    expect(mockPost.mock.calls).toEqual([
      [`${BASE}/businesses`, { apiKey: 'key-1' }],
      [BASE, { apiKey: 'key-1', businessId: '777' }],
      [`${BASE}/sync`],
      [`${BASE}/attention/i1/link`, { employeeId: '301' }],
      [`${BASE}/attention/i2/dismiss`],
    ])
    expect(mockDelete).toHaveBeenCalledWith(BASE)
  })
})
