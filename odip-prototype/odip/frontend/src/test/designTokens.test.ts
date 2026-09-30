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
    const touch = mobileBlock.match(/@media screen and \(max-width: 767px\) and \(pointer: coarse\)\s*\{\s*\.mobile-card-table tbody tr\s*\{([^}]*)\}/)
    expect(touch).not.toBeNull()
    expect(touch![1]).toMatch(/gap:\s*0\.75rem/)
  })

  it('has no other font-size below 12px in the card-table block', () => {
    const sizes = [...mobileBlock.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(0)
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12)
  })
})
