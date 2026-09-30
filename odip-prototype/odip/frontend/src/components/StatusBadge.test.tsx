import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge — size', () => {
  it('renders the 12px pill exactly as before when `size` is omitted', () => {
    render(<StatusBadge status="Confirmed" />)
    const badge = screen.getByText('Confirmed')
    // The complete class string, so any drift in the default (used by every table in the app) fails here.
    expect(badge.className.replace(/\s+/g, ' ').trim()).toBe(
      'text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
    )
  })

  it('treats size="sm" as the default', () => {
    const omitted = render(<StatusBadge status="Draft" />)
    const html = omitted.container.innerHTML
    omitted.unmount()
    const explicit = render(<StatusBadge status="Draft" size="sm" />)
    expect(explicit.container.innerHTML).toBe(html)
  })

  it('renders the md pill (13px, semibold, 24px tall) that leads a detail meta row', () => {
    render(<StatusBadge status="Confirmed" size="md" />)
    const badge = screen.getByText('Confirmed')
    expect(badge).toHaveClass('text-[13px]', 'leading-5', 'font-semibold', 'px-2.5', 'py-0.5', 'rounded-full')
    expect(badge).not.toHaveClass('text-xs')
  })

  it('keeps the same colour at both sizes (only the size is opt-in)', () => {
    for (const size of ['sm', 'md'] as const) {
      const { unmount } = render(<StatusBadge status="Cancelled" size={size} />)
      expect(screen.getByText('Cancelled')).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
      unmount()
    }
  })

  it('still honours label, pulse and className at md', () => {
    render(<StatusBadge status="pending" label="Awaiting" size="md" pulse className="ml-2" />)
    expect(screen.getByText('Awaiting')).toHaveClass('animate-pulse', 'ml-2', 'bg-[var(--color-warning-container)]')
  })
})
