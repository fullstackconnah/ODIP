import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { restoreZone, setZone } from '@/test/timeZone'
import { useProviderToday } from './useProviderToday'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useProviderTodayQuery: mockQuery }))

// 14:30 UTC on 5 Nov is 01:30 on 6 Nov in Sydney.
describe('useProviderToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T14:30:00Z'))
    setZone('UTC')
    mockQuery.mockReset()
  })
  afterEach(() => { vi.useRealTimers(); restoreZone() })

  it("returns the server's date, whatever the browser's day is", () => {
    mockQuery.mockReturnValue({ data: { date: '2026-11-06' } })
    expect(renderHook(() => useProviderToday()).result.current).toBe('2026-11-06')
  })

  it("falls back to the browser's day while it loads and if the read fails", () => {
    mockQuery.mockReturnValue({ data: undefined })
    expect(renderHook(() => useProviderToday()).result.current).toBe('2026-11-05')
  })
})
