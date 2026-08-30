import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftChip } from './ShiftChip'
import { formatShiftTimeRange } from '../lib/roster'
import { makeShift, makeFinding } from '../test-fixtures'

function noop() {}

/**
 * "Open" button accessible name is "<time range><participant name>" with no separator, which
 * unhelpfully overlaps with "Drag to move <participant name>'s shift" and "Actions for
 * <participant name>'s shift" if matched on the name alone — so match on the leading time text,
 * which only the open button carries.
 */
function getOpenButton(shift: ReturnType<typeof makeShift>) {
  return screen.getByRole('button', { name: new RegExp(`^${formatShiftTimeRange(shift.startTime, shift.endTime)}`) })
}

describe('ShiftChip severity marker', () => {
  it('renders the blocking marker keyed off severity, never a specific finding code', () => {
    const shift = makeShift({ findings: [makeFinding({ code: 'ANYTHING_AT_ALL', severity: 'Blocking' })] })
    render(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.getByRole('img', { name: /1 blocking issue/i })).toBeInTheDocument()
  })

  it('renders a different (warning) marker when only Warning findings are present', () => {
    const shift = makeShift({ findings: [makeFinding({ code: 'SOME_OTHER_CODE', severity: 'Warning' })] })
    render(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
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
    render(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.getByRole('img', { name: '1 blocking issue, 2 warnings' })).toBeInTheDocument()
  })

  it('renders no marker at all when there are no findings', () => {
    const shift = makeShift({ findings: [] })
    render(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.queryByRole('img', { name: /blocking|warning/i })).not.toBeInTheDocument()
  })
})

describe('ShiftChip open button vs drag handle', () => {
  it('is a separate element from the drag handle', () => {
    const shift = makeShift()
    render(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const openButton = getOpenButton(shift)
    const dragHandle = screen.getByRole('button', { name: /drag to move/i })
    expect(openButton).not.toBe(dragHandle)
  })

  it('calls onOpen (and only onOpen) when Enter is pressed on the open button', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const shift = makeShift()
    render(<ShiftChip shift={shift} canWrite onOpen={onOpen} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

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
    render(<ShiftChip shift={shift} canWrite onOpen={onOpen} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(getOpenButton(shift))
    expect(onOpen).toHaveBeenCalledWith(shift)
  })
})

describe('ShiftChip menu', () => {
  it('offers Edit, Assign to…, Unassign and Delete when the shift has an assigned staff member', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: 'staff-1' })
    render(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Reassign to…' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Unassign' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Delete' })).toBeInTheDocument()
  })

  it('omits Unassign for an unfilled (dashed) chip with no staff, but keeps Edit/Assign/Delete', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: null, staffName: null })
    render(<ShiftChip shift={shift} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

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
    render(<ShiftChip shift={shift} canWrite={false} onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
  })

  it('still renders the open button so the shift can be viewed', () => {
    const shift = makeShift()
    render(<ShiftChip shift={shift} canWrite={false} onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(getOpenButton(shift)).toBeInTheDocument()
  })
})
