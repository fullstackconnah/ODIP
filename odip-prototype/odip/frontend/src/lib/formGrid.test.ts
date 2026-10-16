import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { formGrid, span } from './formGrid'

const SRC = resolve(__dirname, '..')

describe('span.date', () => {
  it('is one of the two columns below xl and six of the twelve from xl', () => {
    expect(span.date.split(' ')).toEqual(['md:col-span-1', 'xl:col-span-6'])
  })

  it('is wider than span.short at xl: a date (165px) or date-time (241px) control does not fit in 3 of 12 columns', () => {
    const xl = (s: string) => Number(/xl:col-span-(\d+)/.exec(s)![1])
    expect(xl(span.date)).toBeGreaterThan(xl(span.short))
    // ...and it is a real 12-column span, so the formGrid still tiles: two date fields share a row.
    expect(formGrid).toContain('xl:grid-cols-12')
    expect(xl(span.date) * 2).toBeLessThanOrEqual(12)
  })
})

/** Every non-test .tsx under src, as [relative path, source]. */
function sourceFiles(): [string, string][] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f))
    .map((f) => [relative(SRC, join(SRC, f)), readFileSync(join(SRC, f), 'utf8')] as [string, string])
}

/** The index of the `>` that ends the JSX opening tag starting at `start`, skipping `{…}` expressions (arrow functions) and quoted strings. */
function openingTagEnd(src: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return src.length
}

describe('date controls never sit in a span.short cell', () => {
  // R3 F-05: `short` (3 of 12 columns) is narrower than a native date or date-time control, so the year or the AM/PM segment
  // was cut off (measured at 1280-1536). Every FormField that wraps one takes `span.date`. jsdom does no layout, so this scans
  // the source for the pairing that caused it: a `span.short` element whose own subtree holds a date / datetime-local input.
  it('no element with span.short wraps <input type="date"> or type="datetime-local"', () => {
    const offenders: string[] = []
    for (const [file, src] of sourceFiles()) {
      for (const m of src.matchAll(/span\.short/g)) {
        const start = src.lastIndexOf('<', m.index)
        const tag = /^[A-Za-z]+/.exec(src.slice(start + 1))?.[0] ?? ''
        const open = openingTagEnd(src, start)
        // A self-closing element is only its own tag: scanning on would flag the next field (a Postcode just above a Date of birth).
        let end = src[open - 1] === '/' ? open : src.indexOf(`</${tag}>`, m.index)
        if (end < 0 || end - start > 1500) end = Math.min(src.length, start + 600)
        const window = src.slice(start, end)
        if (/type=["'](date|datetime-local)["']/.test(window)) {
          offenders.push(`${file}:${src.slice(0, m.index).split('\n').length} ${/label="([^"]+)"/.exec(window)?.[1] ?? tag}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the scan sees the date fields it protects (so it cannot pass vacuously)', () => {
    let dateSpans = 0
    for (const [, src] of sourceFiles()) dateSpans += (src.match(/span\.date/g) ?? []).length
    expect(dateSpans).toBeGreaterThanOrEqual(29)
  })
})
