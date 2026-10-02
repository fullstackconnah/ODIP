import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * L3-04: the DataTable column rule. The #161 overflow fix deleted columns by breakpoint (`priority`), so below 1536px and 1792px the
 * Overnight and Manual flags, a task's Trip and Type, a reservation's Ref and Nights, a claim's Claimed and Payer simply were not on the
 * page. A column is never removed at md+ now: a wide table scrolls inside its box with the first column and the actions pinned
 * (components/DataTable.tsx). `priority` is a retired, ignored prop; this stops any page from asking for the hiding again.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Pages that still pass `priority`. ParticipantsPage belongs to the participant data-integrity branch (Fix A), which was in flight when
 * this rule landed: its `priority` props are ignored by DataTable and are deleted with that branch's next change to the file.
 */
const STILL_PASSING_PRIORITY = new Set(['pages/ParticipantsPage.tsx'])

describe('the DataTable column rule (L3-04)', () => {
  it('has no breakpoint that hides a column in DataTable itself', () => {
    const source = readFileSync(join(SRC, 'components/DataTable.tsx'), 'utf-8')
    expect(source).not.toMatch(/max-(xl|2xl|\[\d+px\]):hidden/)
  })

  it('has no page asking for a column to be hidden by `priority`', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(SRC, 'pages'))) {
      const name = relative(SRC, file).split(sep).join('/')
      if (STILL_PASSING_PRIORITY.has(name)) continue
      const source = readFileSync(file, 'utf-8')
      if (/\bpriority:\s*'(medium|low|lowest)'/.test(source)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })
})
