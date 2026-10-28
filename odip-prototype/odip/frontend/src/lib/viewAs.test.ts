import { beforeEach, describe, expect, it } from 'vitest'
import { clearViewAs, getViewAs, setViewAs } from './viewAs'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('viewAs (per-tab view-as state)', () => {
  it('writes sessionStorage and leaves localStorage untouched', () => {
    setViewAs('odip_viewing_tenant', 't-1')
    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('t-1')
    expect(localStorage.getItem('odip_viewing_tenant')).toBeNull()
    expect(getViewAs('odip_viewing_tenant')).toBe('t-1')
  })

  it('moves a pre-deploy localStorage value into the tab once, and removes it from localStorage', () => {
    localStorage.setItem('odip_viewing_user', 'u-legacy')
    expect(getViewAs('odip_viewing_user')).toBe('u-legacy')
    expect(sessionStorage.getItem('odip_viewing_user')).toBe('u-legacy')
    expect(localStorage.getItem('odip_viewing_user')).toBeNull()
  })

  it('prefers the tab value over a legacy one', () => {
    sessionStorage.setItem('odip_viewing_tenant', 'mine')
    localStorage.setItem('odip_viewing_tenant', 'legacy')
    expect(getViewAs('odip_viewing_tenant')).toBe('mine')
  })

  it('clear removes the key from both stores, so a legacy value cannot come back', () => {
    sessionStorage.setItem('odip_viewing_tenant', 'a')
    localStorage.setItem('odip_viewing_tenant', 'b')
    clearViewAs('odip_viewing_tenant')
    expect(getViewAs('odip_viewing_tenant')).toBeNull()
    expect(localStorage.getItem('odip_viewing_tenant')).toBeNull()
  })

  it('two tabs (own sessionStorage, shared localStorage) do not see each other\'s switch', () => {
    const tab = () => {
      const store = new Map<string, string>()
      return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    }
    const [a, b] = [tab(), tab()]
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!
    const as = (t: ReturnType<typeof tab>) => Object.defineProperty(window, 'sessionStorage', { value: t, configurable: true })
    try {
      as(a); setViewAs('odip_viewing_tenant', 'org-A')
      as(b); expect(getViewAs('odip_viewing_tenant')).toBeNull()
      setViewAs('odip_viewing_tenant', 'org-B')
      as(a); expect(getViewAs('odip_viewing_tenant')).toBe('org-A')
    } finally { Object.defineProperty(window, 'sessionStorage', real) }
  })
})
