import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Star } from 'lucide-react'
import { FactBar, FactChip, type FactBarAttention, type FactBarSegment } from './FactBar'

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

// The glance variant is opt-in. Every page that does not pass `variant` must render exactly what it always did.
describe('FactBar — the default variant is untouched by the glance variant', () => {
  const segments: FactBarSegment[] = [
    { label: 'Total Amount', value: '$960.00' },
    { label: 'Trip', value: 'Byron Bay', icon: Star, badge: <span>New</span> },
    { label: 'Status', value: 'Open', icon: <span className="material-symbols-outlined">flag</span> },
  ]

  it('renders byte-identical markup whether `variant` is omitted or "default"', () => {
    const omitted = render(<FactBar segments={segments} />)
    const html = omitted.container.innerHTML
    omitted.unmount()

    const explicit = render(<FactBar variant="default" segments={segments} />)
    expect(explicit.container.innerHTML).toBe(html)
  })

  it('does not use any glance class: no grid, no display figure, no clipping on the strip', () => {
    const { container } = render(<FactBar segments={segments} />)
    // (The default icon slot legitimately carries overflow-hidden, so the clipping check is on the strip itself.)
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/grid|overflow-hidden/)
    const html = container.innerHTML
    for (const glanceClass of ['text-display', 'tabular-nums', 'data-attention', 'order-1', 'order-2', 'text-current']) {
      expect(html).not.toContain(glanceClass)
    }
  })

  it('ignores `attention`: a default segment is never tinted and carries no data attribute', () => {
    const { container } = render(
      <FactBar segments={[{ label: 'Insurance', value: '4/5', attention: 'error' }, { label: 'Tasks', value: 2, attention: 'warning' }]} />,
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/color-error-container|color-warning-container/)
    expect(html).not.toContain('data-attention')
  })
})

describe('FactBar — variant="glance"', () => {
  const glanceSegments: FactBarSegment[] = [
    { label: 'Participants / Staff', value: '5 / 3', icon: <span data-testid="glyph" className="material-symbols-outlined">groups</span> },
    { label: 'Outstanding Tasks', value: 2 },
  ]

  function renderGlance(segments: FactBarSegment[] = glanceSegments) {
    const { container } = render(<FactBar variant="glance" segments={segments} />)
    const bar = container.firstElementChild as HTMLElement
    return { bar, cells: Array.from(bar.children) as HTMLElement[] }
  }

  it('is a rounded, bordered, clipped grid: two columns below md, one equal-width row from md', () => {
    const { bar } = renderGlance()
    expect(bar).toHaveClass('grid', 'grid-cols-2', 'md:grid-cols-none', 'md:grid-flow-col', 'md:auto-cols-fr')
    // overflow-hidden lets a tinted cell follow the strip's rounded corners; it is a Flat-By-Default surface, no shadow.
    expect(bar).toHaveClass('overflow-hidden', 'rounded-md', 'border', 'bg-[var(--color-card)]')
    expect(bar.className).not.toMatch(/shadow/)
    // ...and none of the default strip's flex layout.
    expect(bar).not.toHaveClass('flex', 'flex-wrap', 'min-h-[44px]')
  })

  it('sets the value as a display-step tabular figure', () => {
    renderGlance()
    const figure = screen.getByText('5 / 3')
    expect(figure).toHaveClass('text-display', 'tabular-nums')
  })

  it('puts a 13px label beneath the figure: source order is label then value, `order` flips it visually', () => {
    renderGlance()
    const label = screen.getByText('Participants / Staff')
    const labelRow = label.parentElement!
    const figureRow = screen.getByText('5 / 3').parentElement!
    expect(labelRow).toHaveClass('text-[13px]', 'order-2')
    expect(figureRow).toHaveClass('order-1')
    // Same cell, label first in the source so a screen reader hears "label, value, badge".
    expect(labelRow.parentElement).toBe(figureRow.parentElement)
    expect(labelRow.compareDocumentPosition(figureRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the icon in a 16px aria-hidden slot that takes the label colour', () => {
    renderGlance()
    const slot = screen.getByTestId('glyph').parentElement!
    expect(slot).toHaveClass('h-4', 'w-4', 'text-current')
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    // It sits in the label row, before the label text.
    expect(slot.parentElement).toBe(screen.getByText('Participants / Staff').parentElement)
    expect(slot.className).not.toMatch(/text-\[var\(--color-muted-foreground\)\]/)
  })

  it('renders a lucide icon component too, in the same 16px slot', () => {
    const { cells } = renderGlance([{ label: 'Vehicle', value: 'Van 3', icon: Star }])
    const svg = cells[0].querySelector('svg')!
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('class')).toMatch(/w-4/)
    expect(svg.getAttribute('class')).toMatch(/text-current/)
  })

  it('renders the badge in the figure row, beside the figure', () => {
    renderGlance([{ label: 'Outstanding Tasks', value: 2, badge: <span data-testid="chip">Action Needed</span> }])
    expect(screen.getByTestId('chip').parentElement).toBe(screen.getByText('2').parentElement)
  })

  it('lets a long figure row wrap its badge instead of overflowing (a narrow 2x2 cell)', () => {
    renderGlance([{ label: 'Insurance', value: '4/5', badge: <span>Outstanding</span> }])
    expect(screen.getByText('4/5').parentElement).toHaveClass('flex', 'flex-wrap')
  })

  it('renders no cells for an empty array', () => {
    const { bar } = renderGlance([])
    expect(bar.children).toHaveLength(0)
  })

  it('appends a caller className to the strip', () => {
    const { container } = render(<FactBar variant="glance" className="mt-2" segments={glanceSegments} />)
    expect(container.firstElementChild).toHaveClass('mt-2', 'grid')
  })
})

describe('FactBar glance — attention tint', () => {
  function renderCells(attentions: Array<FactBarAttention | undefined>) {
    const segments: FactBarSegment[] = attentions.map((attention, i) => ({ label: `Fact ${i}`, value: i, attention }))
    const { container } = render(<FactBar variant="glance" segments={segments} />)
    return Array.from((container.firstElementChild as HTMLElement).children) as HTMLElement[]
  }

  it('fills a warning segment with the warning-container and its on-container text colour', () => {
    const [cell] = renderCells(['warning'])
    expect(cell).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    expect(cell).toHaveAttribute('data-attention', 'warning')
    expect(cell.className).not.toMatch(/error-container/)
  })

  it('fills an error segment with the error-container and its on-container text colour', () => {
    const [cell] = renderCells(['error'])
    expect(cell).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
    expect(cell).toHaveAttribute('data-attention', 'error')
    expect(cell.className).not.toMatch(/warning-container/)
  })

  it('leaves a quiet segment plain: card fill, ink text, no tint class, no data attribute', () => {
    const [cell] = renderCells([undefined])
    expect(cell).toHaveClass('text-[var(--color-foreground)]')
    expect(cell.className).not.toMatch(/bg-\[/)
    expect(cell.className).not.toMatch(/container/)
    expect(cell).not.toHaveAttribute('data-attention')
  })

  it('tints only the segments that ask, and keeps their neighbours calm', () => {
    const cells = renderCells(['warning', 'error', undefined, 'error'])
    expect(cells.map(c => c.getAttribute('data-attention'))).toEqual(['warning', 'error', null, 'error'])
    expect(cells[2].className).not.toMatch(/container/)
  })

  it('tints the label and the icon from the segment colour, never grey: a tinted label carries no muted class', () => {
    const [tinted, quiet] = renderCells(['error', undefined])
    const tintedLabel = within(tinted).getByText('Fact 0').parentElement!
    const quietLabel = within(quiet).getByText('Fact 1').parentElement!
    // Tinted: inherits the on-container text colour of its cell. Quiet: the muted label colour.
    expect(tintedLabel.className).not.toMatch(/muted-foreground/)
    expect(quietLabel).toHaveClass('text-[var(--color-muted-foreground)]')
  })
})

describe('FactBar glance — cell rules and count handling', () => {
  function cellsFor(count: number) {
    const segments: FactBarSegment[] = Array.from({ length: count }, (_, i) => ({ label: `Fact ${i}`, value: i }))
    const { container } = render(<FactBar variant="glance" segments={segments} />)
    return Array.from((container.firstElementChild as HTMLElement).children) as HTMLElement[]
  }

  it('draws a 2x2 grid with rules between cells: right column gets a left rule, second row a top rule', () => {
    const [c0, c1, c2, c3] = cellsFor(4)
    // Below md.
    expect(c0.className).not.toMatch(/(^|\s)border-[lt](\s|$)/)
    expect(c1).toHaveClass('border-l')
    expect(c1.className).not.toMatch(/(^|\s)border-t(\s|$)/)
    expect(c2).toHaveClass('border-t')
    expect(c2.className).not.toMatch(/(^|\s)border-l(\s|$)/)
    expect(c3).toHaveClass('border-l', 'border-t')
  })

  it('collapses to one row from md: every cell after the first has a left rule and none a top rule', () => {
    const [c0, c1, c2, c3] = cellsFor(4)
    expect(c0.className).not.toMatch(/md:border/)
    expect(c1).toHaveClass('border-l') // unprefixed: already applies at md
    expect(c2).toHaveClass('md:border-l', 'md:border-t-0')
    expect(c3).toHaveClass('border-l', 'md:border-t-0')
  })

  it('gives every cell the ruled-line colour explicitly (Tailwind 4 defaults borders to currentColor)', () => {
    for (const cell of cellsFor(4)) expect(cell).toHaveClass('border-[var(--color-border)]')
  })

  it('lets the last cell of an odd count span the whole row below md, instead of leaving a hole', () => {
    const cells = cellsFor(3)
    expect(cells[2]).toHaveClass('max-md:col-span-2')
    expect(cells[0].className).not.toMatch(/col-span/)
    expect(cells[1].className).not.toMatch(/col-span/)
  })

  it('does not span a single cell or an even count', () => {
    expect(cellsFor(1)[0].className).not.toMatch(/col-span/)
    for (const cell of cellsFor(4)) expect(cell.className).not.toMatch(/col-span/)
  })

  it('sizes cell padding from the card token vertically and steps to 16px horizontally from xl', () => {
    const [cell] = cellsFor(1)
    expect(cell).toHaveClass('px-3', 'xl:px-4', 'py-[var(--card-pad)]', 'min-w-0')
  })
})

describe('FactChip', () => {
  it.each([
    ['positive', 'bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]'],
    ['warning', 'bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]'],
    ['negative', 'bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]'],
    ['neutral', 'bg-[var(--color-input)]', 'text-[var(--color-muted-foreground)]'],
  ] as const)('renders the %s tone in its own colours (unchanged from the pre-glance chip)', (tone, bg, text) => {
    render(<FactChip tone={tone}>Label</FactChip>)
    const chip = screen.getByText('Label')
    expect(chip).toHaveClass(bg, text, 'rounded-full', 'text-xs', 'font-bold', 'px-2', 'py-0.5', 'whitespace-nowrap')
  })

  it.each([
    ['warning', 'text-[var(--color-on-warning-container)]'],
    ['negative', 'text-[var(--color-on-error-container)]'],
  ] as const)('turns a %s chip into a card-white pill on a tinted segment, so it does not vanish into the fill', (tone, text) => {
    render(<FactChip tone={tone} onTint>Label</FactChip>)
    const chip = screen.getByText('Label')
    expect(chip).toHaveClass('bg-[var(--color-card)]', text)
    // Its own container fill is gone: only the text colour keeps the tone.
    expect(chip.className).not.toMatch(/bg-\[var\(--color-(warning|error)-container\)\]/)
  })

  it.each(['positive', 'neutral'] as const)('keeps a %s chip in its own colours even when told onTint (it never sits on a tint)', tone => {
    render(<FactChip tone={tone} onTint>Label</FactChip>)
    expect(screen.getByText('Label').className).not.toMatch(/bg-\[var\(--color-card\)\]/)
  })
  it.each([['success', 'positive'], ['danger', 'negative']] as const)('accepts the tone word "%s" for the older "%s": same chip, same tint behaviour', (word, older) => {
    const { container, rerender } = render(<FactChip tone={older} onTint>Label</FactChip>)
    const asOlder = container.innerHTML
    rerender(<FactChip tone={word} onTint>Label</FactChip>)
    expect(container.innerHTML).toBe(asOlder)
  })
})
