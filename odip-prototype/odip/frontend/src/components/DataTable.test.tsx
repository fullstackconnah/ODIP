import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable } from './DataTable'
import type { Column } from './DataTable'

type Row = { id: string; name: string; age: number }

const rows: Row[] = [
  { id: '1', name: 'Bianca', age: 30 },
  { id: '2', name: 'Alex', age: 25 },
]

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'age', header: 'Age', type: 'text', sortable: true },
]

describe('DataTable — basic rendering', () => {
  it('renders one row per data item with cell text', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    expect(screen.getByText('Bianca')).toBeInTheDocument()
    expect(screen.getByText('Alex')).toBeInTheDocument()
  })

  it('shows the empty message when data is empty and not loading', () => {
    render(<DataTable data={[]} columns={columns} keyField="id" emptyMessage="Nothing here yet" />)

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('shows a loading row instead of the empty message while loading with no data yet', () => {
    render(<DataTable data={[]} columns={columns} keyField="id" loading />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})

describe('DataTable — sortable columns', () => {
  it('marks a sortable header with aria-sort and toggles it on click: none -> asc -> desc -> none', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

    const nameHeader = screen.getByRole('button', { name: /name/i })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')

    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')

    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')

    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')
  })

  it('reorders rows when a sortable column header is clicked', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

    await user.click(screen.getByRole('button', { name: /name/i }))

    const cells = screen.getAllByRole('cell')
    // Ascending by name: Alex before Bianca.
    expect(cells[0]).toHaveTextContent('Alex')
  })

  it('does not make a non-sortable column header interactive even when the table is sortable', () => {
    const mixedColumns: Column<Row>[] = [
      { key: 'name', header: 'Name', sortable: true },
      { key: 'age', header: 'Age' },
    ]
    render(<DataTable data={rows} columns={mixedColumns} keyField="id" sortable />)

    expect(screen.queryByRole('button', { name: /age/i })).not.toBeInTheDocument()
  })
})

describe('DataTable — editable cell affordance', () => {
  it('renders a column\'s editable.render output only for the row matching editingRow', () => {
    const editableColumns: Column<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        editable: { render: (row, onChange) => <input aria-label={`edit-${row.id}`} onChange={e => onChange(e.target.value)} /> },
      },
    ]
    render(<DataTable data={rows} columns={editableColumns} keyField="id" editingRow="2" onEditChange={vi.fn()} />)

    expect(screen.queryByLabelText('edit-1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('edit-2')).toBeInTheDocument()
  })
})

describe('DataTable — verticalDividers (DS-02)', () => {
  it('applies no vertical-divider classes by default', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const headerRow = screen.getAllByRole('row')[0]
    expect(headerRow.className).not.toMatch(/divide-x/)
  })

  it('applies divide-x to the header and body rows when verticalDividers is set', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" verticalDividers />)

    const allRows = screen.getAllByRole('row')
    expect(allRows.length).toBeGreaterThan(1)
    for (const row of allRows) {
      expect(row.className).toMatch(/divide-x/)
    }
  })
})
