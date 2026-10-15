import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useMissedGuidanceContact } from './medications'

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet: mockApiGet, apiGetWithDefault: async (url: string, fallback: unknown) => (await mockApiGet(url)) ?? fallback }
})

// PARTICIPANTS-2: the guidance reads its own every-role endpoint, never /provider-settings (Admin/Coordinator only).
describe('useMissedGuidanceContact', () => {
  it('reads the missed-guidance contact endpoint', async () => {
    mockApiGet.mockResolvedValue({ managerName: 'Morgan Manager', managerPhone: '0299990000', state: 'NSW' })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useMissedGuidanceContact(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/medications/missed-guidance-contact')
    expect(result.current.data).toEqual({ managerName: 'Morgan Manager', managerPhone: '0299990000', state: 'NSW' })
  })
})
