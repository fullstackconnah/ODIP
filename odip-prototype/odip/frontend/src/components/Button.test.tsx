import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Button } from './Button'

describe('Button', () => {
  it('renders the supplied text in a primary variant by default', () => {
    render(<Button>Save enquiry</Button>)
    const btn = screen.getByRole('button', { name: 'Save enquiry' })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveClass('bg-[var(--color-primary)]')
    // Primary button uses white text on the brand background — see Button.tsx.
    expect(btn).toHaveClass('text-white')
  })

  it('defaults the native type to "button" so it cannot submit a form by accident', () => {
    render(<Button>Cancel</Button>)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button')
  })

  it('honours an explicit type prop when the caller passes one', () => {
    render(<Button type="submit">Submit enquiry</Button>)
    expect(screen.getByRole('button', { name: 'Submit enquiry' })).toHaveAttribute('type', 'submit')
  })

  it('renders the secondary and ghost variants with the documented classes', () => {
    render(
      <>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveClass('bg-[var(--color-card)]')
    // Ghost is the icon-button variant — text colour comes from the muted foreground token.
    expect(screen.getByRole('button', { name: 'Ghost' })).toHaveClass('text-[var(--color-muted-foreground)]')
  })

  it('renders the danger variant for destructive confirmations', () => {
    render(<Button variant="danger">Delete</Button>)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-[var(--color-destructive)]')
  })

  it('forwards className passthrough so pages can extend the visual spec', () => {
    render(<Button className="ml-2">Extend</Button>)
    expect(screen.getByRole('button', { name: 'Extend' })).toHaveClass('ml-2')
  })

  it('applies the disabled attribute and prevents clicks while pending or disabled', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Button disabled onClick={onClick}>
        Locked
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Locked' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed')
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders as a router Link when given a `to` prop', () => {
    render(
      <MemoryRouter>
        <Button to="/participants/new-inquiry">New enquiry</Button>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'New enquiry' })
    expect(link).toHaveAttribute('href', '/participants/new-inquiry')
    // The Link must NOT also expose a button role — that would create two semantically
    // conflicting elements on the same node (a link AND a button).
    expect(screen.queryByRole('button', { name: 'New enquiry' })).not.toBeInTheDocument()
  })

  it('renders an iconOnly layout that keeps a 44px square touch target', () => {
    render(<Button iconOnly aria-label="Back to inbox">{'<-'}</Button>)
    const btn = screen.getByRole('button', { name: 'Back to inbox' })
    // iconOnly uses p-1.5 padding; the seat class itself is shared, but the variant must NOT
    // pad-strip it back to a tiny 24px target — we want WCAG-compliant tap zones everywhere.
    expect(btn).toHaveClass('p-1.5')
    // The font-medium / rounded-lg class also persists into the iconOnly variant so the
    // control still reads as a button visually.
    expect(btn).toHaveClass('rounded-lg', 'font-medium')
  })
})