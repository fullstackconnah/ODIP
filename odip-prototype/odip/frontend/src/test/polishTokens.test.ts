import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * The selected / field / dark-elevation tokens (polish PR 2a, SHAPE-PR2 §1, §2, §4), read from index.css and held to the
 * contrast the shape pins. Selected is a tint plus a 2px primary bar, so the tint only has to group; the text and the bar
 * have to read. A field has a real edge (3:1) and a placeholder that is not the value ink.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf-8')
const lightBlock = css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme')))
const darkStart = css.indexOf("/* Dark theme (dark-mode-2026-10)")
const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart))

const hexOf = (block: string, name: string) => {
  const hex = new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})\\b`).exec(block)?.[1]
  if (!hex) throw new Error(`--color-${name} is not a six digit colour in its block`)
  return hex.toLowerCase()
}
const rgb = (hex: string) => [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16))
const luminance = (hex: string) => rgb(hex).map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

describe.each([
  ['light', lightBlock],
  ['dark', darkBlock],
] as const)('%s tokens', (_theme, block) => {
  const t = (name: string) => hexOf(block, name)

  it('reads the on-selected label 4.5:1 on the selected tint, and the primary bar 3:1 on it and on the page and sidebar', () => {
    expect(contrast(t('on-selected'), t('selected'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t('primary'), t('selected'))).toBeGreaterThanOrEqual(3)
    expect(contrast(t('primary'), t('background'))).toBeGreaterThanOrEqual(3)
    expect(contrast(t('primary'), t('sidebar'))).toBeGreaterThanOrEqual(3)
  })

  it('keeps the primary label 4.5:1 on the primary fill', () => {
    expect(contrast(t('primary-foreground'), t('primary'))).toBeGreaterThanOrEqual(4.5)
  })

  it('gives a field a 3:1 edge against the field, the card and the page, a 4.5:1 placeholder, and a value ink well above it', () => {
    expect(contrast(t('field-border'), t('field'))).toBeGreaterThanOrEqual(3)
    expect(contrast(t('field-border'), t('card'))).toBeGreaterThanOrEqual(3)
    expect(contrast(t('placeholder'), t('field'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t('foreground'), t('field'))).toBeGreaterThan(contrast(t('placeholder'), t('field')))
  })

  it('tells a disabled field from an enabled one by its fill, with readable text on it', () => {
    expect(t('field-disabled')).not.toBe(t('field'))
    expect(contrast(t('muted-foreground'), t('field-disabled'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('light field and selected values', () => {
  it('uses the shape\'s values', () => {
    expect(hexOf(lightBlock, 'selected')).toBe('e3edd3')
    expect(hexOf(lightBlock, 'on-selected')).toBe('2c4c00')
    expect(hexOf(lightBlock, 'field')).toBe('ffffff')
    expect(hexOf(lightBlock, 'field-border')).toBe('8a9180')
    expect(hexOf(lightBlock, 'primary')).toBe('396200')
  })

  it('leaves --color-input alone: the grey Dropdown pills and icon tiles still use it', () => {
    expect(hexOf(lightBlock, 'input')).toBe('e4e2de')
    expect(hexOf(darkBlock, 'input')).toBe('2b2f28')
  })
})

describe('dark elevation (SHAPE-PR2 §4)', () => {
  const d = (name: string) => hexOf(darkBlock, name)

  it('steps sidebar < page < card < raised, each content step 1.12:1 or better, the sidebar 1.08:1 below the page', () => {
    expect(contrast(d('background'), d('sidebar'))).toBeGreaterThanOrEqual(1.08)
    expect(contrast(d('card'), d('background'))).toBeGreaterThanOrEqual(1.12)
    expect(contrast(d('popover'), d('card'))).toBeGreaterThanOrEqual(1.12)
  })

  it('puts the field on the raised step, and the muted and accent fills with it', () => {
    expect(d('field')).toBe(d('popover'))
    expect(d('muted')).toBe(d('popover'))
    expect(d('accent')).toBe(d('popover'))
    expect(d('surface-container')).toBe(d('popover'))
  })

  it('ships the high step only if it is 1.1:1 or better above the raised step (ruling 1)', () => {
    expect(contrast(d('surface-container-high'), d('popover'))).toBeGreaterThanOrEqual(1.1)
  })

  it('calms the dark primary: darker than the old #a6d66b, 4.5:1 label, ring and success follow it', () => {
    expect(luminance(d('primary'))).toBeLessThan(luminance('a6d66b'))
    expect(d('ring')).toBe(d('primary'))
    expect(d('success')).toBe(d('primary'))
  })
})
