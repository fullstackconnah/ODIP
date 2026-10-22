import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet, mockClientGet } = vi.hoisted(() => ({
  mockGet: vi.fn<(url: string) => Promise<unknown>>(async () => ({ status: 'Ready', payslips: [] })),
  mockClientGet: vi.fn<(url: string, config?: unknown) => Promise<unknown>>(async () => ({ data: new Blob(['%PDF-']), headers: {} })),
}))

vi.mock('../client', () => ({ apiGet: mockGet, apiClient: { get: mockClientGet } }))

import { useDownloadPayslip, useMyPayslips } from './payslips'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>

beforeEach(() => {
  localStorage.setItem('odip_token', 't')
  localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1', role: 'SupportWorker' }))
})
afterEach(() => { mockGet.mockClear(); mockClientGet.mockClear(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('payslip hooks', () => {
  it('reads GET /portal/payslips, and nothing else from the client', async () => {
    const { result } = renderHook(() => useMyPayslips(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledWith('/portal/payslips')
  })

  it('downloads the pdf as a blob and saves it as payslip-<pay date>.pdf, revoking the URL only after 5 s', async () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:payslip')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const clicked: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ download: this.download, href: this.href }) })
    const { result } = renderHook(() => useDownloadPayslip(), { wrapper })

    await result.current.mutateAsync({ payRunId: 9001, datePaid: '2026-10-08' })

    expect(mockClientGet).toHaveBeenCalledWith('/portal/payslips/9001/pdf', { responseType: 'blob' })
    expect(clicked).toEqual([{ download: 'payslip-2026-10-08.pdf', href: 'blob:payslip' }])
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(revoke).toHaveBeenCalledWith('blob:payslip')
  })

  it('falls back to the pay run id for the file name when the date is missing', async () => {
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    const { result } = renderHook(() => useDownloadPayslip(), { wrapper })

    await result.current.mutateAsync({ payRunId: 9001, datePaid: null })

    expect(names).toEqual(['payslip-9001.pdf'])
  })
})
