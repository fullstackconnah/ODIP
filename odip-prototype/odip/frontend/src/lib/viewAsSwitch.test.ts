import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { switchViewAndReload } from './viewAsSwitch'

/** The headers the next API request would carry, read from the real interceptor without a network. */
async function nextRequestHeaders() {
  const { data } = await apiClient.get('/anything', { adapter: async config => ({ data: config.headers, status: 200, statusText: 'OK', headers: {}, config }) })
  return data as Record<string, string>
}

function stubReload() {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: vi.fn() } })
}

afterEach(() => {
  localStorage.clear()
  window.dispatchEvent(new Event('pointerdown'))   // drop any listener a test left armed
  localStorage.clear()
})

describe('switchViewAndReload', () => {
  it('writes the switch and reloads, so the next page reads the new organisation', () => {
    stubReload()
    localStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => localStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-b')
  })

  it('puts the old organisation and user back when the reload was cancelled and the person carries on here', async () => {
    stubReload()
    localStorage.setItem('odip_viewing_tenant', 'tenant-a')
    localStorage.setItem('odip_user', '{"id":"sa"}')
    switchViewAndReload(() => {
      localStorage.setItem('odip_viewing_tenant', 'tenant-b')
      localStorage.setItem('odip_viewing_user', 'user-b')
      localStorage.setItem('odip_user', '{"id":"user-b"}')
    })

    window.dispatchEvent(new Event('pointerdown'))   // the first press after "Stay", before any button acts on it

    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-a')
    expect(localStorage.getItem('odip_viewing_user')).toBeNull()
    expect(localStorage.getItem('odip_user')).toBe('{"id":"sa"}')
    const headers = await nextRequestHeaders()
    expect(headers['X-View-As-Tenant']).toBe('tenant-a')
    expect(headers['X-View-As-User']).toBeUndefined()
  })

  it('restores on a key press too, and only once', () => {
    stubReload()
    localStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => localStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-a')

    localStorage.setItem('odip_viewing_tenant', 'tenant-c')   // a later change of its own
    window.dispatchEvent(new Event('pointerdown'))
    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-c')
  })
})

describe('switchViewAndReload when the reload goes ahead', () => {
  it('puts nothing back once the page hides, even if a press reaches it while the next page loads', () => {
    stubReload()
    localStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => localStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pointerdown'))
    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-b')
  })
})
