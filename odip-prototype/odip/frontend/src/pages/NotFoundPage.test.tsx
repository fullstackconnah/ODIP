import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'

// L5-11: an unknown URL (a typo, an old bookmark, /trips/:id/edit) landed on React Router's bare default error page with no app shell and
// no way home. The catch-all route renders this inside the authenticated shell.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFoundPage />
    </MemoryRouter>,
  )
}

afterEach(() => { document.title = '' })

describe('NotFoundPage', () => {
  it('is the one h1 of the screen, says the page was not found, and names the address that was asked for', () => {
    renderAt('/trips/t-0001/edit')

    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('/trips/t-0001/edit')).toBeInTheDocument()
  })

  it('offers the way home: a real link to the dashboard', () => {
    renderAt('/does-not-exist')

    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/')
  })

  it('gives the tab its own title', () => {
    renderAt('/does-not-exist')

    expect(document.title).toBe('Page not found — Odip')
  })
})
