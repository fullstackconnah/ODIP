import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * The accessibility statement (/accessibility) says on-screen text is never smaller than 12px. Tailwind's smallest step,
 * text-xs, is 12px, so the only ways under it are an arbitrary text-[..] size, a CSS font-size or font shorthand, or an inline
 * fontSize. This scans for all three in the app (src) and the landing (welcome). PDF documents (@react-pdf/renderer) are not
 * screens and are excluded; the statement lists them as a known limit.
 */
const ROOT = join(__dirname, '../..')
const FLOOR_PX = 12

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'assets') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files(full, out)
    else if (/\.(tsx?|css|html)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const px = (value: string, unit: string) => Number(value) * (unit === 'px' ? 1 : 16)

/** Every font size under the floor in one source text, as `"<what>"` strings. */
function sizesUnderFloor(source: string): string[] {
  const found: string[] = []
  for (const m of source.matchAll(/text-\[(\d*\.?\d+)(px|rem|em)\]/g)) if (px(m[1], m[2]) < FLOOR_PX) found.push(m[0])
  for (const m of source.matchAll(/font(?:-size)?\s*:\s*([^;}\n]+)/g)) {
    for (const v of m[1].matchAll(/(\d*\.?\d+)(px|rem)\b/g)) if (px(v[1], v[2]) < FLOOR_PX) found.push(m[0].trim())
  }
  for (const m of source.matchAll(/fontSize\s*:\s*['"]?(\d*\.?\d+)(px|rem)?/g)) if (px(m[1], m[2] ?? 'px') < FLOOR_PX) found.push(m[0])
  return found
}

describe('on-screen text floor: 12px', () => {
  it('finds a size under the floor in each form it can take (the scan bites)', () => {
    expect(sizesUnderFloor('<p className="text-[11px]">')).toEqual(['text-[11px]'])
    expect(sizesUnderFloor('a { font-size: 0.6875rem; }')).toHaveLength(1)
    expect(sizesUnderFloor('a { font: 600 0.7rem/1.3 var(--font-sans); }')).toHaveLength(1)
    expect(sizesUnderFloor('<span style={{ fontSize: 10 }}>')).toHaveLength(1)
    expect(sizesUnderFloor('<p className="text-xs text-[13px]"> a { font: 400 1rem/1.6 x; font-size: 0.75rem }')).toEqual([])
  })

  it('has no size under 12px in the app or the landing', () => {
    const offenders = files(join(ROOT, 'src'))
      .concat(files(join(ROOT, 'welcome')))
      .filter((f) => !readFileSync(f, 'utf-8').includes('@react-pdf/renderer'))
      .flatMap((f) => sizesUnderFloor(readFileSync(f, 'utf-8')).map((s) => `${relative(ROOT, f).split(sep).join('/')}: ${s}`))
    expect(offenders).toEqual([])
  })
})
