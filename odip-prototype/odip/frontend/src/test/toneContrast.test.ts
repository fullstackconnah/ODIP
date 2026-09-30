import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TONE, ON_TINT, type Tone } from '@/lib/tone'

/**
 * Tone is never the only cue, but the text it colours still has to be legible. This reads the colour tokens out of
 * src/index.css and holds every pair in `lib/tone.ts` to WCAG AA for normal text (4.5:1): each solid pair (its fill and its
 * on-container text), each soft wash with its ink (a wash is a partly transparent fill, so it is composited over the two
 * surfaces it can sit on, the card and the page, and the worse of the two counts), and the card-white pill a chip becomes
 * on a tint. Reading the CSS rather than copying the hex means a palette change is checked too.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(__dirname, '../index.css'), 'utf-8')
// The @theme block holds the palette and has no nested braces, so its end is the first closing brace.
const themeStart = css.indexOf('@theme')
const themeBlock = css.slice(themeStart, css.indexOf('}', themeStart))

type Rgba = { r: number; g: number; b: number; a: number }

function parseColour(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] }
  throw new Error(`Unsupported colour value in index.css: ${value}`)
}

const TOKENS: Record<string, Rgba> = Object.fromEntries(
  [...themeBlock.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], parseColour(m[2].trim())]),
)

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const luminance = (c: Rgba) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const over = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
})

/** `bg-[var(--color-x)]` or `bg-[var(--color-x)]/30` (an optional `!`) to the token's colour at that opacity. */
function fill(cls: string): Rgba {
  const m = cls.match(/^!?bg-\[var\(--color-([a-z0-9-]+)\)\](?:\/(\d+))?$/)
  if (!m) throw new Error(`Not a background class: ${cls}`)
  const token = TOKENS[m[1]]
  if (!token) throw new Error(`--color-${m[1]} is not defined in index.css`)
  return { ...token, a: token.a * (m[2] === undefined ? 1 : +m[2] / 100) }
}
function text(cls: string): Rgba {
  const m = cls.match(/^text-\[var\(--color-([a-z0-9-]+)\)\]$/)
  if (!m) throw new Error(`Not a text class: ${cls}`)
  const token = TOKENS[m[1]]
  if (!token) throw new Error(`--color-${m[1]} is not defined in index.css`)
  return token
}
const parts = (pair: string) => ({ bg: pair.split(' ').find(c => c.startsWith('bg-'))!, text: pair.split(' ').find(c => c.startsWith('text-'))! })

const AA = 4.5
const TONES = Object.keys(TONE) as Tone[]
// The two surfaces a wash can sit on: the card, and the page behind it.
const SURFACES = { card: TOKENS['card'], page: TOKENS['background'] }

describe('tone contrast (WCAG AA, 4.5:1)', () => {
  it('reads the palette out of index.css (so the checks below cannot pass on an empty parse)', () => {
    for (const name of ['card', 'background', 'primary-fixed', 'on-primary-fixed', 'warning-container', 'on-warning-container', 'error-container', 'on-error-container', 'destructive', 'muted-foreground', 'info', 'secondary-container', 'accessible-container', 'on-accessible-container', 'input']) {
      expect(TOKENS[name], name).toBeDefined()
    }
    expect(Object.keys(TOKENS).length).toBeGreaterThan(30)
  })

  it.each(TONES)('%s solid: the fill and its text', tone => {
    const { bg, text: fg } = parts(TONE[tone].solid)
    expect(contrast(over(fill(bg), SURFACES.card), text(fg)), `${tone} solid ${TONE[tone].solid}`).toBeGreaterThanOrEqual(AA)
  })

  it.each(TONES)('%s soft wash with its ink, over the card and over the page', tone => {
    const wash = TONE[tone].soft
    for (const [name, surface] of Object.entries(SURFACES)) {
      const ratio = contrast(over(fill(wash), surface), text(TONE[tone].ink))
      expect(ratio, `${tone}: ${TONE[tone].ink} on ${wash} over the ${name}`).toBeGreaterThanOrEqual(AA)
    }
  })

  it.each(TONES)('%s ink on the card and on the page', tone => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(surface, text(TONE[tone].ink)), `${tone} ink on the ${name}`).toBeGreaterThanOrEqual(AA)
    }
  })

  it.each(Object.keys(ON_TINT) as Tone[])('%s pill on a tint: the tone\'s text on the card fill', tone => {
    const { bg, text: fg } = parts(ON_TINT[tone]!)
    expect(contrast(over(fill(bg), SURFACES.card), text(fg))).toBeGreaterThanOrEqual(AA)
  })

  it('explains itself: --color-warning is a fill, not a text colour (2.15:1 on the card)', () => {
    // R2-12. The amber is for fills, borders and rings; warning text is `on-warning-container` (TONE.warning.ink).
    expect(contrast(SURFACES.card, TOKENS['warning'])).toBeLessThan(AA)
    expect(contrast(SURFACES.card, text(TONE.warning.ink))).toBeGreaterThanOrEqual(AA)
  })
})
