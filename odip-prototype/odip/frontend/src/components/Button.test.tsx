import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

// R3 F-02 / R2-10: Button concatenates its variant classes and the caller's className with no merge, so a ghost button given
// a destructive colour className had TWO colour utilities for one property and the stylesheet order (alphabetical among the
// arbitrary values) picked the winner: ghost's muted grey and primary green beat the caller's red. Delete / Remove lost their
// destructive cue. The fix is a variant that carries one colour set; these tests pin it and the pattern that caused it.
describe('Button — ghost-danger variant', () => {
  const variants = ['primary', 'secondary', 'danger', 'ghost', 'ghost-danger'] as const

  it('is destructive text at rest and on hover, with an error-container wash, and none of ghost\'s own colours', () => {
    render(<Button variant="ghost-danger">Delete</Button>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toHaveClass('text-[var(--color-destructive)]', 'hover:text-[var(--color-destructive)]', 'hover:bg-[var(--color-error-container)]')
    // The colours that beat the caller's red in the old ghost + className combination must not be on the element at all.
    expect(btn).not.toHaveClass('text-[var(--color-muted-foreground)]')
    expect(btn).not.toHaveClass('hover:text-[var(--color-primary)]')
    expect(btn).not.toHaveClass('hover:bg-[var(--color-accent)]')
  })

  it('keeps the shared shape: same base, size, hit area and disabled handling as every other variant', () => {
    render(
      <>
        <Button variant="ghost-danger" size="sm" iconOnly aria-label="Remove">x</Button>
        <Button variant="ghost-danger" disabled>Gone</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]', ...TAP_AREA.split(' '))
    const gone = screen.getByRole('button', { name: 'Gone' })
    expect(gone).toBeDisabled()
    expect(gone).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]', 'disabled:opacity-50')
  })

  it('gives every variant exactly one resting text colour, one hover text colour and one hover background (nothing to collide)', () => {
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>)
      const tokens = screen.getByRole('button', { name: variant }).className.split(/\s+/)
      const rest = tokens.filter(t => /^text-(\[var\(--color-[^)]+\)\]|white)$/.test(t))
      const hoverText = tokens.filter(t => t.startsWith('hover:text-'))
      const hoverBg = tokens.filter(t => t.startsWith('hover:bg-'))
      expect(rest.length, `${variant} resting text colours: ${rest.join(' ')}`).toBeLessThanOrEqual(1)
      expect(hoverText.length, `${variant} hover text colours: ${hoverText.join(' ')}`).toBeLessThanOrEqual(1)
      expect(hoverBg.length, `${variant} hover backgrounds: ${hoverBg.join(' ')}`).toBeLessThanOrEqual(1)
      unmount()
    }
  })
})

describe('Button — no destructive colour overrides on a ghost button', () => {
  /** Every non-test .tsx under src as [relative path, source]. */
  function sources(): [string, string][] {
    const root = resolve(__dirname, '..')
    return (readdirSync(root, { recursive: true }) as string[])
      .filter(f => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f))
      .map(f => [f, readFileSync(join(root, f), 'utf8')] as [string, string])
  }

  /** The opening tag of every `<Button ...>`, with braces balanced so an arrow function in `onClick` does not end it early. */
  function buttonTags(src: string): { tag: string; index: number }[] {
    const out: { tag: string; index: number }[] = []
    for (const m of src.matchAll(/<Button\b/g)) {
      let depth = 0
      let i = m.index! + 7
      for (; i < src.length; i++) {
        const c = src[i]
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0 && src[i - 1] !== '=') break
      }
      out.push({ tag: src.slice(m.index!, i + 1), index: m.index! })
    }
    return out
  }

  it('no <Button variant="ghost"> carries a destructive colour in its className: use variant="ghost-danger"', () => {
    const offenders: string[] = []
    for (const [file, src] of sources()) {
      for (const { tag, index } of buttonTags(src)) {
        if (/variant=["']ghost["']/.test(tag) && /className=[^>]*(destructive|error-container|text-red)/.test(tag)) {
          offenders.push(`${file}:${src.slice(0, index).split('\n').length}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the destructive actions that lost their red use the variant', () => {
    const uses = (file: string) => buttonTags(readFileSync(join(resolve(__dirname, '..'), file), 'utf8')).filter(({ tag }) => /variant=["']ghost-danger["']/.test(tag)).length
    expect(uses('pages/rostering/components/ShiftSlideOver.tsx')).toBe(1)
    expect(uses('pages/rostering/components/PatternSlideOver.tsx')).toBe(1)
    expect(uses('pages/trip-detail/AccommodationTab.tsx')).toBe(1)
    expect(uses('pages/ParticipantDetailPage.tsx')).toBe(1)
  })
})
