import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Button } from './Button'
import { TAP_AREA } from './tapArea'

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

// Spec §1: `--control-h-sm` is 36px on a touch screen "(hit area padded to 44px)". `sm` and `iconOnly` are the only
// Button shapes that stay under 44px there (md is 44, lg is 48), so they alone carry TAP_AREA — a transparent, centred
// ::before sized max(100%, --tap-min). --tap-min is 0px on a mouse, so the desktop box, look and hit area are unchanged.
describe('Button — 44px coarse-pointer hit area', () => {
  const pad = TAP_AREA.split(' ')

  it('pads size="sm" to a 44px hit area', () => {
    render(<Button size="sm">Edit</Button>)
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass(...pad)
  })

  it('pads every iconOnly button, whatever size it was given', () => {
    render(
      <>
        <Button iconOnly aria-label="default">x</Button>
        <Button iconOnly size="sm" aria-label="small">x</Button>
        <Button iconOnly size="md" aria-label="medium">x</Button>
        <Button iconOnly size="lg" aria-label="large">x</Button>
      </>,
    )
    for (const name of ['default', 'small', 'medium', 'large']) {
      expect(screen.getByRole('button', { name })).toHaveClass(...pad)
    }
  })

  it('pads the router-Link form of sm and iconOnly too (row actions that navigate)', () => {
    render(
      <MemoryRouter>
        <Button to="/a" size="sm">Small link</Button>
        <Button to="/b" iconOnly aria-label="Icon link">x</Button>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Small link' })).toHaveClass(...pad)
    expect(screen.getByRole('link', { name: 'Icon link' })).toHaveClass(...pad)
  })

  it('leaves md and lg alone: they already reach 44px / 48px on a touch screen', () => {
    render(
      <>
        <Button>Default</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </>,
    )
    for (const name of ['Default', 'Medium', 'Large']) {
      const btn = screen.getByRole('button', { name })
      expect(btn).not.toHaveClass('relative')
      expect(btn.className).not.toContain('before:')
    }
  })

  it('does not change the box: the pad rides on a pseudo-element, so the size classes stay exactly the token heights', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button iconOnly aria-label="Icon">x</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Small' })).toHaveClass('h-[var(--control-h-sm)]')
    expect(screen.getByRole('button', { name: 'Icon' })).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]')
    // No padding/margin/min-size utility was added to the button itself to fake a bigger target.
    for (const name of ['Small', 'Icon']) {
      const own = screen.getByRole('button', { name }).className.split(' ').filter(c => !c.includes(':'))
      expect(own.filter(c => /^(?:min-[hw]|-?m[trblxy]?-)/.test(c))).toEqual([])
    }
  })

  it('keeps a caller className working next to the pad', () => {
    render(<Button size="sm" className="ml-2">Edit</Button>)
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass('ml-2', ...pad)
  })
})
