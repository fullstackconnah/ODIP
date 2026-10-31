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

// The actions cell is the card's last line whatever the row holds: the same placement classes for a short and a long row.
describe('DataTable phone card: the actions cell', () => {
  type ARow = { id: string; title: string }
  const aRows: ARow[] = [{ id: '1', title: 'Hi' }, { id: '2', title: 'A very long title that wraps over several lines on a phone' }]
  const columns: Column<ARow>[] = [
    { key: 'title', header: 'Task', mobile: 'primary' },
    { key: 'actions', header: '', render: row => (row.id === '1' ? <RowActions><Button size="sm">Edit {row.id}</Button></RowActions> : <Button size="sm">Edit {row.id}</Button>) },
  ]

  it('takes the whole card line, right-aligned, for a short row and a long one alike, without switching on the title layout', () => {
    render(<DataTable data={aRows} columns={columns} keyField="id" />)

    for (const name of ['Edit 1', 'Edit 2']) {
      const cell = screen.getByRole('button', { name }).closest('td') as HTMLElement
      expect(cell).toHaveClass('max-md:basis-full', 'max-md:text-right')
      expect(cell).not.toHaveAttribute('data-card')
    }
  })

  it('leaves no strip on a row with no actions: the empty cell is hidden below md', () => {
    const { container } = render(<DataTable data={aRows} columns={[columns[0], { key: 'actions', header: '', render: () => null }]} keyField="id" />)

    const cell = container.querySelector('tbody td:last-child') as HTMLElement
    expect(cell).toBeEmptyDOMElement()
    expect(cell).toHaveClass('max-md:empty:hidden')
  })

  it('leaves no strip on a row whose actions are all false: the cluster renders nothing, so the cell stays empty and hidden', () => {
    const { container } = render(<DataTable data={aRows} columns={[columns[0], { key: 'actions', header: '', render: () => <RowActions>{false}</RowActions> }]} keyField="id" />)

    const cell = container.querySelector('tbody td:last-child') as HTMLElement
    expect(cell).toBeEmptyDOMElement()
    expect(cell).toHaveClass('max-md:empty:hidden')
  })

  it('does not touch other columns', () => {
    render(<DataTable data={aRows} columns={columns} keyField="id" />)

    expect(cellOf('Hi')).not.toHaveClass('max-md:basis-full')
  })

  it('wraps on a phone without breaking a label: nowrap spans, buttons pushed right, room above the pager', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" pagination={{ page: 2, pageSize: 50, totalCount: 1234, onPageChange: vi.fn() }} />)

    const showing = screen.getByText(/^Showing/)
    const pager = showing.parentElement as HTMLElement
    expect(pager).toHaveClass('max-md:flex-wrap', 'max-md:gap-y-2', 'max-md:py-2', 'max-md:mt-3')
    expect(showing).toHaveClass('whitespace-nowrap')
    const page = screen.getByText(/^Page 2 of 25/)
    expect(page).toHaveClass('whitespace-nowrap')
    expect(page.parentElement).toHaveClass('max-md:ml-auto')
  })
})

describe('DataTable phone card: trail', () => {
  const columns: Column<Row>[] = [
    { key: 'title', header: 'Task', mobile: 'primary' },
    { key: 'owner', header: 'Owner', mobile: 'meta' },
    { key: 'status', header: 'Status', mobile: 'status' },
    { key: 'actions', header: '', mobile: 'trail', render: () => <button type="button">Go</button> },
  ]

  it('trail ends the meta line: ordered with it, content width, hidden when empty, and not the full-width actions line', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const cell = screen.getByRole('button', { name: 'Go' }).closest('td')!
    expect(cell).toHaveAttribute('data-card', 'trail')
    expect(cell).toHaveClass('max-md:-order-1', 'max-md:basis-auto', 'max-md:empty:hidden')
    expect(cell.className).not.toMatch(/basis-full/)
  })

  it('an actions column without trail keeps its own full-width line', () => {
    render(<DataTable data={rows} columns={columns.map(c => c.key === 'actions' ? { ...c, mobile: undefined } : c)} keyField="id" />)
    expect(screen.getByRole('button', { name: 'Go' }).closest('td')).toHaveClass('max-md:basis-full')
  })
})
