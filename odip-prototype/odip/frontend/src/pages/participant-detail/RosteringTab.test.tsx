import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import RosteringTab from './RosteringTab'
import type { ParticipantRosteringDto } from '@/api/types/participants'
import type { CompatibilityRowDto } from '@/api/types'

const { mockUseParticipantRostering, mockUseCompatibility, mockUpsert, perms } = vi.hoisted(() => ({
  mockUseParticipantRostering: vi.fn(),
  mockUseCompatibility: vi.fn(),
  mockUpsert: vi.fn(),
  perms: { canWrite: false },
}))

vi.mock('@/api/hooks', () => ({
  useParticipantRostering: mockUseParticipantRostering,
  useCompatibility: mockUseCompatibility,
  useUpsertCompatibility: () => ({ mutate: mockUpsert }),
  useStaff: () => ({
    data: [
      { id: 'a', fullName: 'Alex Rivera', isActive: true },
      { id: 'b', fullName: 'Bea Cole', isActive: true },
      { id: 'c', fullName: 'Cam Ng', isActive: true },
      { id: 'd', fullName: 'Dee Park', isActive: true },
      { id: 'e', fullName: 'Eve Hall', isActive: true },
      { id: 'x', fullName: 'Emily Chen', isActive: true },
      { id: 'z', fullName: 'Zed Free', isActive: true },
      { id: 'i', fullName: 'Ian Gone', isActive: false },
    ],
  }),
}))

vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: perms.canWrite }) }))

const row = (staffId: string, staffName: string, level: CompatibilityRowDto['level'], rank: number, reason: string | null = null): CompatibilityRowDto => ({
  staffId, staffName, participantId: 'participant-1', participantName: 'Mia Chen', level, rank, reason, updatedAt: '2026-01-01T00:00:00Z',
})
// Preferred 2, Backup 2, Emergency 1, and one No.
const tierRows = () => [
  row('b', 'Bea Cole', 'Preferred', 2), row('a', 'Alex Rivera', 'Preferred', 1),
  row('d', 'Dee Park', 'Backup', 2, 'Knows the house'), row('c', 'Cam Ng', 'Backup', 1),
  row('e', 'Eve Hall', 'Emergency', 1),
  row('x', 'Emily Chen', 'Excluded', 0, 'Clash'),
]

function makeData(overrides: Partial<ParticipantRosteringDto> = {}): ParticipantRosteringDto {
  return {
    upcomingShifts: [],
    assignedStaff: [],
    ...overrides,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <RosteringTab participantId="participant-1" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseParticipantRostering.mockReset()
  mockUseCompatibility.mockReset()
  mockUseCompatibility.mockReturnValue({ data: [], isLoading: false })
  mockUpsert.mockReset()
  perms.canWrite = false
})

describe('RosteringTab', () => {
  it('shows a loading state', () => {
    mockUseParticipantRostering.mockReturnValue({ data: undefined, isLoading: true })
    renderTab()

    expect(screen.getByRole('status')).toHaveTextContent(/loading rostering details/i)
  })

  it('shows empty states when there is no assigned staff or upcoming shifts', () => {
    mockUseParticipantRostering.mockReturnValue({ data: makeData(), isLoading: false })
    renderTab()

    expect(screen.getByText('No staff assigned')).toBeInTheDocument()
    expect(screen.getByText('No shifts in the next 28 days')).toBeInTheDocument()
  })

  it('links an assigned staff card to their staff detail page and shows shift count/compatibility', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        assignedStaff: [
          { staffId: 'staff-1', staffName: 'Alex Rivera', shiftCount: 3, compatibility: 'Preferred' },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-1')
    expect(screen.getByText('3 shifts')).toBeInTheDocument()
    expect(screen.getByText('Preferred')).toBeInTheDocument()
  })

  it('renders the upcoming shifts table with a staff link and date/time/status', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        upcomingShifts: [
          {
            shiftId: 'shift-1', serviceDate: '2026-09-20', startTime: '08:00:00', endTime: '16:00:00',
            endsNextDay: false, staffId: 'staff-1', staffName: 'Alex Rivera', status: 'Published',
            assigneeOnApprovedLeave: false,
          },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-1')
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('shows an on-leave marker for a filled shift whose assignee has approved leave', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        upcomingShifts: [
          {
            shiftId: 'shift-2', serviceDate: '2026-09-21', startTime: '19:00:00', endTime: '07:00:00',
            endsNextDay: true, staffId: 'staff-2', staffName: 'Mei Zhang', status: 'Published',
            assigneeOnApprovedLeave: true,
          },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByText('On leave')).toBeInTheDocument()
  })

  it('shows "Unassigned" for a shift with no staffId', () => {
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({
        upcomingShifts: [
          {
            shiftId: 'shift-3', serviceDate: '2026-09-22', startTime: '09:00:00', endTime: '15:00:00',
            endsNextDay: false, status: 'Published', assigneeOnApprovedLeave: false,
          },
        ],
      }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('links "Open roster" to /rostering', () => {
    mockUseParticipantRostering.mockReturnValue({ data: makeData(), isLoading: false })
    renderTab()

    expect(screen.getByRole('link', { name: /open roster/i })).toHaveAttribute('href', '/rostering')
  })
})

describe('RosteringTab — Staff preferences card (R8b)', () => {
  const PID = 'participant-1'
  function setup(rows: CompatibilityRowDto[], canWrite = true) {
    perms.canWrite = canWrite
    mockUseParticipantRostering.mockReturnValue({ data: makeData(), isLoading: false })
    mockUseCompatibility.mockReturnValue({ data: rows, isLoading: false })
    return renderTab()
  }
  const groupHeadings = () => screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)
  const groupOf = (name: string) => screen.getByRole('heading', { level: 4, name }).parentElement as HTMLElement
  const namesIn = (group: HTMLElement) => within(group).getAllByRole('listitem').map(li => li.querySelector('[data-name]')?.textContent)
  const ranksIn = (group: HTMLElement) => within(group).getAllByRole('listitem').map(li => li.querySelector('[data-rank]')?.textContent)

  it('renders Preferred, Backup, Emergency in that order, each numbered 1..n by rank', () => {
    setup(tierRows())

    expect(groupHeadings()).toEqual(['Preferred', 'Backup', 'Emergency'])
    expect(namesIn(groupOf('Preferred'))).toEqual(['Alex Rivera', 'Bea Cole'])
    expect(ranksIn(groupOf('Preferred'))).toEqual(['1', '2'])
    expect(namesIn(groupOf('Backup'))).toEqual(['Cam Ng', 'Dee Park'])
    expect(ranksIn(groupOf('Backup'))).toEqual(['1', '2'])
    expect(within(groupOf('Backup')).getByText('Knows the house')).toBeInTheDocument()
    expect(ranksIn(groupOf('Emergency'))).toEqual(['1'])
  })

  it('shows staff marked No as a read-only line with a link to the matrix', () => {
    setup(tierRows())

    expect(screen.getByText('No: Emily Chen.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change in the compatibility matrix' })).toHaveAttribute('href', '/rostering/compatibility')
    expect(screen.queryByText(/excluded/i)).not.toBeInTheDocument()
  })

  it('Move up asks the server for rank n-1, keeping the reason', async () => {
    const user = userEvent.setup()
    mockUpsert.mockImplementation((_dto, opts) => opts.onSuccess())
    setup(tierRows())

    await user.click(screen.getByRole('button', { name: 'Move Bea Cole up in Preferred' }))
    expect(mockUpsert).toHaveBeenLastCalledWith({ staffId: 'b', participantId: PID, level: 'Preferred', reason: null, rank: 1 }, expect.anything())

    await user.click(screen.getByRole('button', { name: 'Move Cam Ng down in Backup' }))
    expect(mockUpsert).toHaveBeenLastCalledWith({ staffId: 'c', participantId: PID, level: 'Backup', reason: null, rank: 2 }, expect.anything())
  })

  it('disables Move up on the first row, Move down on the last, and both on a lone row', () => {
    setup(tierRows())

    expect(screen.getByRole('button', { name: 'Move Alex Rivera up in Preferred' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Alex Rivera down in Preferred' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move Bea Cole down in Preferred' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Eve Hall up in Emergency' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Eve Hall down in Emergency' })).toBeDisabled()
  })

  it('a Tier change appends (no rank) and "Remove from list" sets Allowed', async () => {
    const user = userEvent.setup()
    mockUpsert.mockImplementation((_dto, opts) => opts.onSuccess())
    setup(tierRows())

    const tier = screen.getByLabelText('Tier for Cam Ng')
    expect(Array.from(tier.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Preferred', 'Backup', 'Emergency', 'Remove from list'])
    await user.selectOptions(tier, 'Emergency')
    expect(mockUpsert).toHaveBeenLastCalledWith({ staffId: 'c', participantId: PID, level: 'Emergency', reason: null }, expect.anything())

    await user.selectOptions(screen.getByLabelText('Tier for Eve Hall'), 'Remove from list')
    expect(mockUpsert).toHaveBeenLastCalledWith({ staffId: 'e', participantId: PID, level: 'Allowed', reason: null }, expect.anything())
  })

  it('read-only: numbers and names only, with no buttons, selects or Add row', () => {
    setup(tierRows(), false)

    expect(namesIn(groupOf('Preferred'))).toEqual(['Alex Rivera', 'Bea Cole'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Add staff')).not.toBeInTheDocument()
  })

  it('the Add row leaves out staff marked No, staff already in a tier and inactive staff, and defaults to Backup', async () => {
    const user = userEvent.setup()
    setup(tierRows())

    const staff = screen.getByLabelText('Staff to add')
    expect(Array.from(staff.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Choose staff', 'Zed Free'])
    const tier = screen.getByLabelText('Tier to add to')
    expect(tier).toHaveValue('Backup')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.selectOptions(staff, 'Zed Free')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(mockUpsert).toHaveBeenLastCalledWith({ staffId: 'z', participantId: PID, level: 'Backup', reason: null }, expect.anything())
  })

  it('shows an empty state with the Add row when no tier has anyone', () => {
    setup([])

    expect(screen.getByText('No staff preferences yet')).toBeInTheDocument()
    expect(screen.getByText('Add the staff this participant works best with, in order.')).toBeInTheDocument()
    expect(screen.getByLabelText('Staff to add')).toBeInTheDocument()
  })

  it('a reader sees the empty state without the Add row', () => {
    setup([], false)

    expect(screen.getByText('No staff preferences yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Staff to add')).not.toBeInTheDocument()
  })

  it('says so inline when one tier is empty', () => {
    setup([row('a', 'Alex Rivera', 'Preferred', 1)])

    expect(screen.getByText('No backup staff yet.')).toBeInTheDocument()
    expect(screen.getByText('No emergency staff yet.')).toBeInTheDocument()
    expect(screen.queryByText('No preferred staff yet.')).not.toBeInTheDocument()
  })

  it('disables the row and marks the list busy while a save is in flight', async () => {
    const user = userEvent.setup()
    setup(tierRows())

    await user.click(screen.getByRole('button', { name: 'Move Alex Rivera down in Preferred' }))

    expect(screen.getByRole('button', { name: 'Move Alex Rivera down in Preferred' })).toBeDisabled()
    expect(screen.getByLabelText('Tier for Alex Rivera')).toBeDisabled()
    expect(groupOf('Preferred').querySelector('ol')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows a dismissible error when the save fails', async () => {
    const user = userEvent.setup()
    mockUpsert.mockImplementation((_dto, opts) => opts.onError({ response: { data: { message: 'Participant is not ready for booking or rostering.' } } }))
    setup(tierRows())

    await user.click(screen.getByRole('button', { name: 'Move Bea Cole up in Preferred' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Participant is not ready for booking or rostering.')

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('after a move', () => {
    // The server reorders; the mock plays that back and then reports success.
    function reorderOnSave(rows: CompatibilityRowDto[]) {
      let current = rows
      mockUseCompatibility.mockImplementation(() => ({ data: current, isLoading: false }))
      mockUpsert.mockImplementation((dto, opts) => {
        const tier = current.filter(r => r.level === dto.level).sort((a, b) => a.rank - b.rank)
        const moved = tier.find(r => r.staffId === dto.staffId)!
        const next = tier.filter(r => r !== moved)
        next.splice(dto.rank - 1, 0, moved)
        const ranks = new Map(next.map((r, i) => [r.staffId, i + 1]))
        current = current.map(r => (ranks.has(r.staffId) ? { ...r, rank: ranks.get(r.staffId)! } : r))
        opts.onSuccess()
      })
    }
    const three = () => [row('a', 'Alex Rivera', 'Preferred', 1), row('b', 'Bea Cole', 'Preferred', 2), row('c', 'Cam Ng', 'Preferred', 3)]

    it('keeps focus on the same button of the moved row', async () => {
      const user = userEvent.setup()
      setup(three())
      reorderOnSave(three())

      await user.click(screen.getByRole('button', { name: 'Move Alex Rivera down in Preferred' }))

      expect(namesIn(groupOf('Preferred'))).toEqual(['Bea Cole', 'Alex Rivera', 'Cam Ng'])
      expect(screen.getByRole('button', { name: 'Move Alex Rivera down in Preferred' })).toHaveFocus()
    })

    it('moves focus to the enabled sibling when the row reaches an end', async () => {
      const user = userEvent.setup()
      setup(three())
      reorderOnSave(three())

      await user.click(screen.getByRole('button', { name: 'Move Bea Cole down in Preferred' }))

      expect(screen.getByRole('button', { name: 'Move Bea Cole down in Preferred' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move Bea Cole up in Preferred' })).toHaveFocus()
    })

    it('announces the new place politely', async () => {
      const user = userEvent.setup()
      setup(three())
      reorderOnSave(three())

      await user.click(screen.getByRole('button', { name: 'Move Cam Ng up in Preferred' }))

      expect(screen.getByRole('status')).toHaveTextContent('Cam Ng is now preferred #2.')
    })
  })

  it('badges the assigned-staff cards for Backup and Emergency with the tier name', () => {
    perms.canWrite = false
    mockUseParticipantRostering.mockReturnValue({
      data: makeData({ assignedStaff: [{ staffId: 'c', staffName: 'Cam Ng', shiftCount: 1, compatibility: 'Backup' }] }),
      isLoading: false,
    })
    renderTab()

    expect(screen.getByText('Backup')).toBeInTheDocument()
  })
})
