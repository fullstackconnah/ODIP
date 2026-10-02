import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNow } from './useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 11, 59, 30)) // 11:59:30 on the wall clock, whatever the zone
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at the current time', () => {
    const { result } = renderHook(() => useNow())

    expect(result.current.getHours()).toBe(11)
    expect(result.current.getMinutes()).toBe(59)
  })

  it('moves on every minute, so a morning greeting can turn into an afternoon one', () => {
    const { result } = renderHook(() => useNow())

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(result.current.getHours()).toBe(12)
    expect(result.current.getMinutes()).toBe(0)
  })

  it('catches up as soon as the tab comes back to the front, without waiting for the next minute', () => {
    const { result } = renderHook(() => useNow())

    vi.setSystemTime(new Date(2026, 9, 3, 8, 15)) // the laptop was shut overnight
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.getDate()).toBe(3)
    expect(result.current.getHours()).toBe(8)
  })

  it('stops its timer and its listener when the component goes away', () => {
    const { unmount } = renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
