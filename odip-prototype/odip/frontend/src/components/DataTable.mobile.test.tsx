import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTable, RowActions, type Column } from './DataTable'
import { Button } from './Button'

// The phone card (below 768px, `.mobile-card-table` in index.css) is CSS-only, so these assert the classes and attributes it keys off.
type Row = { id: string; title: string; trip: string | null; owner: string; status: string; notes: string }
const rows: Row[] = [{ id: '1', title: 'Book the bus', trip: null, owner: 'Priya', status: 'Open', notes: 'Long notes' }]

const cellOf = (text: string) => screen.getByText(text).closest('td') as HTMLElement

describe('DataTable phone card: column mobile modes', () => {
  it('leaves a table that does not opt in exactly as before: every cell labelled, no card roles, no extra cell', () => {
    const columns: Column<Row>[] = [{ key: 'title', header: 'Task' }, { key: 'owner', header: 'Owner' }]
    const { container } = render(<DataTable data={rows} columns={columns} keyField="id" />)

    expect(container.querySelectorAll('[data-card]')).toHaveLength(0)
    const cells = container.querySelectorAll('tbody td')
    expect(cells).toHaveLength(2)
    expect([...cells].map(c => c.getAttribute('data-label'))).toEqual(['Task', 'Owner'])
  })

  const columns: Column<Row>[] = [
    { key: 'title', header: 'Task', mobile: 'primary' },
    { key: 'trip', header: 'Trip', mobile: 'meta' },
    { key: 'owner', header: 'Owner', mobile: 'meta' },
    { key: 'notes', header: 'Notes', mobile: 'hidden' },
    { key: 'status', header: 'Status', mobile: 'status' },
  ]

  it('primary is the title line: ahead of everything on the card, takes the row, no caps label', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = cellOf('Book the bus')
    expect(cell).toHaveAttribute('data-card', 'primary')
    expect(cell).toHaveClass('max-md:-order-2', 'max-md:flex-1', 'max-md:min-w-0')
  })

  it('status is a pill on the title row: ordered with the title and pushed to its end, no caps label', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = cellOf('Open')
    expect(cell).toHaveAttribute('data-card', 'status')
    expect(cell).toHaveClass('max-md:-order-2', 'max-md:ml-auto')
  })

  it('hidden is left off the card and kept in the table', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = cellOf('Long notes')
    expect(cell).toHaveClass('max-md:hidden')
    expect(cell).not.toHaveAttribute('data-card')
    expect(cell.className.split(' ')).not.toContain('md:hidden')
  })

  it('meta cells follow the title as one muted line, rendered once (the table cell itself), without caps labels', () => {
    const { container } = render(<DataTable data={rows} columns={columns} keyField="id" />)

    expect(screen.getAllByText('Priya')).toHaveLength(1)
    const cell = cellOf('Priya')
    expect(cell).toHaveAttribute('data-card', 'meta')
    expect(cell).toHaveAttribute('data-label', 'Owner')
    expect(cell).toHaveClass('max-md:-order-1', 'max-md:text-[13px]', 'max-md:text-[var(--color-muted-foreground)]')
    expect(container.querySelectorAll('tbody td')).toHaveLength(columns.length)
  })

  it('leaves an empty meta value off the card, so the line never shows a dash', () => {
    const { container } = render(<DataTable data={rows} columns={columns} keyField="id" />)

    const trip = container.querySelector('td[data-label="Trip"]') as HTMLElement
    expect(trip).toHaveTextContent('—')
    expect(trip).not.toHaveAttribute('data-card')
    expect(trip).toHaveClass('max-md:hidden')
  })
})

describe('DataTable pager', () => {
  const columns: Column<Row>[] = [{ key: 'title', header: 'Task' }]

  it('is hidden when everything fits on one page', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" pagination={{ page: 1, pageSize: 50, totalCount: 1, onPageChange: vi.fn() }} />)

    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of 1/)).not.toBeInTheDocument()
  })

  it('stays on a later page even if the list has shrunk to one page, so the way back is never lost', () => {
    render(<DataTable data={[]} columns={columns} keyField="id" pagination={{ page: 2, pageSize: 50, totalCount: 3, onPageChange: vi.fn() }} />)

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  })
})

describe('RowActions on the phone card', () => {
  it('is always shown and makes every control at least 44px square below md, whatever the pointer', () => {
    render(
      <RowActions>
        <Button variant="ghost" size="sm" iconOnly aria-label="Edit">e</Button>
      </RowActions>,
    )

    const cluster = screen.getByRole('button', { name: 'Edit' }).parentElement as HTMLElement
    expect(cluster).toHaveClass('max-md:opacity-100', 'max-md:[&_:is(a,button)]:min-h-11', 'max-md:[&_:is(a,button)]:min-w-11')
  })
})

// VC check A: a later page of a list that has emptied printed "Showing 21-0 of 0"; with nothing to show there is no pager, as before.
describe('DataTable pager with an empty list', () => {
  it('shows no pager when there is nothing at all, even on a later page', () => {
    render(<DataTable data={[]} columns={[{ key: 'title', header: 'Task' }]} keyField="id" pagination={{ page: 2, pageSize: 20, totalCount: 0, onPageChange: vi.fn() }} />)

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
  })
})
