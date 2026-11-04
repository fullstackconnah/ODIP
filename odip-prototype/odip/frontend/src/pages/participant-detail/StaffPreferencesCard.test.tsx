import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CompatibilityRowDto } from '@/api/types'
import { StaffPreferencesCard } from './StaffPreferencesCard'

const { mockUseCompatibility, mockUpsert, perms } = vi.hoisted(() => ({
  mockUseCompatibility: vi.fn(),
  mockUpsert: vi.fn(),
  perms: { canWrite: true, isAdmin: false },
}))

vi.mock('@/api/hooks', () => ({
  useCompatibility: mockUseCompatibility,
  useUpsertCompatibility: () => ({ mutate: mockUpsert }),
  useParticipant: () => ({ data: { fullName: 'Mia Chen' } }),
  useSettings: () => ({ data: { autoRosterReach: 3 } }),
  useStaff: () => ({ data: [{ id: 'z', fullName: 'Zed Free', isActive: true }, { id: 'o', fullName: 'Olly Gone', isActive: false }] }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms }))

const row = (staffId: string, staffName: string, level: CompatibilityRowDto['level'], rank: number, reason: string | null = null): CompatibilityRowDto => ({
  staffId, staffName, participantId: 'p1', participantName: 'Mia Chen', level, rank, reason, updatedAt: '2026-01-01T00:00:00Z',
})
const tierRows = () => [
  row('b', 'Bea Cole', 'Preferred', 2), row('a', 'Alex Rivera', 'Preferred', 1),
  row('c', 'Cam Ng', 'Backup', 1, 'Knows the house'), row('x', 'Emily Chen', 'Excluded', 0, 'Clash'),
]

function setup(rows: CompatibilityRowDto[], canWrite = true) {
  perms.canWrite = canWrite
  mockUseCompatibility.mockReturnValue({ data: rows, isLoading: false })
  return render(<MemoryRouter><StaffPreferencesCard participantId="p1" /></MemoryRouter>)
}
const column = (name: string) => screen.getByRole('region', { name })

beforeEach(() => {
  mockUseCompatibility.mockReset()
  mockUpsert.mockReset()
  perms.isAdmin = false
})

describe('StaffPreferencesCard', () => {
  it('shows the board in compact form: four stacked columns, ranked chips in order', () => {
    setup(tierRows())
    for (const name of ['Preferred', 'Backup', 'Emergency', 'No']) expect(column(name)).toBeInTheDocument()
    const names = within(column('Preferred')).getAllByRole('listitem').map(li => li.querySelector('[data-name]')?.textContent)
    expect(names).toEqual(['Alex Rivera', 'Bea Cole'])
    expect(column('Preferred').parentElement).toHaveClass('grid-cols-1')
    expect(column('Preferred').parentElement?.className).not.toContain('sm:grid-cols')
  })

  it('shows the reach line and the renamed link to the participant on the Compatibility page', () => {
    setup(tierRows())
    expect(screen.getByText('Auto-roster can place anyone not marked No.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open on the Compatibility page' })).toHaveAttribute('href', '/rostering/compatibility?participant=p1')
    expect(screen.queryByText('Change in the compatibility matrix')).not.toBeInTheDocument()
  })

  it('keeps No read-only: no menu on the chip, no Mark No button, and no Mark No on a ranked chip', async () => {
    const user = userEvent.setup()
    setup(tierRows())
    expect(within(column('No')).getByText('Emily Chen')).toBeInTheDocument()
    expect(within(column('No')).queryByRole('button')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Options for Alex Rivera' }))
    expect(screen.queryByRole('option', { name: /Mark No/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Move to Backup' })).toBeInTheDocument()
  })

  it('a write goes through the shared upsert', async () => {
    const user = userEvent.setup()
    setup(tierRows())
    await user.click(screen.getByRole('button', { name: 'Options for Cam Ng' }))
    await user.click(await screen.findByRole('option', { name: 'Move to Emergency' }))
    expect(mockUpsert).toHaveBeenCalledWith({ staffId: 'c', participantId: 'p1', level: 'Emergency', reason: 'Knows the house' }, expect.anything())
  })

  it('says No is changed on the Compatibility page, also when the No tier is empty and for a reader', () => {
    const { unmount } = setup(tierRows())
    expect(screen.getByText('Mark or change a No on the Compatibility page.')).toBeInTheDocument()
    unmount()
    setup([row('a', 'Alex Rivera', 'Preferred', 1)], false)
    expect(screen.getByText('No one is marked No.')).toBeInTheDocument()
    expect(screen.getByText('Mark or change a No on the Compatibility page.')).toBeInTheDocument()
  })

  it('while a save is in flight the menus are disabled and the lists are busy', async () => {
    const user = userEvent.setup()
    setup(tierRows()) // mockUpsert never settles
    await user.click(screen.getByRole('button', { name: 'Options for Cam Ng' }))
    await user.click(await screen.findByRole('option', { name: 'Move to Emergency' }))
    expect(screen.getByRole('button', { name: 'Options for Alex Rivera' })).toBeDisabled()
    expect(within(column('Preferred')).getByRole('list')).toHaveAttribute('aria-busy', 'true')
  })

  it('a failed save shows a dismissible error and frees the menus', async () => {
    const user = userEvent.setup()
    mockUpsert.mockImplementation((_dto, opts) => opts.onError(new Error('boom')))
    setup(tierRows())
    await user.click(screen.getByRole('button', { name: 'Options for Cam Ng' }))
    await user.click(await screen.findByRole('option', { name: 'Move to Emergency' }))
    expect(screen.getByText('Couldn’t save this change. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Options for Alex Rivera' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByText('Couldn’t save this change. Try again.')).not.toBeInTheDocument()
  })

  it('the Add checklist lists active staff who are not yet listed, and leaves inactive staff out', async () => {
    const user = userEvent.setup()
    setup(tierRows())
    await user.click(screen.getByRole('button', { name: 'Add to Backup' }))
    expect(await screen.findByText('Zed Free')).toBeInTheDocument()
    expect(screen.queryByText('Olly Gone')).not.toBeInTheDocument()
  })

  it('a reader sees names only: no buttons, and the link stays', () => {
    setup(tierRows(), false)
    expect(within(column('Preferred')).getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open on the Compatibility page' })).toBeInTheDocument()
  })

  it('a reader with nothing listed sees the sentence instead of empty columns', () => {
    setup([], false)
    expect(screen.getByText('No staff preferences yet')).toBeInTheDocument()
    expect(screen.getByText('No preferred, backup or emergency staff have been listed.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Preferred' })).not.toBeInTheDocument()
  })

  it('a writer with nothing listed gets the empty columns with Add', () => {
    setup([])
    expect(screen.getByRole('button', { name: 'Add to Preferred' })).toBeInTheDocument()
    expect(screen.queryByText('No staff preferences yet')).not.toBeInTheDocument()
  })

  it('shows a loading state and an error with Retry', () => {
    mockUseCompatibility.mockReturnValue({ data: undefined, isLoading: true })
    const { unmount } = render(<MemoryRouter><StaffPreferencesCard participantId="p1" /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent(/loading staff preferences/i)
    unmount()
    mockUseCompatibility.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })
    render(<MemoryRouter><StaffPreferencesCard participantId="p1" /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
  })
})
