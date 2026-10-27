import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent } from '@dnd-kit/core'
import RosterBoardPage from './RosterBoardPage'
import { makeFinding, makeParticipantBoard, makeParticipantRow, makeShift, makeStaffBoard, makeUnfilledShift } from './test-fixtures'
import type { ShiftDto } from '@/api/types'
import type { DragCarry, DropTarget } from './lib/rosterDrag'

const h = vi.hoisted(() => ({
  board: vi.fn(), assign: vi.fn(), move: vi.fn(), publish: vi.fn(), create: vi.fn(),
  dnd: { props: null as null | { onDragEnd: (event: DragEndEvent) => void } },
  screen: { belowMd: false },
  staff: [
    { id: 'staff-2', fullName: 'Sam Wilson', isActive: true, region: 'North', hasExpiredQualifications: false },
    { id: 'staff-9', fullName: 'Alex Ng', isActive: true, region: 'South', hasExpiredQualifications: false },
  ],
}))

vi.mock('@/api/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks')>('@/api/hooks')
  return {
    ...actual,
    useRosterBoard: h.board,
    useAssignShift: () => ({ mutateAsync: h.assign, isPending: false }),
    useMoveStaff: () => ({ mutateAsync: h.move, isPending: false }),
    usePublishWeek: () => ({ mutateAsync: h.publish, isPending: false }),
    useCreateShift: () => ({ mutateAsync: h.create, isPending: false }),
    useUpdateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useParticipants: () => ({ data: [] }),
    useStaff: () => ({ data: h.staff, isLoading: false }),
    useParticipantRoutines: () => ({ data: [] }),
    useCompatibility: () => ({ data: [] }),
    useRosterShiftNotes: () => ({ data: [] }),
    useCheckShift: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

// The real DndContext renders; the test keeps the props the page gave it, to call onDragEnd as a finished drag would.
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      h.dnd.props = props as never
      return createElement(actual.DndContext, props)
    },
  }
})

vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => h.screen.belowMd }))

// The week of Monday 2026-08-17. Mia Chen: Needs staff on Tuesday, Alex on a Published Monday, Sam on Wednesday, a Completed Thursday, and Alex on leave on Friday.
// Jo Park: Sam on Saturday, which counts in Sam's hours even while a filter hides Jo's row.
const at = (overrides: Partial<ShiftDto>) => makeShift({ participantId: 'p-1', participantName: 'Mia Chen', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, status: 'Draft', ...overrides })
const OPEN = makeUnfilledShift({ id: 'open', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', durationHours: 6, status: 'Draft' })
const ALEX_MON = at({ id: 'alex-mon', serviceDate: '2026-08-17', staffId: 'staff-9', staffName: 'Alex Ng', status: 'Published' })
const SAM_WED = at({ id: 'sam-wed', serviceDate: '2026-08-19', staffId: 'staff-2', staffName: 'Sam Wilson' })
const DONE = at({ id: 'done', serviceDate: '2026-08-20', staffId: 'staff-9', staffName: 'Alex Ng', status: 'Completed' })
const ON_LEAVE = at({ id: 'on-leave', serviceDate: '2026-08-21', staffId: 'staff-9', staffName: 'Alex Ng', assigneeOnApprovedLeave: true })
const JO_SAT = makeShift({ id: 'jo-sat', participantId: 'p-2', participantName: 'Jo Park', serviceDate: '2026-08-22', staffId: 'staff-2', staffName: 'Sam Wilson', durationHours: 6, status: 'Draft' })
const BOARD = makeParticipantBoard({
  participantRows: [
    makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: [OPEN, ALEX_MON, SAM_WED, DONE, ON_LEAVE] }),
    makeParticipantRow({ participantId: 'p-2', fullName: 'Jo Park', shifts: [JO_SAT] }),
  ],
})

const sam: DragCarry = { staffId: 'staff-2', staffName: 'Sam Wilson' }
const samOffWed: DragCarry = { ...sam, fromShift: SAM_WED }
const onShift = (shift: ShiftDto): DropTarget => ({ kind: 'shift', shift })

function renderPage(entry = '/rostering?date=2026-08-17') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/rostering', element: <RosterBoardPage /> }], { initialEntries: [entry] })
  return { ...render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>), router }
}

/** What dnd-kit hands onDragEnd when a carried person is let go over `target` (null: over nothing). */
async function drop(carry: DragCarry, target: DropTarget | null, keyboard = false) {
  await act(async () => {
    h.dnd.props!.onDragEnd({
      active: { id: 'carried', data: { current: carry }, rect: { current: { initial: null, translated: null } } },
      over: target ? { id: 'target', data: { current: target }, rect: { width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }, disabled: false } : null,
      activatorEvent: keyboard ? new KeyboardEvent('keydown') : new MouseEvent('mousedown'),
      collisions: null,
      delta: { x: 0, y: 0 },
    } as unknown as DragEndEvent)
  })
}

const findings422 = (severity: 'Warning' | 'Blocking') => ({
  response: { status: 422, data: { success: false, data: [makeFinding({
    code: severity === 'Warning' ? 'STAFF_ON_LEAVE' : 'WSC_EXPIRED', severity, requiresReason: severity === 'Warning', message: 'Sam Wilson cannot work this shift as it stands.',
  })] } },
})

beforeEach(() => {
  for (const fn of [h.board, h.assign, h.move, h.publish, h.create]) fn.mockReset()
  h.board.mockReturnValue({ data: BOARD, isLoading: false, isError: false, refetch: vi.fn() })
  h.assign.mockResolvedValue(OPEN)
  h.move.mockResolvedValue(OPEN)
  h.dnd.props = null
  h.screen.belowMd = false
  sessionStorage.clear()
  localStorage.clear()
})

describe('RosterBoardPage drag and drop: what a drop sends', () => {
  it('assigns a person carried from the strip to a Needs staff shift, with the whole body, and says so', async () => {
    renderPage()
    await drop(sam, onShift(OPEN))
    expect(h.assign).toHaveBeenCalledWith({ id: 'open', data: { staffId: 'staff-2', overrideReason: null, acknowledgedFindingCodes: [], expectedStaffId: null } })
    expect(h.move).not.toHaveBeenCalled()
    expect(await screen.findByText('Sam Wilson assigned to Mia Chen, Tuesday 9am to 3pm.')).toBeInTheDocument()
  })

  it('moves a person carried off a puck onto Needs staff in one request', async () => {
    renderPage()
    await drop(samOffWed, onShift(OPEN))
    expect(h.move).toHaveBeenCalledWith({ fromShiftId: 'sam-wed', toShiftId: 'open', mode: 'Move', staffId: 'staff-2', expectedToStaffId: null, overrideReason: null, acknowledgedFindingCodes: [] })
    expect(h.assign).not.toHaveBeenCalled()
    expect(await screen.findByText('Sam Wilson moved to Mia Chen, Tuesday 9am to 3pm. Wednesday 9am to 3pm now needs staff.')).toBeInTheDocument()
  })

  it('replaces a worker on leave without asking', async () => {
    renderPage()
    await drop(samOffWed, onShift(ON_LEAVE))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(h.move).toHaveBeenCalledWith({ fromShiftId: 'sam-wed', toShiftId: 'on-leave', mode: 'Replace', staffId: 'staff-2', expectedToStaffId: 'staff-9', overrideReason: null, acknowledgedFindingCodes: [] })
  })

  it('asks Replace or Cancel when a strip person lands on a filled puck, and Replace assigns them', async () => {
    const user = userEvent.setup()
    renderPage()
    await drop(sam, onShift(ALEX_MON))
    const prompt = screen.getByRole('alertdialog', { name: 'Alex Ng is on this shift' })
    expect(within(prompt).queryByRole('button', { name: 'Swap' })).not.toBeInTheDocument()
    expect(within(prompt).getByText('Mia Chen, Mon 17 Aug, 9am–3pm.')).toBeInTheDocument()
    expect(within(prompt).getByText('This shift is published, so the change goes out now.')).toBeInTheDocument()
    expect(h.assign).not.toHaveBeenCalled()

    await user.click(within(prompt).getByRole('button', { name: 'Replace' }))

    expect(h.assign).toHaveBeenCalledWith({ id: 'alex-mon', data: { staffId: 'staff-2', overrideReason: null, acknowledgedFindingCodes: [], expectedStaffId: 'staff-9' } })
  })

  it('offers Swap to a person carried off a puck: Cancel sends nothing, Swap sends one swap', async () => {
    const user = userEvent.setup()
    renderPage()
    await drop(samOffWed, onShift(ALEX_MON))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(h.move).not.toHaveBeenCalled()
    expect(h.assign).not.toHaveBeenCalled()

    await drop(samOffWed, onShift(ALEX_MON))
    const prompt = screen.getByRole('alertdialog', { name: 'Alex Ng is on this shift' })
    expect(within(prompt).getByText("Swap: Sam takes it and Alex takes Sam's Wed 19 Aug, 9am–3pm shift with Mia Chen.")).toBeInTheDocument()
    await user.click(within(prompt).getByRole('button', { name: 'Swap' }))

    expect(h.move).toHaveBeenCalledWith({ fromShiftId: 'sam-wed', toShiftId: 'alex-mon', mode: 'Swap', staffId: 'staff-2', expectedToStaffId: 'staff-9', overrideReason: null, acknowledgedFindingCodes: [] })
  })

  it('sends nothing for a locked shift, their own puck, or a drop over nothing', async () => {   // Review Focus 3, the page's side
    renderPage()
    await drop(sam, onShift(DONE))
    await drop(samOffWed, onShift(SAM_WED))
    await drop(sam, null)
    expect(h.assign).not.toHaveBeenCalled()
    expect(h.move).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('RosterBoardPage drag and drop: when the server says no', () => {
  it('asks for a reason on a warning, and "Assign anyway" re-sends the same move with it', async () => {
    const user = userEvent.setup()
    h.move.mockRejectedValueOnce(findings422('Warning')).mockResolvedValueOnce(OPEN)
    renderPage()
    await drop(samOffWed, onShift(OPEN))

    const dialog = await screen.findByRole('alertdialog', { name: 'Assign with warnings' })
    await user.type(within(dialog).getByPlaceholderText('Reason for overriding these warnings'), 'Leave cancelled by phone')
    await user.click(within(dialog).getByRole('button', { name: 'Assign anyway' }))

    expect(h.move).toHaveBeenLastCalledWith({ fromShiftId: 'sam-wed', toShiftId: 'open', mode: 'Move', staffId: 'staff-2', expectedToStaffId: null, overrideReason: 'Leave cancelled by phone', acknowledgedFindingCodes: ['STAFF_ON_LEAVE'] })
  })

  it("shows today's blocked dialog for a blocking finding", async () => {
    h.assign.mockRejectedValueOnce(findings422('Blocking'))
    renderPage()
    await drop(sam, onShift(OPEN))
    expect(await screen.findByRole('alertdialog', { name: "Can't assign this shift" })).toBeInTheDocument()
  })

  it("tells the coordinator an admin can override when the blocking finding is a double-booking", async () => {
    h.assign.mockRejectedValueOnce({ response: { status: 422, data: { success: false, data: [makeFinding({ code: 'DOUBLE_BOOKED_SHIFT', severity: 'Blocking', requiresReason: false, message: 'Sam Wilson already has a shift on 24 Aug 2026, 16:00-20:00, that overlaps this one. An admin can override this.' })] } } })
    renderPage()
    await drop(sam, onShift(OPEN))

    const dialog = await screen.findByRole('alertdialog', { name: "Can't assign this shift" })
    expect(within(dialog).getByText("This worker is already booked at that time. Only an admin can override this, so ask an admin to make the assignment.")).toBeInTheDocument()
    expect(within(dialog).queryByText(/can't be overridden/)).not.toBeInTheDocument()
  })

  it("shows any other refusal in today's error Callout, in the server's words", async () => {
    const STALE = 'This shift changed after the board was loaded. Refresh the board and try again.'
    h.move.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: [STALE] } } })
    renderPage()
    await drop(samOffWed, onShift(OPEN))
    expect((await screen.findByText(STALE)).closest('[role="alert"]')).not.toBeNull()
  })

  it('tells the board frame how tall the error notice is, so strip and grid still share one screen (finish review fix 5)', async () => {
    h.move.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: ['Another change to the roster is still running.'] } } })
    // All published, so no Publish banner stands in the notice wrapper before the error comes (2026-10-16: the banner is measured there too).
    if (BOARD.groupBy !== 'Participant') throw new Error('participant board')
    h.board.mockReturnValue({ data: { ...BOARD, participantRows: BOARD.participantRows.map(r => ({ ...r, shifts: r.shifts.map(s => ({ ...s, status: 'Published' as const })) })) }, isLoading: false, isError: false, refetch: vi.fn() })
    const { container } = renderPage()
    const page = container.querySelector('.animate-fade-in') as HTMLElement
    expect(page.style.getPropertyValue('--roster-notice-h')).toBe('')
    await drop(samOffWed, onShift(OPEN))
    await screen.findByText('Another change to the roster is still running.')
    // jsdom has no layout (offsetHeight 0); the 1440 capture measures the real thing.
    expect(page.style.getPropertyValue('--roster-notice-h')).toBe('calc(0px + var(--section-gap))')
  })
})

describe('RosterBoardPage drag and drop: a drop on an empty day', () => {
  const FRIDAY_OF_JO: DropTarget = { kind: 'day', participantId: 'p-2', participantName: 'Jo Park', day: '2026-08-21' }

  it('opens the new-shift panel prefilled, on Start time; once it saves, the person comes off their old shift', async () => {
    const user = userEvent.setup()
    h.create.mockResolvedValueOnce(makeShift({ id: 'new', participantId: 'p-2', participantName: 'Jo Park', staffId: 'staff-2', staffName: 'Sam Wilson', serviceDate: '2026-08-21', status: 'Draft' }))
    renderPage()
    await drop(samOffWed, FRIDAY_OF_JO)

    const panel = screen.getByRole('dialog', { name: 'New shift' })
    expect(within(panel).getByLabelText(/^Start time/)).toHaveFocus()
    expect(within(panel).getByLabelText(/^Service date/)).toHaveValue('2026-08-21')
    await user.click(within(panel).getByRole('button', { name: 'Save' }))

    // One guarded request (deep review S6): the create carries the move, and the server clears Wednesday in the same save.
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'p-2', staffId: 'staff-2', serviceDate: '2026-08-21', moveFromShiftId: 'sam-wed' }))
    expect(h.assign).not.toHaveBeenCalled()
    expect(await screen.findByText('Sam Wilson moved to Jo Park, Friday 9am to 5pm. Wednesday 9am to 3pm now needs staff.')).toBeInTheDocument()
  })

  it('changes nothing when the panel is cancelled', async () => {
    const user = userEvent.setup()
    renderPage()
    await drop(samOffWed, FRIDAY_OF_JO)
    await user.click(within(screen.getByRole('dialog', { name: 'New shift' })).getByRole('button', { name: 'Cancel' }))
    expect(h.create).not.toHaveBeenCalled()
    expect(h.assign).not.toHaveBeenCalled()
  })

  it('leaves the old shift alone when the panel saved the new shift for someone else', async () => {   // S5
    const user = userEvent.setup()
    // The coordinator changed the Staff field to Alex before saving: Sam has not moved.
    h.create.mockResolvedValueOnce(makeShift({ id: 'new', participantId: 'p-2', staffId: 'staff-9', staffName: 'Alex Ng', serviceDate: '2026-08-21', status: 'Draft' }))
    renderPage()
    await drop(samOffWed, FRIDAY_OF_JO)
    await user.click(within(screen.getByRole('dialog', { name: 'New shift' })).getByRole('button', { name: 'Save' }))
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.assign).not.toHaveBeenCalled()
  })

  it('opens the panel for a person from the strip too, and clears nothing after the save', async () => {
    const user = userEvent.setup()
    h.create.mockResolvedValueOnce(makeShift({ id: 'new', participantId: 'p-2', staffId: 'staff-2', serviceDate: '2026-08-21' }))
    renderPage()
    await drop(sam, FRIDAY_OF_JO)
    await user.click(within(screen.getByRole('dialog', { name: 'New shift' })).getByRole('button', { name: 'Save' }))
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.assign).not.toHaveBeenCalled()
  })

  it("opens the same panel from the new-shift slot of a day that already has shifts (spec 2026-10-15, decision D)", async () => {
    renderPage()
    await drop(sam, { kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-19', beside: 1 })   // Sam's own Wednesday is already there
    const panel = screen.getByRole('dialog', { name: 'New shift' })
    expect(within(panel).getByLabelText(/^Service date/)).toHaveValue('2026-08-19')
    expect(within(panel).getByLabelText(/^Start time/)).toHaveFocus()
  })
})

describe('RosterBoardPage drag and drop: pending, focus, the strip, and where drag is off', () => {
  const samPuck = () => screen.getByRole('button', { name: /^Sam Wilson, / })

  it('shows the pending look and holds every drag until the answer, and a keyboard drop leaves focus on the shift it changed', async () => {
    h.assign.mockReturnValueOnce(new Promise(() => {}))   // still out
    renderPage()
    await drop(sam, onShift(OPEN), true)
    expect(document.querySelector('[data-shift-open="open"]')).toHaveFocus()
    expect(document.querySelector('[aria-busy="true"]')).toHaveTextContent('Assigning Sam…')
    expect(samPuck()).toHaveAttribute('aria-disabled', 'true')
  })

  it('leaves focus on the strip puck when a real keyboard drag is cancelled (Space, ArrowDown, Escape), and sends nothing', async () => {   // S8
    const user = userEvent.setup()
    // jsdom has no scrollIntoView, and dnd-kit's KeyboardSensor calls it when it lifts.
    const scrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    try {
      renderPage()
      samPuck().focus()
      await user.keyboard(' ')
      expect(await screen.findByText('Picked up Sam Wilson.')).toBeInTheDocument()   // the real sensor lifted it, and dnd-kit spoke our words
      await user.keyboard('{ArrowDown}{Escape}')
      expect(await screen.findByText('Cancelled. Nothing changed.')).toBeInTheDocument()
      expect(samPuck()).toHaveFocus()
      expect(h.assign).not.toHaveBeenCalled()
      expect(h.move).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = scrollIntoView
    }
  })

  it('hands focus back to the target shift when its prompt closes', async () => {
    const user = userEvent.setup()
    renderPage()
    await drop(samOffWed, onShift(ALEX_MON), true)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(document.querySelector('[data-shift-open="alex-mon"]')).toHaveFocus()
  })

  it("counts the strip's hours from the whole board, not the filtered one", () => {
    renderPage('/rostering?date=2026-08-17&participant=p-1')   // Jo's row is filtered away; Sam's Saturday with Jo still counts
    expect(samPuck()).toHaveAccessibleName('Sam Wilson, 12 of 38 hours this week')
  })

  it('passes people-named announcements and its own focus handling to dnd-kit', () => {
    renderPage()
    const props = h.dnd.props as unknown as { accessibility: { restoreFocus: boolean; announcements: unknown; screenReaderInstructions: { draggable: string } } }
    expect(props.accessibility.restoreFocus).toBe(false)
    expect(props.accessibility.screenReaderInstructions.draggable).toMatch(/^To pick up a staff member, press Space or Enter\./)
  })

  it('offers no strip, no grip and no drag on a phone', () => {
    h.screen.belowMd = true
    renderPage()
    expect(screen.queryByRole('region', { name: 'Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
    expect(h.dnd.props).toBeNull()
    expect(screen.getAllByRole('button', { name: /Needs staff/ }).length).toBeGreaterThan(0)   // the menus still assign
  })

  it('offers no strip and no grip in the Staff view', () => {
    sessionStorage.setItem('odip.roster.boardView', 'staff')
    h.board.mockReturnValue({ data: makeStaffBoard({ unfilled: [OPEN] }), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.queryByRole('region', { name: 'Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
    expect(h.dnd.props).toBeNull()
  })
})

describe('RosterBoardPage: Publish week', () => {
  // BOARD's drafts: Needs staff on Tuesday, Sam's Wednesday, Alex's Friday (on leave), Sam's Saturday with Jo. Two people, one unfilled.
  it("counts the drafts, confirms in the brief's words, publishes the week, and says what it did", async () => {
    const user = userEvent.setup()
    h.publish.mockResolvedValueOnce({ published: 4, notified: 2, unfilled: 1, skipped: 0 })
    renderPage()

    expect(screen.getByText('4 shifts not visible to staff yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish week' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Publish 17–23 Aug?' })
    expect(within(dialog).getByText('4 draft shifts go out to staff. The 2 people on them are notified. 1 still needs staff and is published as needing staff.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Publish 4 shifts' }))

    expect(h.publish).toHaveBeenCalledWith('2026-08-17')
    expect(await screen.findByText('Published 4 shifts. 2 people notified.')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows a refusal in the error Callout, and is offered on a phone too', async () => {
    const user = userEvent.setup()
    h.screen.belowMd = true
    h.publish.mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: ['Another change to the roster is still running.'] } } })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Publish week' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publish 4 shifts' }))
    expect((await screen.findByText('Another change to the roster is still running.')).closest('[role="alert"]')).not.toBeNull()
  })
})

describe('RosterBoardPage: the toolbar the board frame makes room for (finish review, 1280)', () => {
  it('reports how much taller than one row of controls the toolbar is, so a wrapped toolbar never pushes the board off the screen', () => {
    const { container } = renderPage()
    const page = container.querySelector('.animate-fade-in') as HTMLElement
    // jsdom has no layout, so the toolbar is "one row" here; the 1280x800 capture measures the wrapped case.
    expect(page.style.getPropertyValue('--roster-toolbar-extra')).toBe('0px')
  })
})
