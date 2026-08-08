import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Local dev auto-login: seeds a session so the UI is browsable without going
// through the real sign-in form. Two modes, set in .env.local:
// - VITE_LOCAL_JWT: a real backend-minted JWT (see local-test\mint-jwt.js) —
//   decoded at runtime and used to seed odip_token/odip_user so the app works
//   against the real backend (localhost:5100). Preferred mode.
// - VITE_MOCK_PREVIEW=1: seeds a fake token/user for browsing against the mock
//   API (mock-api\server.js) with no real backend at all.
if (import.meta.env.DEV && import.meta.env.VITE_LOCAL_JWT && !localStorage.getItem('odip_token')) {
  const token = import.meta.env.VITE_LOCAL_JWT as string
  const base64Url = token.split('.')[1]
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const payload = JSON.parse(
    decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    )
  )
  localStorage.setItem('odip_token', token)
  localStorage.setItem('odip_user', JSON.stringify({
    token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    username: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
    fullName: payload.fullName,
    role: payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'],
    tenantId: payload.tenant_id,
    tenantName: 'Demo',
  }))
} else if (import.meta.env.DEV && import.meta.env.VITE_MOCK_PREVIEW === '1' && !localStorage.getItem('odip_token')) {
  localStorage.setItem('odip_token', 'mock-preview-token')
  localStorage.setItem('odip_user', JSON.stringify({
    id: '00000000-0000-0000-0000-000000000001',
    email: 'preview@example.com',
    firstName: 'Preview',
    lastName: 'Admin',
    role: 'Admin',
  }))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
