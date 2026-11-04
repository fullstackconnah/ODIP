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
    const agreements = within(screen.getAllByRole('listitem')[2]).getAllByRole('link')
    expect(agreements.map(a => [a.textContent, a.getAttribute('href')])).toEqual([['Agreements', '/?tab=agreements']])
  })
})
