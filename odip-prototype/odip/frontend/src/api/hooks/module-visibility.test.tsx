import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { apiClient } from '../client'
import { useModuleVisibility, useUpdateModuleVisibility } from './settings'

const original = apiClient.defaults.adapter
afterEach(() => { apiClient.defaults.adapter = original; localStorage.clear() })
const wrapper = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const visible = { hiddenAccommodation: false, hiddenVehicles: false }

describe('tenant workspace visibility transport', () => {
  it('never displays another organisation cache while a new tenant is loading or fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin' }))
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-a')
    apiClient.defaults.adapter = async config => ({ data: { data: { hiddenAccommodation: true, hiddenVehicles: true } }, status: 200, statusText: 'OK', headers: {}, config })
    const hook = renderHook(() => { const query = useModuleVisibility(); return { data: query.data, isError: query.isError } }, { wrapper: wrapper(client) })
    await waitFor(() => expect(hook.result.current.data?.hiddenVehicles).toBe(true))
    let reject!: (error: Error) => void
    apiClient.defaults.adapter = () => new Promise((_resolve, refuse) => { reject = refuse })
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-b'); hook.rerender()
    expect(hook.result.current.data).toBeUndefined()
    await waitFor(() => expect(reject).toBeDefined())
    await act(async () => reject(new Error('offline')))
    await waitFor(() => expect(client.getQueryState(['module-visibility', 'tenant-b'])?.status).toBe('error'))
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.data).toBeUndefined()
    expect(client.getQueryData(['module-visibility', 'tenant-a'])).toEqual({ hiddenAccommodation: true, hiddenVehicles: true })
  })
  it('sends only both visibility fields and immediately updates only the current tenant cache', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin', tenantId: 'tenant-a' }))
    const client = new QueryClient()
    client.setQueryData(['module-visibility', 'tenant-a'], visible)
    client.setQueryData(['module-visibility', 'tenant-b'], visible)
    const requests: unknown[] = []
    apiClient.defaults.adapter = async config => {
      requests.push({ method: config.method, url: config.url, body: JSON.parse(config.data) })
      return { data: { data: { hiddenAccommodation: true, hiddenVehicles: false } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const hook = renderHook(() => useUpdateModuleVisibility(), { wrapper: wrapper(client) })
    await act(async () => { await hook.result.current.mutateAsync({ hiddenAccommodation: true, hiddenVehicles: false }) })
    expect(requests).toEqual([{ method: 'put', url: '/settings/module-visibility', body: { hiddenAccommodation: true, hiddenVehicles: false } }])
    expect(client.getQueryData(['module-visibility', 'tenant-a'])).toEqual({ hiddenAccommodation: true, hiddenVehicles: false })
    expect(client.getQueryData(['module-visibility', 'tenant-b'])).toEqual(visible)
  })
})


