import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { PageHeader, PageHeaderMeta } from './PageHeader'

describe('PageHeader — per-route document title (I-4)', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  it('sets document.title from its title prop, so tab switching and the back button work per-route', () => {
    render(<PageHeader title="Incident Reports" />)
    expect(document.title).toBe('Incident Reports — Odip')
  })

  it('updates document.title when a different page renders with a different title', () => {
    const { rerender } = render(<PageHeader title="Trips" />)
    expect(document.title).toBe('Trips — Odip')

    rerender(<PageHeader title="Participants" />)
    expect(document.title).toBe('Participants — Odip')
  })
})

// Density verdict (mobile) — jsdom applies no CSS, so these assert the responsive class contract
// itself: below md the title row stacks and the actions get their own wrapping row; from md up it is
// the original single row (the wrapper dissolves with `md:contents`, so the caller's action node is
// a direct flex item of the row exactly as before the wrapper existed).
describe('PageHeader — narrow-screen layout', () => {
  afterEach(cleanup)

  function rowOf(title: string) {
    // h1 -> title block -> title row
    return screen.getByRole('heading', { level: 1, name: title }).parentElement!.parentElement!
  }

  it('lets the title shrink and wrap below md instead of being squeezed to an ellipsis stub', () => {
    render(<PageHeader title="Callum Radford" action={<button type="button">Edit</button>} />)

    const h1 = screen.getByRole('heading', { level: 1, name: 'Callum Radford' })
    expect(h1).toHaveClass('max-md:min-w-0', 'max-md:break-words')
    expect(h1).not.toHaveClass('truncate')
    // The block holding the title may itself shrink too.
    expect(h1.parentElement).toHaveClass('min-w-0')
  })

  it('keeps the title at its min-content width from md up, so a tight row never breaks it mid-word', () => {
    render(<PageHeader title="Billing" action={<button type="button">New claim batch</button>} />)

    // Unprefixed min-w-0 / break-words would apply at every width and let a wide action cluster squeeze
    // "Billing" onto two lines at 768px, where the row used to truncate the subtitle instead.
    const h1 = screen.getByRole('heading', { level: 1, name: 'Billing' })
    expect(h1).not.toHaveClass('min-w-0')
    expect(h1).not.toHaveClass('break-words')
  })

  it('stacks the title row below md and restores the single justified row from md up', () => {
    render(<PageHeader title="Staff" action={<button type="button">Edit</button>} />)

    expect(rowOf('Staff')).toHaveClass('flex', 'flex-col', 'md:flex-row', 'md:items-center', 'md:justify-between')
  })

  it('gives the actions their own wrapping row below md that dissolves from md up', () => {
    render(<PageHeader title="Staff" action={<button type="button">Edit</button>} />)

    const wrapper = screen.getByRole('button', { name: 'Edit' }).parentElement!
    expect(wrapper.parentElement).toBe(rowOf('Staff'))
    expect(wrapper).toHaveClass('flex', 'flex-wrap', 'min-w-0', 'md:contents')
  })

  it('clamps and wraps a caller-supplied action cluster below md, so it can never force horizontal overflow', () => {
    render(
      <PageHeader
        title="Staff"
        action={
          <div className="flex shrink-0 items-center gap-2" data-testid="cluster">
            <button type="button">Back</button>
            <button type="button">Leave</button>
          </div>
        }
      />,
    )

    // Descendant rules on the wrapper: a `shrink-0` cluster is capped at the row width and a block-level
    // cluster is made to wrap, whatever classes the page gave it.
    const wrapper = screen.getByTestId('cluster').parentElement!
    expect(wrapper).toHaveClass('max-md:[&>*]:max-w-full', 'max-md:[&>div]:flex-wrap')
  })

  it.each([undefined, null, false, ''])('renders no actions wrapper for a falsy action (%s)', (action) => {
    render(<PageHeader title="Staff" action={action} />)

    expect(rowOf('Staff').children).toHaveLength(1)
  })

  it('lets an inline subtitle drop under the title on a phone and only truncate from md up', () => {
    render(<PageHeader title="Trips" subtitle="Plan and manage every group trip" />)

    const subtitle = screen.getByText('Plan and manage every group trip')
    expect(subtitle).toHaveClass('md:truncate')
    expect(subtitle).not.toHaveClass('truncate')
    expect(subtitle.parentElement).toHaveClass('flex-wrap', 'md:flex-nowrap')
  })

  it('keeps a ReactNode subtitle and the filter row as their own blocks after the title row', () => {
    render(
      <PageHeader title="Participants" subtitle={<span data-testid="meta">Active · Brisbane</span>}>
        <span data-testid="filters">Filters</span>
      </PageHeader>,
    )

    const row = rowOf('Participants')
    const meta = screen.getByTestId('meta').parentElement!
    const filters = screen.getByTestId('filters').parentElement!
    // Siblings of the title row (a Fragment adds no wrapper), in order: row, meta, filters.
    expect(meta.parentElement).toBe(row.parentElement)
    expect(filters.parentElement).toBe(row.parentElement)
    expect(row.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(meta.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// Touch: a 24px pill in the filter row (the Trips "All Statuses" Dropdown) carries a 44px hit area, 10px past its box.
// When the row wraps and the pill lands on a line of its own, an 8px row gap would put that pad 2px over the control
// on the line above (the toggle group), so the row gap opens to 12px under `pointer: coarse` only.
describe('PageHeader — filter row on a touch screen', () => {
  afterEach(cleanup)

  it('opens the wrapped-row gap to 12px under coarse (a padded pill must stay off the row above) and leaves the mouse layout alone', () => {
    render(
      <PageHeader title="Trips">
        <span data-testid="filters">Filters</span>
      </PageHeader>,
    )

    const row = screen.getByTestId('filters').parentElement!
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-2', 'mt-2', 'pointer-coarse:gap-y-3')
    // Row gap only: the column gap between neighbours on a line stays 8px, where the pill's pad is never horizontal.
    expect(row.className).not.toMatch(/pointer-coarse:gap-(?:[0-9]|x)/)
  })
})

// The detail variant is opt-in (DESIGN.md "Detail header pattern"). A page that does not pass `variant` renders exactly
// what it always did; these pin the default's markup so a future edit to the detail branch cannot leak into it.
describe('PageHeader — the default variant is untouched by the detail variant', () => {
  afterEach(cleanup)

  const renderDefault = (variant?: 'default') =>
    render(
      <PageHeader
        title="Participants"
        subtitle={<span data-testid="meta">Active · Brisbane</span>}
        action={<button type="button">New</button>}
        variant={variant}
      >
        <span data-testid="filters">Filters</span>
      </PageHeader>,
    )

  it('renders byte-identical markup whether `variant` is omitted or "default"', () => {
    const omitted = renderDefault()
    const html = omitted.container.innerHTML
    omitted.unmount()
    expect(renderDefault('default').container.innerHTML).toBe(html)
  })

  it('keeps the 20px bold title and no display class', () => {
    renderDefault()
    const h1 = screen.getByRole('heading', { level: 1, name: 'Participants' })
    expect(h1).toHaveClass('text-xl', 'font-bold')
    expect(h1.className).not.toMatch(/text-display|text-balance/)
  })

  it('still returns a Fragment: the title row, the meta block and the filter row are siblings, with no group wrapper', () => {
    const { container } = renderDefault()
    expect(container.children).toHaveLength(3)
    expect(container.firstElementChild).toBe(screen.getByRole('heading', { level: 1 }).parentElement!.parentElement)
    // The meta block keeps its own mt-1 line under the row.
    expect(screen.getByTestId('meta').parentElement).toHaveClass('mt-1', 'text-[13px]')
  })

  it('still puts a string subtitle inline after the title, truncating from md', () => {
    render(<PageHeader title="Trips" subtitle="Plan every trip" />)
    expect(screen.getByText('Plan every trip')).toHaveClass('md:truncate')
    expect(screen.getByText('Plan every trip').parentElement).toBe(screen.getByRole('heading', { level: 1 }).parentElement)
  })
})

describe('PageHeader — variant="detail"', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  function renderDetail() {
    return render(
      <PageHeader
        variant="detail"
        title="Sunshine Coast Beach Escape"
        subtitle={<span data-testid="meta">Confirmed</span>}
        action={<button type="button">Edit Trip</button>}
      />,
    )
  }

  it('sets the title at the display step and it is still the one h1', () => {
    renderDetail()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveClass('text-display', 'text-balance')
    // Not the 20px headline any more.
    expect(headings[0].className).not.toMatch(/text-xl|font-bold/)
  })

  it('keeps the narrow-screen title rules of the default: shrink and break a long word below md only', () => {
    renderDetail()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveClass('max-md:min-w-0', 'max-md:break-words')
    expect(h1).not.toHaveClass('min-w-0')
    expect(h1).not.toHaveClass('break-words')
  })

  it('groups the title row and the meta row in ONE block, so the section gap opens below both', () => {
    const { container } = renderDetail()
    const group = container.firstElementChild as HTMLElement
    expect(container.children).toHaveLength(1)
    expect(group).toHaveClass('flex', 'flex-col', 'gap-2')
    const titleRow = screen.getByRole('heading', { level: 1 }).parentElement!.parentElement!
    expect(titleRow.parentElement).toBe(group)
    expect(screen.getByTestId('meta').parentElement!.parentElement).toBe(group)
    // Title row first, meta second.
    expect(titleRow.compareDocumentPosition(screen.getByTestId('meta')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the meta row in the quiet 13px muted style, without the default variant extra top margin', () => {
    renderDetail()
    const meta = screen.getByTestId('meta').parentElement!
    expect(meta).toHaveClass('text-[13px]', 'text-[var(--color-muted-foreground)]')
    expect(meta).not.toHaveClass('mt-1')
  })

  it('puts even a string subtitle beneath the title rather than inline beside it', () => {
    render(<PageHeader variant="detail" title="Liam Okafor" subtitle="Participant" />)
    const subtitle = screen.getByText('Participant')
    expect(subtitle).not.toHaveClass('md:truncate')
    expect(subtitle.parentElement).not.toBe(screen.getByRole('heading', { level: 1 }).parentElement)
  })

  it('still wraps the actions under the title below md and dissolves the wrapper from md up', () => {
    renderDetail()
    const wrapper = screen.getByRole('button', { name: 'Edit Trip' }).parentElement!
    expect(wrapper).toHaveClass('flex', 'flex-wrap', 'min-w-0', 'md:contents')
    const titleRow = screen.getByRole('heading', { level: 1 }).parentElement!.parentElement!
    expect(wrapper.parentElement).toBe(titleRow)
    expect(titleRow).toHaveClass('flex', 'flex-col', 'md:flex-row', 'md:items-center', 'md:justify-between')
  })

  it('renders no subtitle block when there is no subtitle', () => {
    const { container } = render(<PageHeader variant="detail" title="Billing" />)
    expect((container.firstElementChild as HTMLElement).children).toHaveLength(1)
  })

  it('still sets document.title from its title prop', () => {
    renderDetail()
    expect(document.title).toBe('Sunshine Coast Beach Escape — Odip')
  })

  it('still renders the filter row after the meta row', () => {
    render(
      <PageHeader variant="detail" title="Trip" subtitle={<span data-testid="meta">Confirmed</span>}>
        <span data-testid="filters">Filters</span>
      </PageHeader>,
    )
    const meta = screen.getByTestId('meta')
    const filters = screen.getByTestId('filters')
    expect(meta.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// The dashboard's title is a greeting with the date after it, and the tab keeps naming the page: both are opt-in, so a header that asks for neither is what it was.
describe('PageHeader — titleNote and documentTitle', () => {
  afterEach(() => {
    cleanup()
    document.title = ''
  })

  it('puts the note inside the same one h1, after the title, as its own unit in the muted ink', () => {
    render(<PageHeader variant="detail" title="Good morning, Sarah" titleNote={<time dateTime="2026-10-02">Friday 2 October</time>} />)

    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Good morning, Sarah Friday 2 October')
    expect(h1s[0]).toHaveClass('text-display')

    const title = screen.getByText('Good morning, Sarah')
    const note = screen.getByText('Friday 2 October').parentElement as HTMLElement
    expect(title.parentElement).toBe(h1s[0])
    expect(note.parentElement).toBe(h1s[0])
    expect(title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Same size as the title (it inherits the display step: no size class of its own), only quieter, and each part wraps whole.
    expect(note).toHaveClass('inline-block', 'text-[var(--color-muted-foreground)]')
    expect(note.className).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|[2-9]xl|display)\b/)
    expect(title).toHaveClass('inline-block')
    expect(screen.getByText('Friday 2 October').tagName).toBe('TIME')
  })

  it('keeps the title exactly as it was, with no wrapper spans, when there is no note', () => {
    render(<PageHeader variant="detail" title="Sunshine Coast Beach Escape" />)

    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.children).toHaveLength(0)
    expect(h1.textContent).toBe('Sunshine Coast Beach Escape')
  })

  it('names the tab by documentTitle when the h1 says something else, and keeps it steady while the h1 changes', () => {
    const { rerender } = render(<PageHeader variant="detail" title="Good morning, Sarah" documentTitle="Management Dashboard" />)
    expect(document.title).toBe('Management Dashboard — Odip')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good morning, Sarah')

    rerender(<PageHeader variant="detail" title="Good afternoon, Sarah" documentTitle="Management Dashboard" />)
    expect(document.title).toBe('Management Dashboard — Odip')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon, Sarah')
  })

  it('falls back to the title for the tab when documentTitle is not given', () => {
    render(<PageHeader title="Incident Reports" />)
    expect(document.title).toBe('Incident Reports — Odip')
  })
})

describe('PageHeaderMeta', () => {
  afterEach(cleanup)

  const dots = (container: HTMLElement) => Array.from(container.querySelectorAll('[aria-hidden="true"]'))

  it('joins the items with middots, none after the last', () => {
    const { container } = render(
      <PageHeaderMeta>
        <span>Confirmed</span>
        <span>Caloundra QLD</span>
        <span>SCB-2608</span>
      </PageHeaderMeta>,
    )
    expect(dots(container)).toHaveLength(2)
    expect(container.textContent).toBe('Confirmed·Caloundra QLD·SCB-2608')
  })

  it('hides the separators from assistive tech', () => {
    const { container } = render(
      <PageHeaderMeta>
        <span>A</span>
        <span>B</span>
      </PageHeaderMeta>,
    )
    const [dot] = dots(container)
    expect(dot).toHaveTextContent('·')
    expect(dot).toHaveAttribute('aria-hidden', 'true')
  })

  it('skips null, undefined, false and empty-string children BEFORE placing separators: a missing fact never leaves a dangling dot', () => {
    // The realistic shapes: `{value && <span>}` yields undefined or '' when the fact is missing.
    const noDestination: string | undefined = undefined
    const noCode = ''
    const { container } = render(
      <PageHeaderMeta>
        {null}
        <span>Confirmed</span>
        {undefined}
        {false}
        {''}
        {noDestination && <span>{noDestination}</span>}
        {noCode && <span>{noCode}</span>}
        <span>14–17 Aug 2026</span>
      </PageHeaderMeta>,
    )
    expect(dots(container)).toHaveLength(1)
    expect(container.textContent).toBe('Confirmed·14–17 Aug 2026')
  })

  it('accepts plain strings as items', () => {
    const { container } = render(<PageHeaderMeta>{'Caloundra QLD'}{'4 days'}</PageHeaderMeta>)
    expect(container.textContent).toBe('Caloundra QLD·4 days')
  })

  it('renders a single item with no separator, and an all-empty row as an empty wrapper', () => {
    const single = render(<PageHeaderMeta><span>Only</span></PageHeaderMeta>)
    expect(dots(single.container)).toHaveLength(0)
    single.unmount()
    const empty = render(<PageHeaderMeta>{null}{false}</PageHeaderMeta>)
    expect((empty.container.firstElementChild as HTMLElement).children).toHaveLength(0)
  })

  it('wraps onto further lines instead of overflowing, and each separator travels with the item before it', () => {
    const { container } = render(
      <PageHeaderMeta>
        <span data-testid="first">A</span>
        <span>B</span>
      </PageHeaderMeta>,
    )
    const row = container.firstElementChild as HTMLElement
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-center')
    // The dot is inside the first item's own wrapper, so a wrapped line can end with a dot but never start with one.
    const firstItem = screen.getByTestId('first').parentElement!
    expect(firstItem.querySelector('[aria-hidden="true"]')).toBeTruthy()
    expect(firstItem).toHaveClass('min-w-0')
  })
})
