import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * An undefined `--color-*` token is not an error anywhere: `text-[var(--color-on-primary)]` with no such token computes to "unset", the
 * text inherits the nearest ink, and the BodyDiagram's selected region pill and Add injury button rendered dark text on the dark green
 * primary. This reads every `var(--color-x)` a component, helper or stylesheet names and holds each one to a definition in src/index.css.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..')
const css = readFileSync(join(SRC, 'index.css'), 'utf-8')
const DEFINED = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(match => match[1]))

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('every --color-* token the source names is defined in index.css', () => {
  it('finds the palette (the scan is not silently empty)', () => {
    expect(DEFINED.size).toBeGreaterThan(30)
    expect(DEFINED.has('primary-foreground')).toBe(true)
  })

  it('has no var(--color-x) that index.css does not define', () => {
    const undefinedUses: string[] = []
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf-8').matchAll(/var\(--color-([a-z0-9-]+)/g)) {
        if (!DEFINED.has(match[1])) undefinedUses.push(`${relative(SRC, file).split(sep).join('/')}: --color-${match[1]}`)
      }
    }
    expect([...new Set(undefinedUses)]).toEqual([])
  })
})

describe('dark theme block', () => {
  const themeStart = css.indexOf('@theme')
  const names = (block: string) => [...block.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(m => m[1])
  const darkStart = css.indexOf('/* Dark theme (dark-mode-2026-10)')

  it('re-points exactly the tokens @theme defines: none missing, none extra', () => {
    const light = names(css.slice(themeStart, css.indexOf('}', themeStart)))
    const dark = names(css.slice(darkStart, css.indexOf('}', darkStart)))
    expect(light).toHaveLength(45)
    expect([...dark].sort()).toEqual([...light].sort())
  })

  it('leaves no hard-coded white, ledger shadow, halo or black wash in components (they break in dark)', () => {
    const allowed = new Set(['components/ItineraryPdf.tsx', 'index.css'])
    const leaks: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (allowed.has(rel)) continue
      const source = readFileSync(file, 'utf-8')
      for (const needle of [/text-white/, /rgba\(27,28,26/, /rgba\(57,98,0/, /bg-black\/5\b/, /color-mix\(in_srgb,var\(--color-foreground\)/]) {
        if (needle.test(source)) leaks.push(`${rel}: ${needle}`)
      }
    }
    expect(leaks).toEqual([])
  })
})
