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
