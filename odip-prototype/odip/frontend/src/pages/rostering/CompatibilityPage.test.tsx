import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

function renderPage(url = '/rostering/compatibility') {
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
  mockApiGet.mockReset().mockImplementation(async () => rows)
  mockApiPut.mockReset().mockImplementation(async (_url: string, body: { staffId: string; participantId: string; level: CompatibilityRowDto['level']; reason: string | null }) => {
    const i = rows.findIndex(r => r.staffId === body.staffId && r.participantId === body.participantId)
    const next = row(body.staffId, body.staffId === 's1' ? 'Sam Taylor' : 'Morgan Lee', body.participantId, body.participantId === 'p1' ? 'Alex Rivera' : 'Jamie Chen', body.level, body.reason)
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

  it('filters by the No / Preferences toggle and the search, and opens on ?q=', async () => {
    const user = userEvent.setup()
    renderPage('/rostering/compatibility?q=Jamie')
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
    expect(screen.getByRole('radio', { name: 'No 2' })).toBeInTheDocument()
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
