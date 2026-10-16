import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RosterGrid, RosterGridSkeleton } from './RosterGrid'
import { makeParticipantBoard, makeStaffBoard, makeParticipantRow, makeStaffRow, makeShift, makeUnfilledShift, WEEK_DAYS } from '../test-fixtures'

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
    // The coverage state is a compact badge (a check here); "Fully covered" is its accessible name and title.
    expect(screen.getByRole('img', { name: 'Fully covered' })).toBeInTheDocument()
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

  it('shows "Needs staff" on an unfilled shift inside a participant row', () => {
    const board = makeParticipantBoard({
      participantRows: [makeParticipantRow({
        participantId: 'p1',
        fullName: 'Mia Chen',
        shifts: [makeShift({ participantId: 'p1', participantName: 'Mia Chen', staffId: null, staffName: null })],
      })],
    })
    renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} />)

    expect(screen.getByText('Needs staff')).toBeInTheDocument()
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

  it('widens the sticky first column to 280px from a 1500px viewport through a CSS variable; below that it keeps the 195px column', () => {
    const board = makeParticipantBoard({ participantRows: [makeParticipantRow({ fullName: 'Mia Chen' })] })
    const { container } = renderGrid(<RosterGrid board={board} weekHasNoShifts {...baseProps} />)

    // Only the wide-screen class sets the variable; the grid template and the scroll padding read it with the
    // 195px lib width as the var() fallback, so a narrower window gets exactly the board it always had (195 +
    // the week strip's 921px fits from 1390px) and a wide one gets the room a one-line participant header needs:
    // 280px = 17px rule and padding + the longest fixture name with its marker (167px) + 8 + the 31px ratio chip
    // + 8 + the 35px coverage count badge, with ~14px to spare. 1500px is where 280 + 921 + 2 + the 272px of
    // sidebar and gutters + ~17px of scrollbar (1492px) fits.
    expect(container.firstElementChild).toHaveClass('min-[1500px]:[--roster-sticky-col:280px]')
    expect(container.firstElementChild!.className).not.toMatch(/1480px|264px/)
  })

  it('gives the loading skeleton the same frame, so the column does not jump when the real board arrives', () => {
    const { container } = render(<RosterGridSkeleton days={WEEK_DAYS} />)

    expect(container.firstElementChild).toHaveClass('min-[1500px]:[--roster-sticky-col:280px]', 'overflow-auto')
  })
})

describe('RosterGrid frame with the staff strip (roster drag and drop)', () => {
  it('grows the frame’s chrome allowance by the staff strip when draggable, and only then', () => {
    const { container, unmount } = renderGrid(<RosterGrid board={makeParticipantBoard()} weekHasNoShifts={false} draggable {...baseProps} />)
    expect(container.firstElementChild?.className).toContain('2*var(--control-h)')
    unmount()
    const plain = renderGrid(<RosterGrid board={makeParticipantBoard()} weekHasNoShifts={false} {...baseProps} />)
    expect(plain.container.firstElementChild?.className).not.toContain('2*var(--control-h)')
  })
})

describe('RosterGrid frame under an error notice (finish review fix 5)', () => {
  it('takes the notice the page reports (--roster-notice-h) off its height, with and without the strip', () => {
    const { container, unmount } = renderGrid(<RosterGrid board={makeParticipantBoard()} weekHasNoShifts={false} draggable {...baseProps} />)
    expect(container.firstElementChild?.className).toContain('var(--roster-notice-h,0px)')
    unmount()
    const plain = renderGrid(<RosterGrid board={makeParticipantBoard()} weekHasNoShifts={false} {...baseProps} />)
    expect(plain.container.firstElementChild?.className).toContain('var(--roster-notice-h,0px)')
  })
})

describe('RosterGrid frame under a wrapped toolbar (finish review, 1280)', () => {
  it('takes the extra toolbar row the page reports (--roster-toolbar-extra) off its height, with and without the strip', () => {
    const { container, unmount } = renderGrid(<RosterGrid board={makeParticipantBoard()} weekHasNoShifts={false} draggable {...baseProps} />)
    expect(container.firstElementChild?.className).toContain('var(--roster-toolbar-extra,0px)')
    unmount()
    const plain = renderGrid(<RosterGrid board={makeParticipantBoard()} weekHasNoShifts={false} {...baseProps} />)
    expect(plain.container.firstElementChild?.className).toContain('var(--roster-toolbar-extra,0px)')
  })
})

describe('RosterGrid: the regular (2026-10-16)', () => {
  it('hands "Make … the regular" up from staff and participant rows, never from the Unfilled lane', async () => {
    const user = userEvent.setup()
    const kim = makeShift({ id: 'kim', staffId: 'staff-1', staffName: 'Kim Lee', shiftPatternId: 'pat-1' })
    const open = makeUnfilledShift({ id: 'open', serviceDate: '2026-08-18', shiftPatternId: 'pat-2' })
    for (const board of [
      makeStaffBoard({ staffRows: [makeStaffRow({ staffId: 'staff-1', fullName: 'Kim Lee', shifts: [kim] })], unfilled: [open] }),
      makeParticipantBoard({ participantRows: [makeParticipantRow({ shifts: [kim] })] }),
    ]) {
      const onSetRegular = vi.fn()
      const { container, unmount } = renderGrid(<RosterGrid board={board} weekHasNoShifts={false} {...baseProps} onSetRegular={onSetRegular} />)
      await user.click(within(container.querySelector('[data-shift-chip="kim"]') as HTMLElement).getByRole('button', { name: /^Actions for/ }))
      await user.click(screen.getByRole('option', { name: 'Make Kim the regular' }))
      expect(onSetRegular).toHaveBeenCalledWith(kim)
      const lane = container.querySelector('[data-shift-chip="open"]')
      if (lane) {
        await user.click(within(lane as HTMLElement).getByRole('button', { name: /^Actions for/ }))
        expect(screen.queryByRole('option', { name: /the regular$/ })).not.toBeInTheDocument()
      }
      unmount()
    }
  })
})
