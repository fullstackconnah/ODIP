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
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => sessionStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('tenant-b')
  })

  it('puts the old organisation and user back when the reload was cancelled and the person carries on here', async () => {
    stubReload()
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    localStorage.setItem('odip_user', '{"id":"sa"}')
    switchViewAndReload(() => {
      sessionStorage.setItem('odip_viewing_tenant', 'tenant-b')
      sessionStorage.setItem('odip_viewing_user', 'user-b')
      localStorage.setItem('odip_user', '{"id":"user-b"}')
    })

    window.dispatchEvent(new Event('pointerdown'))   // the first press after "Stay", before any button acts on it

    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('tenant-a')
    expect(sessionStorage.getItem('odip_viewing_user')).toBeNull()
    expect(localStorage.getItem('odip_user')).toBe('{"id":"sa"}')
    const headers = await nextRequestHeaders()
    expect(headers['X-View-As-Tenant']).toBe('tenant-a')
    expect(headers['X-View-As-User']).toBeUndefined()
  })

  it('restores on a key press too, and only once', () => {
    stubReload()
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => sessionStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('tenant-a')

    sessionStorage.setItem('odip_viewing_tenant', 'tenant-c')   // a later change of its own
    window.dispatchEvent(new Event('pointerdown'))
    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('tenant-c')
  })
})

describe('switchViewAndReload when the reload goes ahead', () => {
  it('puts nothing back once the page hides, even if a press reaches it while the next page loads', () => {
    stubReload()
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => sessionStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pointerdown'))
    expect(sessionStorage.getItem('odip_viewing_tenant')).toBe('tenant-b')
  })
})

describe('switchViewAndReload when the first act after staying is a bare click or a submit', () => {
  // A screen reader in browse mode, voice control or a scripted .click() sends a click with no pointerdown or keydown before it.
  it('puts the old organisation back before a bare click on Save sends anything', async () => {
    stubReload()
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => sessionStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    const save = document.createElement('button')
    let sent: Promise<Record<string, string>> | null = null
    save.addEventListener('click', () => { sent = nextRequestHeaders() })
    document.body.appendChild(save)

    save.click()

    expect((await sent!)['X-View-As-Tenant']).toBe('tenant-a')
    save.remove()
  })

  it('puts it back before a form submits', () => {
    stubReload()
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    switchViewAndReload(() => sessionStorage.setItem('odip_viewing_tenant', 'tenant-b'))
    const form = document.createElement('form')
    let seen: string | null = null
    form.addEventListener('submit', e => { e.preventDefault(); seen = sessionStorage.getItem('odip_viewing_tenant') })
    document.body.appendChild(form)

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    expect(seen).toBe('tenant-a')
    form.remove()
  })
})
