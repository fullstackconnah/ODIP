import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RosterGrid } from './RosterGrid'
import { makeParticipantBoard, makeStaffBoard, makeParticipantRow, makeStaffRow } from '../test-fixtures'

function noop() {}

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
    render(<RosterGrid board={board} weekHasNoShifts {...baseProps} />)

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
    render(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.getByText('Fully covered')).toBeInTheDocument()
  })
})

describe('RosterGrid — groupBy narrowing', () => {
  it('renders participant rows in Participant mode, with no Unfilled lane', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({ fullName: 'Mia Chen' })],
    })
    render(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Unfilled')).not.toBeInTheDocument()
  })

  it('renders staff rows plus the Unfilled lane in Staff mode', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({ fullName: 'Alex Rivera' })],
      unfilled: [],
    })
    render(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Unfilled')).toBeInTheDocument()
  })

  it('hides staff rows (but keeps the Unfilled lane) when unfilledOnly is set', () => {
    const board = makeStaffBoard({
      staffRows: [makeStaffRow({ fullName: 'Alex Rivera' })],
      unfilled: [],
    })
    render(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} unfilledOnly />)
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByText('Unfilled')).toBeInTheDocument()
  })
})
