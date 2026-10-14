import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Outlet } from 'react-router-dom'

/**
 * The public reading pages sit OUTSIDE the app shell, beside /login, so a signed-out reader from the landing or the sign-in page reaches
 * them and is never sent to /login. Behaviour, not source text: the real App router at a real URL, with only the shell's layout stubbed
 * (a marker for "the sidebar is there"), as catchAllRoute.test.tsx does.
 */
vi.mock('@/components/layout/AppLayout', () => ({
  default: () => (
    <div>
      <nav aria-label="App sidebar">Sidebar</nav>
      <Outlet />
    </div>
  ),
}))

async function renderAppAt(path: string) {
  vi.resetModules() // App builds its browser router from window.location when the module loads
  window.history.pushState({}, '', path)
  // Warm the lazy routes' chunks so React.lazy resolves at once, not after a cold module load under suite load.
  await Promise.all([import('@/pages/AccessibilityPage'), import('@/pages/NotFoundPage')])
  const { default: App } = await import('../App')
  return render(<App />)
}

afterEach(() => {
  localStorage.clear()
})

describe('/accessibility is public', () => {
  it('renders the statement signed out, with no redirect to /login and no app shell', async () => {
    localStorage.removeItem('odip_token')
    await renderAppAt('/accessibility')
    expect(await screen.findByRole('heading', { level: 1, name: 'Accessibility' }, { timeout: 20_000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/accessibility')
    expect(screen.queryByRole('navigation', { name: 'App sidebar' })).not.toBeInTheDocument()
  }, 30_000)
})
