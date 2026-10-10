import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONF = resolve(__dirname, '../../../nginx/default.conf')

// nginx: a location block with its own add_header drops every add_header inherited from the server block,
// so the security headers silently vanish from whatever that location serves (the static assets, before this test).
describe.skipIf(!existsSync(CONF))('nginx/default.conf', () => {
  it('has no location block with its own add_header, which would drop the server-level security headers', () => {
    const conf = readFileSync(CONF, 'utf8')
    const offenders = [...conf.matchAll(/location\s[^{]*\{([^{}]*)\}/g)]
      .filter((m) => /\badd_header\b/.test(m[1]))
      .map((m) => m[0].split('{')[0].trim())
    expect(offenders).toEqual([])
  })
})
