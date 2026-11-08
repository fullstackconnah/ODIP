import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RosterDayCell, type RosterDayCellProps } from './RosterDayCell'
import { makeShift, makeActivity } from '../test-fixtures'
import { ActivityContext } from '../lib/groupActivities'

// What dnd-kit says is carried. Null (nothing) for every test that does not set it.
const dnd = vi.hoisted(() => ({ active: null as null | { id: string } }))
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return { ...actual, useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => ({ ...actual.useDroppable(args), active: dnd.active as never }) }
})
afterEach(() => { dnd.active = null })

function noop() {}

const ADD_LABEL = 'Add a shift for Mia Chen on Wednesday 19 August'

describe('RosterDayCell — empty cell affordance', () => {
  it('renders a real button naming the participant and date when writable', () => {
    render(
      <RosterDayCell
        day="2026-08-19"
        dayIndex={2}
        shifts={[]}
        canWrite
        addLabel={ADD_LABEL}
        onAdd={noop}
        onOpen={noop}
        onAssignTo={noop}
        onUnassign={noop}
        onDelete={noop}
      />,
    )
    const button = screen.getByRole('button', { name: ADD_LABEL })
    expect(button.tagName).toBe('BUTTON')
  })

  it('renders no button at all when read-only', () => {
    render(
      <RosterDayCell
        day="2026-08-19"
        dayIndex={2}
        shifts={[]}
        canWrite={false}
        addLabel={ADD_LABEL}
        onAdd={noop}
        onOpen={noop}
        onAssignTo={noop}
        onUnassign={noop}
        onDelete={noop}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('activates the add button on Enter', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <RosterDayCell
        day="2026-08-19"
        dayIndex={2}
        shifts={[]}
        canWrite
        addLabel={ADD_LABEL}
        onAdd={onAdd}
        onOpen={noop}
        onAssignTo={noop}
        onUnassign={noop}
        onDelete={noop}
      />,
    )
    screen.getByRole('button', { name: ADD_LABEL }).focus()
    await user.keyboard('{Enter}')
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('activates the add button on Space', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <RosterDayCell
        day="2026-08-19"
        dayIndex={2}
        shifts={[]}
        canWrite
        addLabel={ADD_LABEL}
        onAdd={onAdd}
        onOpen={noop}
        onAssignTo={noop}
        onUnassign={noop}
        onDelete={noop}
      />,
    )
    screen.getByRole('button', { name: ADD_LABEL }).focus()
    await user.keyboard(' ')
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})

describe('RosterDayCell — chip context and height', () => {
  const baseProps = {
    day: '2026-08-19',
    dayIndex: 2,
    canWrite: true,
    addLabel: ADD_LABEL,
    onAdd: noop,
    onOpen: noop,
    onAssignTo: noop,
    onUnassign: noop,
    onDelete: noop,
  }

  it('forwards chipContext so a participant row labels its chips with the covering staff member', () => {
    const shift = makeShift({ participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Rivera' })
    render(<MemoryRouter><RosterDayCell {...baseProps} shifts={[shift]} chipContext="participant" /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Alex Rivera' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mia Chen' })).not.toBeInTheDocument()
  })

  it('defaults to a staff row: the chip is labelled with the participant', () => {
    const shift = makeShift({ participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Rivera' })
    render(<MemoryRouter><RosterDayCell {...baseProps} shifts={[shift]} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Mia Chen' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Alex Rivera' })).not.toBeInTheDocument()
  })

  it('is --row-h less the 1px row rule tall, whether empty or holding a chip', () => {
    const { container, unmount } = render(<RosterDayCell {...baseProps} shifts={[]} />)
    expect(container.firstElementChild).toHaveClass('min-h-[calc(var(--row-h)_-_1px)]')
    unmount()

    const filled = render(<MemoryRouter><RosterDayCell {...baseProps} shifts={[makeShift()]} /></MemoryRouter>)
    expect(filled.container.firstElementChild).toHaveClass('min-h-[calc(var(--row-h)_-_1px)]')
  })
})

describe('RosterDayCell — the new-shift slot while a person is carried (the brief, section 7)', () => {
  const dayTarget = { kind: 'day' as const, participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-19' }
  const cell = (props: Partial<RosterDayCellProps> = {}) => render(
    <MemoryRouter>
      <RosterDayCell day="2026-08-19" dayIndex={2} canWrite addLabel={ADD_LABEL} shifts={[makeShift({ id: 'a', staffName: 'Sam Wilson' })]} chipContext="participant" draggable dayTarget={dayTarget}
        onAdd={noop} onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} {...props} />
    </MemoryRouter>,
  )

  it('has no slot at rest, and every chip keeps its menu', () => {
    const { container } = cell()
    expect(container.querySelector('[data-day-slot]')).toBeNull()
    expect(screen.getByRole('button', { name: /^Actions for/ })).toBeInTheDocument()
  })

  it('drops every chip menu while a person is carried, and gives the day a slot of exactly that room, so no chip text moves and no row grows', () => {
    dnd.active = { id: 'staff:s-1' }
    const { container } = cell()
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
    const day = container.firstElementChild as HTMLElement
    // The menu column was the menu's 2px pad plus a --control-h-sm button: the day's padding grows by exactly that, and the slot fills it.
    expect(day).toHaveClass('relative', 'pr-[calc(var(--control-h-sm)_+_4px)]')
    const slot = container.querySelector('[data-day-slot="2026-08-19"]') as HTMLElement
    expect(slot).toHaveClass('absolute', 'right-0.5', 'w-[calc(var(--control-h-sm)_+_2px)]')
    expect(slot).toHaveAttribute('aria-hidden', 'true')
    expect(slot.querySelector('svg')).not.toBeNull()
  })

  it('gives a reader no slot', () => {
    dnd.active = { id: 'staff:s-1' }
    const { container } = cell({ canWrite: false })
    expect(container.querySelector('[data-day-slot]')).toBeNull()
  })

  // The chip brief, section 6: the only carry hint. The new ad-hoc zones show before the pointer gets there; at rest the Plus stays transparent until hover or focus.
  it('shows an empty writable day its Plus in muted ink while a person is carried, and keeps it transparent at rest', () => {
    const { unmount } = cell({ shifts: [] })
    expect(screen.getByRole('button', { name: ADD_LABEL })).toHaveClass('text-transparent')
    unmount()
    dnd.active = { id: 'staff:s-1' }
    cell({ shifts: [] })
    const day = screen.getByRole('button', { name: ADD_LABEL })
    expect(day).toHaveClass('text-muted-foreground')
    expect(day).not.toHaveClass('text-transparent')
  })
})

describe('RosterDayCell: group activity cards (flag on)', () => {
  const activity = makeActivity({ id: 'act-1', startTime: '11:00:00', endTime: '15:00:00' })
  const board = { byId: new Map([[activity.id, activity]]), open: vi.fn(), removePerson: noop, addShift: noop, busyIds: new Set<string>() }
  const cell = (shifts: ReturnType<typeof makeShift>[], context: 'participant' | 'staff', on = true) => render(
    <MemoryRouter>
      <ActivityContext.Provider value={on ? board : null}>
        <RosterDayCell day="2026-08-17" dayIndex={0} canWrite addLabel={ADD_LABEL} shifts={shifts} chipContext={context} onAdd={noop} onOpen={noop} onAssignTo={noop} onUnassign={noop} onDelete={noop} />
      </ActivityContext.Provider>
    </MemoryRouter>,
  )
  const attached = [makeShift({ id: 's1', groupActivityId: 'act-1', startTime: '11:00:00' }), makeShift({ id: 's2', groupActivityId: 'act-1', startTime: '11:00:00' })]

  it('draws an attached shift as the activity card (a 2:1 pair once) beside the plain chips, ordered by start time', () => {
    const { container } = cell([makeShift({ id: 'late', startTime: '16:00:00' }), ...attached, makeShift({ id: 'early', startTime: '08:00:00' })], 'participant')
    expect(container.querySelectorAll('[data-activity-card]')).toHaveLength(1)
    const order = [...container.querySelectorAll('[data-activity-card], [data-shift-chip]')].map(el => el.getAttribute('data-activity-card') ?? 'chip')
    expect(order).toEqual(['chip', 'act-1', 'chip'])
  })

  it('keeps plain chips in the Staff view and with the flag off', () => {
    const { container, unmount } = cell(attached, 'staff')
    expect(container.querySelector('[data-activity-card]')).toBeNull()
    unmount()
    const off = cell(attached, 'participant', false)
    expect(off.container.querySelector('[data-activity-card]')).toBeNull()
  })
})
