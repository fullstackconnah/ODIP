import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn(async () => ({ data: { data: [] } })) }))

vi.mock('../client', () => ({ apiClient: { get: mockGet }, apiPost: vi.fn(), apiPut: vi.fn() }))

import { useAdminTenantsSummary } from './admin'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

afterEach(() => mockGet.mockClear())

// CORE-4: GET /admin/tenants is SuperAdmin only (TenantsController); a caller mounted for other roles passes enabled = false.
describe('useAdminTenantsSummary', () => {
  it('reads GET /admin/tenants by default', async () => {
    const { result } = renderHook(() => useAdminTenantsSummary(), { wrapper: wrapper(new QueryClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/admin/tenants')
  })

  it('sends no request when disabled', async () => {
    const { result } = renderHook(() => useAdminTenantsSummary(false), { wrapper: wrapper(new QueryClient()) })
    await new Promise(r => setTimeout(r, 0))
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGet).not.toHaveBeenCalled()
  })
})
