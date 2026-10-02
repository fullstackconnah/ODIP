import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Outlet } from 'react-router-dom'

/**
 * L5-11: App.tsx defined 58 routes and no catch-all, so any unknown URL (a typo, an old bookmark, /trips/:id/edit) rendered React Router's
 * bare default error page: no sidebar, no way home. The catch-all sits INSIDE the authenticated layout route, so the person keeps the shell.
 *
 * Behaviour, not source text: the real App router is loaded at an unknown URL with only the shell's layout stubbed (a marker for "the sidebar
 * is still there"), and what the person would see is asserted.
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
  vi.resetModules()   // App builds its browser router from window.location when the module loads
  window.history.pushState({}, '', path)
  await import('@/pages/NotFoundPage')   // warm the lazy route's chunk so React.lazy resolves at once, not after a cold module load under suite load
  const { default: App } = await import('../App')
  return render(<App />)
}

beforeEach(() => {
  localStorage.setItem('odip_token', 'test-token')
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
})

describe('App routes: a catch-all inside the app shell (L5-11)', () => {
  it('shows "Page not found" with the sidebar still on screen for an unknown URL', async () => {
    await renderAppAt('/trips/t-0001/edit')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' }, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'App sidebar' })).toBeInTheDocument()
    expect(screen.getByText('/trips/t-0001/edit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/')
  }, 30_000)

  it('does not show it for a real route', async () => {
    await renderAppAt('/login')

    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument()
  })
})
