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
