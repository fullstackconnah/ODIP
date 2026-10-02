import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentSection, initSections } from './sections'

describe('section index: which section is being read', () => {
  it('is the last section whose top has passed the reading line', () => {
    expect(currentSection([900, 2000, 3000], 400)).toBe(-1)
    expect(currentSection([300, 2000, 3000], 400)).toBe(0)
    expect(currentSection([-1500, -200, 401], 400)).toBe(1)
    expect(currentSection([-3000, -2000, -10], 400)).toBe(2)
    expect(currentSection([], 400)).toBe(-1)
  })
})

describe('section index: aria-current follows the reader', () => {
  let handle: { destroy(): void } | null = null
  afterEach(() => {
    handle?.destroy()
    handle = null
    vi.restoreAllMocks()
  })

  it('marks exactly one link as the current location once its section reaches the line', () => {
    document.body.innerHTML = `
      <nav aria-label="Sections">
        <a href="#before" data-section-link>Before</a><a href="#during" data-section-link>During</a>
      </nav>
      <section id="before"></section><section id="during"></section>`
    const top = { before: 100, during: 2000 }
    for (const id of ['before', 'during'] as const) {
      vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockImplementation(() => ({ top: top[id] }) as DOMRect)
    }
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    handle = initSections(document, window)
    const links = Array.from(document.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['location', null])
  })
})
