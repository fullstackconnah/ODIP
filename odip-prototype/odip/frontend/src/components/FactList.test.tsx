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
