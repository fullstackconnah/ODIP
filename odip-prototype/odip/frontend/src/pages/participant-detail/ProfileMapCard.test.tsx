import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProfileMapCard, type ProfileMapLine } from './ProfileMapCard'

const lines: ProfileMapLine[] = [
  { tab: 'about', label: 'About', chips: [{ id: 'identity', label: 'Profile', quiet: false }, { id: 'ndis-plan', label: 'NDIS & services', quiet: false }] },
  { tab: 'health', label: 'Health & safety', count: 3, chips: [{ id: 'emergency', label: 'Medical', quiet: true }, { id: 'medications', label: 'Medications', quiet: false }] },
  { tab: 'agreements', label: 'Agreements', chips: [{ id: 'agreements', label: 'Agreements', quiet: false }] },
]
const view = () => render(<MemoryRouter><ProfileMapCard lines={lines} /></MemoryRouter>)

describe('ProfileMapCard', () => {
  it('has one line per tab, titled In this profile', () => {
    view()
    expect(screen.getByRole('heading', { name: 'In this profile' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('links each chip to its tab and section', () => {
    view()
    const health = screen.getAllByRole('listitem')[1]
    expect(within(health).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/?tab=health#emergency', '/?tab=health#medications'])
  })

  it('shows the tab count as the tab badge does, with a spoken noun-free numeral', () => {
    view()
    expect(within(screen.getAllByRole('listitem')[1]).getByText('3')).toBeInTheDocument()
    expect(within(screen.getAllByRole('listitem')[0]).queryByText(/\d/)).toBeNull()
  })

  it('mutes an empty chip and says not recorded', () => {
    view()
    expect(screen.getByRole('link', { name: /^Medical\s*, not recorded$/ })).toHaveAttribute('data-quiet', 'true')
  })

  it('makes a one-chip tab a single link under its own name', () => {
    view()
    const row = screen.getAllByRole('listitem')[2]
    expect(within(row).getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])).toEqual([['Agreements', '/?tab=agreements']])
    expect(row.firstElementChild).toHaveTextContent('Agreements')
  })

  it('puts the name in a left column and the links in a wrapping right column', () => {
    view()
    const row = screen.getAllByRole('listitem')[0]
    expect(row.className).toContain('sm:grid-cols-[9rem_1fr]')
    expect(row.lastElementChild!.className).toContain('flex-wrap')
    expect(within(row.lastElementChild as HTMLElement).getAllByRole('link')).toHaveLength(2)
  })

  it('names the list and speaks the count with its noun', () => {
    render(<MemoryRouter><ProfileMapCard lines={[{ ...lines[1], spoken: '3 active risks' }]} /></MemoryRouter>)
    expect(screen.getByRole('list', { name: 'In this profile' })).toHaveTextContent('3, 3 active risks')
  })

  it('tones links by content and leaves them unfilled', () => {
    view()
    const quiet = screen.getByRole('link', { name: /^Medical/ })
    const filled = screen.getByRole('link', { name: 'Medications' })
    for (const a of [quiet, filled]) expect(a.className).toContain('bg-transparent')
    expect(filled).not.toHaveAttribute('data-quiet')
    expect(quiet.className).toContain('data-[quiet]:text-[var(--color-muted-foreground)]')
    expect(filled.className).toContain('text-[var(--color-foreground)]')
  })
})
