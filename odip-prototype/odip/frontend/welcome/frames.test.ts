import { afterEach, describe, expect, it } from 'vitest'
import { captionOf, initScrollFrames } from './frames'

function mount() {
  document.body.replaceChildren()
  const wrap = document.createElement('div')
  wrap.innerHTML = [
    ['Trip record at a glance', 'a'],
    ['Accommodation reserved for a trip', 'b'],
  ]
    .map(
      ([caption, id]) =>
        `<figure class="screen"><span class="screen__hint">Swipe sideways to read the whole screen.</span>` +
        `<div class="screen__view"><div class="screen__frame" id="${id}"><img alt="x" /></div></div>` +
        `<figcaption><span class="tag">Sample data</span> ${caption}</figcaption></figure>`,
    )
    .join('')
  document.body.append(wrap)
  return Array.from(document.querySelectorAll<HTMLElement>('.screen__frame'))
}
function size(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
}

describe('scroll frames (screens that scroll sideways on phones)', () => {
  let handle: { destroy(): void } | null = null
  afterEach(() => handle?.destroy())

  it('names a frame from its own caption, without the Sample data tag or the hint', () => {
    const [a] = mount()
    expect(captionOf(a)).toBe('Trip record at a glance')
  })

  it('a scrolling frame is a focusable group (not a landmark) with a name of its own', () => {
    const frames = mount()
    frames.forEach((f) => size(f, 780, 294))
    handle = initScrollFrames(document, window)
    for (const f of frames) {
      expect(f.tabIndex).toBe(0)
      expect(f.getAttribute('role')).toBe('group')
    }
    const labels = frames.map((f) => f.getAttribute('aria-label'))
    expect(labels[0]).toBe('Screen: Trip record at a glance, scrolls sideways')
    expect(labels[1]).toBe('Screen: Accommodation reserved for a trip, scrolls sideways')
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('a frame that does not scroll gets no role, tab stop or hint', () => {
    const frames = mount()
    frames.forEach((f) => size(f, 300, 300))
    handle = initScrollFrames(document, window)
    for (const f of frames) {
      expect(f.hasAttribute('role')).toBe(false)
      expect(f.hasAttribute('tabindex')).toBe(false)
      expect(f.hasAttribute('aria-label')).toBe(false)
    }
    expect(document.querySelectorAll<HTMLElement>('.screen__hint')[0].hidden).toBe(true)
  })

  it('shows the right-edge fade while more is hidden and drops it at the end', () => {
    const [a] = mount()
    size(a, 780, 294)
    handle = initScrollFrames(document, window)
    const view = a.parentElement!
    expect(view.hasAttribute('data-fade')).toBe(true)
    a.scrollLeft = 486
    a.dispatchEvent(new Event('scroll'))
    expect(view.hasAttribute('data-fade')).toBe(false)
    a.scrollLeft = 0
    a.dispatchEvent(new Event('scroll'))
    expect(view.hasAttribute('data-fade')).toBe(true)
  })
})
