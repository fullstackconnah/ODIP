import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Star } from 'lucide-react'
import { FactBar } from './FactBar'

describe('FactBar', () => {
  it('renders a label/value pair for each segment', () => {
    render(
      <FactBar
        segments={[
          { label: 'Status', value: 'Confirmed' },
          { label: 'Pax', value: 4 },
        ]}
      />,
    )
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Pax')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders an optional badge next to a segment', () => {
    render(
      <FactBar
        segments={[{ label: 'Status', value: 'Confirmed', badge: <span data-testid="badge">New</span> }]}
      />,
    )
    expect(screen.getByTestId('badge')).toBeInTheDocument()
  })

  it('renders an optional leading icon for a segment', () => {
    render(<FactBar segments={[{ label: 'Vehicle', value: 'Van 3', icon: Star }]} />)
    const label = screen.getByText('Vehicle')
    const segment = label.closest('div')!.parentElement!
    expect(segment.querySelector('svg')).toBeTruthy()
  })

  it('renders a ready-made element icon in a muted 16px slot before the label', () => {
    render(
      <FactBar
        segments={[
          { label: 'Participants', value: '4', icon: <span data-testid="glyph" className="material-symbols-outlined">groups</span> },
        ]}
      />,
    )
    const glyph = screen.getByTestId('glyph')
    const slot = glyph.parentElement!
    expect(slot.className).toMatch(/\bw-4\b/)
    expect(slot.className).toMatch(/\bh-4\b/)
    expect(slot.className).toMatch(/text-\[var\(--color-muted-foreground\)\]/)
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    // The slot is the first thing in the segment, i.e. it sits before the label column.
    const segment = slot.parentElement!
    expect(segment.firstElementChild).toBe(slot)
    expect(slot.compareDocumentPosition(screen.getByText('Participants')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders a segment without an icon exactly as before (no icon slot)', () => {
    render(<FactBar segments={[{ label: 'Status', value: 'Confirmed' }]} />)
    const segment = screen.getByText('Status').closest('div')!.parentElement!
    // Only the label/value column — no leading slot, no svg.
    expect(segment.children.length).toBe(1)
    expect(segment.querySelector('svg')).toBeNull()
    expect(segment.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('applies a vertical rule border to every segment after the first, not the first', () => {
    const { container } = render(
      <FactBar
        segments={[
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
          { label: 'C', value: '3' },
        ]}
      />,
    )
    const bar = container.firstElementChild as HTMLElement
    const [first, second, third] = Array.from(bar.children) as HTMLElement[]
    expect(first.className).not.toMatch(/border-l/)
    expect(second.className).toMatch(/border-l/)
    expect(third.className).toMatch(/border-l/)
  })

  it('is a single 44px-tall strip with rounded-md card styling', () => {
    const { container } = render(<FactBar segments={[{ label: 'A', value: '1' }]} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar.className).toMatch(/min-h-\[44px\]/)
    expect(bar.className).toMatch(/rounded-md/)
    expect(bar.className).toMatch(/bg-\[var\(--color-card\)\]/)
  })

  it('wraps segments onto a new line on narrow screens', () => {
    const { container } = render(<FactBar segments={[{ label: 'A', value: '1' }]} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar.className).toMatch(/flex-wrap/)
  })

  it('renders no segments gracefully for an empty array', () => {
    const { container } = render(<FactBar segments={[]} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar.children.length).toBe(0)
  })
})
