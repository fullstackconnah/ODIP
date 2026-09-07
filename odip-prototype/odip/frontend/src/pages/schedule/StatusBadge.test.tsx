import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatusBadge from './StatusBadge'

describe('StatusBadge — keyboard accessibility (PP-9)', () => {
  it('renders the Available (assign) state as a real button, reachable via Tab and Enter', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<StatusBadge status="Available" clickable onClick={onClick} assignLabel="Assign Alex Rivera to Gold Coast Beach Break" />)

    const button = screen.getByRole('button', { name: 'Assign Alex Rivera to Gold Coast Beach Break' })
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders the Assigned (unassign) state as a real button with a descriptive label', () => {
    render(<StatusBadge status="Assigned" role="Support Worker" onUnassign={vi.fn()} unassignLabel="Unassign Alex Rivera from Gold Coast Beach Break" />)

    expect(screen.getByRole('button', { name: 'Unassign Alex Rivera from Gold Coast Beach Break' })).toBeInTheDocument()
  })

  it('falls back to a generic accessible name when no label is supplied', () => {
    render(<StatusBadge status="Available" clickable onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument()
  })
})
