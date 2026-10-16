import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from './index.html?raw'
import { initDay } from './motion'

// CSS is read from disk: the test run does not process CSS (vite.config.ts `css: false`).
const css = readFileSync(join(__dirname, 'welcome.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
const SLOTS = ['t0830', 't1000', 't1130', 't1300', 't1430', 't1600', 'onshift']

class FakeIO {
  static all: FakeIO[] = []
  observed = new Set<Element>()
  cb: IntersectionObserverCallback
  opts: IntersectionObserverInit
  // explicit fields, not parameter properties: tsconfig has erasableSyntaxOnly
  constructor(cb: IntersectionObserverCallback, opts: IntersectionObserverInit = {}) {
    this.cb = cb
    this.opts = opts
    FakeIO.all.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() {}
  hit(idOrEl: string | Element, isIntersecting = true) {
    const target = typeof idOrEl === 'string' ? document.getElementById(idOrEl)! : idOrEl
    this.cb([{ target, isIntersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}
const arrive = () => FakeIO.all.find((o) => o.opts.rootMargin === '0px 0px -12% 0px')!
const centre = () => FakeIO.all.find((o) => o.opts.rootMargin === '-45% 0px -50% 0px')!
// jsdom has no layout: give each rail stop an offsetTop of 80 * index
const layOut = () => document.querySelectorAll<HTMLElement>('.rail [data-for]').forEach((li, i) => Object.defineProperty(li, 'offsetTop', { configurable: true, value: 80 * i }))
const html = document.documentElement
const dot = () => document.querySelector<HTMLElement>('.rail__dot')!
const nowStops = () => Array.from(document.querySelectorAll('.rail .is-now')).map((li) => li.getAttribute('data-for'))
const arrived = (id: string) => document.getElementById(id)!.hasAttribute('data-in')
const shotsOf = (id: string) => Array.from(document.querySelectorAll(`#${id} .shot`))

const pageBody = new DOMParser().parseFromString(indexHtml, 'text/html').body.innerHTML

beforeEach(() => {
  FakeIO.all = []
  history.replaceState(null, '', '/')
  document.body.innerHTML = pageBody
  html.classList.remove('js')
  html.style.cssText = ''
  vi.stubGlobal('IntersectionObserver', FakeIO)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('initDay: the slots arrive and the now dot follows the day', () => {
  it('sets html.js, after both observers are attached', () => {
    initDay()
    // The 7 slots (their "Before" strike) and the 11 screens, each on its own.
    expect([arrive().observed.size, centre().observed.size]).toEqual([18, 7])
    expect(html.classList.contains('js')).toBe(true)
  })

  it('a screen settles when it enters the viewport itself, not when its slot heading does', () => {
    initDay()
    arrive().hit('t1130')
    expect([arrived('t1130'), shotsOf('t1130').map((s) => s.hasAttribute('data-in'))]).toEqual([true, [false, false]])
    const [first, second] = shotsOf('t1130')
    arrive().hit(first)
    expect([first.hasAttribute('data-in'), second.hasAttribute('data-in'), arrive().observed.has(first)]).toEqual([true, false, false])
  })

  it('an intersecting slot gets data-in once and is unobserved', () => {
    initDay()
    arrive().hit('t1000', false)
    expect(arrived('t1000')).toBe(false)
    arrive().hit('t1000')
    expect(arrived('t1000')).toBe(true)
    expect(arrive().observed.has(document.getElementById('t1000')!)).toBe(false)
  })

  it('the centre band moves the dot by its own transform and sets is-now', () => {
    layOut()
    initDay()
    centre().hit('t1130')
    expect(dot().style.transform).toBe('translateY(160px)')
    expect(nowStops()).toEqual(['t1130'])
    expect(html.style.cssText).toBe('')
  })

  it('a fast scroll retargets: the last centre hit wins', () => {
    layOut()
    initDay()
    centre().hit('t1000')
    centre().hit('t1600')
    expect(dot().style.transform).toBe('translateY(400px)')
    expect(nowStops()).toEqual(['t1600'])
  })

  it('resize re-places the dot', () => {
    layOut()
    initDay()
    Object.defineProperty(document.querySelector('.rail [data-for]')!, 'offsetTop', { configurable: true, value: 12 })
    window.dispatchEvent(new Event('resize'))
    expect(dot().style.transform).toBe('translateY(12px)')
  })

  it('marks slots already in view as arrived before html.js is set', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900)
    vi.spyOn(document.getElementById('t1430')!, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 900 } as DOMRect)
    initDay()
    expect(arrived('t1430')).toBe(true)
    expect(arrive().observed.has(document.getElementById('t1430')!)).toBe(false)
    expect(arrive().observed.has(document.getElementById('t0830')!)).toBe(true)
    // its screens are below the fold (zero rects here), so they still wait for their own arrival
    expect(shotsOf('t1430').every((s) => !s.hasAttribute('data-in') && arrive().observed.has(s))).toBe(true)
  })

  it('marks screens already in view as arrived before html.js is set', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900)
    const [shot] = shotsOf('t1000')
    vi.spyOn(shot, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 1200 } as DOMRect)
    initDay()
    expect([shot.hasAttribute('data-in'), arrive().observed.has(shot), arrived('t1000')]).toEqual([true, false, false])
  })

  it('leaves html.js unset when IntersectionObserver throws, so nothing stays hidden', () => {
    vi.stubGlobal('IntersectionObserver', class { constructor() { throw new Error('no observers here') } })
    expect(() => initDay()).toThrow()
    expect(html.classList.contains('js')).toBe(false)
  })

  it('a slot named by location.hash arrives at boot, even before the browser has scrolled to it', () => {
    history.replaceState(null, '', '#t1430')
    initDay()
    expect(arrived('t1430')).toBe(true)
    expect(shotsOf('t1430').every((s) => s.hasAttribute('data-in'))).toBe(true)
    expect(arrived('t1000')).toBe(false)
  })

  it('without IntersectionObserver, every slot arrives and nothing is hidden', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    initDay()
    expect(SLOTS.map(arrived)).toEqual(SLOTS.map(() => true))
    expect(Array.from(document.querySelectorAll('.shot')).every((s) => s.hasAttribute('data-in'))).toBe(true)
    expect(html.classList.contains('js')).toBe(false)
  })
})

/** The CSS rules with their selectors, @keyframes dropped and @media blocks flattened (one level of nesting is all welcome.css uses). */
function rules(source: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = []
  const walk = (text: string) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      for (; depth && j < text.length; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0
      const inner = text.slice(open + 1, j - 1)
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(inner)
      else if (!head.startsWith('@keyframes')) out.push({ selector: head, body: inner })
      i = j
    }
  }
  walk(source)
  return out
}
const mediaBlocks = (source: string, query: string) => {
  const blocks: string[] = []
  let at = source.indexOf(query)
  while (at >= 0) {
    const open = source.indexOf('{', at)
    let depth = 1
    let j = open + 1
    for (; depth; j++) depth += source[j] === '{' ? 1 : source[j] === '}' ? -1 : 0
    blocks.push(source.slice(open + 1, j - 1))
    at = source.indexOf(query, j)
  }
  return blocks.join('\n')
}

describe('the motion CSS', () => {
  it('every hidden start in welcome.css is scoped to .js', () => {
    const hiding = rules(css).filter((r) => /opacity:\s*0\s*[;}]|opacity:\s*0\s*$|scaleX\(0\)/.test(r.body))
    expect(hiding.length).toBeGreaterThanOrEqual(3)
    for (const r of hiding) for (const sel of r.selector.split(',')) expect(sel.trim(), sel).toMatch(/^\.js /)
  })

  it('print shows every hidden start, with selectors at least as specific as the ones that hide', () => {
    const print = mediaBlocks(css, '@media print')
    expect(print).toMatch(/\.js \.shot:not\(\[data-in\]\)\s*\{\s*opacity:\s*1;\s*transform:\s*none;?\s*\}/)
    expect(print).toMatch(/\.js \.slot:not\(\[data-in\]\) \.slot__before h3 span::after\s*\{\s*transform:\s*none;\s*opacity:\s*1;?\s*\}/)
  })

  it('reduced motion becomes short fades: the CSS AccessibilityPage cites', () => {
    const reduced = mediaBlocks(css, '@media (prefers-reduced-motion: reduce)')
    expect(reduced).toMatch(/\.btn:active[^{]*\{[^}]*transform:\s*none/)
    expect(reduced).toMatch(/\.rail__dot\s*\{\s*transition:\s*none;\s*\}/)
    expect(reduced).toMatch(/\.js \.slot \.shot\s*\{\s*transition:\s*opacity [^;,}]+;?\s*\}/)
    expect(reduced).toMatch(/\.js \.shot:not\(\[data-in\]\)\s*\{\s*transform:\s*none;\s*\}/)
    expect(reduced).toMatch(/\.plan li:first-child a::before\s*\{\s*animation:\s*fade/)
    expect(reduced).not.toMatch(/transition:[^;}]*transform/)
  })
})

describe('main.ts boots the page', () => {
  it('the form is enabled and html.js is set', async () => {
    vi.resetModules()
    await import('./main')
    expect(document.querySelector<HTMLButtonElement>('[data-submit]')!.disabled).toBe(false)
    expect(document.querySelector<HTMLElement>('[data-nojs]')!.hidden).toBe(true)
    expect(html.classList.contains('js')).toBe(true)
  })
})
