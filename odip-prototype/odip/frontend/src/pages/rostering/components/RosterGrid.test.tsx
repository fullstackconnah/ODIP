import { describe, it, expect } from 'vitest'
import { render, screen, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RosterGrid } from './RosterGrid'
import { makeParticipantBoard, makeStaffBoard, makeParticipantRow, makeStaffRow, makeShift } from '../test-fixtures'

function noop() {}

/** Row headers (and, when a row has shifts, its chips) render participant/staff Links now. */
function renderGrid(ui: React.ReactElement): RenderResult {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const baseProps = {
  canWrite: true,
  unfilledOnly: false,
  onOpenShift: noop,
  onAssignTo: noop,
  onUnassign: noop,
  onDeleteShift: noop,
  onAddParticipantShift: noop,
  onAddStaffShift: noop,
}

describe('RosterGrid — always renders the full grid', () => {
  it('renders every participant row × 7 day cells for a week with zero shifts, never an empty state', () => {
    const board = makeParticipantBoard({
      participantRows: [
        makeParticipantRow({ participantId: 'p1', fullName: 'Mia Chen', shifts: [] }),
        makeParticipantRow({ participantId: 'p2', fullName: 'Noah Blake', shifts: [] }),
      ],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts {...baseProps} />)

    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.getByText('Noah Blake')).toBeInTheDocument()
    // One writable empty-cell "add" button per participant per day = 2 rows × 7 days.
    expect(screen.getAllByRole('button', { name: /^Add a shift for/ })).toHaveLength(14)
    // No empty-state copy should ever be swapped in here — that's the regression this guards.
    expect(screen.queryByText(/nothing rostered/i)).not.toBeInTheDocument()
  })

  it('renders full grid too when the board actually has shifts', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({ fullName: 'Mia Chen', daysWithoutCover: 0 })],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.getByText('Fully covered')).toBeInTheDocument()
  })
})

describe('RosterGrid — groupBy narrowing', () => {
  it('renders participant rows in Participant mode, with no Unfilled lane', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({ fullName: 'Mia Chen' })],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Unfilled')).not.toBeInTheDocument()
  })

  it('renders staff rows plus the Unfilled lane in Staff mode', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({ fullName: 'Alex Rivera' })],
      unfilled: [],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Unfilled')).toBeInTheDocument()
  })

  it('hides staff rows (but keeps the Unfilled lane) when unfilledOnly is set', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({ fullName: 'Alex Rivera' })],
      unfilled: [],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} unfilledOnly />)
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByText('Unfilled')).toBeInTheDocument()
  })
})

describe('RosterGrid — on-leave shift state', () => {
  it('renders the "On leave" mini-label on a staff-row shift whose assignee has approved leave', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({
        staffId: 'staff-9',
        fullName: 'Alex Rivera',
        shifts: [makeShift({ participantId: 'p1', participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: true })],
      })],
      unfilled: [],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)

    expect(screen.getByText('On leave')).toBeInTheDocument()
  })
})

describe('RosterGrid — cross-domain links', () => {
  it('links a participant row header to their participant page', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({ participantId: 'p1', fullName: 'Mia Chen' })],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts {...baseProps} />)
    expect(screen.getByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/p1')
  })

  it('links a filled shift chip\'s participant and staff names', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({
        staffId: 'staff-9',
        fullName: 'Alex Rivera',
        shifts: [makeShift({ participantId: 'p1', participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Rivera' })],
      })],
      unfilled: [],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)

    expect(screen.getByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/p1')
    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-9')
  })
})

describe('RosterGrid — density', () => {
  it('does not repeat the participant name on chips in a participant row: the chip names the covering staff member', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({
        participantId: 'p1',
        fullName: 'Mia Chen',
        daysWithoutCover: 6,
        shifts: [makeShift({ participantId: 'p1', participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Rivera' })],
      })],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)

    // The participant appears once (the row header); the covering staff member once (the chip label).
    expect(screen.getAllByText('Mia Chen')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-9')
  })

  it('shows "Unfilled" on an unfilled shift inside a participant row', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({
        participantId: 'p1',
        fullName: 'Mia Chen',
        shifts: [makeShift({ participantId: 'p1', participantName: 'Mia Chen', staffId: null, staffName: null })],
      })],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)

    expect(screen.getByText('Unfilled')).toBeInTheDocument()
  })

  it('in a staff row the chip names the participant and the staff member is named once, by the row header link', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({
        staffId: 'staff-9',
        fullName: 'Alex Rivera',
        shifts: [makeShift({ participantId: 'p1', participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Rivera' })],
      })],
      unfilled: [],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)

    expect(screen.getAllByRole('link', { name: 'Alex Rivera' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()
  })

  it('sizes row headers and day cells from --row-h so a row is 34px at a fine pointer and grows under a coarse one', () => {
    const board = makeParticipantBoard({ participantRows: [makeParticipantRow({ fullName: 'Mia Chen' })] })
    const { container } = renderGrid(<RosterGrid board={board} weekHasNoShifts {...baseProps} />)

    expect(container.querySelector('.sticky.left-0.z-10')).toHaveClass('min-h-[var(--row-h)]')
    expect(screen.getAllByRole('button', { name: /^Add a shift for/ })[0]).toHaveClass('min-h-[calc(var(--row-h)_-_1px)]')
  })

  it('pins the day header row and scrolls inside its own frame from md up, so the sticky header actually engages', () => {
    const board = makeParticipantBoard({ participantRows: [makeParticipantRow({ fullName: 'Mia Chen' })] })
    const { container } = renderGrid(<RosterGrid board={board} weekHasNoShifts {...baseProps} />)

    const frame = container.firstElementChild as HTMLElement
    expect(frame).toHaveClass('overflow-auto')
    expect(frame.className).toMatch(/md:max-h-/)
    expect(screen.getByText('Mon').parentElement).toHaveClass('sticky', 'top-0')
  })
})
