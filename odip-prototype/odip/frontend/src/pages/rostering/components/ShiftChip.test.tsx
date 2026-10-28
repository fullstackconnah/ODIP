import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup, within, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { ShiftChip, type ShiftChipProps } from './ShiftChip'
import { formatShiftTimeRange } from '../lib/roster'
import { DropStateContext, type DropState } from '../lib/rosterDrag'
import { makeShift, makeFinding, makeUnfilledShift } from '../test-fixtures'
import { ON_TINT } from '@/lib/tone'
import type { ShiftDto } from '@/api/types'

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

  it('hangs off the tray\'s top-right corner, clear of the header, and the chip makes room for it above', () => {
    const shift = makeShift({ findings: [makeFinding({ severity: 'Warning' })] })
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const marker = screen.getByRole('img', { name: '1 warning' })
    expect(marker.parentElement).toBe(container.querySelector('[data-shift-chip]'))
    // A 12px box 10px above the padding edge (the tray's 1px border included), so it ends 3px into the tray, where the header line starts.
    expect(marker).toHaveClass('absolute', 'pointer-events-none', '-top-[10px]', '-right-1.5', 'h-3', 'w-3')
    expect(marker.parentElement).toHaveClass('my-2')
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
    renderChip(<ShiftChip shift={shift} canWrite draggable onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
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
  it('offers Edit, Replace {first name}…, Remove {first name} and Delete when the shift has an assigned staff member', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: 'staff-1' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Replace Alex…' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Remove Alex' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Delete' })).toBeInTheDocument()
  })

  it('omits Remove for an unfilled (dashed) chip with no staff, but keeps Edit/Assign/Delete', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ staffId: null, staffName: null })
    renderChip(<ShiftChip shift={shift} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Assign to…' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('ShiftChip menu: Delete on locked shifts', () => {
  // A started or finished shift has a completion behind it, so the server refuses its Delete (409): the menu does not offer it. A cancelled shift can still go.
  it.each(['InProgress', 'PendingReview', 'Completed'] as const)('does not offer Delete on a %s shift, and still offers Edit', async status => {
    const user = userEvent.setup()
    renderChip(<ShiftChip shift={makeShift({ staffId: 'staff-1', status })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
    expect(screen.getByRole('option', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('still offers Delete on a cancelled shift', async () => {
    const user = userEvent.setup()
    renderChip(<ShiftChip shift={makeShift({ staffId: 'staff-1', status: 'Cancelled' })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    await user.click(screen.getByRole('button', { name: /actions for/i }))
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

  it('dashes the person box, never the tray, for a filled shift whose assignee has approved leave, same as an unfilled chip', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: true })
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    // The shift exists, so the tray is solid; the hole is in the box (the chip brief, section 1).
    expect(container.querySelector('[data-shift-box]')).toHaveClass('border-dashed')
    expect(container.querySelectorAll('.border-dashed')).toHaveLength(1)
  })

  it('dashes the box of a Needs staff chip too, and never the tray', () => {
    const { container } = renderChip(<ShiftChip shift={makeUnfilledShift()} canWrite dashed context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(container.querySelector('[data-shift-box]')).toHaveClass('border-dashed')
    expect(container.querySelector('[data-shift-chip]')).not.toHaveClass('border-dashed')
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

    expect(screen.getByRole('link', { name: 'Mia Chen' })).toHaveAttribute('href', '/participants/participant-9?tab=people&section=week&week=2026-08-17')
  })

  it('links the staff name to their staff detail page when the shift is filled (participant-row chip)', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera' })
    renderChip(<ShiftChip shift={shift} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toHaveAttribute('href', '/staff/staff-9?tab=week&week=2026-08-17')
  })

  // Roster week shots (SHAPE §8.5): a 20px name link is 44px tall under a coarse pointer, as a block line so it still truncates. It stops growing there (flex-initial), so a tap past the name still opens the shift;
  // the fine pointer keeps flex-1, and the first tail marker takes the trailing edge the link used to push it to.
  it('gives both name links a 44px line that covers only the name under a coarse pointer', () => {
    renderChip(<ShiftChip shift={makeShift({ overrideReason: 'Covering a gap' })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const link = screen.getByRole('link', { name: 'Mia Chen' })
    expect(link).toHaveClass('truncate', 'min-w-0', 'flex-1', 'pointer-coarse:flex-initial', 'pointer-coarse:leading-[var(--tap-min)]')
    expect(link.parentElement).toHaveClass('pointer-coarse:[&>a+span]:ml-auto')
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

describe('ShiftChip tray and box', () => {
  it('reads time, then the participant name in a staff row — and repeats no staff name', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: 'staff-9', staffName: 'Alex Rivera', startTime: '19:00:00', endTime: '07:00:00', endsNextDay: true })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const openButton = getOpenButton(shift)
    // The time heads the tray and the name sits in the box under it: no separator between them.
    expect(openButton).toHaveTextContent(/7pm–7am.*Grace Palmer/)
    expect(openButton).not.toHaveTextContent('·')
    expect(openButton).toHaveAccessibleName(/^7pm–7am \(ends the next day\)\s*, Grace Palmer, Ad hoc: not from an agreement or a pattern, Published$/)
    // The row header already names the staff member, so the chip carries no second line for them.
    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Alex Rivera' })).not.toBeInTheDocument()
  })

  it('names the covering staff member instead of repeating the participant in a participant row', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: 'staff-9', staffName: 'Alex Rivera', startTime: '19:00:00', endTime: '07:00:00' })
    renderChip(<ShiftChip shift={shift} canWrite context="participant" draggable onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(getOpenButton(shift)).toHaveTextContent(/7pm–7am.*Alex Rivera/)
    expect(screen.queryByText('Grace Palmer')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Grace Palmer' })).not.toBeInTheDocument()
    // The grip carries the PERSON (roster drag and drop); the actions menu still names the participant's shift.
    expect(screen.getByRole('button', { name: 'Drag to move Alex Rivera to another shift or day' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Actions for Grace Palmer's shift" })).toBeInTheDocument()
  })

  it('reads "Needs staff" (as plain text, not a link) for an unfilled shift in a participant row', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: null, staffName: null })
    renderChip(<ShiftChip shift={shift} canWrite dashed context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByText('Needs staff')).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('is a tray of two rows, the header over a --control-h box: 32px with a mouse, 44px under a coarse pointer', () => {
    const shift = makeShift()
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const tray = container.firstElementChild as HTMLElement
    expect(tray).toHaveAttribute('data-shift-chip', shift.id)
    expect(tray).toHaveClass('grid', 'grid-rows-[auto_var(--control-h)]', 'gap-y-0.5', 'p-0.5', 'border-border', 'bg-surface-container-low')
    // jsdom has no layout, so the classes are the evidence; the captures measure 56px and 68px.
    const box = tray.querySelector('[data-shift-box]') as HTMLElement
    expect(box).toHaveClass('border', 'rounded-[calc(var(--radius-sm)_-_2px)]')
    // The open control spans both rows, so it holds the header and the box (the brief, section 2.1).
    expect(getOpenButton(shift)).toContainElement(box)
    expect(getOpenButton(shift)).toHaveClass('col-span-full', 'row-[1/span_2]', 'grid-cols-subgrid', 'grid-rows-subgrid')
  })

  it('gives the grip a 44px hit area under a coarse pointer, kept inside the chip and off the open control (post-merge review N6)', () => {
    renderChip(<ShiftChip shift={makeShift()} canWrite draggable onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const grip = screen.getByRole('button', { name: /^Drag to move/ })
    // The house TAP_AREA pad (a transparent ::before, 44px under coarse, the grip's own box with a mouse) ...
    expect(grip).toHaveClass('relative', 'before:min-w-[var(--tap-min)]', 'before:min-h-[var(--tap-min)]')
    // ... reaches 13px past each side of the 18px grip, so a coarse-only margin keeps that pad inside the chip and off the time and name beside it.
    expect(grip).toHaveClass('pointer-coarse:mx-[13px]')
  })

  it('keeps the grip and the menu out of the open control: siblings layered over the box row, in the order lead, open, menu', () => {
    const shift = makeShift()
    renderChip(<ShiftChip shift={shift} canWrite draggable context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const open = getOpenButton(shift)
    const grip = screen.getByRole('button', { name: /^Drag to move/ })
    const menu = screen.getByRole('button', { name: /^Actions for/ })
    expect(open).not.toContainElement(grip)
    expect(open).not.toContainElement(menu)
    expect(grip.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(open.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(grip).toHaveClass('row-start-2', 'col-start-1')
  })

  it('puts the name in the box, in foreground ink', () => {
    const shift = makeShift({ staffName: 'Kim Lee' })
    const { container } = renderChip(<ShiftChip shift={shift} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const link = screen.getByRole('link', { name: 'Kim Lee' })
    expect(container.querySelector('[data-shift-box]')).toContainElement(link)
    expect(link).toHaveClass('text-foreground', 'truncate')
  })
})

// Landing-spotted: at the board's native width a day column is 123-130px, and the time, the separator, the drag handle and the actions
// trigger left the name 0-5px: a one-letter link. Below 14rem the name now sits UNDER the time on its own line (the chip grows to two
// lines); from 14rem it is the one line "time · name" it was. jsdom cannot measure a container query, so the pixel result is covered by the
// Playwright roster screenshots; what is asserted here is what stays true at every width: the whole name is in the document and reachable, in
// reading order after the time, with the decoration kept out of what a screen reader announces.
describe('ShiftChip keeps the name readable in a narrow day column', () => {
  it('puts the whole name after the time in reading order, as a link whose whole text stays in the document when the visible text is truncated', () => {
    const shift = makeShift({ participantName: "Jack O'Sullivan", participantId: 'participant-7' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const time = screen.getByText(formatShiftTimeRange(shift.startTime, shift.endTime))
    const link = screen.getByRole('link', { name: "Jack O'Sullivan" })
    expect(link).toHaveTextContent("Jack O'Sullivan")
    expect(link).toHaveAttribute('href', '/participants/participant-7?tab=people&section=week&week=2026-08-17')
    expect(time.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws no separator, since the name has a line of its own, and the open control announces time and name with a comma', () => {
    const shift = makeShift({ participantName: 'Grace Palmer' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.queryByText('·')).not.toBeInTheDocument()
    expect(getOpenButton(shift)).toHaveAccessibleName('9am–5pm, Grace Palmer, Ad hoc: not from an agreement or a pattern, Published')
  })

  it('keeps the name, the override mark and the on-leave marker together and apart from the time, so the markers never become a third line', () => {
    const shift = makeShift({ participantName: 'Grace Palmer', staffId: 'staff-9', staffName: 'Alex Rivera', overrideReason: 'Only cover available', assigneeOnApprovedLeave: true })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const nameRow = screen.getByRole('link', { name: 'Grace Palmer' }).parentElement as HTMLElement
    expect(nameRow).toContainElement(screen.getByRole('img', { name: /Assigned with an override/ }))
    expect(nameRow).toContainElement(screen.getByText('On leave'))
    expect(nameRow).not.toContainElement(screen.getByText(formatShiftTimeRange(shift.startTime, shift.endTime)))
  })

  it('carries the full name in the link title, so a truncated name can still be read on hover', () => {
    const shift = makeShift({ participantName: 'Grace Palmer-Hughes' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const link = screen.getByRole('link', { name: 'Grace Palmer-Hughes' })
    expect(link).toHaveAttribute('title', 'Grace Palmer-Hughes')
    expect(link).toHaveTextContent('Grace Palmer-Hughes')
  })
})

describe('ShiftChip sub-text is announced, never clipped', () => {
  it('spells the next-day note, ratio, override and on-leave state out in the open control\'s accessible name, severity first', () => {
    const shift = makeShift({
      participantName: 'Grace Palmer-Hughes',
      staffId: 'staff-9',
      staffName: 'Mei Zhang',
      startTime: '19:00:00',
      endTime: '07:00:00',
      endsNextDay: true,
      ratio: 'TwoToOne',
      overrideReason: 'Only cover available',
      assigneeOnApprovedLeave: true,
      findings: [makeFinding({ severity: 'Blocking' })],
    })
    renderChip(<ShiftChip shift={shift} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByRole('button', { name: /^1 blocking issue, 7pm–7am/ })).toHaveAccessibleName(
      '1 blocking issue, 7pm–7am (ends the next day), Mei Zhang, Ad hoc: not from an agreement or a pattern, 2:1 ratio, Assigned with an override: Only cover available, On leave, Published',
    )
  })

  it('names "Needs staff" in a participant row and the participant in a staff row, in the accessible name too', () => {
    const unfilled = makeShift({ participantName: 'Grace Palmer', staffId: null, staffName: null })
    const { unmount } = renderChip(<ShiftChip shift={unfilled} canWrite dashed context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(getOpenButton(unfilled)).toHaveAccessibleName('9am–5pm, Needs staff, Ad hoc: not from an agreement or a pattern, Published')
    unmount()

    const staffRow = makeShift({ participantName: 'Grace Palmer' })
    renderChip(<ShiftChip shift={staffRow} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(getOpenButton(staffRow)).toHaveAccessibleName('9am–5pm, Grace Palmer, Ad hoc: not from an agreement or a pattern, Published')
  })

  it('draws no visually-hidden text: an sr-only span is a 1px clip box whose text overflows it, i.e. clipped without an ellipsis', () => {
    const shift = makeShift({
      staffId: 'staff-9',
      staffName: 'Mei Zhang',
      startTime: '19:00:00',
      endTime: '07:00:00',
      endsNextDay: true,
      ratio: 'OneToTwo',
      assigneeOnApprovedLeave: true,
    })
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(container.querySelector('.sr-only')).toBeNull()
    // The next-day note still reaches sighted users on hover.
    expect(screen.getByText('7pm–7am')).toHaveAttribute('title', '7pm–7am — ends the next day')
  })

  it('shows "On leave" in words only once the chip is 15rem wide; below that the words are display:none, not a clipped fragment', () => {
    const shift = makeShift({ staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: true })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const words = screen.getByText('On leave')
    expect(words).toHaveClass('hidden', '@[15rem]:inline')
    expect(words).not.toHaveClass('sr-only')
    // The icon beside it carries the same explanation on hover, and the whole chip does too.
    expect(words.parentElement).toHaveAttribute('title', expect.stringContaining('approved leave'))
    expect(words.closest('[class*="@container"]')).toHaveAttribute('title', expect.stringContaining('approved leave'))
  })

  it('keeps the actions trigger a --control-h-sm square at --radius-sm (Button iconOnly geometry), not Dropdown\'s 26px rounded-lg', () => {
    renderChip(<ShiftChip shift={makeShift()} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const trigger = screen.getByRole('button', { name: /actions for/i })
    // Dropdown's icon variant hard-codes p-1.5 rounded-lg and takes no className, so the geometry is applied to
    // the trigger by the wrapper around it. Both class lists are asserted so the override can't silently rot.
    const wrapper = trigger.parentElement?.parentElement as HTMLElement
    for (const cls of [
      '[&_button]:h-[var(--control-h-sm)]',
      '[&_button]:w-[var(--control-h-sm)]',
      '[&_button]:p-0',
      '[&_button]:rounded-[var(--radius-sm)]',
    ]) expect(wrapper).toHaveClass(cls)
  })
})

describe('ShiftChip over-budget marker (budget phase 3)', () => {
  const emergency = () => makeShift({
    overrideReason: 'Emergency or safety: Participant unsafe at home tonight',
    acknowledgedFindingCodes: ['BUDGET_EMERGENCY'],
    budgetReview: { state: 'Pending' },
  })

  it('marks an emergency shift with the words "Over budget: emergency", and says the review is pending', () => {
    renderChip(<ShiftChip shift={emergency()} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const marker = screen.getByRole('img', { name: /Over budget: emergency/ })
    expect(marker).toHaveAttribute('title', expect.stringContaining('Over budget: emergency'))
    expect(marker).toHaveAttribute('title', expect.stringContaining('Admin review pending'))
    expect(marker).toHaveAttribute('data-budget-marker', 'emergency')
  })

  it('marks an Admin override with its own words, and no review to wait for', () => {
    const shift = makeShift({ overrideReason: 'Client carer is in hospital', acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const marker = screen.getByRole('img', { name: /Over budget: Admin override/ })
    expect(marker).toHaveAttribute('data-budget-marker', 'adminOverride')
    expect(marker.getAttribute('title')).not.toMatch(/review/i)
  })

  it('says it in the open control\'s accessible name too, in place of the generic override line, so one mark is not announced twice', () => {
    const shift = emergency()
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    const name = getOpenButton(shift).getAttribute('aria-label')!
    expect(name).toContain('Over budget: emergency, Admin review pending')
    expect(name).not.toContain('Assigned with an override')
    expect(screen.queryByRole('img', { name: /Assigned with an override/ })).not.toBeInTheDocument()
  })

  it('draws no budget marker for a plain override, a warning-only shift, or codes the server did not acknowledge', () => {
    renderChip(<ShiftChip shift={makeShift({ overrideReason: 'Only cover available' })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.queryByRole('img', { name: /Over budget/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Assigned with an override/ })).toBeInTheDocument()   // the generic mark is unchanged
  })

  it('does not take a marker from the reason\'s words', () => {
    renderChip(<ShiftChip shift={makeShift({ overrideReason: 'Emergency or safety: typed by hand', acknowledgedFindingCodes: ['BUDGET_APPROACHING'] })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.queryByRole('img', { name: /Over budget/ })).not.toBeInTheDocument()
  })

  it('reads a reviewed emergency as reviewed', () => {
    const shift = makeShift({ ...emergency(), budgetReview: { state: 'Reviewed', reviewedOn: '2026-10-05' } })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByRole('img', { name: /Over budget: emergency/ })).toHaveAttribute('title', expect.stringContaining('Reviewed'))
  })

  // The phase 3 design review, H1: a 12 px shield in the name row was unreadable at the board's 125 px chips, squeezed the label, and the Admin override looked like the generic override shield.
  describe('the disc on the chip’s corner (design review H1)', () => {
    const reviewed = () => makeShift({ ...emergency(), budgetReview: { state: 'Reviewed', reviewedOn: '2026-10-05' } })
    const adminOverride = () => makeShift({ overrideReason: 'Client carer is in hospital', acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] })
    const markerOf = (shift: ShiftDto) => {
      renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
      return screen.getByRole('img', { name: /Over budget/ })
    }
    const glyph = (marker: HTMLElement) => marker.querySelector('svg')!.getAttribute('class') ?? ''

    it('sits on the corner, out of the name row and out of the way of clicks, so the label never gives way to it', () => {
      const marker = markerOf(makeShift({ ...emergency(), participantName: 'Grace Palmer' }))

      const nameRow = screen.getByRole('link', { name: 'Grace Palmer' }).parentElement as HTMLElement
      expect(nameRow).not.toContainElement(marker)
      expect(marker).toHaveClass('absolute', 'pointer-events-none')
    })

    it('is a 20 px disc around a 16 px glyph: big enough to read at the board’s chip widths', () => {
      const marker = markerOf(emergency())

      expect(marker).toHaveClass('h-5', 'w-5')
      expect(marker.querySelector('svg')).toHaveClass('h-4', 'w-4')
    })

    it('draws a pending emergency as a round alarm in the warning pair', () => {
      const marker = markerOf(emergency())

      expect(marker).toHaveClass('rounded-full')
      expect(marker.className).toContain('--color-warning-container')
      expect(glyph(marker)).toContain('lucide-siren')
    })

    it('draws a reviewed emergency as a round tick in the success pair: a different glyph, not just a different colour', () => {
      const marker = markerOf(reviewed())

      expect(marker).toHaveClass('rounded-full')
      expect(marker.className).toContain('--color-primary-fixed')
      expect(glyph(marker)).toContain('lucide-check')
    })

    it('draws an Admin override as a rounded square key in the info pair: its own silhouette, and not the generic override shield', () => {
      const marker = markerOf(adminOverride())

      expect(marker).not.toHaveClass('rounded-full')
      expect(marker.className).toContain('--color-secondary-container')
      expect(glyph(marker)).toContain('lucide-key-round')
      expect(glyph(marker)).not.toContain('shield')
    })

    it('leaves the generic override mark as it was: a shield in the name row', () => {
      renderChip(<ShiftChip shift={makeShift({ overrideReason: 'Only cover available' })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

      expect(screen.getByRole('img', { name: /Assigned with an override/ }).querySelector('svg')!.getAttribute('class')).toContain('shield')
    })

    // The chip brief's tray (2026-10-15): the header line runs the tray's whole width and its time never clips, so the disc takes the bottom corner on every chip, beside the box's menu.
    it('takes the bottom corner, with or without a severity marker, so it never sits on the header line', () => {
      const plain = markerOf(emergency())
      expect(plain.className).toContain('-bottom-')
      expect(plain.className).not.toContain('-top-')
      cleanup()

      const withFindings = markerOf(makeShift({ ...emergency(), findings: [makeFinding({ severity: 'Warning' })] }))
      expect(withFindings.className).toContain('-bottom-')
      expect(withFindings.className).not.toContain('-top-')
    })

    it('makes room for the part of the disc that hangs off the chip, so the board’s sticky day header never cuts it (the first row sits right under it)', () => {
      const plain = markerOf(emergency())
      expect(plain.parentElement).toHaveClass('my-2')
      cleanup()

      const bottom = markerOf(makeShift({ ...emergency(), findings: [makeFinding({ severity: 'Warning' })] }))
      expect(bottom.parentElement).toHaveClass('my-2')
    })

    // Design review round 1 N1, code review N4: the disc is pointer-events-none (it must never take a click), so hit testing skips it and its own title never shows. The words are on the chip root, which is
    // what the pointer lands on, joined with the words of the other markers that apply.
    describe('the hover words (the disc cannot show its own title)', () => {
      const chipRoot = (marker: HTMLElement) => marker.parentElement as HTMLElement

      it('puts the budget marker’s words on the chip itself, with the reason, so hovering the disc shows them', () => {
        const marker = markerOf(emergency())

        expect(chipRoot(marker)).toHaveAttribute('title', 'Over budget: emergency, Admin review pending — Emergency or safety: Participant unsafe at home tonight\nPublished')
      })

      it('keeps the disc’s own aria-label and title: the words stay in the accessible name', () => {
        const marker = markerOf(emergency())

        expect(marker).toHaveAttribute('aria-label', 'Over budget: emergency, Admin review pending')
        expect(marker).toHaveAttribute('title', expect.stringContaining('Over budget: emergency'))
      })

      it('says every marker that applies, one to a line: on leave, the budget marker, and the severity marker', () => {
        const shift = makeShift({ ...adminOverride(), staffId: 'staff-9', staffName: 'Alex Rivera', assigneeOnApprovedLeave: true, findings: [makeFinding({ severity: 'Blocking' })] })
        const marker = markerOf(shift)

        const lines = chipRoot(marker).getAttribute('title')!.split('\n')
        expect(lines).toHaveLength(4)
        expect(lines[0]).toContain('has approved leave covering this shift')
        expect(lines[1]).toBe('Over budget: Admin override — Client carer is in hospital')
        expect(lines[2]).toBe('1 blocking issue')
        expect(lines[3]).toBe('Published')
      })

      it('says the severity marker’s words on the chip too, since that marker is pointer-events-none as well', () => {
        renderChip(<ShiftChip shift={makeShift({ findings: [makeFinding({ severity: 'Warning' })] })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

        expect(screen.getByText('9am–5pm').closest('[class*="@container"]')).toHaveAttribute('title', '1 warning\nPublished')
      })

      it("ends the hover title with the shift's state, even on a chip with no marker", () => {
        renderChip(<ShiftChip shift={makeShift({ status: 'Draft' })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

        expect(screen.getByText('9am–5pm').closest('[class*="@container"]')).toHaveAttribute('title', 'Draft')
      })
    })

    it('leaves the header its whole width: no pad for the disc', () => {
      const disc = markerOf(emergency())
      expect(disc.parentElement!.querySelector('[data-shift-source]')!.parentElement).toHaveClass('px-0.5')
    })

    it('adds no room to a chip with no marker', () => {
      renderChip(<ShiftChip shift={makeShift()} canWrite draggable onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

      const chip = screen.getByRole('button', { name: /^Drag to move/ }).parentElement as HTMLElement
      expect(chip).not.toHaveClass('my-2')
    })

    it('paints the full marker words in a dedicated wrapped row at every chip width', () => {
      const shift = makeShift({ ...emergency(), participantName: 'Grace Palmer' })
      const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

      const words = container.querySelector('[data-budget-marker-words]') as HTMLElement
      expect(words).toHaveTextContent('Over budget: emergency')
      expect(words).not.toHaveClass('hidden', 'invisible', 'sr-only')
      expect(words).not.toHaveAttribute('aria-hidden')
      expect(words).toHaveClass('row-start-3', 'whitespace-normal', 'break-words', 'text-xs', 'leading-4')
      expect(words.parentElement).toBe(getOpenButton(shift))
      // The explicit control name includes the complete marker once. Because it is an aria-labeled control,
      // its visible child text does not become a second copy in the accessible name; the disc also retains
      // its own full marker label as required by the design.
      const name = getOpenButton(shift).getAttribute('aria-label')!
      expect(name.match(/Over budget: emergency/g)).toHaveLength(1)
      expect(screen.getByRole('img', { name: /Over budget: emergency/ })).toHaveAttribute('aria-label', 'Over budget: emergency, Admin review pending')
    })

    it('paints the Admin override words in the same dedicated row and keeps its accessible name exact once', () => {
      const shift = makeShift({ overrideReason: 'Client carer is in hospital', acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] })
      const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

      const words = container.querySelector('[data-budget-marker-words]') as HTMLElement
      expect(words).toHaveTextContent('Over budget: Admin override')
      expect(words).not.toHaveClass('hidden', 'invisible', 'sr-only')
      expect(words).not.toHaveAttribute('aria-hidden')
      expect(words).toHaveClass('row-start-3', 'whitespace-normal', 'break-words')
      const name = getOpenButton(shift).getAttribute('aria-label')!
      expect(name.match(/Over budget: Admin override/g)).toHaveLength(1)
      expect(screen.getByRole('img', { name: 'Over budget: Admin override' })).toBeInTheDocument()
    })

  })
})

describe('ShiftChip in the Participant view with drag and drop (draggable)', () => {
  const chip = (shift: ShiftDto, extra: Partial<ShiftChipProps> = {}) =>
    renderChip(<ShiftChip shift={shift} canWrite context="participant" draggable onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} {...extra} />)

  it('gives a filled, unlocked puck a grip that moves the person, apart from the open control', () => {
    const shift = makeShift({ staffName: 'Sam Wilson' })
    chip(shift)
    expect(screen.getByRole('button', { name: 'Drag to move Sam Wilson to another shift or day' })).not.toBe(getOpenButton(shift))
  })

  it('gives a Needs staff puck no grip, and says "Needs staff"', () => {
    chip(makeUnfilledShift({ status: 'Draft' }), { dashed: true })
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
    expect(screen.getByText('Needs staff')).toBeInTheDocument()
  })

  it.each([['Completed', 'Completed'], ['InProgress', 'In progress'], ['PendingReview', 'Pending review'], ['Cancelled', 'Cancelled']] as const)(
    'shows a lock and no grip on a %s shift', (status, words) => {
      const { container } = chip(makeShift({ status }))
      expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
      expect(container.querySelector(`[title="${words}: can't be changed here"]`)).not.toBeNull()
    },
  )

  it("strikes through a cancelled shift's time", () => {
    chip(makeShift({ status: 'Cancelled' }))
    expect(screen.getByText('9am–5pm')).toHaveClass('line-through')
  })

  it('marks every shift with where it came from: Scheduled (an agreement or a pattern) or Ad hoc, titled and named by it', () => {
    const fromAgreement = makeShift({ id: 'a', shiftPatternId: 'pat-1', fromAgreement: true, sourceDraftVersion: 3, status: 'Draft' })
    const agreed = chip(fromAgreement)
    expect(agreed.container.querySelector('[data-shift-source="agreed"]')).toHaveAttribute('title', 'From agreement v3')
    expect(within(agreed.container.querySelector('[data-shift-source="agreed"]') as HTMLElement).getByText('Scheduled')).toBeInTheDocument()
    expect(getOpenButton(fromAgreement)).toHaveAccessibleName('9am–5pm, Alex Rivera, Scheduled, From agreement v3, Draft')
    agreed.unmount()

    const fromPattern = makeShift({ id: 'b', shiftPatternId: 'pat-2', status: 'Draft' })
    const handMade = chip(fromPattern)
    expect(handMade.container.querySelector('[data-shift-source="pattern"]')).toHaveAttribute('title', 'From a pattern')
    expect(within(handMade.container.querySelector('[data-shift-source="pattern"]') as HTMLElement).getByText('Scheduled')).toBeInTheDocument()
    // The visible word is in the name too (WCAG 2.5.3), just before the title that tells an agreement from a pattern. Ad hoc's title already starts with its word.
    expect(getOpenButton(fromPattern)).toHaveAccessibleName('9am–5pm, Alex Rivera, Scheduled, From a pattern, Draft')
    handMade.unmount()

    const oneOff = makeShift({ id: 'c', status: 'Draft' })
    const adHoc = chip(oneOff)
    expect(adHoc.container.querySelector('[data-shift-source="adhoc"]')).toHaveAttribute('title', 'Ad hoc: not from an agreement or a pattern')
    expect(getOpenButton(oneOff)).toHaveAccessibleName('9am–5pm, Alex Rivera, Ad hoc: not from an agreement or a pattern, Draft')
  })

  it('draws the mark whole or not at all, after a time that never gives way (the brief, section 5)', () => {
    const { container } = chip(makeShift({ shiftPatternId: 'pat-1', fromAgreement: true }))
    const mark = container.querySelector('[data-shift-source]') as HTMLElement
    // A clipped one-line box that wraps: the zero-width first item holds the line, so a glyph or word that does not fit wraps out of sight instead of showing a sliver.
    expect(mark).toHaveClass('h-4', 'flex-wrap', 'gap-y-4', 'overflow-hidden')
    expect(mark.firstElementChild).toHaveClass('w-0')
    expect(screen.getByText('9am–5pm')).toHaveClass('shrink-0', 'font-medium', 'tabular-nums', 'text-foreground')
    // The header: one 16px line of 12px text, 4px in from the tray's inner edge, the label right-aligned after the time (the chip brief, section 2.2).
    const header = screen.getByText('9am–5pm').parentElement as HTMLElement
    expect(header).toHaveClass('h-4', 'text-xs', 'px-0.5', 'col-span-full')
    expect(header).toContainElement(mark)
    expect(mark).toHaveClass('justify-end', 'flex-1', 'min-w-0')
  })

  it("ends the accessible name and the hover title with the shift's state", () => {
    const shift = makeShift({ status: 'Draft' })
    const { container } = chip(shift)
    expect(getOpenButton(shift)).toHaveAccessibleName('9am–5pm, Alex Rivera, Ad hoc: not from an agreement or a pattern, Draft')
    expect(container.firstElementChild?.getAttribute('title')).toMatch(/Draft$/)
  })

  it('shows the pending look: the target reads "Assigning Sam…" and is busy, the source fades, and its grip waits', () => {
    const target = makeUnfilledShift({ id: 'to', status: 'Draft' })
    const source = makeShift({ id: 'from', staffId: 'staff-2', staffName: 'Sam Wilson' })
    const { container } = renderChip(
      <DropStateContext.Provider value={{ disabled: true, pending: { targetId: 'to', sourceId: 'from', staffName: 'Sam Wilson' } }}>
        <ShiftChip shift={target} canWrite context="participant" draggable dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />
        <ShiftChip shift={source} canWrite context="participant" draggable onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />
      </DropStateContext.Provider>,
    )
    expect(container.querySelector('[aria-busy="true"]')).toHaveTextContent('Assigning Sam…')
    // No action can run during the write, so the busy chip drops its actions menu and the label takes its room (finish review fix 2: "Assigning K…" at 1440).
    expect(container.querySelector('[aria-busy="true"] button[aria-label^="Actions for"]')).toBeNull()
    expect(container.querySelector('[aria-busy="true"] [data-shift-open]')).toHaveAccessibleName(/Assigning Sam…/)
    expect(container.querySelector('[data-shift-open="from"]')?.parentElement).toHaveClass('opacity-50')
    expect(screen.getByRole('button', { name: 'Drag to move Sam Wilson to another shift or day' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('has no grip without draggable: the Staff view keeps click and menus', () => {
    renderChip(<ShiftChip shift={makeShift()} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /actions for/i })).toBeInTheDocument()
  })
})

describe('ShiftChip plus: the staff picker (spec 2026-10-15, decision C; the brief, section 3)', () => {
  const open = makeUnfilledShift({ id: 'open', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', status: 'Draft' })
  const plusName = 'Assign someone to Tuesday 9am to 3pm for Mia'
  const chipOf = (shift: ShiftDto, extra: Partial<ShiftChipProps> = {}) => (
    <ShiftChip key={shift.id} shift={shift} canWrite dashed={!shift.staffId} context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} {...extra} />
  )
  function withPick(ui: React.ReactElement, state: Partial<DropState> = {}) {
    const pick = vi.fn()
    const result = renderChip(<DropStateContext.Provider value={{ disabled: false, pending: null, pick, pickingId: null, ...state }}>{ui}</DropStateContext.Provider>)
    return { pick, ...result }
  }

  it('puts the plus first on a Needs staff chip, named for the day, the time and the participant, and it opens the picker', async () => {
    const user = userEvent.setup()
    const { pick } = withPick(chipOf(open))
    const plus = screen.getByRole('button', { name: plusName })
    expect(plus).toHaveAttribute('title', plusName)
    expect(plus).toHaveAttribute('aria-haspopup', 'dialog')
    expect(plus).toHaveAttribute('aria-expanded', 'false')
    // Tab order inside the chip: the plus, the open control, the menu.
    expect(plus.compareDocumentPosition(getOpenButton(open)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(plus)
    expect(pick).toHaveBeenCalledWith(open)
  })

  it('in the Participant view, spans the box but for the menu, with its glyph at the box centre, and prints no words beside it (the chip brief, section 4)', () => {
    const { container } = withPick(chipOf(open))
    const plus = screen.getByRole('button', { name: plusName })
    // The lead and name cells: the whole empty box is the target. Its leading pad is the menu's width, so the glyph sits at the box's centre.
    expect(plus).toHaveClass('row-start-2', 'col-[1/span_2]', 'pl-[calc(var(--control-h-sm)_+_4px)]')
    expect(plus).not.toHaveClass('w-[18px]')
    expect(plus.querySelector('svg')).toHaveClass('h-4', 'w-4', 'pointer-coarse:h-6', 'pointer-coarse:w-6')
    // Words inside the target would be a visible label missing from its name (WCAG 2.5.3); the open control still says it.
    expect(screen.queryByText('Needs staff')).not.toBeInTheDocument()
    expect(getOpenButton(open)).toHaveAccessibleName(/Needs staff/)
    expect(container.querySelector('[data-shift-box]')).not.toContainElement(plus)
  })

  it("on the Staff view's Unfilled lane, stays in the lead cell beside the participant's name: 18px wide with a mouse, a 44px square under a coarse pointer", () => {
    withPick(chipOf(open, { context: 'staff' }))
    const plus = screen.getByRole('button', { name: plusName })
    expect(plus).toHaveClass('col-start-1', 'w-[18px]', 'pointer-coarse:w-11')
    expect(plus).not.toHaveClass('col-[1/span_2]')
    expect(plus.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5')
    expect(screen.getByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()
  })

  it('gives no plus to a filled, an on-leave or a locked chip, or to a reader', () => {
    withPick(
      <>
        {chipOf(makeShift({ id: 'filled', staffName: 'Sam Wilson' }))}
        {chipOf(makeShift({ id: 'leave', assigneeOnApprovedLeave: true }))}
        {(['InProgress', 'PendingReview', 'Completed', 'Cancelled'] as const).map(status => chipOf(makeUnfilledShift({ id: status, status })))}
        {chipOf(makeUnfilledShift({ id: 'ro' }), { canWrite: false })}
      </>,
    )
    expect(screen.queryByRole('button', { name: /^Assign someone/ })).not.toBeInTheDocument()
  })

  it('gives each chip of a 2:1 pair its own plus', () => {
    withPick(<>{chipOf(makeUnfilledShift({ ...open, id: 'w1' }))}{chipOf(makeUnfilledShift({ ...open, id: 'w2' }))}</>)
    expect(screen.getAllByRole('button', { name: plusName })).toHaveLength(2)
  })

  it('draws no plus where nothing can open a picker (a chip outside the board page)', () => {
    renderChip(chipOf(open))
    expect(screen.queryByRole('button', { name: plusName })).not.toBeInTheDocument()
  })

  it("rings the box, not the tray, and keeps the plus's hover look while its picker is open", () => {
    const { container } = withPick(chipOf(open), { pickingId: 'open' })
    expect(screen.getByRole('button', { name: plusName })).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('[data-shift-chip="open"] [data-shift-box]')).toHaveClass('ring-2', 'ring-ring')
    expect(container.querySelector('[data-shift-chip="open"]')).not.toHaveClass('ring-2')
  })

  it('waits while a write is out: every other plus is aria-disabled and faded, and the target shows "Assigning Kim…" with no plus', async () => {
    const user = userEvent.setup()
    const { pick } = withPick(<>{chipOf(open)}{chipOf(makeUnfilledShift({ ...open, id: 'other' }))}</>, { disabled: true, pending: { targetId: 'open', staffName: 'Kim Lee' } })
    const plus = screen.getByRole('button', { name: plusName })   // the other chip's: the target has none
    expect(plus).toHaveAttribute('aria-disabled', 'true')
    expect(plus).toHaveClass('opacity-40')
    await user.click(plus)
    expect(pick).not.toHaveBeenCalled()
    expect(screen.getByText('Assigning Kim…')).toBeInTheDocument()
  })

  it('keeps the plus column as an empty spacer while a pick is out, drag or no drag, so the text does not jump', () => {
    const pending = { disabled: true, pending: { targetId: 'open', staffName: 'Kim Lee' } }
    for (const draggable of [true, false]) {
      const { container, unmount } = withPick(chipOf(open, { draggable }), pending)
      const lead = container.querySelector('[data-shift-chip="open"]')!.firstElementChild!
      expect(lead).toHaveAttribute('aria-hidden', 'true')
      expect(lead).toHaveClass('w-[18px]', 'pointer-coarse:w-11')
      unmount()
    }
  })

  it('pads the name off the box edge only where no leading column does', () => {
    const nameCell = () => screen.getByRole('link', { name: 'Sam Wilson' }).parentElement!
    const withGrip = withPick(chipOf(makeShift({ id: 'f', staffName: 'Sam Wilson' }), { draggable: true }))
    expect(nameCell()).toHaveClass('pl-0.5')
    withGrip.unmount()
    withPick(chipOf(makeShift({ id: 'f', staffName: 'Sam Wilson' }), { draggable: false }))
    expect(nameCell()).toHaveClass('pl-1.5')
  })

  it('disables Assign to… on an unfilled chip under the same condition as its plus', async () => {
    const user = userEvent.setup()
    const { pick } = withPick(chipOf(open), { disabled: true })
    await user.click(screen.getByRole('button', { name: "Actions for Mia Chen's shift" }))
    expect(screen.getByRole('option', { name: 'Assign to…' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('option', { name: 'Assign to…' }))
    expect(pick).not.toHaveBeenCalled()
  })

  it("opens the picker from an unfilled chip's Assign to…, and keeps the panel for a filled chip's Replace {first name}… (SHAPE departure 13)", async () => {
    const user = userEvent.setup()
    const onAssignTo = vi.fn()
    const { pick } = withPick(<>{chipOf(open, { onAssignTo })}{chipOf(makeShift({ id: 'filled', participantName: 'Jo Park' }), { onAssignTo })}</>)
    await user.click(screen.getByRole('button', { name: "Actions for Mia Chen's shift" }))
    await user.click(screen.getByRole('option', { name: 'Assign to…' }))
    expect(pick).toHaveBeenCalledWith(open)
    expect(onAssignTo).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: "Actions for Jo Park's shift" }))
    await user.click(screen.getByRole('option', { name: 'Replace Alex…' }))
    expect(onAssignTo).toHaveBeenCalledTimes(1)
  })
})

describe('ShiftChip menu: Swap with… (the lead decision 1, 2026-10-15)', () => {
  const chipIn = (shift: ShiftDto, state: Partial<DropState> = {}, extra: Partial<ShiftChipProps> = {}) => {
    const swap = vi.fn()
    renderChip(
      <DropStateContext.Provider value={{ disabled: false, pending: null, swap, ...state }}>
        <ShiftChip shift={shift} canWrite dashed={!shift.staffId} context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} {...extra} />
      </DropStateContext.Provider>,
    )
    return swap
  }
  const openMenu = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^Actions for/ }))

  it('reads Edit, Replace {first}…, Swap with…, Remove {first}, Delete on an assigned chip, and Swap opens the swap picker for it', async () => {
    const user = userEvent.setup()
    const shift = makeShift({ id: 'kim', staffName: 'Kim Lee' })
    const swap = chipIn(shift)
    await openMenu(user)
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Edit', 'Replace Kim…', 'Swap Kim with…', 'Remove Kim', 'Delete'])
    await user.click(screen.getByRole('option', { name: 'Swap Kim with…' }))
    expect(swap).toHaveBeenCalledWith(shift)
  })

  it('offers no Swap on an unfilled or a locked chip, or where nothing can open the picker', async () => {
    const user = userEvent.setup()
    chipIn(makeUnfilledShift({ id: 'open' }))
    await openMenu(user)
    expect(screen.queryByRole('option', { name: 'Swap Kim with…' })).not.toBeInTheDocument()
    cleanup()
    chipIn(makeShift({ id: 'done', status: 'Completed' }))
    await openMenu(user)
    expect(screen.queryByRole('option', { name: 'Swap Kim with…' })).not.toBeInTheDocument()
    cleanup()
    renderChip(<ShiftChip shift={makeShift()} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    await openMenu(user)
    expect(screen.queryByRole('option', { name: 'Swap Kim with…' })).not.toBeInTheDocument()
  })

  it('waits while a write is out, as every drag and plus does (#253)', async () => {
    const user = userEvent.setup()
    const swap = chipIn(makeShift({ id: 'kim', staffName: 'Kim Lee' }), { disabled: true })
    await openMenu(user)
    expect(screen.getByRole('option', { name: 'Swap Kim with…' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('option', { name: 'Swap Kim with…' }))
    expect(swap).not.toHaveBeenCalled()
  })
})

describe('ShiftChip: the regular (2026-10-16)', () => {
  const chipIn = (shift: ShiftDto, state: Partial<DropState> = {}, extra: Partial<ShiftChipProps> = {}) => {
    const onSetRegular = vi.fn()
    const result = renderChip(
      <DropStateContext.Provider value={{ disabled: false, pending: null, swap: vi.fn(), pick: vi.fn(), ...state }}>
        <ShiftChip shift={shift} canWrite dashed={!shift.staffId} context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} onSetRegular={onSetRegular} {...extra} />
      </DropStateContext.Provider>,
    )
    return { onSetRegular, ...result }
  }
  const openMenu = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^Actions for/ }))
  const kim = makeShift({ id: 'kim', staffName: 'Kim Lee', shiftPatternId: 'pat-1', fromAgreement: true })

  it('offers "Make Kim the regular" on a pattern shift with a worker, after Swap and before Remove, and hands the shift up', async () => {
    const user = userEvent.setup()
    const { onSetRegular } = chipIn(kim)
    await openMenu(user)
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Edit', 'Replace Kim…', 'Swap Kim with…', 'Make Kim the regular', 'Remove Kim', 'Delete'])
    await user.click(screen.getByRole('option', { name: 'Make Kim the regular' }))
    expect(onSetRegular).toHaveBeenCalledWith(kim)
  })

  it("\"Stop being the regular\" when Kim is the regular, said in the chip's title and name, with no mark drawn", async () => {
    const user = userEvent.setup()
    const { container } = chipIn({ ...kim, isRegular: true })
    expect(container.querySelector('[data-shift-chip]')?.getAttribute('title')).toContain('Kim Lee is the regular')
    expect(getOpenButton(kim).getAttribute('aria-label')).toContain(', Kim is the regular,')
    expect(screen.queryByText(/regular/i)).not.toBeInTheDocument()
    await openMenu(user)
    expect(screen.getByRole('option', { name: 'Stop being the regular' })).toBeInTheDocument()
  })

  it('offers neither on a one-off, a Patterns-page pattern, an open shift, or where nothing handles it, and keeps it on a locked chip', async () => {
    const user = userEvent.setup()
    const cases: [ShiftDto, Partial<ShiftChipProps>][] = [
      [makeShift({ id: 'one-off', staffName: 'Kim Lee', shiftPatternId: null }), {}],
      // A Patterns-page pattern: Start never makes its shifts, so "every week you start" would be untrue there (deep review S2).
      [makeShift({ id: 'hand-made', staffName: 'Kim Lee', shiftPatternId: 'pat-2' }), {}],
      [makeUnfilledShift({ id: 'open', shiftPatternId: 'pat-1' }), {}],
      [kim, { onSetRegular: undefined }],
    ]
    for (const [shift, extra] of cases) {
      chipIn(shift, {}, extra)
      await openMenu(user)
      expect(screen.queryByRole('option', { name: /the regular$/ })).not.toBeInTheDocument()
      cleanup()
    }
    chipIn({ ...kim, status: 'Completed' })
    await openMenu(user)
    expect(screen.getByRole('option', { name: 'Make Kim the regular' })).toBeInTheDocument()
  })

  const away = makeUnfilledShift({ id: 'away', participantName: 'Mia Chen', shiftPatternId: 'pat-1', regularUserId: 's-1', regularAwayReason: 'on approved leave' })

  it('an open shift whose regular is away: the plus takes the lead cell, and the box says Away, or Regular away from 11rem', () => {
    const { container } = chipIn(away)
    const plus = container.querySelector('[data-shift-plus]')
    expect(plus).toHaveClass('col-start-1')
    expect(plus).not.toHaveClass('col-[1/span_2]')
    const flag = container.querySelector('[data-regular-away]') as HTMLElement
    expect(flag).toHaveAttribute('title', 'Regular away: on approved leave')
    expect(within(flag).getByText('Away')).toHaveClass('@[11rem]:hidden')
    expect(within(flag).getByText('Regular away')).toHaveClass('hidden', '@[11rem]:inline')
    expect(getOpenButton(away).getAttribute('aria-label')).toContain('Needs staff, Regular away: on approved leave')
    expect(container.querySelector('[data-shift-chip]')?.getAttribute('title')).toContain('Regular away: on approved leave')
  })

  it('a reader sees the flag in place of "Needs staff"', () => {
    const { container } = chipIn(away, {}, { canWrite: false })
    expect(screen.queryByText('Needs staff')).not.toBeInTheDocument()
    expect(container.querySelector('[data-regular-away]')).not.toBeNull()
    expect(getOpenButton(away).getAttribute('aria-label')).toContain('Needs staff')
  })

  it("on the Unfilled lane the flag follows the participant's name: the glyph always, the words from 15rem", () => {
    renderChip(
      <DropStateContext.Provider value={{ disabled: false, pending: null, pick: vi.fn() }}>
        <ShiftChip shift={away} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />
      </DropStateContext.Provider>,
    )
    const flag = screen.getByRole('link', { name: 'Mia Chen' }).nextElementSibling as HTMLElement
    expect(flag).toHaveAttribute('data-regular-away')
    expect(within(flag).getByText('Regular away')).toHaveClass('hidden', '@[15rem]:inline')
  })
})

describe('ShiftChip Draft: tinted, worded, and publishable from its menu (card roster-draft-publish)', () => {
  const draft = makeShift({ status: 'Draft', staffId: 'staff-1', staffName: 'Kim Lee' })
  const chipIn = (shift: ShiftDto, state: Partial<DropState> = {}, extra: Partial<ShiftChipProps> = {}) => {
    const publish = vi.fn()
    renderChip(
      <DropStateContext.Provider value={{ disabled: false, pending: null, publish, ...state }}>
        <ShiftChip shift={shift} canWrite context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} {...extra} />
      </DropStateContext.Provider>,
    )
    return publish
  }
  const openMenu = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^Actions for/ }))

  it('a Draft chip is tinted warning and shows the word Draft; a Published one has neither', () => {
    const { container, rerender } = renderChip(<ShiftChip shift={draft} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    const tray = container.querySelector('[data-shift-chip]')!
    expect(tray).toHaveClass('bg-[var(--color-warning-container)]')
    expect(tray).not.toHaveClass('bg-surface-container-low')
    expect(within(tray as HTMLElement).getByText('Draft')).toBeInTheDocument()
    expect(getOpenButton(draft).getAttribute('aria-label')).toMatch(/Draft$/)
    rerender(<MemoryRouter><ShiftChip shift={{ ...draft, status: 'Published' }} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} /></MemoryRouter>)
    expect(tray).not.toHaveClass('bg-[var(--color-warning-container)]')
    expect(within(tray as HTMLElement).queryByText('Draft')).not.toBeInTheDocument()
  })

  it('a Draft chip keeps its problem signals: the severity marker, and the dashed box of an open shift', () => {
    const open = makeUnfilledShift({ status: 'Draft', findings: [makeFinding({ severity: 'Blocking' })] })
    const { container } = renderChip(<ShiftChip shift={open} canWrite dashed onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.getByRole('img', { name: /1 blocking issue/ })).toBeInTheDocument()
    expect(container.querySelector('[data-shift-box]')).toHaveClass('border-dashed', 'bg-card')
  })

  it('a finding on a Draft chip sits in an ON_TINT pill, so it stays louder than the tray; a published chip keeps its bare marker', () => {
    const { rerender } = renderChip(<ShiftChip shift={{ ...draft, findings: [makeFinding({ severity: 'Warning' })] }} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(screen.getByRole('img', { name: /1 warning/ })).toHaveClass(...ON_TINT.warning!.split(' '), 'h-5', 'w-5')
    rerender(<MemoryRouter><ShiftChip shift={{ ...draft, findings: [makeFinding({ severity: 'Blocking' })] }} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} /></MemoryRouter>)
    expect(screen.getByRole('img', { name: /1 blocking issue/ })).toHaveClass(...ON_TINT.danger!.split(' '))
    rerender(<MemoryRouter><ShiftChip shift={{ ...draft, status: 'Published', findings: [makeFinding({ severity: 'Warning' })] }} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} /></MemoryRouter>)
    const marker = screen.getByRole('img', { name: /1 warning/ })
    expect(marker).toHaveClass('h-3', 'w-3')
    expect(marker).not.toHaveClass('bg-[var(--color-card)]')
  })

  it('Publish waits while a drag write is out: disabled, and choosing it hands nothing to the page', async () => {
    const user = userEvent.setup()
    const publish = chipIn(draft, { disabled: true })
    await openMenu(user)
    const item = screen.getByRole('option', { name: 'Publish' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await user.click(item)
    expect(publish).not.toHaveBeenCalled()
  })

  it('the menu offers Publish on a Draft shift (after Edit), and not on a Published one', async () => {
    const user = userEvent.setup()
    chipIn(draft)
    await openMenu(user)
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Edit', 'Publish', 'Replace Kim…', 'Remove Kim', 'Delete'])
    cleanup()
    chipIn({ ...draft, status: 'Published' })
    await openMenu(user)
    expect(screen.queryByRole('option', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('no Publish where the page offers none (a reader, or outside the board)', async () => {
    const user = userEvent.setup()
    chipIn(draft, { publish: undefined })
    await openMenu(user)
    expect(screen.queryByRole('option', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('choosing Publish hands the shift to the page once', async () => {
    const user = userEvent.setup()
    const publish = chipIn(draft)
    await openMenu(user)
    await user.click(screen.getByRole('option', { name: 'Publish' }))
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(draft)
  })

  it('while its publish is out the item reads Publishing… and cannot be chosen', async () => {
    const user = userEvent.setup()
    const publish = chipIn(draft, { publishingIds: new Set([draft.id]) })
    await openMenu(user)
    const item = screen.getByRole('option', { name: 'Publishing…' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await user.click(item)
    expect(publish).not.toHaveBeenCalled()
  })
})
