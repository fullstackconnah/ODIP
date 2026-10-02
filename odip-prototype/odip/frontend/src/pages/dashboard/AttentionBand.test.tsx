import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AttentionBand, type BandItem } from './AttentionBand'
import { BAND_GRID_CLASS, BAND_SPAN_CLASS, bandSpans } from './bandLayout'
import { TONE } from '@/lib/tone'

// The band is an answer, not a row of counters: a tall tile for each item that needs somebody, ONE row naming the items that are clear, and one field when
// everything is. An item with no data is neither, so an all-clear is never claimed without the data behind it.

const slug = (label: string) => label.toLowerCase().replace(/\s+/g, '-')
const item = (label: string, count: number, o: Partial<BandItem> = {}): BandItem => ({
  label,
  count,
  tone: 'danger',
  detail: `${label} line.`,
  action: { label: `Open ${label}`, to: `/${slug(label)}` },
  ...o,
})

const renderBand = (items: BandItem[]) =>
  render(
    <MemoryRouter>
      <AttentionBand items={items} />
    </MemoryRouter>,
  )

const band = () => screen.getByRole('region', { name: 'Needs attention' })
const clearRow = () => screen.queryByText('All clear', { selector: 'span.font-semibold' })?.closest('p') ?? null

const FOUR = [item('Alpha', 3), item('Beta', 0), item('Gamma', 2, { tone: 'warning' }), item('Delta', 0)]

describe('AttentionBand — what is a tile', () => {
  it('is one named region, the page\'s only landmark from the band', () => {
    renderBand(FOUR)

    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(band()).toHaveClass('@container')
  })

  it('makes a tile of each item above zero, in the order given, and of nothing else', () => {
    renderBand(FOUR)

    const names = within(band()).getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(names).toEqual(['Alpha 3', 'Gamma 2'])
    expect(screen.queryByRole('group', { name: 'Beta 0' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Delta 0' })).not.toBeInTheDocument()
  })

  it('gives each tile its figure, its label, its line and a link to where it is fixed', () => {
    renderBand(FOUR)

    const alpha = screen.getByRole('group', { name: 'Alpha 3' })
    expect(within(alpha).getByText('3')).toHaveClass('text-display')
    expect(within(alpha).getByText('Alpha')).toBeInTheDocument()
    expect(within(alpha).getByText('Alpha line.')).toBeInTheDocument()
    expect(within(alpha).getByRole('link', { name: 'Open Alpha' })).toHaveAttribute('href', '/alpha')
    const gamma = screen.getByRole('group', { name: 'Gamma 2' })
    expect(within(gamma).getByRole('link', { name: 'Open Gamma' })).toHaveAttribute('href', '/gamma')
  })

  it('tints a tile by its item\'s tone: danger takes the error container, warning the warning container', () => {
    renderBand(FOUR)

    expect(screen.getByRole('group', { name: 'Alpha 3' })).toHaveAttribute('data-attention', 'error')
    expect(screen.getByRole('group', { name: 'Gamma 2' })).toHaveAttribute('data-attention', 'warning')
  })

  it('never makes a tile of a zero, however it is toned', () => {
    renderBand([item('Alpha', 0), item('Beta', 0, { tone: 'warning' })])

    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('renders nothing for no items: an empty band claims nothing', () => {
    const { container } = renderBand([])

    expect(container).toBeEmptyDOMElement()
  })
})

describe('AttentionBand — the All clear row', () => {
  it('collapses the zero items into ONE row after the tiles, naming them, on Pale Sprout', () => {
    renderBand(FOUR)

    const row = clearRow()!
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('All clear on Beta and Delta')
    // Pale Sprout with its near-black ink: the system's documented all-clear pair (the success tone's solid).
    for (const cls of TONE.success.solid.split(' ')) expect(row).toHaveClass(cls)
    expect(row).toHaveClass('bg-[var(--color-primary-fixed)]', 'text-[var(--color-on-primary-fixed)]')
    // After the last tile, not before it.
    const lastTile = screen.getByRole('group', { name: 'Gamma 2' })
    expect(lastTile.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Just one of them.
    expect(screen.getAllByText('All clear')).toHaveLength(1)
  })

  it('names three or more with commas and "and", never a serial comma', () => {
    renderBand([item('Alpha', 1), item('Beta', 0), item('Gamma', 0), item('Delta', 0)])

    expect(clearRow()).toHaveTextContent('All clear on Beta, Gamma and Delta')
  })

  it('names a lone clear item without a list', () => {
    renderBand([item('Alpha', 2), item('Beta', 0)])

    expect(clearRow()).toHaveTextContent('All clear on Beta')
  })

  it('draws no row when nothing is clear', () => {
    renderBand([item('Alpha', 1), item('Beta', 2, { tone: 'warning' })])

    expect(screen.queryByText('All clear')).not.toBeInTheDocument()
    expect(band().innerHTML).not.toMatch(/primary-fixed/)
  })

  it('hides its icon from assistive tech, so the row is read as its words', () => {
    renderBand(FOUR)

    expect(clearRow()!.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('AttentionBand — when everything is zero', () => {
  const ALL_ZERO = [item('Alpha', 0), item('Beta', 0, { tone: 'warning' }), item('Gamma', 0)]

  it('becomes one full-width Pale Sprout field: "All clear. Nothing needs you right now."', () => {
    renderBand(ALL_ZERO)

    const field = screen.getByText('All clear. Nothing needs you right now.').closest('div.rounded-md') as HTMLElement
    expect(field).not.toBeNull()
    for (const cls of TONE.success.solid.split(' ')) expect(field).toHaveClass(cls)
    expect(band().firstElementChild).toBe(field)
    // The field is the whole band: no tile, no link, no second row.
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByText('All clear', { selector: 'span.font-semibold' })).not.toBeInTheDocument()
  })

  it('names what was checked, so the claim can be audited', () => {
    renderBand(ALL_ZERO)

    expect(screen.getByText('Checked and at zero: Alpha, Beta and Gamma.')).toBeInTheDocument()
  })

  it('hides its icon from assistive tech', () => {
    renderBand(ALL_ZERO)

    expect(band().querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('AttentionBand — no all-clear without data', () => {
  it('shows an en dash tile, never a 0, for an item still loading: busy, untinted, no line, no action', () => {
    renderBand([item('Alpha', 0, { loading: true, to: '/alpha-page' }), item('Beta', 2)])

    const link = screen.getByRole('link', { name: 'Alpha Loading' })
    expect(link).toHaveAttribute('href', '/alpha-page')
    expect(link).toHaveAttribute('aria-busy', 'true')
    expect(link).not.toHaveAttribute('data-attention')
    expect(within(link).getByText('–')).toHaveClass('text-display')
    expect(within(link).queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha line.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open Alpha' })).not.toBeInTheDocument()
  })

  it('shows "Couldn\'t load" to a screen reader for an item that failed, not busy and untinted', () => {
    renderBand([item('Alpha', 0, { error: true, to: '/alpha-page' }), item('Beta', 2)])

    const link = screen.getByRole('link', { name: "Alpha Couldn't load" })
    expect(link).not.toHaveAttribute('aria-busy')
    expect(link).not.toHaveAttribute('data-attention')
    expect(screen.queryByRole('link', { name: 'Open Alpha' })).not.toBeInTheDocument()
  })

  it('does not name an item with no data among the clear ones, and does not turn the band into the all-clear field', () => {
    renderBand([item('Alpha', 0, { loading: true }), item('Beta', 0), item('Gamma', 0)])

    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(clearRow()).toHaveTextContent('All clear on Beta and Gamma')
    expect(clearRow()).not.toHaveTextContent('Alpha')
  })

  it('claims no all-clear at all while every item is waiting for its data', () => {
    renderBand([item('Alpha', 0, { loading: true }), item('Beta', 0, { error: true })])

    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
    expect(screen.getByText('Loading')).toHaveClass('sr-only')
    expect(screen.getByText("Couldn't load")).toHaveClass('sr-only')
  })

  it('treats a failed item with a stale count as no data, so a cached number is never tinted', () => {
    renderBand([item('Alpha', 4, { error: true })])

    expect(screen.queryByRole('group', { name: /Alpha 4/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: "Alpha Couldn't load" })).not.toHaveAttribute('data-attention')
  })

  it('settles from the placeholder: a zero joins the All clear row, a count becomes a tile', () => {
    const { rerender } = renderBand([item('Alpha', 0, { loading: true, to: '/alpha-page' }), item('Beta', 0)])
    expect(screen.getByRole('link', { name: 'Alpha Loading' }).getAttribute('aria-busy')).toBe('true')

    rerender(
      <MemoryRouter>
        <AttentionBand items={[item('Alpha', 0), item('Beta', 0)]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.queryByText('–')).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <AttentionBand items={[item('Alpha', 5), item('Beta', 0)]} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('group', { name: 'Alpha 5' })).toHaveAttribute('data-attention', 'error')
    expect(clearRow()).toHaveTextContent('All clear on Beta')
  })
})

describe('AttentionBand — layout', () => {
  const grid = () => band().querySelector('div.grid') as HTMLElement
  const wrappers = () => [...(grid().children as HTMLCollectionOf<HTMLElement>)]

  it('lays the tiles in a 60-track grid, each in a wrapper that reads its own spans', () => {
    renderBand([item('A', 1), item('B', 1), item('C', 1), item('D', 1), item('E', 1)])

    expect(grid().className).toBe(BAND_GRID_CLASS)
    expect(wrappers()).toHaveLength(5)
    const spans = bandSpans(5)
    wrappers().forEach((wrapper, i) => {
      expect(wrapper.className).toBe(BAND_SPAN_CLASS)
      spans[i].forEach((span, step) => expect(wrapper.style.getPropertyValue(`--span-${step}`)).toBe(String(span)))
      // The tile fills its wrapper, so every tile of a row is as tall as the tallest.
      expect(wrapper.firstElementChild).toHaveClass('h-full')
    })
  })

  it('counts the placeholders as tiles, so a loading item keeps its place in the rows', () => {
    renderBand([item('A', 0, { loading: true }), item('B', 1), item('C', 0)])

    expect(wrappers()).toHaveLength(2)
  })

  it('puts the All clear row under the grid with the same 8px between them as between tiles', () => {
    renderBand(FOUR)

    const stack = grid().parentElement as HTMLElement
    expect(stack).toHaveClass('flex', 'flex-col', 'gap-2')
    expect(stack.lastElementChild).toBe(clearRow())
  })

  it('never truncates, scrolls sideways or shrinks the type', () => {
    renderBand(FOUR)

    expect(band().innerHTML).not.toMatch(/overflow|truncate|line-clamp/)
  })
})
