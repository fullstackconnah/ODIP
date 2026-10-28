import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const INDEX_CSS_PATH = join(__dirname, '../index.css')

describe('design tokens (C-4a)', () => {
  it('defines --color-surface, so the five bg-[var(--color-surface)] usages in AddActivityModal/GenerateClaimModal resolve to a real background instead of rendering unset', () => {
    const css = readFileSync(INDEX_CSS_PATH, 'utf-8')
    const themeBlock = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'))

    // Plain substring, not a regex: "--color-surface-container:" does NOT contain the
    // substring "--color-surface:" (the character after "surface" differs: "-" vs ":"),
    // so this can't be satisfied by the pre-existing -container/-low/-high/-lowest tokens.
    expect(themeBlock).toContain('--color-surface:')
  })
})

describe('mobile card-table captions (density polish)', () => {
  const css = readFileSync(INDEX_CSS_PATH, 'utf-8')
  // The block that turns every DataTable row into a card below 768px: `td::before` prints the column's
  // data-label above its value.
  const mobileBlock = css.slice(css.indexOf('/* Mobile-friendly table card view */'), css.indexOf('/* Material Symbols support */'))
  const caption = mobileBlock.match(/\.mobile-card-table tbody td::before\s*\{([^}]*)\}/)?.[1] ?? ''

  it('finds the caption rule (so the assertions below cannot pass on an empty match)', () => {
    expect(caption).toContain('content: attr(data-label)')
  })

  it('sets the label above each value at the 12px type floor, not 10px', () => {
    const size = caption.match(/font-size:\s*(\d+(?:\.\d+)?)px/)
    expect(size).not.toBeNull()
    expect(Number(size![1])).toBeGreaterThanOrEqual(12)
    expect(caption).not.toMatch(/font-size:\s*(?:9|10|11)px/)
  })

  it('keeps the card layout the caption sits in: hidden header, flex-wrap cards, block caption above the value', () => {
    expect(mobileBlock).toMatch(/\.mobile-card-table thead\s*\{\s*display:\s*none/)
    expect(mobileBlock).toMatch(/\.mobile-card-table tbody tr\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/)
    expect(caption).toMatch(/display:\s*block/)
    expect(caption).toMatch(/margin-bottom:\s*2px/)
    expect(caption).toMatch(/text-transform:\s*uppercase/)
  })

  it('opens the gap between the cells of a card from 8px to 12px only for a touch phone, so two 44px hit areas never overlap', () => {
    // Base card: 0.5rem between cells (a mouse at a narrow window keeps it).
    expect(mobileBlock).toMatch(/\.mobile-card-table tbody tr\s*\{[^}]*gap:\s*0\.5rem/)
    const touch = mobileBlock.match(/@media screen and \(width < 48rem\) and \(pointer: coarse\)\s*\{\s*\.mobile-card-table tbody tr\s*\{([^}]*)\}/)
    expect(touch).not.toBeNull()
    expect(touch![1]).toMatch(/gap:\s*0\.75rem/)
  })

  it('has no other font-size below 12px in the card-table block', () => {
    const sizes = [...mobileBlock.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(0)
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12)
  })
})

describe('light palette unchanged (dark-mode-2026-10)', () => {
  const css = readFileSync(INDEX_CSS_PATH, 'utf-8')
  const themeStart = css.indexOf('@theme')
  const themeBlock = css.slice(themeStart, css.indexOf('}', themeStart))
  const parsed = Object.fromEntries([...themeBlock.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))

  // origin/main's 42 light values, verbatim, plus the three tokens dark mode adds with light values equal to today's pixels, plus the four chart tokens (budget-graph-2026-10).
  const LIGHT = {
    'background': '#fbf9f5',
    'foreground': '#1b1c1a',
    'card': '#ffffff',
    'card-foreground': '#1b1c1a',
    'popover': '#ffffff',
    'popover-foreground': '#1b1c1a',
    'primary': '#396200',
    'primary-foreground': '#ffffff',
    'primary-container': '#4d7c0f',
    'primary-fixed': '#bbf37c',
    'on-primary-fixed': '#0f2000',
    'secondary': '#515f74',
    'secondary-foreground': '#ffffff',
    'secondary-container': '#d5e3fc',
    'muted': '#efeeea',
    'muted-foreground': '#43493a',
    'accent': '#efeeea',
    'accent-foreground': '#1b1c1a',
    'destructive': '#ba1a1a',
    'destructive-foreground': '#ffffff',
    'error-container': '#ffdad6',
    'on-error-container': '#93000a',
    'border': '#c3c9b5',
    'input': '#e4e2de',
    'ring': '#396200',
    'sidebar': '#f5f3ef',
    'sidebar-foreground': '#1b1c1a',
    'sidebar-accent': 'rgba(255,255,255,0.4)',
    'surface': '#ffffff',
    'surface-container': '#efeeea',
    'surface-container-low': '#f5f3ef',
    'surface-container-high': '#eae8e4',
    'surface-container-lowest': '#ffffff',
    'outline-variant': '#c3c9b5',
    'success': '#396200',
    'warning': '#f59e0b',
    'warning-container': '#fef3c7',
    'on-warning-container': '#92400e',
    'info': '#515f74',
    'conflict': '#ba1a1a',
    'accessible-container': '#ffd7ef',
    'on-accessible-container': '#7a2169',
    'warning-foreground': '#1b1c1a',
    'hover-wash': 'rgba(0,0,0,0.05)',
    'focus-ring-soft': 'rgba(57,98,0,0.18)',
    'chart-budget': '#7a8070',
    'chart-actual': 'var(--color-primary)',
    'chart-expected': '#2f6db5',
    'chart-grid': 'var(--color-border)',
  }

  it('keeps every light value, and adds the three dark-mode tokens and the four chart tokens (budget-graph-2026-10)', () => {
    expect(parsed).toEqual(LIGHT)
  })

  it('keeps the four shadow tokens equal to the literals they replaced', () => {
    const shadow = (name: string) => css.match(new RegExp('^\\s*--shadow-' + name + ':\\s*([^;]+);', 'm'))?.[1]
    expect(shadow('float')).toBe('0 24px 40px -12px rgba(27,28,26,0.14)')
    expect(shadow('hairline')).toBe('0 24px 32px -12px rgba(27,28,26,0.04)')
    expect(shadow('hairline-up')).toBe('0 -8px 24px -4px rgba(27,28,26,0.04)')
    expect(shadow('lift')).toBe('0 24px 32px -12px rgba(27,28,26,0.08)')
  })
})
