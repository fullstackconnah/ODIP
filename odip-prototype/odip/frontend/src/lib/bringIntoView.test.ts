import { afterEach, describe, expect, it, vi } from 'vitest'
import { bringIntoView } from './bringIntoView'

// Scrolling a block the person needs to see (a budget refusal at the foot of a long form, the emergency card that just grew) by the least distance: instant under reduced motion and where the browser cannot say.

const realMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = realMatchMedia
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

const motion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia
}

describe('bringIntoView', () => {
  it('scrolls by the least distance, smoothly while motion is allowed', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    motion(false)

    bringIntoView(document.createElement('div'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
  })

  it('is instant under reduced motion', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    motion(true)

    bringIntoView(document.createElement('div'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
  })

  it('is instant where the browser cannot say whether motion is wanted', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    ;(window as { matchMedia?: unknown }).matchMedia = undefined

    bringIntoView(document.createElement('div'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
  })

  it('does nothing for no element, or for an element that cannot scroll into view (jsdom)', () => {
    expect(() => bringIntoView(null)).not.toThrow()
    expect(() => bringIntoView(undefined)).not.toThrow()
    expect(() => bringIntoView(document.createElement('div'))).not.toThrow()
  })
})
