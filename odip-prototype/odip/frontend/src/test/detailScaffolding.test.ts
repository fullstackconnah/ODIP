import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// Source-scanning guards for the detail-page scaffolding (BackButton, PageState, useTabParam), in the house style of
// focusRingTokens.test.ts: each rule is a property of the source, so it fails at the line that breaks it.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
  }
  return files
}

const FILES = sourceFiles(SRC_DIR).map(full => ({ path: relative(SRC_DIR, full).split('\\').join('/'), text: readFileSync(full, 'utf-8') }))
const offendersOf = (test: (text: string) => boolean, allowed: string[] = []) =>
  FILES.filter(f => test(f.text) && !allowed.includes(f.path)).map(f => f.path)

describe('BackButton', () => {
  it('owns useBackTarget: no page calls it, so no hook can sit below an early return (the #155 class of bug)', () => {
    expect(offendersOf(text => /\buseBackTarget\(/.test(text), ['hooks/useBackNavigation.tsx', 'components/BackButton.tsx'])).toEqual([])
  })

  it('is the only file that draws a Back arrow: no page imports ArrowLeft to hand-roll one', () => {
    expect(offendersOf(text => /import\s*\{[^}]*\bArrowLeft\b[^}]*\}\s*from\s*'lucide-react'/.test(text), ['components/BackButton.tsx'])).toEqual([])
  })
})
