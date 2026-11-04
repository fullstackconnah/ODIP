import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompatibilityRowDto } from '@/api/types'
import CompatibilityPage from './CompatibilityPage'

const { mockApiGet, mockApiPut, perms } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPut: vi.fn(), perms: { canWrite: true } }))

vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms }))
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

function renderPage(url = '/rostering/compatibility?view=all') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><CompatibilityPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  perms.canWrite = true
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

const dataRows = () => screen.getAllByRole('row').slice(1)

describe('CompatibilityPage: the exceptions list', () => {
  it('lists only pairings that differ from the default, in scope, one badge each', async () => {
    renderPage()
    await screen.findByText('Knows the routine')

    // Allowed, the inactive staff member and the participant outside the loaded list are not rendered.
    expect(dataRows()).toHaveLength(3)
    expect(screen.queryByText('Gone Person')).not.toBeInTheDocument()
    expect(screen.queryByText('Exited Person')).not.toBeInTheDocument()
    expect(screen.queryByText('Allowed')).not.toBeInTheDocument()
    for (const r of dataRows()) {
      expect(within(r).getAllByText(/^(Preferred|Backup|Emergency|No)$/)).toHaveLength(1)
    }
    expect(screen.getByRole('radio', { name: 'All 3' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No 1' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Preferences 2' })).toBeInTheDocument()
    // No grid controls.
    expect(document.querySelectorAll('table select')).toHaveLength(0)
  })

  it('links a participant to the roster chip of their page, a tab and section the page knows', async () => {
    renderPage()
    await screen.findByText('Knows the routine')
    expect(screen.getAllByRole('link', { name: 'Alex Rivera' })[0]).toHaveAttribute('href', '/participants/p1?tab=people&section=roster')
  })

  it('filters by the No / Preferences toggle and the search, and opens on ?q=', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?view=all&q=Jamie')
    await screen.findByText('Morgan Lee')
    expect(dataRows()).toHaveLength(1)

    await user.clear(screen.getByLabelText('Search staff or participants'))
    await user.click(screen.getByRole('radio', { name: 'No 1' }))
    expect(dataRows()).toHaveLength(1)
    expect(screen.getByText('Past conflict')).toBeInTheDocument()
  })

  it('refetches the list after Mark as No and shows the new row', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Knows the routine')

    await user.click(screen.getByRole('button', { name: 'Mark as No' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByLabelText(/^Staff/))
    await user.click(await screen.findByRole('option', { name: 'Sam Taylor' }))
    await user.click(within(dialog).getByLabelText(/^Participant/))
    await user.click(await screen.findByRole('option', { name: 'Jamie Chen' }))
    await user.type(within(dialog).getByLabelText(/Reason/), 'Not a fit')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as No' }))

    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's1', participantId: 'p2', level: 'Excluded', reason: 'Not a fit' })
    expect(await screen.findByText('Not a fit')).toBeInTheDocument()
    expect(dataRows()).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'No 2' })).toBeInTheDocument()
  })

  it('shows every pairing in the default view, with no Show all', async () => {
    const staffNames = [['s1', 'Sam Taylor'], ['s2', 'Morgan Lee'], ['s4', 'Casey Wong']]
    rows = [
      ...staffNames.map(([id, name]) => row(id, name, 'p1', 'Alex Rivera', 'Preferred')),
      ...staffNames.map(([id, name]) => row(id, name, 'p2', 'Jamie Chen', 'Preferred')),
      row('s5', 'Robin Hall', 'p1', 'Alex Rivera', 'Excluded', 'Past conflict'),
      row('s5', 'Robin Hall', 'p2', 'Jamie Chen', 'Excluded', 'Left the team'),
    ]
    renderPage()
    await screen.findByText('Left the team')
    expect(dataRows()).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
  })

  it('keeps the reason when only the reason is edited, and sends the new one', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Past conflict')

    await user.click(screen.getByRole('button', { name: 'Edit reason' }))
    const dialog = await screen.findByRole('alertdialog')
    const box = within(dialog).getByLabelText(/Reason/)
    expect(box).toHaveValue('Past conflict')
    await user.clear(box)
    await user.type(box, 'Updated reason')
    await user.click(within(dialog).getByRole('button', { name: 'Save reason' }))

    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's2', participantId: 'p1', level: 'Excluded', reason: 'Updated reason' })
    expect(await screen.findByText('Updated reason')).toBeInTheDocument()
  })

  it('removes a No by saving Allowed with no reason, and the row drops out', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Past conflict')

    await user.click(screen.getByRole('button', { name: 'Remove No' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove No' }))

    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's2', participantId: 'p1', level: 'Allowed', reason: null })
    await screen.findByRole('radio', { name: 'No 0' })
    expect(screen.queryByText('Past conflict')).not.toBeInTheDocument()
  })

  it('shows the server\'s refusal inside the dialog and keeps the typed reason', async () => {
    const user = userEvent.setup()
    mockApiPut.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['Participant is not ready for booking or rostering.'] } } })
    renderPage()
    await screen.findByText('Past conflict')

    await user.click(screen.getByRole('button', { name: 'Edit reason' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText(/Reason/), ' more')
    await user.click(within(dialog).getByRole('button', { name: 'Save reason' }))

    expect(await within(dialog).findByText('Participant is not ready for booking or rostering.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue('Past conflict more')
  })

  it('tells the user a tier will be replaced when the chosen pair already holds one', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Knows the routine')

    await user.click(screen.getByRole('button', { name: 'Mark as No' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByLabelText(/^Staff/))
    await user.click(await screen.findByRole('option', { name: 'Sam Taylor' }))
    await user.click(within(dialog).getByLabelText(/^Participant/))
    await user.click(await screen.findByRole('option', { name: 'Alex Rivera' }))

    expect(within(dialog).getByText(/Sam Taylor is listed as Preferred for Alex Rivera\. Marking No takes them off that list/)).toBeInTheDocument()
  })

  it('has no write controls for a reader', async () => {
    perms.canWrite = false
    renderPage()
    await screen.findByText('Knows the routine')
    expect(screen.queryByRole('button', { name: 'Mark as No' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit reason' })).not.toBeInTheDocument()
  })

  it('says so when nothing differs from the default', async () => {
    rows = []
    renderPage()
    expect(await screen.findByText('No pairings marked yet')).toBeInTheDocument()
    expect(screen.getByText(/can’t be rostered|can't be rostered/)).toBeInTheDocument()
  })
})

describe('CompatibilityPage: the participant board', () => {
  const list = () => within(screen.getByRole('navigation', { name: 'Participants' }))

  it('opens by participant: a list with counts, and the first participant on the board', async () => {
    renderPage('/rostering/compatibility')
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => expect(list().getByRole('link', { name: /Alex Rivera/ })).toHaveTextContent('1 listed · 1 No'))
    expect(list().getByRole('link', { name: /Jamie Chen/ })).toHaveTextContent('1 listed')
    expect(list().getByRole('link', { name: /Jamie Chen/ })).not.toHaveTextContent('No')
    expect(list().getByRole('link', { name: /Alex Rivera/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('radio', { name: 'By participant' })).toBeChecked()
    expect(document.querySelectorAll('select')).toHaveLength(0)
  })

  it('opens All pairings on ?view=all, and the toggle moves between the two', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility')
    await screen.findByRole('heading', { name: 'Alex Rivera' })
    await user.click(screen.getByRole('radio', { name: 'All pairings' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'By participant' }))
    expect(await screen.findByRole('heading', { name: 'Alex Rivera' })).toBeInTheDocument()
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
