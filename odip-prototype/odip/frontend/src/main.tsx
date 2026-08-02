import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Local mock preview only (VITE_MOCK_PREVIEW set in .env.local): seed a fake
// session so the UI is browsable without Firebase. Remove with .env.local.
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
