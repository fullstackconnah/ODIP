import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExceptionsDrawer } from './ExceptionsDrawer'
import { makeFinding } from '../test-fixtures'
import type { RosterExceptionDto } from '@/api/types'

function makeException(overrides: Partial<RosterExceptionDto> = {}): RosterExceptionDto {
  return {
    shiftId: 'shift-1',
    participantName: 'Mia Chen',
    serviceDate: '2026-08-17',
    finding: makeFinding({ severity: 'Blocking', message: 'Staff member is already rostered elsewhere at this time.' }),
    ...overrides,
  } as RosterExceptionDto
}

describe('ExceptionsDrawer', () => {
  it('is a modal dialog named "Exceptions this week", and renders nothing while closed', () => {
    const { rerender } = render(<ExceptionsDrawer open={false} onClose={() => {}} exceptions={[]} onJumpToShift={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<ExceptionsDrawer open onClose={() => {}} exceptions={[]} onJumpToShift={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Exceptions this week' })).toHaveAttribute('aria-modal', 'true')
  })

  it('says so when there is nothing to review', () => {
    render(<ExceptionsDrawer open onClose={() => {}} exceptions={[]} onJumpToShift={() => {}} />)
    expect(screen.getByText('No exceptions this week')).toBeInTheDocument()
  })

  it('lists each exception as a button that jumps to its shift; one without a shift cannot be opened', async () => {
    const user = userEvent.setup()
    const onJumpToShift = vi.fn()
    render(
      <ExceptionsDrawer
        open
        onClose={() => {}}
        onJumpToShift={onJumpToShift}
        exceptions={[makeException(), makeException({ shiftId: null, participantName: 'Noah Bennett' })]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Mia Chen/ }))
    expect(onJumpToShift).toHaveBeenCalledWith('shift-1')
    expect(screen.getByRole('button', { name: /Noah Bennett/ })).toBeDisabled()
  })

  it('closes on Escape, the close button and the scrim; focus starts on the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExceptionsDrawer open onClose={onClose} exceptions={[makeException()]} onJumpToShift={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
