import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompatibilityRowDto } from '@/api/types'
import CompatibilityPage from './CompatibilityPage'

const { mockApiGet, mockApiPut, perms, narrow } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPut: vi.fn(), perms: { canWrite: true, isAdmin: false }, narrow: { value: false } }))

vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms }))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => narrow.value }))
vi.mock('@/api/client', async orig => ({ ...(await orig<object>()), apiGet: mockApiGet, apiPut: mockApiPut }))

const PARTICIPANTS = [
  { id: 'p1', fullName: 'Alex Rivera', firstName: 'Alex', lastName: 'Rivera' },
  { id: 'p2', fullName: 'Jamie Chen', firstName: 'Jamie', lastName: 'Chen' },
]
vi.mock('@/api/hooks', async orig => ({
  ...(await orig<object>()),
  useParticipants: () => ({ data: PARTICIPANTS, isLoading: false, isError: false, refetch: vi.fn() }),
  useStaff: () => ({
    data: [
      { id: 's1', fullName: 'Sam Taylor', isActive: true },
      { id: 's2', fullName: 'Morgan Lee', isActive: true },
      { id: 's3', fullName: 'Gone Person', isActive: false },
      { id: 's4', fullName: 'Casey Wong', isActive: true },
      { id: 's5', fullName: 'Robin Hall', isActive: true },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

function row(staffId: string, staffName: string, participantId: string, participantName: string, level: CompatibilityRowDto['level'], reason: string | null = null): CompatibilityRowDto {
  return { staffId, staffName, participantId, participantName, level, rank: 0, reason, updatedAt: '2026-10-01T00:00:00Z' }
}

let rows: CompatibilityRowDto[]

function renderPage(url = '/rostering/compatibility?view=table') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><CompatibilityPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  perms.canWrite = true
  perms.isAdmin = false
  narrow.value = false
  rows = [
    row('s1', 'Sam Taylor', 'p1', 'Alex Rivera', 'Preferred', 'Knows the routine'),
    row('s2', 'Morgan Lee', 'p1', 'Alex Rivera', 'Excluded', 'Past conflict'),
    row('s1', 'Sam Taylor', 'p2', 'Jamie Chen', 'Allowed'),
    row('s2', 'Morgan Lee', 'p2', 'Jamie Chen', 'Backup'),
    row('s3', 'Gone Person', 'p2', 'Jamie Chen', 'Excluded', 'Left'),
    row('s1', 'Sam Taylor', 'p9', 'Exited Person', 'Preferred'),
  ]
  mockApiGet.mockReset().mockImplementation(async (_url: string, params?: { participantId?: string }) => (params?.participantId ? rows.filter(r => r.participantId === params.participantId) : [...rows]))
  mockApiPut.mockReset().mockImplementation(async (_url: string, body: { staffId: string; participantId: string; level: CompatibilityRowDto['level']; reason: string | null }) => {
    const i = rows.findIndex(r => r.staffId === body.staffId && r.participantId === body.participantId)
    const staffNames: Record<string, string> = { s1: 'Sam Taylor', s2: 'Morgan Lee', s4: 'Casey Wong', s5: 'Robin Hall' }
    const next = row(body.staffId, staffNames[body.staffId], body.participantId, body.participantId === 'p1' ? 'Alex Rivera' : 'Jamie Chen', body.level, body.reason)
    if (i >= 0) rows[i] = next
    else rows.push(next)
    return next
  })
})

describe('CompatibilityPage: the table', () => {
  const cellFor = (p: string, st: string) => screen.getByRole('gridcell', { name: new RegExp(`^${p} and ${st}:`) })

  it.each(['table', 'all'])('opens the matrix on ?view=%s (all is an old link), in scope only', async view => {
    renderPage(`/rostering/compatibility?view=${view}`)
    expect(await screen.findByRole('grid')).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
    // The inactive staff member is no column; the participant outside the loaded list is no row.
    expect(screen.queryByTitle('Gone Person')).not.toBeInTheDocument()
    expect(screen.queryByText('Exited Person')).not.toBeInTheDocument()
    expect(cellFor('Alex Rivera', 'Sam Taylor')).toHaveTextContent('P')
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked()
  })

  it('moves between the board and the table with the toggle', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility')
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByRole('radio', { name: 'Table' }))
    expect(await screen.findByRole('grid')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'By participant' }))
    expect(await screen.findByRole('heading', { name: 'Alex Rivera' })).toBeInTheDocument()
  })

  it('falls back to the board below md, even on ?view=table', async () => {
    narrow.value = true
    renderPage('/rostering/compatibility?view=table')
    expect(await screen.findByRole('heading', { name: 'Alex Rivera' })).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('shows the reach line on both views, with the Change link for an Admin only', async () => {
    perms.isAdmin = false
    renderPage('/rostering/compatibility?view=table')
    expect(await screen.findByText(/Auto-roster can place anyone not marked No/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Change' })).not.toBeInTheDocument()
  })

  it('gives an Admin the Change link on the board view too', async () => {
    perms.isAdmin = true
    renderPage('/rostering/compatibility')
    expect(await screen.findByRole('link', { name: 'Change' })).toBeInTheDocument()
  })

  it('marks No from the header button and shows it in the cell after the refetch', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?view=table')
    await screen.findByRole('grid')
    await user.click(screen.getByRole('button', { name: 'Mark as No' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByLabelText(/^Staff/))
    await user.click(await screen.findByRole('option', { name: 'Sam Taylor' }))
    await user.click(within(dialog).getByLabelText(/^Participant/))
    await user.click(await screen.findByRole('option', { name: 'Jamie Chen' }))
    await user.type(within(dialog).getByLabelText(/Reason/), 'Not a fit')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as No' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's1', participantId: 'p2', level: 'Excluded', reason: 'Not a fit' })
    await waitFor(() => expect(cellFor('Jamie Chen', 'Sam Taylor')).toHaveTextContent('No'))
  })

  it('opens the fixed-pair dialog on N, edits a No on N, and removes one on Delete', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?view=table')
    await screen.findByRole('grid')
    cellFor('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('n')
    let dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByLabelText(/^Staff/)).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('Sam Taylor')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mockApiPut).not.toHaveBeenCalled()

    cellFor('Alex Rivera', 'Morgan Lee').focus()
    await user.keyboard('n')
    dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue('Past conflict')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.keyboard('{Delete}')
    dialog = await screen.findByRole('alertdialog')
    expect(mockApiPut).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Remove No' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's2', participantId: 'p1', level: 'Allowed', reason: null })
  })

  it('Undo after Remove No puts the No and its reason back', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?view=table')
    await screen.findByRole('grid')
    cellFor('Alex Rivera', 'Morgan Lee').focus()
    await user.keyboard('{Delete}')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove No' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(mockApiPut).toHaveBeenLastCalledWith('/rostering/compatibility', { staffId: 's2', participantId: 'p1', level: 'Excluded', rank: null, reason: 'Past conflict' })
  })

  it('Undo after Mark No puts the earlier tier back', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?view=table')
    await screen.findByRole('grid')
    cellFor('Jamie Chen', 'Morgan Lee').focus()
    await user.keyboard('n')
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Not a fit')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as No' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(mockApiPut).toHaveBeenLastCalledWith('/rostering/compatibility', { staffId: 's2', participantId: 'p2', level: 'Backup', rank: null, reason: null })
  })

  it('has no write controls for a reader', async () => {
    perms.canWrite = false
    renderPage('/rostering/compatibility?view=table')
    await screen.findByRole('grid')
    expect(screen.queryByRole('button', { name: 'Mark as No' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument()
  })

  it('keeps the two searches in the URL', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?view=table&sq=sam')
    await screen.findByRole('grid')
    expect(screen.getByLabelText('Search staff')).toHaveValue('sam')
    await user.type(screen.getByLabelText('Search participants'), 'Jam')
    expect(screen.getAllByRole('rowheader')).toHaveLength(1)
  })
})

describe('CompatibilityPage: the participant board', () => {
  const list = () => within(screen.getByRole('navigation', { name: 'Participants' }))

  it('opens by participant: a list with counts, and the first participant on the board', async () => {
    renderPage('/rostering/compatibility')
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    await waitFor(() => expect(list().getByRole('link', { name: /Alex Rivera/ })).toHaveTextContent('1 listed · 1 No'))
    expect(list().getByRole('link', { name: /Jamie Chen/ })).toHaveTextContent('1 listed')
    expect(list().getByRole('link', { name: /Jamie Chen/ })).not.toHaveTextContent('No')
    expect(list().getByRole('link', { name: /Alex Rivera/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('radio', { name: 'By participant' })).toBeChecked()
    expect(document.querySelectorAll('select')).toHaveLength(0)
  })

  it('deep-links a participant and filters the list on ?q=', async () => {
    renderPage('/rostering/compatibility?participant=p2')
    expect(await screen.findByRole('heading', { name: 'Jamie Chen' })).toBeInTheDocument()
    expect(list().getByRole('link', { name: /Jamie Chen/ })).toHaveAttribute('aria-current', 'page')
  })

  it('filters the participant list on ?q= and says when nobody matches', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?q=Jam')
    await screen.findByRole('heading', { name: 'Jamie Chen' })
    expect(list().queryByRole('link', { name: /Alex Rivera/ })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search participants'))
    await user.type(screen.getByLabelText('Search participants'), 'zzz')
    expect(screen.getByText('No participants match “zzz”.')).toBeInTheDocument()
  })

  it('updates the list counts after an add, without a reload', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?participant=p2')
    await screen.findByRole('heading', { name: 'Jamie Chen' })
    await user.click(await screen.findByRole('button', { name: 'Add to Emergency' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Casey Wong' }))
    await user.click(screen.getByRole('button', { name: 'Add 1 as Emergency' }))
    await waitFor(() => expect(list().getByRole('link', { name: /Jamie Chen/ })).toHaveTextContent('2 listed'))
  })

  it('marks No from a chip as a new mark, not an edit, and says what the person is leaving', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility')
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(await screen.findByRole('button', { name: 'Options for Sam Taylor' }))
    await user.click(await screen.findByRole('option', { name: 'Mark No…' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByRole('button', { name: 'Save reason' })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/^Staff/)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/Sam Taylor is listed as Preferred for Alex Rivera\. Marking No takes them off that list/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Reason/), 'Asked to be apart')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as No' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's1', participantId: 'p1', level: 'Excluded', reason: 'Asked to be apart' })
  })

  it('marks No from the column foot with the participant fixed and the staff picked', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?participant=p2')
    await screen.findByRole('heading', { name: 'Jamie Chen' })
    await user.click(await screen.findByRole('button', { name: '+ Mark No' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByLabelText(/^Participant/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByLabelText(/^Staff/))
    await user.click(await screen.findByRole('option', { name: 'Casey Wong' }))
    await user.type(within(dialog).getByLabelText(/Reason/), 'Not a fit')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as No' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's4', participantId: 'p2', level: 'Excluded', reason: 'Not a fit' })
  })

  it('edits and removes a No from its chip', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility')
    await screen.findByText('Past conflict')
    await user.click(screen.getByRole('button', { name: 'Options for Morgan Lee' }))
    await user.click(await screen.findByRole('option', { name: 'Edit reason…' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue('Past conflict')
    expect(within(dialog).getByRole('button', { name: 'Save reason' })).toBeInTheDocument()
  })

  it('shows a reader the board with no menus and no Add buttons', async () => {
    perms.canWrite = false
    renderPage('/rostering/compatibility')
    await screen.findByText('Past conflict')
    expect(screen.queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add to/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Mark No' })).not.toBeInTheDocument()
  })
})
