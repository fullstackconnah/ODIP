import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

const QUERY = '(min-width: 48rem)'

/** A fake matchMedia whose result the test flips with fire(); listeners is the set of live 'change' subscriptions. */
function stubMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() { return matches },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia
  return {
    listeners,
    fire: (next: boolean) => { matches = next; listeners.forEach(fn => fn()) },
  }
}

describe('useMediaQuery', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

  it('is true when the query matches, and asks matchMedia for that query', () => {
    stubMatchMedia(true)
    expect(renderHook(() => useMediaQuery(QUERY, false)).result.current).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith(QUERY)
  })

  it('is false when the query does not match', () => {
    stubMatchMedia(false)
    expect(renderHook(() => useMediaQuery(QUERY, true)).result.current).toBe(false)
  })

  it("re-renders on the query's change event, and subscribes once across re-renders", () => {
    const media = stubMatchMedia(false)
    const { result, rerender } = renderHook(() => useMediaQuery(QUERY, false))
    rerender()
    expect(media.listeners.size).toBe(1)
    act(() => media.fire(true))
    expect(result.current).toBe(true)
  })

  it('removes its change listener on unmount', () => {
    const media = stubMatchMedia(true)
    const { unmount } = renderHook(() => useMediaQuery(QUERY, false))
    expect(media.listeners.size).toBe(1)
    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('returns the fallback where matchMedia does not exist', () => {
    expect(renderHook(() => useMediaQuery(QUERY, true)).result.current).toBe(true)
    expect(renderHook(() => useMediaQuery(QUERY, false)).result.current).toBe(false)
  })
})
