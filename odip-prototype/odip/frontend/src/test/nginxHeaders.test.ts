import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONF = resolve(__dirname, '../../../nginx/default.conf')

// nginx: a location block with its own add_header (directly, or nested in an `if`) drops every add_header inherited from the
// server block, so the security headers silently vanish from whatever that location serves (the static assets, before this test).
describe.skipIf(!existsSync(CONF))('nginx/default.conf', () => {
  it('has no add_header anywhere inside a location block, which would drop the server-level security headers', () => {
    const lines = readFileSync(CONF, 'utf8').split('\n').map((l) => l.replace(/#.*/, ''))
    const offenders: string[] = []
    const stack: boolean[] = []   // one entry per open block: is it a location?
    for (const line of lines) {
      const opensLocation = /^\s*location\s/.test(line)
      if (/\badd_header\b/.test(line) && (opensLocation || stack.some(Boolean))) offenders.push(line.trim())
      let first = true
      for (const ch of line.match(/[{}]/g) ?? []) {
        if (ch === '}') stack.pop()
        else { stack.push(opensLocation && first); first = false }
      }
    }
    expect(offenders).toEqual([])
  })
})
