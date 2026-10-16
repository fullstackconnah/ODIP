import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const { mockApiPost, mockApiPut } = vi.hoisted(() => ({ mockApiPost: vi.fn(), mockApiPut: vi.fn() }))

vi.mock('../client', () => ({
  apiGet: vi.fn(),
  apiPost: mockApiPost,
  apiPut: mockApiPut,
  apiDelete: vi.fn(),
}))

import { useSetRegular, useStartWeek } from './rostering'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const keysInvalidated = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(c => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey)

beforeEach(() => {
  mockApiPost.mockReset()
  mockApiPut.mockReset()
})

describe('useStartWeek and useSetRegular (Start rostering, 2026-10-16)', () => {
  it('useStartWeek posts the week, then refetches the board', async () => {
    const result = { weekStart: '2026-08-17', created: 2, assignedToRegulars: 1, regularAway: 0, skipped: [] }
    mockApiPost.mockResolvedValue(result)
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result: hook } = renderHook(() => useStartWeek(), { wrapper: wrapper(qc) })

    await expect(hook.current.mutateAsync('2026-08-17')).resolves.toEqual(result)
    expect(mockApiPost).toHaveBeenCalledWith('/rostering/weeks/2026-08-17/start')
    expect(keysInvalidated(spy)).toContainEqual(['roster-board'])
  })

  it('useStartWeek refetches the board after a refusal too, since a 409 means the board is out of date', async () => {
    const refusal = { response: { status: 409, data: { code: 'roster-week-started' } } }
    mockApiPost.mockRejectedValue(refusal)
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result: hook } = renderHook(() => useStartWeek(), { wrapper: wrapper(qc) })

    await expect(hook.current.mutateAsync('2026-08-17')).rejects.toBe(refusal)
    expect(keysInvalidated(spy)).toContainEqual(['roster-board'])
  })

  it('useSetRegular puts the whole body, null to stop being the regular', async () => {
    mockApiPut.mockResolvedValue({ id: 'pat-1' })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result: hook } = renderHook(() => useSetRegular(), { wrapper: wrapper(qc) })

    await hook.current.mutateAsync({ patternId: 'pat-1', shiftId: 'shift-1', staffId: 'staff-2', expectedRegularId: 'staff-1' })
    expect(mockApiPut).toHaveBeenLastCalledWith('/rostering/patterns/pat-1/regular', { shiftId: 'shift-1', staffId: 'staff-2', expectedRegularId: 'staff-1' })
    await hook.current.mutateAsync({ patternId: 'pat-1', shiftId: 'shift-1', staffId: null, expectedRegularId: '00000000-0000-0000-0000-000000000000' })
    expect(mockApiPut).toHaveBeenLastCalledWith('/rostering/patterns/pat-1/regular', { shiftId: 'shift-1', staffId: null, expectedRegularId: '00000000-0000-0000-0000-000000000000' })
    expect(keysInvalidated(spy)).toContainEqual(['roster-board'])
    expect(keysInvalidated(spy)).toContainEqual(['roster-patterns'])
  })
})
