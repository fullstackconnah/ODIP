import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedValue', () => {
  it('starts with the value, and follows it only once it has stopped changing for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 'a' } })
    expect(result.current).toBe('a')

    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('b')
  })

  it('starts the wait again on every change, so a person who is still typing is not asked about', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 1 } })

    rerender({ value: 2 })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ value: 3 })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe(1)
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(3)
  })

  it('compares by contents: a new array with the same items restarts nothing and changes nothing', () => {
    const first = [{ id: 'b1' }]
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: first } })

    rerender({ value: [{ id: 'b1' }] })
    act(() => { vi.advanceTimersByTime(1000) })

    expect(result.current).toBe(first)
  })
})
