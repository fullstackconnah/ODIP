import { describe, it, expect, beforeEach } from 'vitest'
import { caregiverApiClient } from './caregiverClient'

describe('caregiverApiClient', () => {
  beforeEach(() => {
    localStorage.setItem('odip_token', 'should-not-be-sent')
    localStorage.setItem('odip_viewing_tenant', 'tenant-should-not-be-sent')
    localStorage.setItem('odip_viewing_user', 'user-should-not-be-sent')
  })

  it('sends no Authorization or X-View-As-* headers and no credentials, even when a session exists', async () => {
    let captured: Record<string, unknown> = {}
    caregiverApiClient.defaults.adapter = async (config) => {
      captured = { ...config.headers }
      expect(config.withCredentials).toBe(false)
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }
    await caregiverApiClient.get('/public/caregiver/abc')
    expect(captured['Authorization']).toBeUndefined()
    expect(captured['X-View-As-Tenant']).toBeUndefined()
    expect(captured['X-View-As-User']).toBeUndefined()
  })

  it('has no interceptors registered', () => {
    // @ts-expect-error — handlers is internal but stable in axios 1.x
    expect(caregiverApiClient.interceptors.request.handlers.filter(Boolean)).toHaveLength(0)
    // @ts-expect-error — handlers is internal but stable in axios 1.x
    expect(caregiverApiClient.interceptors.response.handlers.filter(Boolean)).toHaveLength(0)
  })
})
