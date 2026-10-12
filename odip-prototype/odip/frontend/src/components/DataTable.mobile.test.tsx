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

  it('primary is the title line: first in the card, takes the row, no caps label', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = cellOf('Book the bus')
    expect(cell).toHaveAttribute('data-card', 'primary')
    expect(cell).toHaveClass('max-md:order-first', 'max-md:flex-1', 'max-md:min-w-0')
  })

  it('status is a pill on the title row: ordered with the title and pushed to its end, no caps label', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = cellOf('Open')
    expect(cell).toHaveAttribute('data-card', 'status')
    expect(cell).toHaveClass('max-md:order-first', 'max-md:ml-auto')
  })

  it('hidden is left off the card and kept in the table', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = cellOf('Long notes')
    expect(cell).toHaveClass('max-md:hidden')
    expect(cell).not.toHaveClass('md:hidden')
  })

  it('meta folds into one muted line under the title: its own cells leave the card, empty values are skipped, the headers stay for screen readers', () => {
    const { container } = render(<DataTable data={rows} columns={columns} keyField="id" />)

    // The table cells stay for md and up, off the card.
    const ownerCells = [...container.querySelectorAll('td[data-label="Owner"]')]
    expect(ownerCells).toHaveLength(1)
    expect(ownerCells[0]).toHaveClass('max-md:hidden')

    const meta = container.querySelector('td[data-card="meta"]') as HTMLElement
    expect(meta).toHaveClass('md:hidden', 'max-md:order-first', 'max-md:basis-full', 'text-[var(--color-muted-foreground)]')
    // The empty trip ("—") is left out, so the line never starts with a dash or a dangling separator.
    expect(meta).toHaveTextContent(/^Owner: Priya$/)
    expect(meta.querySelector('.sr-only')).toHaveTextContent('Owner:')
  })

  it('joins several meta values with a separator only between them', () => {
    const { container } = render(<DataTable data={[{ ...rows[0], trip: 'Byron Bay' }]} columns={columns} keyField="id" />)

    const meta = container.querySelector('td[data-card="meta"]') as HTMLElement
    expect(meta).toHaveTextContent(/^Trip: Byron Bay ?· ?Owner: Priya$/)
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
