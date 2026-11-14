import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * Bracketed pixel values (`h-[44px]`) are budgeted per file in px-budget.json: a file may never gain one, and the
 * baseline only ever goes down (fix them as you touch a file, then `UPDATE_PX_BUDGET=1 npx vitest run src/pxBudget.test.ts`).
 */
const PX = /\[-?\d+(\.\d+)?px\]/g
const FE = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(FE, 'src')
const BASELINE = join(FE, 'px-budget.json')

export type Counts = Record<string, number>

export const countPx = (text: string): number => text.match(PX)?.length ?? 0

/** over: files above baseline (a new file has baseline 0); under: files below it or gone from the scan. */
export function compare(baseline: Counts, now: Counts) {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(now)])].sort()
  const over: { file: string; was: number; now: number }[] = []
  const under: string[] = []
  for (const file of files) {
    const was = baseline[file] ?? 0
    const cur = now[file] ?? 0
    if (cur > was) over.push({ file, was, now: cur })
    else if (cur < was) under.push(file)
  }
  return { over, under }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function scan(): Counts {
  const counts: Counts = {}
  for (const full of sourceFiles(SRC)) {
    const n = countPx(readFileSync(full, 'utf-8'))
    if (n > 0) counts[relative(SRC, full).split(sep).join('/')] = n
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)))
}

describe('countPx and compare', () => {
  it('counts bracketed px values only', () => {
    expect(countPx('h-[44px]')).toBe(1)
    expect(countPx('w-[calc(100%-8px)]')).toBe(0)
    expect(countPx('[13px] [13px]')).toBe(2)
    expect(countPx('[1.5px]')).toBe(1)
    expect(countPx('[2rem]')).toBe(0)
    expect(countPx('a\r\n[3px]\r\n[4px]')).toBe(2)
  })

  it('compares over, under, missing and new files', () => {
    expect(compare({ a: 2 }, { a: 2 })).toEqual({ over: [], under: [] })
    expect(compare({ a: 2 }, { a: 3 })).toEqual({ over: [{ file: 'a', was: 2, now: 3 }], under: [] })
    expect(compare({ a: 2 }, { a: 1 })).toEqual({ over: [], under: ['a'] })
    expect(compare({ a: 2 }, {})).toEqual({ over: [], under: ['a'] })
    expect(compare({}, { b: 1 })).toEqual({ over: [{ file: 'b', was: 0, now: 1 }], under: [] })
  })
})

describe('px budget', () => {
  it('no file gains a bracketed px value, and the baseline is current', () => {
    const now = scan()
    expect(Object.keys(now).length).toBeGreaterThan(50) // not silently empty
    const baseline: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf-8')) : {}
    const { over, under } = compare(baseline, now)
    const overMsg = over.map(o => `${o.file}: was ${o.was}, now ${o.now}`).join('\n')
    // The update run refuses to raise a count: with any file over, it fails like a plain run and writes nothing.
    if (process.env.UPDATE_PX_BUDGET === '1' && over.length === 0) {
      writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n')
      return
    }
    expect(over, `${overMsg}\nUse a size token (for example \`--control-h\`, \`--tap-min\`) or the spacing scale instead of a bracketed px value. See DESIGN.md.`).toEqual([])
    expect(under, 'px-budget.json is out of date: run `UPDATE_PX_BUDGET=1 npx vitest run src/pxBudget.test.ts` and commit the file').toEqual([])
  })
})
