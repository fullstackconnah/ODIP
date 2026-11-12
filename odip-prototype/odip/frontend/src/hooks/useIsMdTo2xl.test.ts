import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useIsMdTo2xl } from './useIsMdTo2xl'

function stubMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() { return matches },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia
  return (next: boolean) => { matches = next; listeners.forEach(fn => fn()) }
}

describe('useIsMdTo2xl', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'matchMedia') })

  it('is false without matchMedia', () => {
    expect(renderHook(() => useIsMdTo2xl()).result.current).toBe(false)
  })

  it('is true when the md-to-2xl query matches', () => {
    stubMatchMedia(true)
    expect(renderHook(() => useIsMdTo2xl()).result.current).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem) and (max-width: 95.99rem)')
  })

  it("re-renders on the query's change event", () => {
    const fire = stubMatchMedia(false)
    const { result } = renderHook(() => useIsMdTo2xl())
    expect(result.current).toBe(false)
    act(() => fire(true))
    expect(result.current).toBe(true)
  })
})
