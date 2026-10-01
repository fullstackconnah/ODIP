import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The landing page is the same product as the app, so it takes the app's tokens by value. This test reads the app's
// token source (src/index.css, the @theme block) and the landing's :root block, and maps them by token name: if the
// app changes a green, this fails until the landing follows.
const appCss = readFileSync(join(__dirname, '../src/index.css'), 'utf-8')
const landingCss = readFileSync(join(__dirname, 'welcome.css'), 'utf-8')

function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().toLowerCase().replace(/\s+/g, ' '))
  return out
}
const blockAfter = (css: string, opener: RegExp) => {
  const start = css.search(opener)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const app = tokens(blockAfter(appCss, /@theme\s*\{/))
const landing = tokens(blockAfter(landingCss, /:root\s*\{/))

const REQUIRED = {
  '--color-primary': '#396200',
  '--color-primary-container': '#4d7c0f',
  '--color-primary-fixed': '#bbf37c',
  '--color-on-primary-fixed': '#0f2000',
  '--color-background': '#fbf9f5',
  '--color-border': '#c3c9b5',
  '--color-foreground': '#1b1c1a',
  '--color-input': '#e4e2de',
}

describe("landing tokens are the app's tokens", () => {
  it('reads both token blocks (so the checks below cannot pass on an empty parse)', () => {
    expect(app.size).toBeGreaterThan(30)
    expect(landing.size).toBeGreaterThan(15)
  })

  it.each(Object.keys(REQUIRED))('%s matches the app, by name', (name) => {
    expect(app.get(name), `${name} in src/index.css`).toBeDefined()
    expect(landing.get(name), `${name} in welcome.css`).toBe(app.get(name))
  })

  it('the app still has the values the brief named (Ledger Olive, Deep Fern, Pale Sprout, Forest, Warm Paper, Ruled Line, Ledger Ink, Field Grey)', () => {
    for (const [name, value] of Object.entries(REQUIRED)) expect(app.get(name)).toBe(value)
  })

  it('every other app token the landing declares (colours, radii, faces) has the app value too', () => {
    const shared = [...landing.keys()].filter((name) => app.has(name))
    expect(shared.length).toBeGreaterThanOrEqual(19)
    for (const name of shared) expect(landing.get(name), name).toBe(app.get(name))
  })

  it('never uses pure white or pure black', () => {
    // The colour keywords only: `white-space` is not a colour.
    expect(landingCss).not.toMatch(/#fff\b|#ffffff\b|#000\b|#000000\b|(?<![\w-])(white|black)(?![\w-])|rgb\(\s*255\s+255\s+255|rgb\(\s*0\s+0\s+0\b/i)
  })
})
