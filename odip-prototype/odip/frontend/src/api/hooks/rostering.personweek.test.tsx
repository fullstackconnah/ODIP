import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))

vi.mock('../client', () => ({
  apiGet: mockApiGet,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

import { useRosterPersonWeek } from './rostering'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

beforeEach(() => mockApiGet.mockReset())

// Spec 2026-10-28: one person's roster week is the board, narrowed server-side to that person's row.
describe('useRosterPersonWeek', () => {
  it('asks for a staff member\'s week with staffId and no participantId', async () => {
    mockApiGet.mockResolvedValue({ weekStart: '2026-11-02' })
    const { result } = renderHook(() => useRosterPersonWeek('staff', 's1', '2026-11-02'), { wrapper: wrapper(newClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', { weekStart: '2026-11-02', groupBy: 'staff', staffId: 's1' })
  })

  it('asks for a participant\'s week with participantId and no staffId', async () => {
    mockApiGet.mockResolvedValue({ weekStart: '2026-11-02' })
    const { result } = renderHook(() => useRosterPersonWeek('participant', 'p1', '2026-11-02'), { wrapper: wrapper(newClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/rostering/board', { weekStart: '2026-11-02', groupBy: 'participant', participantId: 'p1' })
  })

  it('keeps the same person\'s last week on screen while the next one loads', async () => {
    const first = { weekStart: '2026-11-02' }
    mockApiGet.mockResolvedValueOnce(first).mockReturnValueOnce(new Promise(() => {}))
    const { result, rerender } = renderHook(({ week }) => useRosterPersonWeek('staff', 's1', week), { wrapper: wrapper(newClient()), initialProps: { week: '2026-11-02' } })
    await waitFor(() => expect(result.current.data).toBe(first))

    rerender({ week: '2026-11-09' })

    expect(result.current.data).toBe(first)
    expect(result.current.isPlaceholderData).toBe(true)
  })

  it('never shows another person\'s week while a new person\'s loads', async () => {
    mockApiGet.mockResolvedValueOnce({ weekStart: '2026-11-02' }).mockReturnValueOnce(new Promise(() => {}))
    const { result, rerender } = renderHook(({ id }) => useRosterPersonWeek('staff', id, '2026-11-02'), { wrapper: wrapper(newClient()), initialProps: { id: 's1' } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ id: 's2' })

    expect(result.current.data).toBeUndefined()
    expect(result.current.isPlaceholderData).toBe(false)
  })
})
