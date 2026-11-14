import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useProviderSettings, useProviderZone } from '@/api/hooks'
import { todayInZone } from '@/lib/dateOnly'
import { restoreZone, setZone } from '@/test/timeZone'

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({ ...(await importOriginal<object>()), apiGet }))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

// 15:30 UTC on 5 Nov is 02:30 on 6 Nov in Sydney (the process zone here) and 23:30 on 5 Nov in Perth (the provider's).
describe('useProviderZone', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:30:00Z'))
    setZone('Australia/Sydney')
  })
  afterEach(() => { vi.useRealTimers(); restoreZone(); apiGet.mockReset() })

  it("gives a SupportWorker the provider's zone although provider-settings refuses them", async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/provider-today' ? Promise.resolve({ date: '2026-11-05', timeZoneId: 'Australia/Perth' }) : Promise.reject(new Error('403')))
    const { result } = renderHook(() => ({ zone: useProviderZone(), settings: useProviderSettings().data?.timeZoneId }), { wrapper })
    await waitFor(() => expect(result.current.zone).toBe('Australia/Perth'))
    expect(result.current.settings).toBeUndefined()
    expect(todayInZone(result.current.zone)).toBe('2026-11-05')
    expect(todayInZone(undefined)).toBe('2026-11-06')
  })

  it("is undefined, so dates keep the device's zone, when the read fails", async () => {
    apiGet.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useProviderZone(), { wrapper })
    await waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })
})
