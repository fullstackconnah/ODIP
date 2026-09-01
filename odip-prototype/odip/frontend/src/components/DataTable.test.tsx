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
