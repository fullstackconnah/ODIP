import { describe, it, expect, vi } from 'vitest'
import { render, screen, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { ShiftChip } from './ShiftChip'
import { formatShiftTimeRange } from '../lib/roster'
import { makeShift, makeFinding } from '../test-fixtures'

function noop() {}

/** ShiftChip now renders participant/staff name Links, which need a Router ancestor. */
function renderChip(ui: React.ReactElement): RenderResult {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

/**
 * "Open" button accessible name is "<time range>, <name>", which unhelpfully overlaps with
 * "Drag to move <participant name>'s shift" and "Actions for <participant name>'s shift" if matched
 * on the name alone — so match on the leading time text, which only the open button carries.
 */
function getOpenButton(shift: ReturnType<typeof makeShift>) {
  return screen.getByRole('button', { name: new RegExp(`^${formatShiftTimeRange(shift.startTime, shift.endTime)}`) })
}

describe('ShiftChip severity marker', () => {
  it('renders the blocking marker keyed off severity, never a specific finding code', () => {
    const shift = makeShift({ findings: [makeFinding({ code: 'ANYTHING_AT_ALL', severity: 'Blocking' })] })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.getByRole('img', { name: /1 blocking issue/i })).toBeInTheDocument()
  })

  it('renders a different (warning) marker when only Warning findings are present', () => {
    const shift = makeShift({ findings: [makeFinding({ code: 'SOME_OTHER_CODE', severity: 'Warning' })] })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const marker = screen.getByRole('img', { name: /1 warning/i })
    expect(marker).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /blocking/i })).not.toBeInTheDocument()
  })

  it('states both severity and count in the accessible name for a mix of findings', () => {
    const shift = makeShift({
      findings: [
        makeFinding({ code: 'A', severity: 'Blocking' }),
        makeFinding({ code: 'B', severity: 'Warning' }),
        makeFinding({ code: 'C', severity: 'Warning' }),
      ],
    })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.getByRole('img', { name: '1 blocking issue, 2 warnings' })).toBeInTheDocument()
  })

  it('renders no marker at all when there are no findings', () => {
    const shift = makeShift({ findings: [] })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.queryByRole('img', { name: /blocking|warning/i })).not.toBeInTheDocument()
  })
})

describe('ShiftChip open button vs drag handle', () => {
  it('is a separate element from the drag handle', () => {
    const shift = makeShift()
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const openButton = getOpenButton(shift)
    const dragHandle = screen.getByRole('button', { name: /drag to move/i })
    expect(openButton).not.toBe(dragHandle)
  })

  it('calls onOpen (and only onOpen) when Enter is pressed on the open button', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const shift = makeShift()
    renderChip(<ShiftChip shift={shift} canWrite onOpen={onOpen} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const openButton = getOpenButton(shift)
    openButton.focus()
    await user.keyboard('{Enter}')

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(shift)
    // The regression this guards: dnd-kit's KeyboardSensor used to share this button's
    // listeners and would flip into a drag (opacity-50 while isDragging) instead of opening.
    expect(openButton.closest('[class*="opacity-50"]')).not.toBeInTheDocument()
  })

  it('calls onOpen when the open button is clicked', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const shift = makeShift()
    renderChip(<ShiftChip shift={shift} canWrite onOpen={onOpen} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(getOpenButton(shift))
    expect(onOpen).toHaveBeenCalledWith(shift)
  })
})

describe('ShiftChip menu', () => {
  it('offers Edit, Assign to…, Unassign and Delete when the shift has an assigned staff member', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: 'staff-1' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Reassign to…' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Unassign' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Delete' })).toBeInTheDocument()
  })

  it('omits Unassign for an unfilled (dashed) chip with no staff, but keeps Edit/Assign/Delete', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: null, staffName: null })
    renderChip(<ShiftChip shift={shift} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Assign to…' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Unassign' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('ShiftChip read-only (canWrite false)', () => {
  it('renders no menu and no drag handle', () => {
    const shift = makeShift()
    renderChip(<ShiftChip shift={shift} canWrite={false} onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
  })

  it('still renders the open button so the shift can be viewed', () => {
    const shift = makeShift()
    renderChip(<ShiftChip shift={shift} canWrite={false} onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(getOpenButton(shift)).toBeInTheDocument()
  })
})

describe('ShiftChip on-leave state', () => {
  it('renders an "On leave" mini-label with an explanatory title for a filled shift whose assignee has approved leave', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: true })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const label = screen.getByText('On leave')
    expect(label).toBeInTheDocument()
    expect(label).toHaveAttribute('title', expect.stringContaining('approved leave'))
  })

  it('renders a dashed border for a filled shift whose assignee has approved leave, same as an unfilled chip', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: true })
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(container.querySelector('.border-dashed')).not.toBeNull()
  })

  it('does not render the "On leave" label or a dashed border for a normal filled shift', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: false })
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.queryByText('On leave')).not.toBeInTheDocument()
    expect(container.querySelector('.border-dashed')).toBeNull()
  })

  it('ignores assigneeOnApprovedLeave for an unfilled chip (no staffId) — it never applies to a hole that is already open', () => {
    const shift = makeShift({ staffId: null, staffName: null, assigneeOnApprovedLeave: true })
    renderChip(<ShiftChip shift={shift} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.queryByText('On leave')).not.toBeInTheDocument()
  })
})

describe('ShiftChip cross-domain links', () => {
  it('links the participant name to their participant page', () => {
    const shift = makeShift({ participantId: 'participant-9', participantName: 'Mia Chen' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/participant-9')
  })

  it('links the staff name to their staff detail page when the shift is filled (participant-row chip)', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera' })
    renderChip(<ShiftChip shift={shift} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-9')
  })

  it('renders no staff link for an unfilled (dashed) chip', () => {
    const shift = makeShift({ staffId: null, staffName: null })
    renderChip(<ShiftChip shift={shift} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    // Only the participant link should exist — no staff name to link.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('clicking the participant link navigates without also opening the shift slide-over', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const shift = makeShift({ participantId: 'participant-9', participantName: 'Mia Chen' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={onOpen} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('link', { name: 'Mia Chen' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('clicking the staff link navigates without also opening the shift slide-over (participant-row chip)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera' })
    renderChip(<ShiftChip shift={shift} canWrite context="participant" onOpen={onOpen} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('link', { name: 'Alex Rivera' }))
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('ShiftChip one-line label', () => {
  it('reads time, then a separator, then the participant name in a staff row — and repeats no staff name', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: 'staff-9', staffName: 'Alex Rivera', startTime: '19:00:00', endTime: '07:00:00', endsNextDay: true })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const openButton = getOpenButton(shift)
    // Visible text is "7pm–7am · Grace Palmer": time, then the separator, then the name.
    expect(openButton).toHaveTextContent(/7pm–7am.*·.*Grace Palmer/)
    // The separator is decorative (aria-hidden), so the accessible name uses a comma instead of "middle dot".
    expect(openButton).toHaveAccessibleName(/^7pm–7am \(ends the next day\)\s*, Grace Palmer$/)
    // The row header already names the staff member, so the chip carries no second line for them.
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Alex Rivera' })).not.toBeInTheDocument()
  })

  it('names the covering staff member instead of repeating the participant in a participant row', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: 'staff-9', staffName: 'Alex Rivera', startTime: '19:00:00', endTime: '07:00:00' })
    renderChip(<ShiftChip shift={shift} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(getOpenButton(shift)).toHaveTextContent(/7pm–7am.*·.*Alex Rivera/)
    expect(screen.queryByText('Grace Palmer')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Grace Palmer' })).not.toBeInTheDocument()
    // The shift still belongs to the participant for the drag handle and the actions menu.
    expect(screen.getByRole('button', { name: "Drag to move Grace Palmer's shift" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Actions for Grace Palmer's shift" })).toBeInTheDocument()
  })

  it('reads "Unfilled" (as plain text, not a link) for an unfilled shift in a participant row', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: null, staffName: null })
    renderChip(<ShiftChip shift={shift} canWrite dashed context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByText('Unfilled')).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('is one line at row-h minus 6px, so it grows with the density token under a coarse pointer', () => {
    const shift = makeShift()
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(container.firstElementChild).toHaveClass('h-[calc(var(--row-h)_-_6px)]')
  })
})
