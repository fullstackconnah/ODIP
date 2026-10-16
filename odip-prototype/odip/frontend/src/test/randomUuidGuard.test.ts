import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * crypto.randomUUID() exists only in a secure context (HTTPS or localhost), and live ODIP is plain HTTP on the LAN:
 * there it is undefined and the click that calls it throws. This scan of src/ (not *.test.*) keeps it out of the app.
 * Allowed: lib/completionRequestId.ts (falls back to getRandomValues) and the call guarded by `'randomUUID' in crypto`.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED = ['lib/completionRequestId.ts', 'pages/participant-detail/AddRestrictivePracticeDialog.tsx']
const CALL = /\bcrypto\.randomUUID\(/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('crypto.randomUUID stays out of the app source', () => {
  it('scans the source (not silently empty)', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(200)
  })

  it('no file outside the allowed ones calls crypto.randomUUID(); use newCompletionRequestId() or a client counter', () => {
    const offenders = sourceFiles(SRC).map(full => ({ path: relative(SRC, full).split(sep).join('/'), full }))
      .filter(({ path }) => !ALLOWED.includes(path))
      .filter(({ full }) => CALL.test(readFileSync(full, 'utf-8')))
      .map(({ path }) => `${path}: calls crypto.randomUUID(), which is undefined on plain HTTP. Use newCompletionRequestId() (lib/completionRequestId.ts) or a client counter.`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
