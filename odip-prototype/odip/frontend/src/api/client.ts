import axios from 'axios'
import type { ApiResponse } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Singleton refresh promise — prevents concurrent 401s from each calling /auth/exchange
let refreshPromise: Promise<string | null> | null = null

// Guards against logout() re-running (e.g. if a stale/rejected token keeps triggering
// 401s while the redirect to /login is still in flight)
let loggingOut = false

function logout() {
  if (loggingOut) return
  loggingOut = true
  localStorage.removeItem('odip_token')
  localStorage.removeItem('odip_user')
  localStorage.removeItem('odip_viewing_tenant')
  localStorage.removeItem('odip_viewing_user')
  localStorage.removeItem('odip_superadmin_user')
  window.location.href = '/login'
}

// JWT interceptor
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('odip_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  if (viewingTenantId) {
    config.headers['X-View-As-Tenant'] = viewingTenantId
  }
  const viewingUserId = localStorage.getItem('odip_viewing_user')
  if (viewingUserId) {
    config.headers['X-View-As-User'] = viewingUserId
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as typeof error.config & { _retried?: boolean }
    if (error.response?.status === 401 && config?.url?.endsWith('/auth/logout')) {
      return Promise.reject(error)
    }
    if (error.response?.status === 401 && !config._retried) {
      config._retried = true
      try {
        // Deduplicate concurrent refresh calls — reuse in-flight promise instead of
        // spawning a new /auth/exchange request for every simultaneous 401
        if (!refreshPromise) {
          refreshPromise = (async () => {
            try {
              const { auth } = await import('../lib/firebase')
              const currentUser = auth.currentUser
              if (!currentUser) return null
              const idToken = await currentUser.getIdToken(true)
              const exchangeRes = await apiClient.post<ApiResponse<{ token: string }>>(
                '/auth/exchange',
                { idToken }
              )
              const newToken = exchangeRes.data.data?.token ?? null
              if (newToken) localStorage.setItem('odip_token', newToken)
              return newToken
            } finally {
              refreshPromise = null
            }
          })()
        }
        const newToken = await refreshPromise
        if (newToken) {
          config.headers.Authorization = `Bearer ${newToken}`
          return apiClient(config)
        }
      } catch {
        // Firebase refresh failed — fall through to logout
      }
      try { await apiClient.post('/auth/logout') } catch { /* ignore */ }
      logout()
    }
    return Promise.reject(error)
  }
)

// ── Typed API helpers ─────────────────────────────────────────

export async function apiGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params })
  return response.data.data as T
}

export async function apiGetWithDefault<T>(url: string, defaultValue: T, params?: Record<string, any>): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params })
  return response.data.data ?? defaultValue
}

export async function apiPost<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, data)
  return response.data.data as T
}

export async function apiPostRaw<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const response = await apiClient.post<ApiResponse<T>>(url, data)
  return response.data
}

export async function apiPut<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.put<ApiResponse<T>>(url, data)
  return response.data.data as T
}

export async function apiPutRaw<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const response = await apiClient.put<ApiResponse<T>>(url, data)
  return response.data
}

export async function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  const response = await apiClient.patch<ApiResponse<T>>(url, data)
  return response.data.data as T
}

export async function apiPatchRaw<T>(url: string, data?: unknown): Promise<ApiResponse<T>> {
  const response = await apiClient.patch<ApiResponse<T>>(url, data)
  return response.data
}

export async function apiDelete(url: string): Promise<void> {
  await apiClient.delete(url)
}

export async function apiDeleteRaw<T>(url: string): Promise<ApiResponse<T>> {
  const response = await apiClient.delete<ApiResponse<T>>(url)
  return response.data
}
