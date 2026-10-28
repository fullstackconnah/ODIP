import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DisclosureToggle } from './DisclosureToggle'

describe('DisclosureToggle', () => {
  it('shows the label unchanged and reports closed with aria-controls', () => {
    render(<DisclosureToggle label="Inactive (2)" open={false} onToggle={() => {}} controls="panel-1" />)
    const b = screen.getByRole('button', { name: 'Inactive (2)' })
    expect(b).toHaveAttribute('aria-expanded', 'false')
    expect(b).toHaveAttribute('aria-controls', 'panel-1')
  })

  it('reports open, rotates the chevron and calls onToggle on click', async () => {
    const onToggle = vi.fn()
    render(<DisclosureToggle label="Archived (1)" open onToggle={onToggle} />)
    const b = screen.getByRole('button', { name: 'Archived (1)' })
    expect(b).toHaveAttribute('aria-expanded', 'true')
    expect(b).not.toHaveAttribute('aria-controls')
    expect(b.querySelector('svg')).toHaveClass('rotate-180')
    await userEvent.click(b)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('has the --tap-min floor and a keyboard-only focus ring', () => {
    render(<DisclosureToggle label="Ceased (3)" open={false} onToggle={() => {}} />)
    expect(screen.getByRole('button')).toHaveClass('min-h-[var(--tap-min)]', 'focus-visible:ring-2')
  })
})
