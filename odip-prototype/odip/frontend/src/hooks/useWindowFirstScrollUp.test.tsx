import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWindowFirstScrollUp } from './useWindowFirstScrollUp'

function setup({ scrollY, overflows = true }: { scrollY: number; overflows?: boolean }) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: overflows ? 900 : 300 })
  Object.defineProperty(el, 'clientHeight', { value: 300 })
  document.body.append(el)
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true })
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  renderHook(() => useWindowFirstScrollUp({ current: el }))
  const wheel = (init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(e)
    return e
  }
  return { wheel, scrollBy }
}

describe('useWindowFirstScrollUp', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(window, 'scrollY', { value: 0, configurable: true }) })

  it('wheeling up with the page scrolled moves the window, not the board', () => {
    const { wheel, scrollBy } = setup({ scrollY: 80 })
    const e = wheel({ deltaY: -120 })
    expect(scrollBy).toHaveBeenCalledWith({ top: -120, behavior: 'instant' })
    expect(e.defaultPrevented).toBe(true)
  })

  it('leaves the wheel alone once the window is at the top', () => {
    const { wheel, scrollBy } = setup({ scrollY: 0 })
    const e = wheel({ deltaY: -120 })
    expect(scrollBy).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('leaves scrolling down, pinch zoom and a sideways wheel alone', () => {
    const { wheel, scrollBy } = setup({ scrollY: 80 })
    expect(wheel({ deltaY: 120 }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: -120, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: -10, deltaX: -120 }).defaultPrevented).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('does nothing where the element is not a scroller (below lg)', () => {
    const { wheel, scrollBy } = setup({ scrollY: 80, overflows: false })
    expect(wheel({ deltaY: -120 }).defaultPrevented).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
