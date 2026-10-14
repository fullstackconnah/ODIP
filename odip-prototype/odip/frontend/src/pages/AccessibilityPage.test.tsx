import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AccessibilityPage from './AccessibilityPage'
import type { PlatformInfo } from '@/lib/platformInfo'

const NONE: PlatformInfo = { companyName: null, abn: null, supportEmail: null, statusUrl: null, legalPublished: false, version: undefined, buildSha: undefined }

function renderPage(info: PlatformInfo = NONE) {
  render(<MemoryRouter initialEntries={['/accessibility']}><AccessibilityPage info={info} /></MemoryRouter>)
}

describe('AccessibilityPage', () => {
  it('is one h1 in one main, between a wordmark bar and the public footer, and names the tab', () => {
    renderPage()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Accessibility' })).toBeInTheDocument()
    expect(document.title).toBe('Accessibility — Odip')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(screen.getByRole('contentinfo').closest('main')).toBeNull()
    expect(screen.getByRole('link', { name: 'Odip home' })).toHaveAttribute('href', '/')
  })

  it('carries W3C minimum contents in order: the target, what we do, known limits, a contact and where to complain', () => {
    renderPage()
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Our target', 'What we do', "What we know isn't right yet", 'Tell us about a problem', "If you're not happy with our response",
    ])
    expect(screen.getByRole('link', { name: 'humanrights.gov.au/complaints' })).toHaveAttribute('href', 'https://humanrights.gov.au/complaints')
  })

  it('sends the reader to their administrator while there is no support address, with no empty mailto', () => {
    renderPage()
    expect(screen.getByText(/usually your administrator/)).toBeInTheDocument()
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('gives the support address once it is set', () => {
    renderPage({ ...NONE, supportEmail: 'help@example.org' })
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'help@example.org' })).toHaveAttribute('href', 'mailto:help@example.org')
    expect(screen.queryByText(/usually your administrator/)).toBeNull()
  })
})
