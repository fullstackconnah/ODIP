import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CellText, DataTable, RowActions } from './DataTable'
import type { Column } from './DataTable'
import { Button } from './Button'
import { TAP_AREA } from './tapArea'
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

describe('DataTable — density row geometry (spec §1/§4)', () => {
  // A cell with any of these would stack padding on top of the row's token height again — the
  // py-[7px] + 28px-button combination that made rows 43px instead of 34.
  const VERTICAL_PADDING = /(^|\s)(p|py|pt|pb)-/

  it('takes body row height from --row-h on the row, from md up, so the mobile card view keeps auto height', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const [, ...bodyRows] = screen.getAllByRole('row')
    expect(bodyRows).toHaveLength(2)
    for (const row of bodyRows) {
      expect(row).toHaveClass('md:h-[var(--row-h)]')
      // No unconditional fixed height: below 768px .mobile-card-table makes the row a padded flex card.
      expect(row.className).not.toMatch(/(^|\s)h-\[/)
    }
  })

  it('puts no vertical padding on body cells and centres their content', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const [, ...bodyRows] = screen.getAllByRole('row')
    for (const row of bodyRows) {
      for (const cell of within(row).getAllByRole('cell')) {
        expect(cell).toHaveClass('align-middle', 'px-[var(--cell-px)]')
        expect(cell.className).not.toMatch(VERTICAL_PADDING)
      }
    }
  })

  it('takes header height from --table-head-h and centres unpadded header cells', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" />)

    const headerRow = screen.getAllByRole('row')[0]
    expect(headerRow).toHaveClass('h-[var(--table-head-h)]')
    for (const th of within(headerRow).getAllByRole('columnheader')) {
      expect(th).toHaveClass('align-middle', 'px-[var(--cell-px)]')
      expect(th.className).not.toMatch(VERTICAL_PADDING)
    }
  })

  it('no longer carries the fixed pixel padding that built rows out of padding', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} keyField="id" selectable selectedRows={new Set()} onSelectionChange={vi.fn()} />,
    )

    expect(container.innerHTML).not.toMatch(/py-\[7px\]|py-\[6px\]/)
  })

  it('compact is the row token minus 4px: extra-tight on a mouse, never below a usable touch row', () => {
    render(<DataTable data={rows} columns={columns} keyField="id" compact />)

    const [, ...bodyRows] = screen.getAllByRole('row')
    for (const row of bodyRows) {
      expect(row).toHaveClass('md:h-[calc(var(--row-h)-4px)]')
      expect(row).not.toHaveClass('md:h-[var(--row-h)]')
    }
    // compact only changes the row height; cells stay padding-free and centred.
    expect(within(bodyRows[0]).getAllByRole('cell')[0]).toHaveClass('align-middle')
  })

  it('sizes the pagination bar off --row-h too, so paging does not add a taller-than-row strip', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        keyField="id"
        pagination={{ page: 1, pageSize: 2, totalCount: 5, onPageChange: vi.fn() }}
      />,
    )

    const bar = screen.getByText(/showing/i).closest('div')
    expect(bar).toHaveClass('min-h-[var(--row-h)]', 'items-center')
  })
})

describe('DataTable — RowActions (hover / focus reveal)', () => {
  const actionColumns: Column<Row>[] = [
    ...columns,
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <RowActions>
          <Button variant="ghost" size="sm" iconOnly aria-label={`Edit ${row.name}`}>e</Button>
        </RowActions>
      ),
    },
  ]

  it('gives every body row the named group the actions reveal against', () => {
    render(<DataTable data={rows} columns={actionColumns} keyField="id" />)

    const [headerRow, ...bodyRows] = screen.getAllByRole('row')
    expect(headerRow).not.toHaveClass('group/row')
    for (const row of bodyRows) expect(row).toHaveClass('group/row')
  })

  it('reveals actions on row hover and focus, always shows them on coarse pointers, and only ever fades them', () => {
    render(<DataTable data={rows} columns={actionColumns} keyField="id" />)

    const cluster = screen.getByRole('button', { name: 'Edit Bianca' }).parentElement as HTMLElement
    expect(cluster).toHaveClass(
      'opacity-0',
      'group-hover/row:opacity-100',
      'group-focus-within/row:opacity-100',
      'focus-within:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    )
    // Never removed from the accessibility tree or the tab order.
    expect(cluster.className).not.toMatch(/(^|\s)(hidden|invisible|sr-only)(\s|$)|display:|visibility:/)
    // And it stays clickable by coordinate (voice control, switch access) — no pointer-events:none.
    expect(cluster.className).not.toMatch(/pointer-events/)
  })

  it('keeps hidden actions keyboard-reachable: Tab from a clickable row lands on its action', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={actionColumns} keyField="id" onRowClick={vi.fn()} />)

    await user.tab() // first data row (tabIndex 0)
    expect(screen.getAllByRole('row')[1]).toHaveFocus()
    await user.tab() // its action
    expect(screen.getByRole('button', { name: 'Edit Bianca' })).toHaveFocus()
  })

  it('pins the legacy ActionButtons icon children to the same --control-h-sm square as Button iconOnly', () => {
    render(<DataTable data={rows} columns={actionColumns} keyField="id" />)

    const cluster = screen.getByRole('button', { name: 'Edit Bianca' }).parentElement as HTMLElement
    expect(cluster).toHaveClass(
      '[&>div>:is(a,button)]:h-[var(--control-h-sm)]',
      '[&>div>:is(a,button)]:w-[var(--control-h-sm)]',
      '[&>div>:is(a,button)]:p-0',
    )
  })

  it('opens the gap between actions from 6px to 8px on a coarse pointer: 36px buttons with 44px hit areas touch, never overlap', () => {
    render(<DataTable data={rows} columns={actionColumns} keyField="id" />)

    const edit = screen.getByRole('button', { name: 'Edit Bianca' })
    // A Button iconOnly reaches 4px past each edge under coarse (36 -> 44), so 2 x 4 = 8px is the least gap.
    expect(edit).toHaveClass(...TAP_AREA.split(' '))
    const cluster = edit.parentElement as HTMLElement
    expect(cluster).toHaveClass('gap-1.5', 'pointer-coarse:gap-2')
  })
})

describe('DataTable — one-line cells (row height at any desktop width)', () => {
  type Item = { id: string; name: string; notes: string; count: number; when: string; price: number }
  const items: Item[] = [
    { id: '1', name: 'Sunshine Coast Beach Escape', notes: 'A long free-text note that would otherwise wrap', count: 7, when: '2026-08-14', price: 1234.5 },
  ]

  it('never lets a body cell wrap from md up, and leaves the mobile card view free to wrap', () => {
    render(<DataTable data={items} columns={[{ key: 'name', header: 'Name' }]} keyField="id" />)

    const cell = screen.getAllByRole('cell')[0]
    expect(cell).toHaveClass('md:whitespace-nowrap')
    // Every nowrap / truncate class is md-scoped: below 768px the row is a padded flex card whose
    // text has to be able to wrap inside it.
    expect(cell.className).not.toMatch(/(^|\s)(whitespace-nowrap|truncate)(\s|$)/)
    const text = screen.getByText('Sunshine Coast Beach Escape')
    expect(text.className).not.toMatch(/(^|\s)(truncate|max-w-)/)
  })

  it('renders a plain string as one truncating line with its full text in the title', () => {
    render(<DataTable data={items} columns={[{ key: 'name', header: 'Name' }]} keyField="id" />)

    const text = screen.getByText('Sunshine Coast Beach Escape')
    expect(text.tagName).toBe('SPAN')
    expect(text).toHaveClass('block', 'md:truncate', 'md:max-w-[var(--cell-max,24rem)]')
    expect(text).toHaveAttribute('title', 'Sunshine Coast Beach Escape')
    // No cap given: falls back to the 24rem default, so free text can't widen the table without bound.
    expect(text.getAttribute('style')).toBeNull()
  })

  it('takes the cap from maxWidth: a px number or any CSS length', () => {
    render(
      <DataTable
        data={items}
        columns={[
          { key: 'name', header: 'Name', maxWidth: 160 },
          { key: 'notes', header: 'Notes', maxWidth: '12rem' },
        ]}
        keyField="id"
      />,
    )

    expect(screen.getByText('Sunshine Coast Beach Escape').getAttribute('style')).toContain('--cell-max: 160px')
    expect(screen.getByText(/A long free-text note/).getAttribute('style')).toContain('--cell-max: 12rem')
  })

  it('titles a custom render that returns a plain string, but not one that returns elements', () => {
    render(
      <DataTable
        data={items}
        columns={[
          { key: 'name', header: 'Name', render: row => row.name.toUpperCase() },
          { key: 'notes', header: 'Notes', render: row => <em>{row.notes}</em> },
        ]}
        keyField="id"
      />,
    )

    expect(screen.getByText('SUNSHINE COAST BEACH ESCAPE')).toHaveAttribute('title', 'SUNSHINE COAST BEACH ESCAPE')
    // An element limits itself (see CellText); DataTable doesn't wrap or title it.
    const em = screen.getByText(/A long free-text note/)
    expect(em.tagName).toBe('EM')
    expect(em).not.toHaveAttribute('title')
    expect(em.parentElement?.tagName).toBe('TD')
  })

  it('leaves numbers, formatted dates and currency, and the empty dash untitled: nothing there to reveal', () => {
    render(
      <DataTable
        data={[{ ...items[0], notes: null as unknown as string }]}
        columns={[
          { key: 'count', header: 'Count' },
          { key: 'when', header: 'When', type: 'date' },
          { key: 'price', header: 'Price', type: 'currency' },
          { key: 'notes', header: 'Notes' },
        ]}
        keyField="id"
      />,
    )

    for (const cell of screen.getAllByRole('cell')) {
      expect(cell.querySelector('[title]')).toBeNull()
    }
    expect(screen.getAllByRole('cell')[3]).toHaveTextContent('—')
  })

  it('lets a column opt back in to wrapping (prose): no nowrap on its cell and no truncating wrapper', () => {
    render(
      <DataTable
        data={items}
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'notes', header: 'Notes', wrap: true },
        ]}
        keyField="id"
      />,
    )

    const [nameCell, notesCell] = screen.getAllByRole('cell')
    expect(nameCell).toHaveClass('md:whitespace-nowrap')
    expect(notesCell.className).not.toMatch(/whitespace-nowrap/)
    expect(notesCell.querySelector('[title]')).toBeNull()
    expect(notesCell.firstChild?.nodeType).toBe(Node.TEXT_NODE)
  })
})

describe('DataTable — CellText', () => {
  it('is a one-line block, cut at the caller\'s md max-width, titled with its string children', () => {
    render(<CellText className="md:max-w-[9rem] 2xl:max-w-[16rem]">Mount Tamborine QLD · Gold Coast Hinterland</CellText>)

    const text = screen.getByText('Mount Tamborine QLD · Gold Coast Hinterland')
    expect(text).toHaveClass('block', 'md:truncate', 'md:max-w-[9rem]', '2xl:max-w-[16rem]')
    expect(text).toHaveAttribute('title', 'Mount Tamborine QLD · Gold Coast Hinterland')
  })

  it('takes an explicit title, and adds none for element children', () => {
    const { rerender } = render(<CellText title="Full text">Short</CellText>)
    expect(screen.getByText('Short')).toHaveAttribute('title', 'Full text')

    rerender(<CellText><b>Bold</b></CellText>)
    expect(screen.getByText('Bold').parentElement).not.toHaveAttribute('title')
  })
})

describe('DataTable — column priority (dropping columns instead of squeezing them)', () => {
  type Item = { id: string; a: string; b: string; c: string; d: string; e: string }
  const items: Item[] = [{ id: '1', a: 'alpha', b: 'bravo', c: 'charlie', d: 'delta', e: 'echo' }]
  const columns: Column<Item>[] = [
    { key: 'a', header: 'A' },
    { key: 'b', header: 'B', priority: 'high' },
    { key: 'c', header: 'C', priority: 'medium' },
    { key: 'd', header: 'D', priority: 'low' },
    { key: 'e', header: 'E', priority: 'lowest' },
  ]

  it('keeps high (and the default) always, and drops medium below xl, low below 2xl, lowest below 1792px', () => {
    render(<DataTable data={items} columns={columns} keyField="id" />)

    const headers = screen.getAllByRole('columnheader')
    const cells = screen.getAllByRole('cell')
    const hiddenClass: Array<string | null> = [null, null, 'md:max-xl:hidden', 'md:max-2xl:hidden', 'md:max-[1792px]:hidden']
    hiddenClass.forEach((cls, i) => {
      for (const el of [headers[i], cells[i]]) {
        if (cls) expect(el).toHaveClass(cls)
        else expect(el.className).not.toMatch(/hidden/)
      }
    })
  })

  it('only ever hides from md up, so the mobile card view keeps every field and its data-label', () => {
    render(<DataTable data={items} columns={columns} keyField="id" />)

    for (const el of [...screen.getAllByRole('columnheader'), ...screen.getAllByRole('cell')]) {
      expect(el.className).not.toMatch(/(^|\s)(hidden|max-\w+:hidden)(\s|$)/)
    }
    // Hidden by CSS only: the cell and its label are still in the DOM for the card view.
    expect(screen.getByText('delta').closest('td')).toHaveAttribute('data-label', 'D')
    expect(screen.getByText('echo').closest('td')).toHaveAttribute('data-label', 'E')
  })

  it('hides an editing cell with its column too, so an edited row never shears against its header', () => {
    const editable: Column<Item>[] = [
      { key: 'a', header: 'A' },
      { key: 'd', header: 'D', priority: 'low', editable: { render: (row, onChange) => <input aria-label="edit-d" defaultValue={row.d} onChange={e => onChange(e.target.value)} /> } },
    ]
    render(<DataTable data={items} columns={editable} keyField="id" editingRow="1" onEditChange={vi.fn()} />)

    expect(screen.getByLabelText('edit-d').closest('td')).toHaveClass('md:max-2xl:hidden')
    expect(screen.getByRole('columnheader', { name: 'D' })).toHaveClass('md:max-2xl:hidden')
  })
})

describe('DataTable — minWidth', () => {
  type Item = { id: string; name: string; status: string }
  const items: Item[] = [{ id: '1', name: 'Bianca', status: 'Draft' }]

  it('reserves the column width from md up, on the header and every cell, through a custom property', () => {
    render(
      <DataTable
        data={items}
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'status', header: 'Status', minWidth: '10.25rem' },
        ]}
        keyField="id"
      />,
    )

    const th = screen.getByRole('columnheader', { name: 'Status' })
    const td = screen.getByText('Draft').closest('td') as HTMLElement
    for (const el of [th, td]) {
      expect(el).toHaveClass('md:min-w-[var(--col-min)]')
      expect(el.getAttribute('style')).toContain('--col-min: 10.25rem')
    }
    // md-scoped, so a mobile card cell isn't forced to that width.
    expect(td.className).not.toMatch(/(^|\s)min-w-/)
    // Columns that don't ask for one carry neither the class nor the property.
    const name = screen.getByRole('columnheader', { name: 'Name' })
    expect(name.className).not.toMatch(/min-w-/)
    expect(name.getAttribute('style')).toBeNull()
  })

  it('takes a plain number as px', () => {
    render(<DataTable data={items} columns={[{ key: 'status', header: 'Status', minWidth: 164 }]} keyField="id" />)

    expect(screen.getByRole('columnheader', { name: 'Status' }).getAttribute('style')).toContain('--col-min: 164px')
  })
})

describe('DataTable — RowActions overlay', () => {
  const overlayColumns: Column<Row>[] = [
    ...columns,
    {
      key: 'actions',
      header: '',
      className: 'relative',
      render: (row) => (
        <RowActions overlay>
          <Button variant="secondary" size="sm" aria-label={`Change status for ${row.name}`}>Change status</Button>
        </RowActions>
      ),
    },
  ]

  it('takes the cluster out of the flow on a mouse at md+, without touching its reveal or keyboard reach', () => {
    render(<DataTable data={rows} columns={overlayColumns} keyField="id" />)

    const cluster = screen.getByRole('button', { name: 'Change status for Bianca' }).parentElement as HTMLElement
    expect(cluster).toHaveClass(
      'md:pointer-fine:absolute',
      'md:pointer-fine:right-full',
      'md:pointer-fine:inset-y-0',
      // Solid row background under the buttons, fading out over the 24px left padding.
      'md:pointer-fine:bg-[linear-gradient(to_left,var(--row-bg)_calc(100%_-_1.5rem),transparent)]',
      'md:pointer-fine:[--row-bg:var(--color-card)]',
      'md:pointer-fine:group-hover/row:[--row-bg:color-mix(in_srgb,var(--color-accent)_50%,var(--color-card))]',
    )
    // The same opacity-only reveal as the in-flow cluster.
    expect(cluster).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'group-focus-within/row:opacity-100', 'focus-within:opacity-100', '[@media(pointer:coarse)]:opacity-100')
    expect(cluster.className).not.toMatch(/(^|\s)(hidden|invisible|sr-only)(\s|$)|pointer-events/)
    // Never absolute below md or on a touch screen: there it is always shown and covers nothing.
    expect(cluster.className).not.toMatch(/(^|\s)(absolute|right-full|inset-y-0)(\s|$)/)
  })

  it('stays in the flow, with no overlay classes, when overlay is not asked for', () => {
    const inFlow: Column<Row>[] = [
      ...columns,
      { key: 'actions', header: '', render: (row) => <RowActions><Button size="sm" aria-label={`Edit ${row.name}`}>e</Button></RowActions> },
    ]
    render(<DataTable data={rows} columns={inFlow} keyField="id" />)

    const cluster = screen.getByRole('button', { name: 'Edit Bianca' }).parentElement as HTMLElement
    expect(cluster.className).not.toMatch(/pointer-fine|absolute/)
  })

  it('renders nothing for an empty overlay cluster, so a hover never paints a blank patch', () => {
    const empty: Column<Row>[] = [
      ...columns,
      { key: 'actions', header: '', className: 'relative', render: () => <RowActions overlay>{false}{null}</RowActions> },
    ]
    const { container } = render(<DataTable data={rows} columns={empty} keyField="id" />)

    expect(container.querySelector('[class*="group-hover/row:opacity-100"]')).toBeNull()
  })

  it('keeps an overlaid action keyboard-reachable: Tab from a clickable row lands on it', async () => {
    const user = userEvent.setup()
    render(<DataTable data={rows} columns={overlayColumns} keyField="id" onRowClick={vi.fn()} />)

    await user.tab()
    expect(screen.getAllByRole('row')[1]).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Change status for Bianca' })).toHaveFocus()
  })
})

describe('DataTable — keyboard activation of a clickable row', () => {
  const actionClicks: string[] = []
  const controlColumns: Column<Row>[] = [
    ...columns,
    {
      key: 'actions',
      header: '',
      // Like every real row action (see ParticipantsPage/TripsPage): the click stops propagating
      // so it doesn't also open the row. The keydown is what DataTable itself has to get right.
      render: (row) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); actionClicks.push(row.id) }}>
          Act on {row.name}
        </button>
      ),
    },
  ]

  it('leaves Enter on a control inside the row to that control instead of opening the row', async () => {
    const user = userEvent.setup()
    actionClicks.length = 0
    const onRowClick = vi.fn()
    render(<DataTable data={rows} columns={controlColumns} keyField="id" onRowClick={onRowClick} />)

    screen.getByRole('button', { name: 'Act on Bianca' }).focus()
    await user.keyboard('{Enter}')

    // The row used to cancel the keydown and navigate, so the control's own click never fired.
    expect(actionClicks).toEqual(['1'])
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('still activates the row when the row itself has focus (Enter and Space)', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<DataTable data={rows} columns={controlColumns} keyField="id" onRowClick={onRowClick} />)

    const firstRow = screen.getAllByRole('row')[1]
    firstRow.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onRowClick).toHaveBeenCalledTimes(2)
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })
})
