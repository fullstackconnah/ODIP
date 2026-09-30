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

  it('renders iconOnly as a fixed --control-h-sm square (24px fine, 36px coarse) with no padding', () => {
    render(<Button iconOnly aria-label="Back to inbox">{'<-'}</Button>)
    const btn = screen.getByRole('button', { name: 'Back to inbox' })
    // Height AND width come off the token, so a coarse pointer scales the hit area with the rest
    // of the density layer; padding is zero because the centred icon is the content.
    expect(btn).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]', 'p-0')
    // p-1.5 (28px with a 16px icon) is what pushed table rows past --row-h — it must not return.
    expect(btn).not.toHaveClass('p-1.5')
    // A square in a crowded row of actions must not be squeezed narrower than tall.
    expect(btn).toHaveClass('shrink-0')
    expect(btn).toHaveClass('font-medium')
  })

  it('ignores size for iconOnly: every icon button is the same --control-h-sm square', () => {
    render(
      <>
        <Button iconOnly size="sm" aria-label="small">x</Button>
        <Button iconOnly size="md" aria-label="medium">x</Button>
        <Button iconOnly size="lg" aria-label="large">x</Button>
      </>,
    )
    for (const name of ['small', 'medium', 'large']) {
      const btn = screen.getByRole('button', { name })
      expect(btn).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]')
      expect(btn.className).not.toMatch(/h-\[var\(--control-h\)\]|h-\[calc/)
    }
  })

  it('takes its corner radius from the --radius-sm token, not the old rounded-lg', () => {
    render(
      <>
        <Button>Text</Button>
        <Button iconOnly aria-label="Icon">x</Button>
      </>,
    )
    for (const name of ['Text', 'Icon']) {
      const btn = screen.getByRole('button', { name })
      expect(btn).toHaveClass('rounded-[var(--radius-sm)]')
      expect(btn).not.toHaveClass('rounded-lg')
    }
  })

  it('sizes text buttons off the control tokens: sm = --control-h-sm, md = --control-h', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Small' })).toHaveClass('h-[var(--control-h-sm)]')
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveClass('h-[var(--control-h)]')
  })
})