import { apiClient } from '@/api/client'

const MAX_REPORTS = 5
const sent = new Set<string>()

export type ClientErrorKind = 'boundary' | 'error' | 'rejection'

/** Test hook: a page load starts with nothing sent. */
export function resetClientErrorReports() {
  sent.clear()
}

/**
 * Sends a front-end crash to the API's log (POST /client-errors). Fire and forget: it never throws and nothing waits on it.
 * At most 5 per page load and each message once, so a render loop cannot flood the API. Signed-out pages send nothing (the endpoint needs a token).
 * The path is the pathname only, never the query string.
 */
export function reportClientError(kind: ClientErrorKind, error: unknown, componentStack?: string | null) {
  try {
    if (sent.size >= MAX_REPORTS || !localStorage.getItem('odip_token')) return
    const err = error instanceof Error ? error : null
    const message = (err?.message || String(error ?? '')).trim()
    if (!message || sent.has(message)) return
    sent.add(message)
    void apiClient
      .post('/client-errors', { message: message.slice(0, 500), stack: err?.stack?.slice(0, 4000), componentStack: componentStack?.slice(0, 4000), path: window.location.pathname, kind })
      .catch(() => {})
  } catch { /* reporting must never cause a second crash */ }
}
