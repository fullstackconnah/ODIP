import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Outlet } from 'react-router-dom'
import { PLATFORM_INFO } from '@/lib/platformInfo'
import { platformFacts } from '@/lib/platformFacts'

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

// The legal documents go live in ONE later PR, on the owner's word. That PR commits the approved files, sets legalPublished, fills the
// company facts and registers the routes. Until then the footer links are hidden and the routes don't exist. This guard keeps the flag
// and the files from drifting apart in either direction. It reads only files under frontend/, which is all the Docker test run has.
const LEGAL_DIR = join(__dirname, '../legal')
const DOCS = ['privacy', 'terms']
const MARKERS = [
  'DRAFT: not legal advice', 'Operator to confirm', '[Company legal name]', '[ABN]', '[Registered address]', '[Support email]',
  '[Privacy contact email]', '[date]',
]

describe.runIf(PLATFORM_INFO.legalPublished)('legal documents, once published', () => {
  it.each(DOCS)('%s.md exists, with no draft marker left', doc => {
    const file = join(LEGAL_DIR, `${doc}.md`)
    expect(existsSync(file), file).toBe(true)
    const text = readFileSync(file, 'utf-8')
    for (const marker of MARKERS) expect(text, marker).not.toContain(marker)
  })

  it('names the company that publishes them', () => {
    expect(platformFacts(PLATFORM_INFO).company).not.toBeNull()
  })

  it.each(DOCS)('serves /legal/%s to a signed-out reader', async doc => {
    localStorage.removeItem('odip_token')
    await renderAppAt(`/legal/${doc}`)
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 20_000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/legal/${doc}`)
  }, 30_000)
})

describe.skipIf(PLATFORM_INFO.legalPublished)('legal documents, until they are published', () => {
  it.each(DOCS)('/legal/%s is not a route: signed in, it is the not-found page inside the shell', async doc => {
    localStorage.setItem('odip_token', 'test-token')
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    await renderAppAt(`/legal/${doc}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' }, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'App sidebar' })).toBeInTheDocument()
  }, 30_000)

  it.each(DOCS)('/legal/%s signed out goes to /login, like any unknown URL', async doc => {
    localStorage.removeItem('odip_token')
    await renderAppAt(`/legal/${doc}`)
    await waitFor(() => expect(window.location.pathname).toBe('/login'), { timeout: 20_000 })
  }, 30_000)

  it('ships no legal document: the drafts stay out of the repo until they are approved', () => {
    expect(existsSync(LEGAL_DIR)).toBe(false)
  })
})
