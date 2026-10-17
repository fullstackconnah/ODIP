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

  // Without these, every tunnel visitor reaches the API as the Docker gateway and shares one rate-limit and sign-in-lockout bucket.
  it('takes the visitor from CF-Connecting-IP, trusting only Docker-internal hops, and forwards that single address', () => {
    const conf = readFileSync(CONF, 'utf8').split('\n').map((l) => l.replace(/#.*/, '')).join('\n')
    expect(conf).toMatch(/^\s*set_real_ip_from\s+172\.16\.0\.0\/12;/m)
    expect(conf.match(/set_real_ip_from/g)).toHaveLength(1)
    expect(conf).toMatch(/^\s*real_ip_header\s+CF-Connecting-IP;/m)
    expect(conf).toMatch(/^\s*real_ip_recursive\s+off;/m)
    expect(conf).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/)
    expect(conf).not.toMatch(/proxy_add_x_forwarded_for/)
  })
})
