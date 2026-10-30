import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn(async () => []) }))

vi.mock('../client', () => ({ apiGet: mockGet }))

import { useHoursByWorkerReport, useLeaveTakenReport, useShiftFulfilmentReport } from './reports'

const range = { from: '2026-09-28', to: '2026-10-25' }
const qc = new QueryClient()
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

afterEach(() => { mockGet.mockClear(); qc.clear() })

describe('report hooks', () => {
  it.each([
    ['hours', useHoursByWorkerReport, '/reports/hours-by-worker'],
    ['fulfilment', useShiftFulfilmentReport, '/reports/shift-fulfilment'],
    ['leave', useLeaveTakenReport, '/reports/leave-taken'],
  ])('%s reads its URL with the range', async (_name, hook, url) => {
    const { result } = renderHook(() => hook(range, true), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith(`${url}?from=2026-09-28&to=2026-10-25`)
  })

  it('sends no request while disabled', async () => {
    const { result } = renderHook(() => useHoursByWorkerReport(range, false), { wrapper })
    await new Promise(r => setTimeout(r, 0))
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGet).not.toHaveBeenCalled()
  })
})
