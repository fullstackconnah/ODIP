import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatCard } from './StatCard'
import { FactBar } from './FactBar'

const renderCard = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

// The default tile is used by VehiclesPage (three plain tiles) and, before the attention band, by the dashboard. It is
// the one that must not move: the `attention` variant is opt-in, so these pin the default's markup and classes.
describe('StatCard — default variant (unchanged)', () => {
  it('renders a compact Card with a 12px label over a text-xl display-bold value', () => {
    const { container } = renderCard(<StatCard label="Total Fleet Capacity" value="24 passengers" />)

    const card = container.firstElementChild as HTMLElement
    expect(card).toHaveClass('p-2', 'rounded-md', 'border', 'bg-[var(--color-card)]')
    const label = screen.getByText('Total Fleet Capacity')
    expect(label.tagName).toBe('P')
    expect(label).toHaveClass('text-xs', 'font-medium', 'text-[var(--color-muted-foreground)]')
    // A plain tile keeps its wrapping label.
    expect(label).not.toHaveClass('truncate')
    const value = screen.getByText('24 passengers')
    expect(value).toHaveClass('text-xl', 'font-display', 'font-bold', 'text-[var(--color-primary)]')
    // The display step is not the default tile's: it belongs to detail titles, glance figures and the attention band.
    expect(value).not.toHaveClass('text-display')
    expect(card).not.toHaveAttribute('data-attention')
    expect(card).not.toHaveAttribute('role')
  })

  it('tints the tile from the semantic containers, exactly as before', () => {
    const { container, rerender } = renderCard(<StatCard label="Overdue" value={2} tone="danger" />)
    expect(container.firstElementChild).toHaveClass('!bg-[var(--color-error-container)]/30')
    expect(screen.getByText('2')).toHaveClass('text-[var(--color-destructive)]')
    // A tinted tile is dense: its label truncates instead of wrapping.
    expect(screen.getByText('Overdue')).toHaveClass('truncate')

    rerender(<MemoryRouter><StatCard label="Overdue" value={2} tone="warning" /></MemoryRouter>)
    expect(container.firstElementChild).toHaveClass('!bg-[var(--color-warning-container)]')
    expect(screen.getByText('2')).toHaveClass('text-[var(--color-on-warning-container)]')
  })

  it('wraps the whole tile in a focusable Link when given `to`, and shows the caption as a muted line', () => {
    renderCard(<StatCard label="Qualification Issues" value={0} to="/qualifications" caption="All clear" />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/qualifications')
    expect(link).toHaveClass('block', 'rounded-[var(--radius-md)]', 'hover:opacity-90', 'focus-visible:ring-2')
    const caption = screen.getByText('All clear')
    expect(caption.tagName).toBe('P')
    expect(caption).toHaveClass('text-xs', 'text-[var(--color-muted-foreground)]')
  })

  it('ignores `loading`, which only the attention variant honours', () => {
    const { container } = renderCard(<StatCard label="Overdue" value={2} loading />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })
})

describe('StatCard — attention variant', () => {
  const tile = (label: string) => screen.getByText(label).closest('[data-attention], [role="group"], a') as HTMLElement

  it('shows the value as a display-step tabular figure with the 13px label beneath, label first in source order', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={12} />)

    const figure = screen.getByText('12')
    expect(figure).toHaveClass('text-display', 'tabular-nums')
    // No second figure style: it is the display step, not text-xl / font-display.
    expect(figure).not.toHaveClass('text-xl')
    const label = screen.getByText('Overdue')
    expect(label).toHaveClass('text-[13px]', 'font-medium', 'order-2')
    expect(figure.parentElement).toHaveClass('order-1')
    // Source order is label then figure (a screen reader hears "Overdue, 12"); `order` puts the figure on top.
    expect(label.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is quiet with no tone: card fill, muted figure and label, no data-attention', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={0} />)

    const el = tile('Overdue')
    expect(el).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    expect(el).not.toHaveAttribute('data-attention')
    expect(el.className).not.toMatch(/container\)\]/)
  })

  it('tints danger with the error container and warning with the warning container, everything in the on-container colour', () => {
    renderCard(
      <>
        <StatCard variant="attention" label="Qual" value={5} tone="danger" />
        <StatCard variant="attention" label="Missing" value={2} tone="warning" />
      </>,
    )

    const danger = tile('Qual')
    expect(danger).toHaveAttribute('data-attention', 'error')
    expect(danger).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
    const warning = tile('Missing')
    expect(warning).toHaveAttribute('data-attention', 'warning')
    expect(warning).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    // The figure and the label sit inside the tile and take its colour (no grey of their own).
    expect(within(danger).getByText('5').className).not.toMatch(/text-\[var\(--color-(muted|primary|destructive)/)
    expect(within(danger).getByText('Qual').className).not.toMatch(/text-\[var\(--color-muted/)
  })

  it('leaves info, success and neutral quiet: only warning and danger ask for attention', () => {
    renderCard(
      <>
        <StatCard variant="attention" label="A" value={1} tone="info" />
        <StatCard variant="attention" label="B" value={1} tone="success" />
        <StatCard variant="attention" label="C" value={1} tone="neutral" />
      </>,
    )

    for (const label of ['A', 'B', 'C']) {
      expect(tile(label)).not.toHaveAttribute('data-attention')
      expect(tile(label)).toHaveClass('bg-[var(--color-card)]')
    }
  })

  // The band tints exactly as the trip glance strip does. FactBar keeps its own tone map (a component file may export only
  // components), so this is what stops the two from drifting: both must carry these fills and on-container colours.
  it('carries the same fill and on-container classes as a glance segment of the same attention', () => {
    const { container } = renderCard(
      <>
        <FactBar
          variant="glance"
          segments={[
            { label: 'E', value: 1, attention: 'error' },
            { label: 'W', value: 1, attention: 'warning' },
          ]}
        />
        <StatCard variant="attention" label="Qual" value={5} tone="danger" />
        <StatCard variant="attention" label="Missing" value={2} tone="warning" />
      </>,
    )

    const glance = (attention: string) => container.querySelector(`[data-attention="${attention}"]`) as HTMLElement
    const expected = {
      error: ['bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]'],
      warning: ['bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]'],
    } as const
    expect(glance('error')).toHaveClass(...expected.error)
    expect(glance('warning')).toHaveClass(...expected.warning)
    expect(tile('Qual')).toHaveClass(...expected.error)
    expect(tile('Missing')).toHaveClass(...expected.warning)
  })

  it('shows a quiet tile\'s caption as the lime positive chip and a tinted tile\'s caption as plain text', () => {
    renderCard(
      <>
        <StatCard variant="attention" label="Quiet" value={0} caption="All clear" />
        <StatCard variant="attention" label="Tinted" value={2} tone="danger" caption="Chase these" />
      </>,
    )

    const chip = screen.getByText('All clear')
    expect(chip).toHaveClass('rounded-full', 'bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
    // A lime chip never sits on a tint (DESIGN.md, The Attention Tint Rule).
    const plain = screen.getByText('Chase these')
    expect(plain).not.toHaveClass('bg-[var(--color-primary-fixed)]')
    expect(plain).not.toHaveClass('rounded-full')
  })

  it('renders a linked tile as a link whose name is its label, its number and its caption, with a --tap-min floor', () => {
    renderCard(<StatCard variant="attention" label="Qualification Issues" value={0} to="/qualifications" caption="All clear" />)

    const link = screen.getByRole('link', { name: 'Qualification Issues 0 All clear' })
    expect(link).toHaveAttribute('href', '/qualifications')
    expect(link).toHaveClass('min-h-[var(--tap-min)]', 'hover:opacity-90', 'focus-visible:ring-2', 'focus-visible:ring-[var(--color-ring)]')
    // Never a hard-coded 44px: the floor is the token, 0px on a mouse and 44px on touch.
    expect(link.className).not.toMatch(/44px/)
  })

  it('renders an unlinked tile as a named group, so its accessible name carries the number as well as the label', () => {
    renderCard(<StatCard variant="attention" label="Missing Staff" value={2} tone="warning" />)

    const group = screen.getByRole('group', { name: 'Missing Staff 2' })
    expect(group.tagName).toBe('DIV')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows an en dash while loading: muted, busy, never tinted, no caption, no definite number', () => {
    renderCard(
      <StatCard variant="attention" label="Critical Participant Alerts" value={0} to="/participants" tone="danger" caption="All clear" loading />,
    )

    const link = screen.getByRole('link', { name: 'Critical Participant Alerts Loading' })
    expect(link).toHaveAttribute('aria-busy', 'true')
    expect(link).not.toHaveAttribute('data-attention')
    expect(link).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    const dash = screen.getByText('–')
    expect(dash).toHaveClass('text-display', 'tabular-nums')
    // The dash is decoration for assistive tech; "Loading" is what it hears instead.
    expect(dash).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('All clear')).toBeNull()
  })

  it('names an unlinked loading tile "<label> Loading" and marks it busy', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={0} loading />)

    expect(screen.getByRole('group', { name: 'Overdue Loading' })).toHaveAttribute('aria-busy', 'true')
  })

  it('is not busy once loaded', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} tone="danger" loading={false} />)

    expect(tile('Overdue')).not.toHaveAttribute('aria-busy')
  })

  it('passes className through to the tile (the band uses it to stretch an odd last item)', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} className="col-span-2" />)

    expect(tile('Overdue')).toHaveClass('col-span-2')
  })
})
