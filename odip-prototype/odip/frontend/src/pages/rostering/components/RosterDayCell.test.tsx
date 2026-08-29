import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RosterDayCell } from './RosterDayCell'

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
