import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FactList } from './FactList'

describe('FactList', () => {
  it('renders each item as a label/value pair inside a definition list', () => {
    render(
      <FactList
        items={[
          { label: 'NDIS number', value: '4312567' },
          { label: 'Region', value: 'North Coast' },
        ]}
      />,
    )
    expect(screen.getByText('NDIS number')).toBeInTheDocument()
    expect(screen.getByText('4312567')).toBeInTheDocument()
    expect(screen.getByText('Region')).toBeInTheDocument()
    expect(screen.getByText('North Coast')).toBeInTheDocument()
  })

  it('renders an em dash for an individual empty value while other rows still render', () => {
    render(
      <FactList
        items={[
          { label: 'NDIS number', value: '4312567' },
          { label: 'Notes', value: '' },
        ]}
      />,
    )
    expect(screen.getByText('4312567')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('treats a whitespace-only value as empty', () => {
    render(<FactList items={[{ label: 'Notes', value: '   ' }, { label: 'Region', value: 'North Coast' }]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders a single muted line instead of rows when every value is empty', () => {
    render(<FactList items={[{ label: 'A', value: '' }, { label: 'B', value: undefined }]} />)
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('honours a custom emptyMessage', () => {
    render(<FactList items={[{ label: 'A', value: '' }]} emptyMessage="No accommodation details yet" />)
    expect(screen.getByText('No accommodation details yet')).toBeInTheDocument()
  })

  it('renders the empty state for an empty items array', () => {
    render(<FactList items={[]} />)
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
  })

  it('renders an optional Edit action in the empty state and fires onEdit when clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<FactList items={[{ label: 'A', value: '' }]} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('does not render an Edit action when onEdit is not passed', () => {
    render(<FactList items={[{ label: 'A', value: '' }]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not render the Edit action when at least one value is present', () => {
    const onEdit = vi.fn()
    render(<FactList items={[{ label: 'A', value: 'Something' }]} onEdit={onEdit} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})

describe('FactList hideEmpty', () => {
  const five = (empty: number) => Array.from({ length: 5 }, (_, i) => ({ label: String.fromCharCode(65 + i), value: i < empty ? '' : `v${i}` }))

  it('drops empty rows and lists their names in one Not recorded line', () => {
    const { container } = render(<FactList hideEmpty items={five(3)} />)
    expect(container.querySelectorAll('dd')).toHaveLength(2)
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.getByText('Not recorded: A, B, C')).toBeInTheDocument()
  })

  it('names six and counts the rest', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, value: i === 9 ? 'x' : '' }))
    render(<FactList hideEmpty items={items} />)
    expect(screen.getByText('Not recorded: L0, L1, L2, L3, L4, L5 and 3 more')).toBeInTheDocument()
  })

  it('shows Add only when onAdd is given, and calls it', async () => {
    const onAdd = vi.fn()
    const { rerender } = render(<FactList hideEmpty items={five(2)} />)
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    rerender(<FactList hideEmpty onAdd={onAdd} items={five(2)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('reads Not recorded alone, with no Add or Edit, when every row is empty: the card header Edit is the one action', () => {
    render(<FactList hideEmpty onAdd={() => {}} onEdit={() => {}} items={five(5)} />)
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows no foot line when every row is answered', () => {
    render(<FactList hideEmpty items={five(0)} />)
    expect(screen.queryByText(/Not recorded/)).not.toBeInTheDocument()
  })

  it('keeps None and No as answers', () => {
    render(<FactList hideEmpty items={[{ label: 'A', value: 'None' }, { label: 'B', value: 'No' }]} />)
    expect(screen.queryByText(/Not recorded/)).not.toBeInTheDocument()
  })

  it('without hideEmpty still renders the em dash rows', () => {
    render(<FactList items={five(3)} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
