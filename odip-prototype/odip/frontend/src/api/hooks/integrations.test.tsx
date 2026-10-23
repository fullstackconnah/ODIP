import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet, mockPost, mockPut, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn<(url: string) => Promise<unknown>>(async () => ({ connected: false })),
  mockPost: vi.fn<(url: string, body?: unknown) => Promise<unknown>>(async () => ({ connected: true })),
  mockPut: vi.fn<(url: string, body?: unknown) => Promise<unknown>>(async () => ({ connected: true })),
  mockDelete: vi.fn<(url: string) => Promise<void>>(async () => undefined),
}))

vi.mock('../client', () => ({ apiGet: mockGet, apiPost: mockPost, apiPut: mockPut, apiDelete: mockDelete }))

import {
  useConnectEmploymentHero, useDisconnectEmploymentHero, useDismissEmploymentHeroItem, useEmploymentHeroBusinesses,
  useEmploymentHeroEmployees, useEmploymentHeroStatus, useEmploymentHeroWorkTypes, useLinkEmploymentHeroStaff, usePayPeriods, usePayrollCheck,
  useSaveEmploymentHeroWorkTypes, useSendMissingTimesheets, useSyncEmploymentHero,
} from './integrations'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
const BASE = '/integrations/employment-hero'

afterEach(() => { mockGet.mockClear(); mockPost.mockClear(); mockPut.mockClear(); mockDelete.mockClear() })

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

  it('connecting or disconnecting marks the nav flag stale, so My payslips appears or goes without a reload', async () => {
    for (const hook of [useConnectEmploymentHero, useDisconnectEmploymentHero]) {
      const qc = new QueryClient()
      qc.setQueryData(['module-visibility', 'tenant-1'], { employmentHero: true })
      const { result } = renderHook(hook as () => { mutateAsync: (v: never) => Promise<unknown> }, {
        wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
      })
      await result.current.mutateAsync(undefined as never)
      expect(qc.getQueryState(['module-visibility', 'tenant-1'])?.isInvalidated).toBe(true)
    }
  })

  it('saves the four work types with PUT and marks the card stale', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['employment-hero'], {})
    const { result } = renderHook(() => useSaveEmploymentHeroWorkTypes(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })
    const body = { standard: '7', activeNight: '8', passiveNight: null, sleepover: null }
    await result.current.mutateAsync(body)
    expect(mockPut).toHaveBeenCalledWith(`${BASE}/work-types`, body)
    expect(qc.getQueryState(['employment-hero'])?.isInvalidated).toBe(true)
  })

  it('reads the work types, the periods and the check from the payroll endpoints, and waits for a range', async () => {
    const types = renderHook(() => useEmploymentHeroWorkTypes(true), { wrapper })
    const periods = renderHook(() => usePayPeriods(), { wrapper })
    const check = renderHook(() => usePayrollCheck({ from: '2026-10-06', to: '2026-10-19' }), { wrapper })
    const idle = renderHook(() => usePayrollCheck(null), { wrapper })
    await waitFor(() => expect(types.result.current.isSuccess && periods.result.current.isSuccess && check.result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/work-types`)
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/payroll/periods`)
    expect(mockGet).toHaveBeenCalledWith(`${BASE}/payroll`, { from: '2026-10-06', to: '2026-10-19' })
    expect(idle.result.current.fetchStatus).toBe('idle')
  })

  it('Send missing posts exactly the range and stores the re-read check', async () => {
    const check = { from: '2026-10-06', to: '2026-10-19', workers: [] }
    mockPost.mockResolvedValueOnce({ queued: 3, check })
    const qc = new QueryClient()
    const { result } = renderHook(() => useSendMissingTimesheets(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })
    await result.current.mutateAsync({ from: '2026-10-06', to: '2026-10-19' })
    expect(mockPost).toHaveBeenCalledWith(`${BASE}/payroll/send-missing`, { from: '2026-10-06', to: '2026-10-19' })
    expect(qc.getQueryData(['employment-hero', 'payroll', 'check', '2026-10-06', '2026-10-19'])).toEqual(check)
  })
})
