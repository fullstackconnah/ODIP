import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Local dev auto-login: with VITE_MOCK_PREVIEW=1 (set in .env.local) a fake token/user is seeded so the UI is
// browsable against the mock API (mock-api/server.js) without going through the real sign-in form.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK_PREVIEW === '1' && !localStorage.getItem('odip_token')) {
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
