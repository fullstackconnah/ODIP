import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './fonts.css'
import { captureInstallEvents } from './lib/installPrompt'
import { offlineQueue } from './lib/offline/queue'

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

// beforeinstallprompt can fire before React mounts: listen from the first line so the install card still gets it.
captureInstallEvents()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Unsent changes go out when the app opens, the signal returns, or the app comes back to the front.
void offlineQueue.replay()
window.addEventListener('online', () => { void offlineQueue.replay() })
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void offlineQueue.replay() })

// The worker (public build only, secure origins) keeps the app shell openable when the signal drops. sw.js is emitted by vite.config.ts.
if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js') })
}
