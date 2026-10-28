import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8')

describe('checkbox and radio accent', () => {
  it('themes every checkbox and radio from the primary token in one base rule', () => {
    const base = css.slice(css.indexOf('@layer base'))
    expect(base).toMatch(/input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{\s*accent-color:\s*var\(--color-primary\);?\s*\}/)
  })
})
