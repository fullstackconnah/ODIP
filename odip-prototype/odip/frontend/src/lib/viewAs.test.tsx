import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { clearViewAs, currentProfile, getViewAs, setViewAs } from './viewAs'
import { readSession } from './offline/store'
import { usePermissions } from './permissions'

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

describe('viewAs profile (the viewed user stays in its own tab)', () => {
  const SA = { id: 'sa-1', role: 'SuperAdmin', fullName: 'Sam' }
  const X = { ...SA, id: 'x-1', role: 'SupportWorker', fullName: 'Xena' }
  const tab = () => {
    const store = new Map<string, string>()
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  }
  const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!
  const as = (t: ReturnType<typeof tab>) => Object.defineProperty(window, 'sessionStorage', { value: t, configurable: true })
  afterEach(() => Object.defineProperty(window, 'sessionStorage', real))

  it('tab A viewing as X leaves tab B acting as the SuperAdmin; stopping in A leaves B alone', () => {
    localStorage.setItem('odip_user', JSON.stringify(SA))
    const [a, b] = [tab(), tab()]
    as(a); setViewAs('odip_viewing_user', X.id); setViewAs('odip_viewing_profile', JSON.stringify(X))
    expect(currentProfile().id).toBe('x-1')
    as(b)
    expect(currentProfile().id).toBe('sa-1')
    expect(readSession().userId).toBe('sa-1')
    function Probe() { return <span>{`${usePermissions().id}:${String(usePermissions().isSupportWorker)}`}</span> }
    render(<Probe />)
    expect(screen.getByText('sa-1:false')).toBeInTheDocument()
    as(a); clearViewAs('odip_viewing_user')
    expect(currentProfile().id).toBe('sa-1')
    expect(sessionStorage.getItem('odip_viewing_profile')).toBeNull()
    as(b); expect(currentProfile().id).toBe('sa-1')
  })

  it('clearing the viewed user clears their profile with it', () => {
    setViewAs('odip_viewing_user', X.id); setViewAs('odip_viewing_profile', JSON.stringify(X))
    clearViewAs('odip_viewing_user')
    expect(getViewAs('odip_viewing_profile')).toBeNull()
  })

  it('migrates a pre-deploy impersonation: odip_user is the SuperAdmin again, the viewed profile moves into this tab', () => {
    localStorage.setItem('odip_user', JSON.stringify(X))
    localStorage.setItem('odip_superadmin_user', JSON.stringify(SA))
    localStorage.setItem('odip_viewing_user', X.id)
    expect(currentProfile().id).toBe('x-1')
    expect(JSON.parse(localStorage.getItem('odip_user')!).id).toBe('sa-1')
    expect(localStorage.getItem('odip_superadmin_user')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('odip_viewing_profile')!).id).toBe('x-1')
    expect(getViewAs('odip_viewing_user')).toBe('x-1')
  })

  it('migrates a leftover odip_superadmin_user with no viewed user by restoring odip_user only', () => {
    localStorage.setItem('odip_user', JSON.stringify(X))
    localStorage.setItem('odip_superadmin_user', JSON.stringify(SA))
    expect(currentProfile().id).toBe('sa-1')
    expect(sessionStorage.getItem('odip_viewing_profile')).toBeNull()
  })
})
