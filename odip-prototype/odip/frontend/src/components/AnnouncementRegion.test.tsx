import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnnouncementRegion } from './AnnouncementRegion'

describe('AnnouncementRegion', () => {
  it('is a polite live region, empty until there is something to say', () => {
    render(<AnnouncementRegion message="" />)

    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('is read whole each time it changes, so a sentence is never announced as a fragment', () => {
    render(<AnnouncementRegion message="" />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true')
  })

  it('is visually hidden: sighted users read the same sentence in the visible content', () => {
    render(<AnnouncementRegion message="Ann One was created." />)

    expect(screen.getByRole('status')).toHaveClass('sr-only')
  })

  it('is the same element when its message arrives, because a live region created already holding its text is announced unreliably', () => {
    const { rerender } = render(<AnnouncementRegion message="" />)
    const before = screen.getByRole('status')

    rerender(<AnnouncementRegion message="Ann One was created. We've sent ann@example.com a link." />)

    expect(screen.getByRole('status')).toBe(before)
    expect(before).toHaveTextContent("Ann One was created. We've sent ann@example.com a link.")
  })
})
