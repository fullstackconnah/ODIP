import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RosterDayCell } from './RosterDayCell'
import { makeShift } from '../test-fixtures'

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
