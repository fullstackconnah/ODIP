import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * The product is called Bunya Support on every screen (owner, 2026-10-25); ODIP is only the internal code name. This fails when a source
 * line outside a comment says the bare word ODIP, which is what a screen, aria label, toast or error sentence would show.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..')

// file (relative to src, posix slashes) -> why its hits stay. Add nothing here for text a person can read.
const ALLOWED: Record<string, string> = {
  'lib/documentMapping.ts': 'developer notes on the field-mapping table; no page renders `notes`',
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const isComment = (line: string) => /^(\/\/|\*|\/\*|\{\/\*)/.test(line.trim())

describe('the product name on screen', () => {
  it('no source line outside a comment says ODIP, bar the allowlist', () => {
    const hits: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (rel in ALLOWED) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!isComment(line) && /\bODIP\b/.test(line)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
