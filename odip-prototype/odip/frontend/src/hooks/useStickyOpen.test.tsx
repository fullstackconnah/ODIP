import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStickyOpen } from './useStickyOpen'

const toggleTo = (open: boolean) => ({ currentTarget: { open } }) as unknown as React.SyntheticEvent<HTMLDetailsElement>

describe('useStickyOpen', () => {
  it('starts open when there is content at mount, closed when there is none', () => {
    expect(renderHook(() => useStickyOpen(true)).result.current.open).toBe(true)
    expect(renderHook(() => useStickyOpen(false)).result.current.open).toBe(false)
  })

  it('opens when content arrives later and stays open when it goes away', () => {
    const { result, rerender } = renderHook(({ has }) => useStickyOpen(has), { initialProps: { has: false } })
    rerender({ has: true })
    expect(result.current.open).toBe(true)
    rerender({ has: false })
    expect(result.current.open).toBe(true)
  })

  it('stays closed after the person closes it, until content goes from none to some again', () => {
    const { result, rerender } = renderHook(({ has }) => useStickyOpen(has), { initialProps: { has: true } })
    act(() => result.current.onToggle(toggleTo(false)))
    expect(result.current.open).toBe(false)
    rerender({ has: true })
    expect(result.current.open).toBe(false)
    rerender({ has: false })
    rerender({ has: true })
    expect(result.current.open).toBe(true)
  })
})
