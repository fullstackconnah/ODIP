import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useItineraryView } from './useItineraryView'

const { apiGet, apiPut } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/api/client', async importOriginal => ({ ...(await importOriginal<object>()), apiGet, apiPut }))

const KEY = 'odip.itinerary.view'
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(() => useItineraryView(), { wrapper })
}

afterEach(() => {
  localStorage.clear()
  apiGet.mockReset()
  apiPut.mockReset()
})

describe('useItineraryView', () => {
  it('uses the browser copy at once and when the server cannot be reached', async () => {
    localStorage.setItem(KEY, 'list')
    apiGet.mockRejectedValue(new Error('offline'))
    const { result } = setup()
    expect(result.current[0]).toBe('list')
    await waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(result.current[0]).toBe('list')
  })

  it('applies the server value over the browser copy once, and writes it to the browser', async () => {
    localStorage.setItem(KEY, 'days')
    apiGet.mockResolvedValue({ itineraryView: 'list' })
    const { result } = setup()
    await waitFor(() => expect(result.current[0]).toBe('list'))
    expect(localStorage.getItem(KEY)).toBe('list')
  })

  it('ignores a server value that is not days or list', async () => {
    apiGet.mockResolvedValue({ itineraryView: 'grid' })
    const { result } = setup()
    await waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(result.current[0]).toBe('days')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps switching and keeps the browser copy when the save fails, with no error thrown', async () => {
    apiGet.mockResolvedValue({ itineraryView: null })
    apiPut.mockRejectedValue(new Error('500'))
    const { result } = setup()
    act(() => result.current[1]('list'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1))
    expect(apiPut).toHaveBeenCalledWith('/me/ui-preferences', { itineraryView: 'list' })
    expect(result.current[0]).toBe('list')
    expect(localStorage.getItem(KEY)).toBe('list')
    act(() => result.current[1]('days'))
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2))
    expect(result.current[0]).toBe('days')
    expect(localStorage.getItem(KEY)).toBe('days')
  })
})
