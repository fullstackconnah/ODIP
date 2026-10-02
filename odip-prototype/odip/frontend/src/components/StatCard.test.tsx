import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatCard } from './StatCard'

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

  it('ignores `loading` and `error`, which only the attention variant honours', () => {
    const { container } = renderCard(<StatCard label="Overdue" value={2} loading error />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).toBeNull()
    expect(screen.queryByText("Couldn't load")).toBeNull()
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

  it('keeps an 8px side inset (the compact card\'s) so the longest label fits one line in a 176px tile', () => {
    renderCard(<StatCard variant="attention" label="Critical Participant Alerts" value={4} tone="danger" />)

    const el = tile('Critical Participant Alerts')
    // 12px sides (the glance cell's) left 150px inside the borders and wrapped a 152.6px label at 1920; 8px leaves 158px.
    expect(el).toHaveClass('px-2', 'py-[var(--card-pad)]', 'border', 'rounded-md')
    expect(el).not.toHaveClass('px-3')
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

  it('shows an en dash and "Couldn\'t load" when the request failed: muted, not busy, never tinted, no caption, no number', () => {
    renderCard(
      <StatCard variant="attention" label="Qualification Issues" value={0} to="/qualifications" tone="danger" caption="All clear" error />,
    )

    const link = screen.getByRole('link', { name: "Qualification Issues Couldn't load" })
    expect(link).toHaveAttribute('href', '/qualifications')
    // Failed is not in flight: nothing is about to change, so it is not busy.
    expect(link).not.toHaveAttribute('aria-busy')
    expect(link).not.toHaveAttribute('data-attention')
    expect(link).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
    const dash = screen.getByText('\u2013')
    expect(dash).toHaveClass('text-display', 'tabular-nums')
    expect(dash).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText("Couldn't load")).toHaveClass('sr-only')
    // Never an "All clear", and never a definite 0, without data.
    expect(screen.queryByText('All clear')).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('Loading')).toBeNull()
  })

  it('names an unlinked failed tile "<label> Couldn\'t load"', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} tone="warning" error />)

    const group = screen.getByRole('group', { name: "Overdue Couldn't load" })
    expect(group).not.toHaveAttribute('aria-busy')
    expect(group).not.toHaveAttribute('data-attention')
    expect(screen.queryByText('3')).toBeNull()
  })

  it('lets loading win when both are set (a retry in flight is still loading)', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={0} loading error />)

    expect(screen.getByRole('group', { name: 'Overdue Loading' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText("Couldn't load")).toBeNull()
  })

  it('is not busy once loaded', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} tone="danger" loading={false} />)

    expect(tile('Overdue')).not.toHaveAttribute('aria-busy')
  })

  it('passes className through to the tile (the band gives it h-full)', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} className="h-full" />)

    expect(tile('Overdue')).toHaveClass('h-full')
  })
})

// The tall tile of a count somebody has to act on (DESIGN.md "Attention band"): the figure, the label, one honest line and a link to where it is fixed.
// It is opt-in through `action`, so a tile that does not ask for it is the compact tile pinned above, class for class.
describe('StatCard — attention variant, the tall action tile', () => {
  const ACTION = { label: 'Open overdue tasks', to: '/tasks?status=Overdue' }
  const renderTall = (props: Partial<React.ComponentProps<typeof StatCard>> = {}) =>
    renderCard(
      <StatCard
        variant="attention"
        label="Overdue"
        value={2}
        tone="danger"
        detail="Tasks past their due date and still open."
        action={ACTION}
        {...props}
      />,
    )
  const group = (name = 'Overdue 2') => screen.getByRole('group', { name })

  it('stacks the figure, the label, the line and the link, in that order', () => {
    renderTall()

    const tile = group()
    const parts = [
      within(tile).getByText('2'),
      within(tile).getByText('Overdue'),
      within(tile).getByText('Tasks past their due date and still open.'),
      within(tile).getByRole('link', { name: 'Open overdue tasks' }),
    ]
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i - 1].compareDocumentPosition(parts[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `part ${i}`).toBeTruthy()
    }
    // One column of them: nothing sits beside the figure, so the tile stays tall at any width.
    expect(parts[0].parentElement).toHaveClass('flex', 'flex-col')
    expect(parts[0].parentElement).toBe(parts[3].parentElement)
  })

  it('sets the figure at the display step in tabular figures, the label at the title step and the line at the 13px secondary step', () => {
    renderTall()

    const tile = group()
    expect(within(tile).getByText('2')).toHaveClass('text-display', 'tabular-nums')
    expect(within(tile).getByText('Overdue')).toHaveClass('text-sm', 'font-semibold')
    expect(within(tile).getByText('Tasks past their due date and still open.')).toHaveClass('text-[13px]')
    // No new type size: the only display class on the tile is the figure's, and nothing is bigger than it.
    expect(tile.querySelectorAll('.text-display')).toHaveLength(1)
    expect(tile.innerHTML).not.toMatch(/text-(?:xl|2xl|3xl|4xl|5xl|6xl|\[(?:1[5-9]|[2-9]\d)px\])/)
  })

  it('is a named group carrying the number and the label, not a link: the link is inside it', () => {
    renderTall()

    const tile = group()
    expect(tile.tagName).toBe('DIV')
    expect(tile).not.toHaveAttribute('href')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(within(tile).getByRole('link', { name: 'Open overdue tasks' })).toHaveAttribute('href', '/tasks?status=Overdue')
  })

  it('tints a danger tile with the error container and a warning tile with the warning container, everything in the on-container colour', () => {
    renderCard(
      <>
        <StatCard variant="attention" label="Danger" value={1} tone="danger" detail="d" action={ACTION} />
        <StatCard variant="attention" label="Warning" value={1} tone="warning" detail="w" action={{ label: 'Go', to: '/x' }} />
      </>,
    )

    const danger = group('Danger 1')
    expect(danger).toHaveAttribute('data-attention', 'error')
    expect(danger).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
    const warning = group('Warning 1')
    expect(warning).toHaveAttribute('data-attention', 'warning')
    expect(warning).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    // The line and the link inherit that colour from the tile: no grey of their own on a tint.
    for (const el of [within(danger).getByText('d'), within(danger).getByRole('link')]) expect(el.className).not.toMatch(/muted-foreground|text-\[var/)
  })

  it('stays on the card fill with the muted ink when its tone does not ask for attention', () => {
    renderTall({ tone: 'info' })

    expect(group()).not.toHaveAttribute('data-attention')
    expect(group()).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-muted-foreground)]')
  })

  it('gives the link the whole tile as its hit area and its focus ring, with a --tap-min floor on its own box', () => {
    renderTall()

    const link = screen.getByRole('link', { name: 'Open overdue tasks' })
    expect(group()).toHaveClass('relative')
    expect(link).toHaveClass('after:absolute', 'after:inset-0', 'after:rounded-md', 'focus-visible:after:ring-2', 'focus-visible:after:ring-[var(--color-ring)]', 'min-h-[var(--tap-min)]', 'focus:outline-none')
    // The ring token is the app's, never an alpha-suffixed one, and 44px is the token, never a number.
    expect(link.className).not.toMatch(/ring-\[var\(--color-ring\)\]\/\d+/)
    expect(link.className).not.toMatch(/(?:min-h|h)-\[44px\]/)
  })

  it('is padded from --section-gap on every side (the airier step), and never hard-codes a size', () => {
    renderTall()

    expect(group()).toHaveClass('p-[var(--section-gap)]', 'rounded-md', 'border', 'border-[var(--color-border)]')
    expect(group().className).not.toMatch(/\bp-\d|\[\d+px\]/)
  })

  it('hides the link\'s arrow from assistive tech: the chevron is decoration', () => {
    renderTall()

    const icon = screen.getByRole('link', { name: 'Open overdue tasks' }).querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('drops the line when there is none, rather than leaving an empty row', () => {
    renderTall({ detail: undefined })

    expect(group().querySelectorAll('span')).toHaveLength(2) // the figure and the label
  })

  it('ignores a caption: the line takes that job', () => {
    renderTall({ caption: 'All clear' })

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
  })

  it('falls back to the compact tile while it has no data, whatever else it is given: there is no count for the line to explain', () => {
    renderCard(<StatCard variant="attention" label="Qualification Issues" value={0} tone="danger" detail="Expired." action={ACTION} to="/qualifications" loading />)

    const link = screen.getByRole('link', { name: 'Qualification Issues Loading' })
    expect(link).toHaveAttribute('href', '/qualifications')
    expect(link).toHaveAttribute('aria-busy', 'true')
    expect(link).not.toHaveAttribute('data-attention')
    expect(screen.queryByText('Expired.')).not.toBeInTheDocument()
    expect(screen.queryByText('Open overdue tasks')).not.toBeInTheDocument()
  })

  it('falls back to the compact tile after a failed request too', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} tone="warning" detail="Late." action={ACTION} error />)

    expect(screen.getByRole('group', { name: "Overdue Couldn't load" })).not.toHaveAttribute('data-attention')
    expect(screen.queryByText('Late.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('is still the compact tile without an action, even with a line: the compact tile does not show one', () => {
    renderCard(<StatCard variant="attention" label="Overdue" value={3} tone="danger" detail="Late." />)

    expect(screen.queryByText('Late.')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Overdue 3' })).toHaveClass('px-2')
  })

  it('does nothing to the default variant: it ignores detail and action', () => {
    renderCard(<StatCard label="Vehicles" value={3} detail="Late." action={ACTION} />)

    expect(screen.queryByText('Late.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('passes className through to the tile (the band gives it h-full)', () => {
    renderTall({ className: 'h-full' })

    expect(group()).toHaveClass('h-full')
  })
})
