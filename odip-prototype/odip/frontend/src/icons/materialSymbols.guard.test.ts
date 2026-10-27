import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATERIAL_SYMBOLS } from './materialSymbols'

const SRC = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

// Names the app can render: span text inside an element whose className (either quote style, or a
// template literal) holds material-symbols-outlined anywhere (literal, or the quoted arms of an
// expression), `msIcon: 'x'` / `msIcon="x"` / `msIcon={'x'}` values and `factIcon('x')` arguments.
function usedNames(code: string): string[] {
  const names: string[] = []
  for (const m of code.matchAll(/className=\{?\s*(["'`])(?:(?!\1)[^])*material-symbols-outlined(?:(?!\1)[^])*\1\s*\}?[^>]*>([^<]*)</g)) {
    const body = m[2].trim()
    if (body.startsWith('{')) for (const q of body.matchAll(/["']([a-z0-9_]+)["']/g)) names.push(q[1])
    else if (body) names.push(body)
  }
  for (const m of code.matchAll(/(?:msIcon(?::\s*|=\{?\s*)|factIcon\(\s*)(["'])([a-z0-9_]+)\1/g)) names.push(m[2])
  return names
}

describe('MATERIAL_SYMBOLS', () => {
  it('is sorted with no duplicates', () => {
    expect([...MATERIAL_SYMBOLS]).toEqual([...new Set(MATERIAL_SYMBOLS)].sort())
  })

  it('lists every icon name the app renders', () => {
    const missing = sources(SRC).flatMap((file) =>
      usedNames(readFileSync(file, 'utf8')).filter((n) => !MATERIAL_SYMBOLS.includes(n)).map((n) => `${n} (${file})`),
    )
    expect(missing).toEqual([])
  })
})
