import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { PageHeader } from './PageHeader'

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
