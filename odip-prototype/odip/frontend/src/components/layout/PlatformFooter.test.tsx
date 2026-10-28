import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PlatformFooter from './PlatformFooter'
import { ACKNOWLEDGEMENT_OF_COUNTRY } from '@/lib/platformFacts'
import type { PlatformInfo } from '@/lib/platformInfo'

const NONE: PlatformInfo = { companyName: null, abn: null, supportEmail: null, statusUrl: null, legalPublished: false, version: undefined, buildSha: undefined }
const FULL: PlatformInfo = {
  companyName: 'Odip Pty Ltd', abn: '12345678901', supportEmail: 'help@example.org', statusUrl: 'https://status.example.org',
  legalPublished: true, version: '1.0.0', buildSha: '7be2ef82a1c3',
}
const MALFORMED: PlatformInfo = {
  companyName: '   ', abn: '1234', supportEmail: 'help.example.org', statusUrl: 'javascript:alert(1)', legalPublished: false, version: '0.0.0', buildSha: 'dev',
}

function renderFooter(variant: 'shell' | 'public', info: PlatformInfo, support?: boolean) {
  render(
    <MemoryRouter initialEntries={['/form']}>
      <Routes>
        <Route path="/form" element={<PlatformFooter variant={variant} info={info} support={support} />} />
        <Route path="/accessibility" element={<h1>Accessibility statement</h1>} />
      </Routes>
    </MemoryRouter>,
  )
  return screen.getByRole('contentinfo')
}

const linkNames = (footer: HTMLElement) => within(footer).queryAllByRole('link').map(link => link.getAttribute('aria-label') ?? link.textContent)

describe('PlatformFooter', () => {
  it.each(['shell', 'public'] as const)('%s: renders with every value missing, Accessibility only, as the contentinfo landmark', variant => {
    const footer = renderFooter(variant, NONE)
    expect(footer.tagName).toBe('FOOTER')
    expect(linkNames(footer)).toEqual(['Accessibility (opens in a new tab)'])
    expect(within(footer).queryByText(/©|ABN|Build|v\d/)).toBeNull()
  })

  it.each(['shell', 'public'] as const)('%s: hides malformed values exactly like missing ones', variant => {
    const footer = renderFooter(variant, MALFORMED)
    expect(linkNames(footer)).toEqual(['Accessibility (opens in a new tab)'])
    expect(within(footer).queryByText(/©|ABN|Build|v\d/)).toBeNull()
  })

  it('shows the full state in order: the acknowledgement, the facts, then Support, Privacy, Terms, Accessibility and Status', () => {
    const footer = renderFooter('shell', FULL)
    const facts = within(footer).getByText(/^© /).closest('p')!
    expect(facts.textContent).toBe(`© ${new Date().getFullYear()} Odip Pty Ltd · ABN 12 345 678 901 · v1.0.0 · 7be2ef8`)
    // The dots between facts are drawn, never read aloud.
    expect([...facts.querySelectorAll('[aria-hidden="true"]')].map(dot => dot.textContent)).toEqual([' · ', ' · '])
    expect(linkNames(footer)).toEqual(['Support: help@example.org', 'Privacy (opens in a new tab)', 'Terms (opens in a new tab)', 'Accessibility (opens in a new tab)', 'Status (opens in a new tab)'])
    const ack = within(footer).getByText(ACKNOWLEDGEMENT_OF_COUNTRY)
    const list = within(footer).getByRole('list')
    expect(ack.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(facts.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names Support with its address, links it as mailto, and shows only the word below md', () => {
    const support = within(renderFooter('shell', FULL)).getByRole('link', { name: 'Support: help@example.org' })
    expect(support).toHaveAttribute('href', 'mailto:help@example.org')
    expect(within(support).getByText('Support')).toHaveClass('md:hidden')
    expect(within(support).getByText('Support: help@example.org')).toHaveClass('hidden', 'md:inline')
  })

  it('opens Status in a new tab, says so, and gives the new page no handle on this one', () => {
    const status = within(renderFooter('public', FULL)).getByRole('link', { name: 'Status (opens in a new tab)' })
    expect(status).toHaveAttribute('href', 'https://status.example.org')
    expect(status).toHaveAttribute('target', '_blank')
    expect(status).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(status).getByText('(opens in a new tab)')).toHaveClass('sr-only')
  })

  it.each(['shell', 'public'] as const)('%s: opens Privacy, Terms and Accessibility in a new tab, says so, and keeps the form on this page', variant => {
    const footer = renderFooter(variant, FULL)
    for (const [name, href] of [['Privacy', '/legal/privacy'], ['Terms', '/legal/terms'], ['Accessibility', '/accessibility']]) {
      const link = within(footer).getByRole('link', { name: `${name} (opens in a new tab)` })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(within(link).getByText('(opens in a new tab)')).toHaveClass('sr-only')
    }
  })

  it('links Privacy and Terms to their routes only while the documents are published', () => {
    const footer = renderFooter('public', FULL)
    expect(within(footer).getByRole('link', { name: 'Privacy (opens in a new tab)' })).toHaveAttribute('href', '/legal/privacy')
    expect(within(footer).getByRole('link', { name: 'Terms (opens in a new tab)' })).toHaveAttribute('href', '/legal/terms')
  })

  it('hides Privacy and Terms while legalPublished is false, whatever else is set', () => {
    expect(linkNames(renderFooter('public', { ...FULL, legalPublished: false }))).toEqual(['Support: help@example.org', 'Accessibility (opens in a new tab)', 'Status (opens in a new tab)'])
  })

  it('public: carries the acknowledgement at 13px, one step above the small print, at every width', () => {
    const ack = within(renderFooter('public', NONE)).getByText(ACKNOWLEDGEMENT_OF_COUNTRY)
    expect(ack).toHaveClass('text-[13px]')
    expect(ack).not.toHaveClass('hidden')
  })

  it('shell: carries the acknowledgement at the caption step from md only, on its own row above the facts and links', () => {
    const footer = renderFooter('shell', FULL)
    const ack = within(footer).getByText(ACKNOWLEDGEMENT_OF_COUNTRY)
    expect(ack).toHaveClass('hidden', 'md:block', 'max-w-[68ch]')
    expect(ack.contains(within(footer).getByRole('list'))).toBe(false)
    expect(ack.parentElement!.contains(within(footer).getByRole('list'))).toBe(true)
    expect(ack.nextElementSibling!.contains(within(footer).getByRole('list'))).toBe(true)
  })

  it('hides Support when support is false (the caregiver form), even with an address set', () => {
    const footer = renderFooter('public', FULL, false)
    expect(within(footer).queryByRole('link', { name: /Support/ })).toBeNull()
    expect(linkNames(footer)).toEqual(['Privacy (opens in a new tab)', 'Terms (opens in a new tab)', 'Accessibility (opens in a new tab)', 'Status (opens in a new tab)'])
  })

  it('shell: carries the bottom-nav clearance below lg, now that main no longer does', () => {
    expect(renderFooter('shell', NONE)).toHaveClass('pb-[calc(var(--mobile-nav-h)+0.75rem)]', 'lg:pb-3')
  })

  it('public: one centred column, padded for the safe area only', () => {
    const footer = renderFooter('public', NONE)
    expect(footer).toHaveClass('pb-[calc(var(--safe-bottom)+0.75rem)]', 'max-w-3xl', 'mx-auto')
    expect(footer.className).not.toContain('mobile-nav-h')
  })

  it('holds no nav landmark, lists its links in a role=list list, and floors each link to 44px on touch rather than padding it', () => {
    const footer = renderFooter('shell', FULL)
    expect(within(footer).queryByRole('navigation')).toBeNull()
    expect(within(footer).getByRole('list')).toHaveAttribute('role', 'list')
    for (const link of within(footer).getAllByRole('link')) {
      expect(link.parentElement!.tagName).toBe('LI')
      expect(link).toHaveClass('min-h-[var(--tap-min)]', 'min-w-[var(--tap-min)]')
      expect(link.className).not.toContain('before:')
    }
    expect(footer.className).not.toMatch(/(^|\s)(fixed|sticky)(\s|$)/)
  })
})
