import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8')

/** The body of the first `@media (<query>) { ... }` block that contains `needle`. */
function mediaBlock(query: string, needle: string) {
  const re = new RegExp(String.raw`@media \(${query}\) \{`, 'g')
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1, i = re.lastIndex
    for (; depth && i < css.length; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0
    const body = css.slice(re.lastIndex, i - 1)
    if (body.includes(needle)) return body
  }
  return null
}

describe('motion polish CSS contract', () => {
  it('fades an opened fold in over 150ms, only for users without a reduced-motion preference', () => {
    expect(mediaBlock('prefers-reduced-motion: no-preference', 'details[open] > :not(summary)')).toMatch(/details\[open\] > :not\(summary\) \{ animation: foldIn 150ms ease-out; \}/)
    expect(css).toMatch(/@keyframes foldIn \{\s*from \{ opacity: 0; \}/)
  })

  it('keeps spinners turning under reduced motion (a loading signal is essential motion)', () => {
    const reduce = mediaBlock('prefers-reduced-motion: reduce', '.animate-spin')
    expect(reduce).toMatch(/\.animate-spin \{[^}]*animation-duration: 1s !important;[^}]*animation-iteration-count: infinite !important;/)
  })
})
