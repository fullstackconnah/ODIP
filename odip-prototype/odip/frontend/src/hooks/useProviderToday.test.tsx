import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { restoreZone, setZone } from '@/test/timeZone'
import { useProviderToday } from './useProviderToday'

const { mockSettings } = vi.hoisted(() => ({ mockSettings: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useProviderSettings: mockSettings }))

// 14:30 UTC on 5 Nov is 01:30 on 6 Nov in Sydney.
describe('useProviderToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T14:30:00Z'))
    setZone('UTC')
    mockSettings.mockReset()
  })
  afterEach(() => { vi.useRealTimers(); restoreZone() })

  it("uses the organisation's saved zone", () => {
    mockSettings.mockReturnValue({ data: { timeZoneId: 'Australia/Sydney', state: 'QLD' } })
    expect(renderHook(() => useProviderToday()).result.current).toBe('2026-11-06')
  })

  it("uses the State's default zone when none is saved", () => {
    mockSettings.mockReturnValue({ data: { timeZoneId: null, state: 'NSW' } })
    expect(renderHook(() => useProviderToday()).result.current).toBe('2026-11-06')
    mockSettings.mockReturnValue({ data: { timeZoneId: null, state: 'WA' } })
    expect(renderHook(() => useProviderToday()).result.current).toBe('2026-11-05')
  })

  it("falls back to the browser's day while the settings are missing, and passes `enabled` on", () => {
    mockSettings.mockReturnValue({ data: undefined })
    expect(renderHook(() => useProviderToday(false)).result.current).toBe('2026-11-05')
    expect(mockSettings).toHaveBeenCalledWith(false)
  })
})
