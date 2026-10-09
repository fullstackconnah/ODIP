import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { ShiftChip } from './ShiftChip'
import { formatShiftTimeRange } from '../lib/roster'
import { makeShift, makeFinding } from '../test-fixtures'
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

  it('is at least row-h minus 6px tall, so it grows with the density token under a coarse pointer', () => {
    const shift = makeShift()
    const { container } = renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(container.firstElementChild).toHaveClass('min-h-[calc(var(--row-h)_-_6px)]')
    // A fixed height would clip the name stacked under the time (below).
    expect(container.firstElementChild).not.toHaveClass('h-[calc(var(--row-h)_-_6px)]')
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
    expect(link).toHaveAttribute('href', '/participants/participant-7')
    expect(time.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the "·" separator out of the accessibility tree, and the open control announces time and name with a comma', () => {
    const shift = makeShift({ participantName: 'Grace Palmer' })
    renderChip(<ShiftChip shift={shift} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

    expect(screen.getByText('·')).toHaveAttribute('aria-hidden', 'true')
    expect(getOpenButton(shift)).toHaveAccessibleName('9am–5pm, Grace Palmer')
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
      '1 blocking issue, 7pm–7am (ends the next day), Mei Zhang, 2:1 ratio, Assigned with an override: Only cover available, On leave',
    )
  })

  it('names "Unfilled" in a participant row and the participant in a staff row, in the accessible name too', () => {
    const unfilled = makeShift({ participantName: 'Grace Palmer', staffId: null, staffName: null })
    const { unmount } = renderChip(<ShiftChip shift={unfilled} canWrite dashed context="participant" onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(getOpenButton(unfilled)).toHaveAccessibleName('9am–5pm, Unfilled')
    unmount()

    const staffRow = makeShift({ participantName: 'Grace Palmer' })
    renderChip(<ShiftChip shift={staffRow} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)
    expect(getOpenButton(staffRow)).toHaveAccessibleName('9am–5pm, Grace Palmer')
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

    it('takes the top corner, and the bottom one when the chip already carries a severity marker at the top', () => {
      const plain = markerOf(emergency())
      expect(plain.className).toContain('-top-')
      cleanup()

      const withFindings = markerOf(makeShift({ ...emergency(), findings: [makeFinding({ severity: 'Warning' })] }))
      expect(withFindings.className).toContain('-bottom-')
      expect(withFindings.className).not.toContain('-top-')
    })

    it('keeps the words as a bonus on a wide chip: in the name row, and display:none below 18rem, never clipped', () => {
      renderChip(<ShiftChip shift={makeShift({ ...emergency(), participantName: 'Grace Palmer' })} canWrite onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />)

      const words = screen.getByText('Over budget: emergency', { selector: 'span' })
      expect(words).toHaveClass('hidden', '@[18rem]:inline')
      expect(words).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('link', { name: 'Grace Palmer' }).parentElement).toContainElement(words)
    })
  })
})
