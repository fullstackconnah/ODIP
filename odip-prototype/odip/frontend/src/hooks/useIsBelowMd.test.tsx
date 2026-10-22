import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIsBelowMd } from './useIsBelowMd'

// card42: the phone-card CSS and the hook once split at 767px and 48rem, so a width in [767, 768) got the desktop table with the phone's select-all.
const css = readFileSync(join(__dirname, '../index.css'), 'utf-8')

/** matchMedia over a fake viewport: understands only the `(min-width: Nrem)` query the hook asks. */
function viewport(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const rem = Number(/min-width:\s*([\d.]+)rem/.exec(query)?.[1])
    return { matches: px >= rem * 16, addEventListener: () => {}, removeEventListener: () => {} }
  })
}

describe('useIsBelowMd and the phone-card CSS share one breakpoint (48rem)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([[767, true], [767.5, true], [767.99, true], [768, false], [1024, false]])('at %spx below md is %s', (px, below) => {
    viewport(px)
    expect(renderHook(() => useIsBelowMd()).result.current).toBe(below)
  })

  it('every phone media query in index.css is the exact complement, (width < 48rem), never a 767px literal', () => {
    expect(css).not.toMatch(/max-width:\s*767px/)
    expect(css.match(/\(width < 48rem\)/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
