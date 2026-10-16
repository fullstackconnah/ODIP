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
  '--color-surface': '#ffffff',
  '--color-foreground': '#1b1c1a',
  '--color-muted-foreground': '#43493a',
  '--color-primary': '#396200',
  '--color-primary-fixed': '#bbf37c',
  '--color-on-primary-fixed': '#0f2000',
  '--color-secondary': '#515f74',
  '--color-surface-container-low': '#f5f3ef',
  '--color-input': '#e4e2de',
  '--color-border': '#c3c9b5',
  '--color-destructive': '#ba1a1a',
  '--color-error-container': '#ffdad6',
  '--color-on-error-container': '#93000a',
  '--color-warning-container': '#fef3c7',
  '--color-on-warning-container': '#92400e',
  '--radius-md': '0.5rem',
  '--radius-lg': '0.75rem',
  '--font-sans': "'manrope', system-ui, -apple-system, sans-serif",
  '--font-display': "'plus jakarta sans', system-ui, -apple-system, sans-serif",
}

describe("landing tokens are the app's tokens", () => {
  it('reads both token blocks (so the checks below cannot pass on an empty parse)', () => {
    expect(app.size).toBeGreaterThan(30)
    expect(landing.size).toBeGreaterThan(25)
  })

  it.each(Object.keys(REQUIRED))('%s matches the app, by name', (name) => {
    expect(app.get(name), `${name} in src/index.css`).toBeDefined()
    expect(landing.get(name), `${name} in welcome.css`).toBe(app.get(name))
  })

  it('the app still has the values the brief named', () => {
    for (const [name, value] of Object.entries(REQUIRED)) expect(app.get(name)).toBe(value)
  })

  it('every other app token the landing declares (colours, radii, faces) has the app value too', () => {
    const shared = [...landing.keys()].filter((name) => app.has(name))
    expect(shared.length).toBeGreaterThanOrEqual(19)
    for (const name of shared) expect(landing.get(name), name).toBe(app.get(name))
  })

  it('uses pure white only as the white ground token (owner, 2026-10-16), and never pure black', () => {
    const code = landingCss.replace(/\/\*[\s\S]*?\*\//g, '') // comments may say "white ground"
    expect(code.match(/#fff\b|#ffffff\b/gi)).toEqual(['#ffffff']) // --color-surface only
    expect(code).toMatch(/--color-surface:\s*#ffffff;/)
    expect(code).not.toMatch(/#000\b|#000000\b|(?<![\w-])(white|black)(?![\w-])|rgb\(\s*0\s+0\s+0\b/i)
  })
})
