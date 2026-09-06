import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_DIR = join(__dirname, '..')
const FORBIDDEN_PATTERN = /ring-\[var\(--color-(?:ring|primary)\)\]\/\d+/

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

describe('focus ring tokens (C-2)', () => {
  it('has zero alpha-suffixed ring-[var(--color-ring)]/NN or ring-[var(--color-primary)]/NN focus rings left in src', () => {
    const offenders = collectSourceFiles(SRC_DIR).filter(file => FORBIDDEN_PATTERN.test(readFileSync(file, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
