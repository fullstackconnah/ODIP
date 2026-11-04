import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SectionLine } from './SectionLine'

const three = [
  { id: 'emergency', title: 'Emergency', has: true },
  { id: 'medical', title: 'Medical', has: false },
  { id: 'health-conditions', title: 'Health conditions', has: true },
]
const view = (sections = three) => render(<MemoryRouter><SectionLine tab="health" sections={sections} /></MemoryRouter>)

describe('SectionLine', () => {
  it('shows only for a chip with 3 or more sections', () => {
    const { container, rerender } = view(three.slice(0, 2))
    expect(container).toBeEmptyDOMElement()
    rerender(<MemoryRouter><SectionLine tab="health" sections={three} /></MemoryRouter>)
    expect(screen.getByRole('navigation', { name: 'Sections on this page' })).toBeInTheDocument()
  })

  it('links each section by tab and hash, in card order', () => {
    view()
    expect(screen.getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Emergency', '/?tab=health#emergency'],
      ['Medical, not recorded', '/?tab=health#medical'],
      ['Health conditions', '/?tab=health#health-conditions'],
    ])
  })

  it('labels an empty section as not recorded for assistive tech and mutes it', () => {
    view()
    expect(screen.getByRole('link', { name: /^Medical\s*, not recorded$/ })).toHaveAttribute('data-quiet', 'true')
    expect(screen.getByRole('link', { name: 'Emergency' })).not.toHaveAttribute('data-quiet')
  })

  it('keeps every link at the touch floor', () => {
    view()
    for (const a of screen.getAllByRole('link')) {
      expect(a.className).toContain('min-h-[var(--tap-min)]')
      expect(a.className).toContain('bg-transparent')
      expect(a.className).not.toMatch(/(^|\s)(hover:|pointer-coarse:)?bg-\[var\(--color-accent\)\]/)
    }
  })

  it('reads a filled section in the body tone and an empty one muted', () => {
    view()
    expect(screen.getByRole('link', { name: 'Emergency' }).className).toContain('text-[var(--color-foreground)]')
    expect(screen.getByRole('link', { name: /^Medical/ }).className).toContain('data-[quiet]:text-[var(--color-muted-foreground)]')
  })
})
