import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable } from './DataTable'
import type { Column } from './DataTable'
import { UiPreferencesProvider } from '@/hooks/useUiPreferences'

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

    const nameHeader = screen.getByRole('columnheader', { name: /name/i })
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

    await user.click(screen.getByRole('columnheader', { name: /name/i }))

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

describe('DataTable — editingRows (RP-01 all-rows-editable mode)', () => {
  const editableColumns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Name',
      editable: { render: (row, onChange) => <input aria-label={`edit-name-${row.id}`} defaultValue={row.name} onChange={e => onChange(e.target.value)} /> },
    },
    {
      key: 'age',
      header: 'Age',
      editable: { render: (row, onChange) => <input aria-label={`edit-age-${row.id}`} defaultValue={row.age} onChange={e => onChange(e.target.value)} /> },
    },
  ]

  it('renders every editable column\'s control for every row whose key is in editingRows, simultaneously', () => {
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1', '2'])}
        onEditChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('edit-name-1')).toBeInTheDocument()
    expect(screen.getByLabelText('edit-age-1')).toBeInTheDocument()
    expect(screen.getByLabelText('edit-name-2')).toBeInTheDocument()
    expect(screen.getByLabelText('edit-age-2')).toBeInTheDocument()
  })

  it('leaves a row out of edit mode when its key is not in editingRows', () => {
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1'])}
        onEditChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('edit-name-1')).toBeInTheDocument()
    expect(screen.queryByLabelText('edit-name-2')).not.toBeInTheDocument()
    expect(screen.getByText('Alex')).toBeInTheDocument() // row 2's plain display cell
  })

  it('fires onEditChange with the row, column key, and new value when an editable cell changes', async () => {
    const user = userEvent.setup()
    const onEditChange = vi.fn()
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1'])}
        onEditChange={onEditChange}
      />
    )

    await user.clear(screen.getByLabelText('edit-name-1'))
    await user.type(screen.getByLabelText('edit-name-1'), 'X')

    expect(onEditChange).toHaveBeenCalledWith(rows[0], 'name', 'X')
  })

  it('is keyboard-navigable: tabbing moves focus between the editable inputs in DOM order', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1', '2'])}
        onEditChange={vi.fn()}
      />
    )

    await user.tab()
    expect(screen.getByLabelText('edit-name-1')).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('edit-age-1')).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('edit-name-2')).toHaveFocus()
  })

  it('shows a per-row error message with role="alert" only under a row currently in edit mode', () => {
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1'])}
        onEditChange={vi.fn()}
        rowError={row => (row.id === '1' ? 'Description is required' : undefined)}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Description is required')
  })

  it('does not show a row error for a row with no error even in edit mode', () => {
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1', '2'])}
        onEditChange={vi.fn()}
        rowError={row => (row.id === '1' ? 'Description is required' : undefined)}
      />
    )

    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('does not show a row error for a row outside edit mode even if rowError would return one', () => {
    render(
      <DataTable
        data={rows}
        columns={editableColumns}
        keyField="id"
        editingRows={new Set(['1'])}
        onEditChange={vi.fn()}
        rowError={() => 'Always errors'}
      />
    )

    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  // editable.render's third argument (ctx.errorId) is how a caller associates its cell inputs
  // with the row's error message for assistive tech — these pin that the id DataTable hands
  // back actually resolves to the rendered role="alert" element (not a dangling reference).
  const columnsWithAriaWiring: Column<Row>[] = [
    {
      key: 'name',
      header: 'Name',
      editable: {
        render: (row, onChange, ctx) => (
          <input
            aria-label={`edit-name-${row.id}`}
            defaultValue={row.name}
            onChange={e => onChange(e.target.value)}
            aria-invalid={ctx.errorId ? 'true' : undefined}
            aria-describedby={ctx.errorId}
          />
        ),
      },
    },
  ]

  it('hands editable.render a stable errorId that resolves to the rendered error element, with aria-invalid set', () => {
    render(
      <DataTable
        data={rows}
        columns={columnsWithAriaWiring}
        keyField="id"
        editingRows={new Set(['1'])}
        onEditChange={vi.fn()}
        rowError={row => (row.id === '1' ? 'Description is required' : undefined)}
      />
    )

    const input = screen.getByLabelText('edit-name-1')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedById = input.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    expect(document.getElementById(describedById!)).toHaveTextContent('Description is required')
    expect(document.getElementById(describedById!)).toHaveAttribute('role', 'alert')
  })

  it('passes an undefined errorId (no aria-invalid/aria-describedby) for a row with no error', () => {
    render(
      <DataTable
        data={rows}
        columns={columnsWithAriaWiring}
        keyField="id"
        editingRows={new Set(['1', '2'])}
        onEditChange={vi.fn()}
        rowError={row => (row.id === '1' ? 'Description is required' : undefined)}
      />
    )

    const cleanInput = screen.getByLabelText('edit-name-2')
    expect(cleanInput).not.toHaveAttribute('aria-invalid')
    expect(cleanInput).not.toHaveAttribute('aria-describedby')
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

describe('DataTable — vertical dividers driven by the GEN-2 UI preference', () => {
  afterEach(() => {
    localStorage.clear()
  })

  function expectAllRowsToMatchDivider(matches: boolean) {
    const allRows = screen.getAllByRole('row')
    expect(allRows.length).toBeGreaterThan(1)
    for (const row of allRows) {
      if (matches) expect(row.className).toMatch(/divide-x/)
      else expect(row.className).not.toMatch(/divide-x/)
    }
  }

  it('renders divide-x when the user preference has vertical dividers on', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1' }))
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ tableVerticalDividers: true }))

    render(
      <UiPreferencesProvider>
        <DataTable data={rows} columns={columns} keyField="id" />
      </UiPreferencesProvider>
    )

    expectAllRowsToMatchDivider(true)
  })

  it('omits divide-x when the user preference has vertical dividers off', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1' }))
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ tableVerticalDividers: false }))

    render(
      <UiPreferencesProvider>
        <DataTable data={rows} columns={columns} keyField="id" />
      </UiPreferencesProvider>
    )

    expectAllRowsToMatchDivider(false)
  })

  it('an explicit verticalDividers={true} prop wins over a preference that is off', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1' }))
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ tableVerticalDividers: false }))

    render(
      <UiPreferencesProvider>
        <DataTable data={rows} columns={columns} keyField="id" verticalDividers={true} />
      </UiPreferencesProvider>
    )

    expectAllRowsToMatchDivider(true)
  })

  it('an explicit verticalDividers={false} prop wins over a preference that is on', () => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'user-1' }))
    localStorage.setItem('odip_ui_prefs:user-1', JSON.stringify({ tableVerticalDividers: true }))

    render(
      <UiPreferencesProvider>
        <DataTable data={rows} columns={columns} keyField="id" verticalDividers={false} />
      </UiPreferencesProvider>
    )

    expectAllRowsToMatchDivider(false)
  })

  it('falls back to the default preference (off) when rendered outside any UiPreferencesProvider', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    expectAllRowsToMatchDivider(false)
  })
})

describe('DataTable — native table semantics (C-3)', () => {
  it('never puts role="button" on a sortable header — aria-sort stays on the native columnheader role', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

    const nameHeader = screen.getByRole('columnheader', { name: /name/i })
    expect(nameHeader).not.toHaveAttribute('role')
    expect(nameHeader).toHaveAttribute('aria-sort')
  })

  it('never puts role="button" on a clickable row — rows keep their native row role and cells stay navigable', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" onRowClick={vi.fn()} />)

    for (const row of screen.getAllByRole('row')) {
      expect(row).not.toHaveAttribute('role')
    }
    // Cells are still individually exposed, not flattened into one string per row.
    expect(screen.getAllByRole('cell').length).toBeGreaterThan(0)
  })

  it('keeps a clickable row keyboard-operable (tabIndex + Enter) even without role="button"', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<DataTable data={rows} columns={columns} keyField="id" onRowClick={onRowClick} />)

    const firstDataRow = screen.getAllByRole('row')[1]
    expect(firstDataRow).toHaveAttribute('tabIndex', '0')
    firstDataRow.focus()
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })
})

describe('DataTable — mobile card view (I-1)', () => {
  it('applies the mobile-card-table class so the existing CSS-only card transform activates under 768px', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    expect(screen.getByRole('table')).toHaveClass('mobile-card-table')
  })

  it('emits a data-label attribute on each cell equal to its column header text, for the CSS pseudo-header', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    expect(screen.getByText('Bianca').closest('td')).toHaveAttribute('data-label', 'Name')
    expect(screen.getByText('30').closest('td')).toHaveAttribute('data-label', 'Age')
  })

  it('emits an empty data-label (never the literal "undefined") for a column with a non-string ReactNode header', () => {
    const columnsWithNodeHeader: Column<Row>[] = [
      { key: 'name', header: <span>Name</span> },
    ]
    render(<DataTable data={rows} columns={columnsWithNodeHeader} keyField="id" />)

    expect(screen.getByText('Bianca').closest('td')).toHaveAttribute('data-label', '')
  })
})

describe('DataTable — pagination prop (pagination rollout wave 1)', () => {
  it('renders no pagination controls when the pagination prop is absent', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    expect(screen.queryByRole('button', { name: /previous page/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument()
  })

  it('still sorts client-side when pagination is absent (unchanged existing behaviour)', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={columns} keyField="id" sortable />)

    await user.click(screen.getByRole('columnheader', { name: /name/i }))

    const cells = screen.getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Alex')
  })

  it('renders "Showing X-Y of Z" and Previous/Next controls when pagination is present', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        pagination={{ page: 1, pageSize: 2, totalCount: 5, onPageChange: vi.fn() }}
      />
    )

    expect(screen.getByText(/showing 1-2 of 5/i)).toBeInTheDocument()
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument()
  })

  it('disables Previous on the first page and Next on the last page', () => {
    const { rerender } = render(
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        pagination={{ page: 1, pageSize: 2, totalCount: 5, onPageChange: vi.fn() }}
      />
    )

    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled()

    rerender(
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        pagination={{ page: 3, pageSize: 2, totalCount: 5, onPageChange: vi.fn() }}
      />
    )

    expect(screen.getByRole('button', { name: /previous page/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled()
  })

  it('fires onPageChange with the next/previous page number when the controls are clicked', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        pagination={{ page: 2, pageSize: 2, totalCount: 5, onPageChange }}
      />
    )

    await user.click(screen.getByRole('button', { name: /next page/i }))
    expect(onPageChange).toHaveBeenCalledWith(3)

    await user.click(screen.getByRole('button', { name: /previous page/i }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('suppresses client-side sorting when pagination is present, trusting the server order', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        sortable
        pagination={{ page: 1, pageSize: 2, totalCount: 2, onPageChange: vi.fn() }}
      />
    )

    // Clicking the sortable header still toggles aria-sort (the affordance stays live)...
    const nameHeader = screen.getByRole('columnheader', { name: /name/i })
    await user.click(nameHeader)
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')

    // ...but row order is untouched — still server/data order (Bianca, Alex), not re-sorted to Alex-first.
    const cells = screen.getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Bianca')
  })

  it('does not render pagination controls when totalCount is 0', () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        keyField="id"
        pagination={{ page: 1, pageSize: 50, totalCount: 0, onPageChange: vi.fn() }}
      />
    )

    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument()
  })
})
