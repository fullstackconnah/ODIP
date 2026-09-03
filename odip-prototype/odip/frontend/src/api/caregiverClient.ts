import axios from 'axios'
import type { ApiResponse } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

/**
 * The caregiver form's HTTP client. Deliberately NOT `apiClient`:
 *  - no request interceptor, so no Authorization / X-View-As-* header can ever be attached
 *    (a signed-in admin opening a /caregiver/:token tab must not leak their session);
 *  - `withCredentials: false`, so the odip_jwt cookie fallback is not sent either;
 *  - no 401 interceptor, so a failure never triggers the Firebase refresh / logout dance.
 * Authentication on these routes is the link token in the URL and nothing else.
 */
export const caregiverApiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
})

export async function caregiverGet<T>(url: string): Promise<ApiResponse<T>> {
  const res = await caregiverApiClient.get<ApiResponse<T>>(url)
  return res.data
}

export async function caregiverPut(url: string, body: unknown): Promise<void> {
  await caregiverApiClient.put(url, body)
}

export async function caregiverPost(url: string, body: unknown): Promise<void> {
  await caregiverApiClient.post(url, body)
}
