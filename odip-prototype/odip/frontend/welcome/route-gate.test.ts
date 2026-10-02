import { describe, expect, it, vi } from 'vitest'
import gateSource from './route-gate.js?raw'
import appIndexHtml from '../index.html?raw'
import appSource from '../src/App.tsx?raw'
import clientSource from '../src/api/client.ts?raw'

// The gate is a classic script, so the test runs its real source with stubbed globals.
function run(opts: { pathname: string; token?: string | null; storageThrows?: boolean }) {
  const replace = vi.fn()
  const location = { pathname: opts.pathname, replace }
  const localStorage = {
    getItem: (key: string) => {
      if (opts.storageThrows) throw new Error('storage blocked')
      return key === 'odip_token' ? (opts.token ?? null) : null
    },
  }
  new Function('location', 'localStorage', gateSource)(location, localStorage)
  return replace
}

describe('route gate: signed-out visitors to exactly "/" reach the landing page', () => {
  it('sends a signed-out visitor at "/" to /welcome/', () => {
    const replace = run({ pathname: '/', token: null })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/welcome/')
  })

  it('leaves a signed-in visitor at "/" on the Dashboard route', () => {
    expect(run({ pathname: '/', token: 'a-session-token' })).not.toHaveBeenCalled()
  })

  it.each(['/login', '/trips', '/trips/t-0001', '/participants/p-1', '/caregiver/abc123', '/welcome/', '/index.html'])(
    'never redirects the deep link %s',
    (pathname) => {
      expect(run({ pathname, token: null })).not.toHaveBeenCalled()
    },
  )

  it('does nothing (and does not throw) when storage is blocked', () => {
    expect(() => run({ pathname: '/', storageThrows: true })).not.toThrow()
    expect(run({ pathname: '/', storageThrows: true })).not.toHaveBeenCalled()
  })

  it('is a classic script: no imports, exports or inline-only APIs', () => {
    expect(gateSource).not.toMatch(/^\s*(import|export)\s/m)
    expect(gateSource).not.toMatch(/document\.write|eval\(/)
  })

  it('reads the same session key the app uses', () => {
    expect(gateSource).toContain("'odip_token'")
    expect(appSource).toContain("localStorage.getItem('odip_token')")
    expect(clientSource).toContain('odip_token')
  })

  it('leaves the app entry HTML untouched: the gate is injected at build time, not hand-written', () => {
    expect(appIndexHtml).not.toContain('route-gate')
    expect(appIndexHtml).toContain('<script type="module" src="/src/main.tsx"></script>')
  })
})
